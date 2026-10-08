import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { adCampaigns, broadcastRecipients, broadcasts, contacts, integrations, leads, leadSources, metricDaily, postSchedules, socialPosts, stages } from '../db/schema.js';
import { addDays, wibDateString } from '../lib/time.js';
import { badRequest, notFound } from '../lib/http.js';
import { notify, usersWithRole } from './notify.js';
import { rupiahShort } from './insights.js';

// Angka pemasaran (Meta Ads, media sosial, website). Biaya & statistik dari platform,
// lead/closing/omzet dari CRM — semuanya dihitung script.

const num = (v: unknown) => Number(v ?? 0);
const omzetExpr = sql<number>`coalesce(${leads.dealValue}, ${leads.estimatedValue}, ${leads.budget}, 0)`;

export interface Range {
  from: string; // YYYY-MM-DD (WIB, inklusif)
  to: string; // inklusif
}

export function rangeOf(days: number, now = new Date()): Range {
  return { from: wibDateString(addDays(now, -(days - 1))), to: wibDateString(now) };
}
export function prevRange(r: Range): Range {
  const len = (new Date(r.to).getTime() - new Date(r.from).getTime()) / 86_400_000 + 1;
  const to = new Date(new Date(r.from).getTime() - 86_400_000);
  return { from: new Date(to.getTime() - (len - 1) * 86_400_000).toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
const startOf = (d: string) => new Date(`${d}T00:00:00+07:00`);
const endOf = (d: string) => new Date(new Date(`${d}T00:00:00+07:00`).getTime() + 86_400_000);

async function metricSum(ctx: Ctx, provider: string, metric: string, r: Range, dim?: string) {
  const conds = [eq(metricDaily.provider, provider), eq(metricDaily.metric, metric), gte(metricDaily.day, r.from), lte(metricDaily.day, r.to)];
  if (dim !== undefined) conds.push(eq(metricDaily.dim, dim));
  const [x] = await ctx.db.select({ v: sql<number>`coalesce(sum(${metricDaily.value}),0)` }).from(metricDaily).where(and(...conds));
  return num(x?.v);
}

async function metricByDim(ctx: Ctx, provider: string, metric: string, r: Range) {
  const rows = await ctx.db
    .select({ dim: metricDaily.dim, v: sql<number>`sum(${metricDaily.value})` })
    .from(metricDaily)
    .where(and(eq(metricDaily.provider, provider), eq(metricDaily.metric, metric), gte(metricDaily.day, r.from), lte(metricDaily.day, r.to)))
    .groupBy(metricDaily.dim);
  return new Map(rows.map((x) => [x.dim, num(x.v)]));
}

async function metricByDay(ctx: Ctx, provider: string, metric: string, r: Range) {
  const rows = await ctx.db
    .select({ day: metricDaily.day, v: sql<number>`sum(${metricDaily.value})` })
    .from(metricDaily)
    .where(and(eq(metricDaily.provider, provider), eq(metricDaily.metric, metric), gte(metricDaily.day, r.from), lte(metricDaily.day, r.to)))
    .groupBy(metricDaily.day);
  return new Map(rows.map((x) => [String(x.day), num(x.v)]));
}

const integrationInfo = async (ctx: Ctx, provider: string) =>
  (await ctx.db.select({ id: integrations.id, name: integrations.accountName, status: integrations.status, lastSyncAt: integrations.lastSyncAt, lastError: integrations.lastError, meta: integrations.meta }).from(integrations).where(and(eq(integrations.provider, provider), inArray(integrations.status, ['connected', 'error'])))) ?? [];

// ---------------------------------------------------------------- Meta Ads

/** Kampanye + belanja (Meta/manual) + lead, skor, closing & omzet dari CRM (via id iklan click-to-WhatsApp). */
export async function adsView(ctx: Ctx, r: Range) {
  const camps = await ctx.db.select().from(adCampaigns).orderBy(asc(adCampaigns.name));
  const spend = await metricByDim(ctx, 'meta_ads', 'spend', r);
  const impressions = await metricByDim(ctx, 'meta_ads', 'impressions', r);
  const clicks = await metricByDim(ctx, 'meta_ads', 'clicks', r);
  const chats = await metricByDim(ctx, 'meta_ads', 'wa_chats', r);
  const [igads] = await ctx.db.select().from(leadSources).where(eq(leadSources.refCode, 'IGADS'));

  // Lead dari iklan (sumber IG/Meta Ads) yang dibuat dalam periode
  const adLeads = await ctx.db
    .select({ id: leads.id, adRefId: contacts.adRefId, score: leads.score, kind: stages.kind, value: omzetExpr })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(gte(leads.createdAt, startOf(r.from)), lt(leads.createdAt, endOf(r.to)), igads ? eq(leads.sourceId, igads.id) : sql`false`));
  const byAd = new Map<string, typeof adLeads>();
  for (const l of adLeads) if (l.adRefId) byAd.set(l.adRefId, [...(byAd.get(l.adRefId) ?? []), l]);
  const matched = new Set<string>();

  const rows = camps.map((c) => {
    const ls = c.adIds.flatMap((a) => byAd.get(a) ?? []);
    for (const l of ls) matched.add(l.id);
    const won = ls.filter((l) => l.kind === 'won');
    const sp = spend.get(c.externalId) ?? 0;
    return {
      id: c.id,
      externalId: c.externalId,
      name: c.name,
      objective: c.objective,
      status: c.status,
      manual: c.externalId.startsWith('manual.'),
      spend: sp,
      impressions: impressions.get(c.externalId) ?? 0,
      clicks: clicks.get(c.externalId) ?? 0,
      waChats: chats.get(c.externalId) ?? 0,
      leads: ls.length,
      cpl: ls.length ? Math.round(sp / ls.length) : null,
      avgScore: ls.length ? Math.round(ls.reduce((a, l) => a + l.score, 0) / ls.length) : null,
      closings: won.length,
      costPerClosing: won.length ? Math.round(sp / won.length) : null,
      omzet: won.reduce((a, l) => a + num(l.value), 0),
    };
  });
  const unmatched = adLeads.filter((l) => !matched.has(l.id));
  const unknownAdIds = [...new Set(unmatched.map((l) => l.adRefId).filter(Boolean))] as string[];
  const totalSpend = [...spend.values()].reduce((a, b) => a + b, 0);
  const won = adLeads.filter((l) => l.kind === 'won');
  const omzet = won.reduce((a, l) => a + num(l.value), 0);

  // Catatan script: lead termurah vs kualitasnya
  const notes: string[] = [];
  const withLeads = rows.filter((x) => x.leads >= 3 && x.cpl !== null);
  if (withLeads.length >= 2) {
    const cheapest = [...withLeads].sort((a, b) => a.cpl! - b.cpl!)[0]!;
    const lowQ = [...withLeads].sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0))[0]!;
    notes.push(`${cheapest.name} memberi lead termurah (${rupiahShort(cheapest.cpl!)}/lead, skor rata-rata ${cheapest.avgScore}).`);
    if (lowQ.id !== cheapest.id) notes.push(`${lowQ.name} skor lead rata-ratanya paling rendah (${lowQ.avgScore}) — cek target audiensnya.`);
    const priciest = withLeads.filter((x) => x.costPerClosing !== null).sort((a, b) => b.costPerClosing! - a.costPerClosing!)[0];
    if (priciest) notes.push(`Biaya per closing tertinggi: ${priciest.name} (${rupiahShort(priciest.costPerClosing!)}).`);
  }
  if (unmatched.length) notes.push(`${unmatched.length} lead iklan belum terhubung ke kampanye (id iklan belum dikenal). ${unknownAdIds.length ? 'Petakan id iklannya di bawah.' : 'Lead ini datang tanpa id iklan.'}`);

  return {
    connections: await integrationInfo(ctx, 'meta_ads'),
    kpi: {
      spend: totalSpend,
      leads: adLeads.length,
      cpl: adLeads.length ? Math.round(totalSpend / adLeads.length) : null,
      closings: won.length,
      costPerClosing: won.length ? Math.round(totalSpend / won.length) : null,
      omzet,
      roas: totalSpend ? Math.round((omzet / totalSpend) * 10) / 10 : null,
    },
    campaigns: rows.sort((a, b) => b.spend - a.spend || b.leads - a.leads),
    unmatchedLeads: unmatched.length,
    unknownAdIds: unknownAdIds.slice(0, 50),
    notes,
  };
}

export async function addManualCampaign(ctx: Ctx, name: string, objective: string | null) {
  const ext = `manual.${Date.now().toString(36)}`;
  const [c] = await ctx.db.insert(adCampaigns).values({ externalId: ext, name, objective, status: 'ACTIVE' }).returning();
  return c!;
}

/** Belanja manual per bulan (dipakai selama Meta Ads belum terhubung). */
export async function setManualSpend(ctx: Ctx, campaignId: string, month: string, amount: number) {
  const [c] = await ctx.db.select().from(adCampaigns).where(eq(adCampaigns.id, campaignId));
  if (!c) throw notFound('Kampanye tidak ditemukan');
  const day = `${month}-01`;
  await ctx.db
    .insert(metricDaily)
    .values({ provider: 'meta_ads', metric: 'spend', dim: c.externalId, day, value: amount, manual: true })
    .onConflictDoUpdate({ target: [metricDaily.provider, metricDaily.account, metricDaily.metric, metricDaily.dim, metricDaily.day], set: { value: amount, manual: true } });
}

export async function mapAdId(ctx: Ctx, campaignId: string, adId: string) {
  const [c] = await ctx.db.select().from(adCampaigns).where(eq(adCampaigns.id, campaignId));
  if (!c) throw notFound('Kampanye tidak ditemukan');
  if (!c.adIds.includes(adId)) await ctx.db.update(adCampaigns).set({ adIds: [...c.adIds, adId], updatedAt: new Date() }).where(eq(adCampaigns.id, c.id));
}

/** Belanja iklan & broadcast dalam periode (untuk kolom biaya di Dashboard › Marketing). */
export async function channelCosts(ctx: Ctx, start: Date, end: Date) {
  const ads = await metricSum(ctx, 'meta_ads', 'spend', { from: wibDateString(start), to: wibDateString(new Date(end.getTime() - 1)) });
  const [bc] = await ctx.db
    .select({ v: sql<number>`coalesce(sum(${broadcasts.costPerMsg}),0)` })
    .from(broadcastRecipients)
    .innerJoin(broadcasts, eq(broadcasts.id, broadcastRecipients.broadcastId))
    .where(and(inArray(broadcastRecipients.status, ['sent', 'delivered', 'read']), gte(broadcastRecipients.sentAt, start), lt(broadcastRecipients.sentAt, end)));
  return { IGADS: ads, BC: num(bc?.v) };
}

// ---------------------------------------------------------------- Media sosial

const PLATFORMS = ['instagram', 'tiktok', 'facebook'] as const;

export async function socialView(ctx: Ctx, r: Range, platforms: string[] = [...PLATFORMS]) {
  const prev = prevRange(r);
  const load = (rr: Range) =>
    ctx.db
      .select()
      .from(socialPosts)
      .where(and(inArray(socialPosts.provider, platforms.length ? platforms : ['none']), gte(socialPosts.publishedAt, startOf(rr.from)), lt(socialPosts.publishedAt, endOf(rr.to))));
  const [now, before] = await Promise.all([load(r), load(prev)]);
  const agg = (xs: typeof now) => ({
    posts: xs.length,
    likes: xs.reduce((a, p) => a + p.likes, 0),
    comments: xs.reduce((a, p) => a + p.comments, 0),
    shares: xs.reduce((a, p) => a + p.shares, 0),
    impressions: xs.reduce((a, p) => a + (p.impressions || p.views), 0),
    reach: xs.reduce((a, p) => a + p.reach, 0),
  });
  const conns = await ctx.db.select({ provider: integrations.provider, name: integrations.accountName, status: integrations.status, lastSyncAt: integrations.lastSyncAt }).from(integrations).where(and(inArray(integrations.provider, [...PLATFORMS]), inArray(integrations.status, ['connected', 'error'])));
  // Jumlah pengikut terbaru per akun, dijumlah bila ada lebih dari satu akun di platform yang sama.
  const followers = async (p: string) => {
    const xs = await ctx.db.select({ account: metricDaily.account, v: metricDaily.value }).from(metricDaily).where(and(eq(metricDaily.provider, p), eq(metricDaily.metric, 'followers'))).orderBy(desc(metricDaily.day)).limit(400);
    if (!xs.length) return null;
    const latest = new Map<string, number>();
    for (const x of xs) if (!latest.has(x.account)) latest.set(x.account, num(x.v));
    return [...latest.values()].reduce((a, b) => a + b, 0);
  };
  const perPlatform = await Promise.all(
    PLATFORMS.map(async (p) => {
      const a = agg(now.filter((x) => x.provider === p));
      const b = agg(before.filter((x) => x.provider === p));
      return { provider: p, connected: conns.find((c) => c.provider === p) ?? null, followers: await followers(p), ...a, impressionsPrev: b.impressions };
    }),
  );
  // Harian: impressions per platform dari posting yang terbit hari itu + jumlah posting
  const days: string[] = [];
  for (let d = new Date(r.from + 'T00:00:00Z'); d <= new Date(r.to + 'T00:00:00Z'); d = new Date(d.getTime() + 86_400_000)) days.push(d.toISOString().slice(0, 10));
  const daily = days.map((day) => {
    const ps = now.filter((p) => wibDateString(p.publishedAt) === day);
    return { day, posts: ps.length, values: PLATFORMS.map((pl) => ps.filter((p) => p.provider === pl).reduce((a, p) => a + (p.impressions || p.views), 0)) };
  });
  const top = [...now].sort((a, b) => b.likes - a.likes).slice(0, 5).map((p) => ({ provider: p.provider, caption: p.caption.slice(0, 140), likes: p.likes, comments: p.comments, shares: p.shares, permalink: p.permalink, publishedAt: p.publishedAt }));
  return { kpi: { ...agg(now), prev: agg(before) }, perPlatform, daily, top };
}

// ---------- Jadwal posting ----------

export async function listSchedule(ctx: Ctx, from: Date, to: Date) {
  return ctx.db.select().from(postSchedules).where(and(gte(postSchedules.scheduledAt, from), lt(postSchedules.scheduledAt, to))).orderBy(asc(postSchedules.scheduledAt));
}

/** Worker: terbitkan posting yang jatuh tempo. Instagram/Facebook lewat API; TikTok & akun belum terhubung → pengingat manual. */
export async function runPostSchedules(ctx: Ctx, now = new Date()) {
  const due = await ctx.db.select().from(postSchedules).where(and(eq(postSchedules.status, 'scheduled'), lte(postSchedules.scheduledAt, now))).limit(10);
  const base = ctx.config.PUBLIC_URL.replace(/\/$/, '');
  let done = 0;
  for (const p of due) {
    const results: Record<string, { ok: boolean; id?: string; error?: string }> = {};
    const manual: string[] = [];
    for (const pl of p.platforms) {
      const [i] = await ctx.db.select().from(integrations).where(and(eq(integrations.provider, pl), eq(integrations.status, 'connected'))).limit(1);
      if (!i || pl === 'tiktok' || (pl === 'instagram' && !p.mediaPath)) {
        manual.push(pl);
        results[pl] = { ok: false, error: !i ? 'Akun belum terhubung — posting manual' : pl === 'tiktok' ? 'TikTok: posting manual (API posting butuh audit TikTok)' : 'Instagram butuh gambar' };
        continue;
      }
      try {
        const { credFor } = await import('../integrations/service.js');
        const { publishFacebook, publishInstagram } = await import('../integrations/meta.js');
        const cred = await credFor(ctx, i);
        const img = p.mediaPath ? `${base}/api/public/media/${p.mediaPath}` : null;
        const id = pl === 'instagram' ? await publishInstagram(cred, i.accountId, img!, p.caption) : await publishFacebook(cred, i.accountId, p.caption, img);
        results[pl] = { ok: true, id };
      } catch (e) {
        results[pl] = { ok: false, error: (e as Error).message.slice(0, 200) };
      }
    }
    const oks = Object.values(results).filter((x) => x.ok).length;
    const status = manual.length === p.platforms.length ? 'manual' : oks === p.platforms.length ? 'published' : oks ? 'partial' : 'failed';
    await ctx.db.update(postSchedules).set({ status, results }).where(eq(postSchedules.id, p.id));
    if (status !== 'published') {
      const team = await usersWithRole(ctx, 'marketing', 'admin');
      const label = p.caption.slice(0, 50);
      await notify(ctx, team, 'sistem', status === 'manual' ? `Waktunya posting manual (${manual.join(', ')}): "${label}…"` : `Posting gagal terbit sebagian: "${label}…" — cek Media Sosial › Jadwal`, '/sosmed?tab=plan');
    }
    done++;
  }
  return done;
}

export function validatePlatforms(ps: string[]) {
  const bad = ps.filter((p) => !(PLATFORMS as readonly string[]).includes(p));
  if (bad.length || !ps.length) throw badRequest('Pilih minimal satu platform: instagram, facebook, tiktok');
}

// ---------------------------------------------------------------- Website

export async function websiteView(ctx: Ctx, r: Range) {
  const prev = prevRange(r);
  const [users, usersPrev, sessions, sessionsPrev, pageviews, durTotal] = await Promise.all([
    metricSum(ctx, 'ga4', 'users', r),
    metricSum(ctx, 'ga4', 'users', prev),
    metricSum(ctx, 'ga4', 'sessions', r),
    metricSum(ctx, 'ga4', 'sessions', prev),
    metricSum(ctx, 'ga4', 'pageviews', r),
    metricSum(ctx, 'ga4', 'avg_session_sec', r),
  ]);
  const dailyUsers = await metricByDay(ctx, 'ga4', 'users', r);
  const days: string[] = [];
  for (let d = new Date(r.from + 'T00:00:00Z'); d <= new Date(r.to + 'T00:00:00Z'); d = new Date(d.getTime() + 86_400_000)) days.push(d.toISOString().slice(0, 10));
  const daysWithData = days.filter((d) => dailyUsers.has(d)).length;
  const channels = [...(await metricByDim(ctx, 'ga4', 'sessions_by_channel', r)).entries()].map(([k, v]) => ({ channel: k, sessions: v })).sort((a, b) => b.sessions - a.sessions);
  const pages = [...(await metricByDim(ctx, 'ga4', 'pageviews_by_page', r)).entries()].map(([k, v]) => ({ page: k, views: v })).sort((a, b) => b.views - a.views).slice(0, 10);
  // Kata kunci: ambil potret terbaru dalam periode
  const [lastQ] = await ctx.db.select({ day: metricDaily.day }).from(metricDaily).where(and(eq(metricDaily.provider, 'gsc'), eq(metricDaily.metric, 'query_clicks'), lte(metricDaily.day, r.to))).orderBy(desc(metricDaily.day)).limit(1);
  let keywords: { query: string; clicks: number; impressions: number; position: number | null }[] = [];
  if (lastQ) {
    const q = await ctx.db.select().from(metricDaily).where(and(eq(metricDaily.provider, 'gsc'), eq(metricDaily.day, lastQ.day), inArray(metricDaily.metric, ['query_clicks', 'query_impressions', 'query_position'])));
    const byQ = new Map<string, { clicks: number; impressions: number; position: number | null }>();
    for (const m of q) {
      const e = byQ.get(m.dim) ?? { clicks: 0, impressions: 0, position: null };
      if (m.metric === 'query_clicks') e.clicks += num(m.value); // dijumlah bila ada beberapa situs
      if (m.metric === 'query_impressions') e.impressions += num(m.value);
      if (m.metric === 'query_position') e.position = e.position === null ? num(m.value) : Math.min(e.position, num(m.value));
      byQ.set(m.dim, e);
    }
    keywords = [...byQ.entries()].map(([query, v]) => ({ query, ...v })).sort((a, b) => b.clicks - a.clicks).slice(0, 15);
  }
  const searchClicks = await metricSum(ctx, 'gsc', 'clicks', r);

  // Lead dari website (form, widget, tombol WA bertanda WEB)
  const [web] = await ctx.db.select().from(leadSources).where(eq(leadSources.refCode, 'WEB'));
  const webLeads = web ? await ctx.db.select({ id: leads.id, kind: stages.kind }).from(leads).innerJoin(stages, eq(stages.id, leads.stageId)).where(and(eq(leads.sourceId, web.id), gte(leads.createdAt, startOf(r.from)), lt(leads.createdAt, endOf(r.to)))) : [];
  const webLeadsPrev = web ? num((await ctx.db.select({ n: sql<number>`count(*)` }).from(leads).where(and(eq(leads.sourceId, web.id), gte(leads.createdAt, startOf(prev.from)), lt(leads.createdAt, endOf(prev.to)))))[0]?.n) : 0;

  // Status website dari pemantau
  const monitors = await ctx.db.select().from(integrations).where(and(eq(integrations.provider, 'uptime'), eq(integrations.status, 'connected')));
  const status = await Promise.all(
    monitors.map(async (m) => {
      const checks = await metricSum(ctx, 'uptime', 'checks', r, m.accountId);
      const up = await metricSum(ctx, 'uptime', 'up', r, m.accountId);
      const ms = await metricSum(ctx, 'uptime', 'ms_total', r, m.accountId);
      const st = (m.meta as any).uptime ?? {};
      return { name: m.accountName, url: m.accountId, up: st.up ?? null, lastMs: st.lastMs ?? null, checkedAt: st.checkedAt ?? null, downSince: st.downSince ?? null, uptimePct: checks ? Math.round((up / checks) * 1000) / 10 : null, avgMs: up ? Math.round(ms / up) : null };
    }),
  );

  // Catatan script
  const alerts: { level: 'bad' | 'warn' | 'info'; text: string }[] = [];
  for (const s of status) if (s.up === false) alerts.push({ level: 'bad', text: `${s.name} tidak bisa dibuka sejak ${s.downSince ? new Date(s.downSince).toLocaleString('id-ID') : 'baru saja'}.` });
  for (const s of status) if (s.avgMs && s.avgMs > 3000) alerts.push({ level: 'warn', text: `${s.name} lambat (rata-rata ${(s.avgMs / 1000).toFixed(1)} detik). Pengunjung HP mudah menutup halaman.` });
  if (usersPrev && users < usersPrev * 0.8) alerts.push({ level: 'warn', text: `Pengunjung turun ${Math.round((1 - users / usersPrev) * 100)}% dibanding periode sebelumnya.` });
  if (sessions >= 200 && webLeads.length / sessions < 0.005) alerts.push({ level: 'info', text: `Hanya ${webLeads.length} lead dari ${sessions.toLocaleString('id-ID')} sesi. Pertimbangkan tombol WA / form di halaman paket yang paling sering dibuka.` });

  return {
    connections: { ga4: await integrationInfo(ctx, 'ga4'), gsc: await integrationInfo(ctx, 'gsc'), uptime: monitors.length },
    kpi: {
      users,
      usersPrev,
      sessions,
      sessionsPrev,
      pageviews,
      avgSessionSec: daysWithData ? Math.round(durTotal / daysWithData) : null,
      searchClicks,
      leads: webLeads.length,
      leadsPrev: webLeadsPrev,
      closings: webLeads.filter((l) => l.kind === 'won').length,
      conversion: sessions ? Math.round((webLeads.length / sessions) * 10000) / 100 : null,
    },
    daily: days.map((d) => ({ day: d, users: dailyUsers.get(d) ?? 0 })),
    channels,
    pages,
    keywords,
    status,
    alerts,
  };
}

