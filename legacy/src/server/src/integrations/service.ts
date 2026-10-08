import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { adCampaigns, integrations, metricDaily, reviews, socialPosts } from '../db/schema.js';
import { randomToken, last4 } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/http.js';
import { getSetting, setSetting } from '../services/settings.js';
import { notify, usersWithRole } from '../services/notify.js';
import { wibDateString } from '../lib/time.js';
import { FAMILY_PROVIDERS, PROVIDERS, type AuthFamily, type ProviderId } from './catalog.js';
import { callJson, PlatformError } from './http.js';
import type { AccountOption, AppCreds, Cred, SyncOutput } from './types.js';
import { metaAuthorizeUrl, metaDiscover, metaExchangeCode, metaTokenExpiry, syncFacebook, syncInstagram, syncMetaAds } from './meta.js';
import { googleAuthorizeUrl, googleDiscover, googleExchangeCode, googleFresh, syncGa4, syncGbp, syncGsc } from './google.js';
import { syncTiktok, tiktokAuthorizeUrl, tiktokDiscover, tiktokExchangeCode, tiktokFresh } from './tiktok.js';

export type Integration = typeof integrations.$inferSelect;
type Family = Exclude<AuthFamily, 'none'>;

// ---------------------------------------------------------------- Kredensial aplikasi (App ID / Client ID)

interface StoredApps {
  [k: string]: { id: string; secretEnc: string; last4: string; updatedAt: string } | undefined;
}

export async function getApp(ctx: Ctx, family: Family): Promise<AppCreds | null> {
  const s = await getSetting<StoredApps>(ctx.db, 'integration_apps');
  const a = s?.[family];
  return a ? { id: a.id, secret: ctx.box.decrypt(a.secretEnc) } : null;
}

export async function appsPublic(ctx: Ctx) {
  const s = (await getSetting<StoredApps>(ctx.db, 'integration_apps')) ?? {};
  const out: Record<string, { id: string; secret: string; updatedAt: string; redirectUri: string } | { id: null; redirectUri: string }> = {};
  for (const f of ['meta', 'google', 'tiktok'] as Family[]) {
    const a = s[f];
    out[f] = a ? { id: a.id, secret: a.last4, updatedAt: a.updatedAt, redirectUri: redirectUri(ctx, f) } : { id: null, redirectUri: redirectUri(ctx, f) };
  }
  return out;
}

export async function saveApp(ctx: Ctx, family: Family, id: string, secret: string) {
  const s = (await getSetting<StoredApps>(ctx.db, 'integration_apps')) ?? {};
  s[family] = { id: id.trim(), secretEnc: ctx.box.encrypt(secret.trim()), last4: last4(secret.trim()), updatedAt: new Date().toISOString() };
  await setSetting(ctx.db, 'integration_apps', s);
}

export const redirectUri = (ctx: Ctx, family: Family) => `${ctx.config.PUBLIC_URL.replace(/\/$/, '')}/api/integrations/oauth/${family}/callback`;

// ---------------------------------------------------------------- Login & pilih akun

interface Grant {
  family: Family;
  userId: string;
  createdAt: number;
  accounts?: AccountOption[];
  error?: string;
}
const grants = new Map<string, Grant>();
const GRANT_TTL = 20 * 60_000;

function sweep() {
  for (const [k, g] of grants) if (Date.now() - g.createdAt > GRANT_TTL) grants.delete(k);
}

export async function startOAuth(ctx: Ctx, family: Family, userId: string) {
  const app = await getApp(ctx, family);
  if (!app) throw badRequest(`Isi dulu ${family === 'meta' ? 'App ID & App Secret Meta' : family === 'google' ? 'Client ID & Client Secret Google' : 'Client key & secret TikTok'} di bagian "Aplikasi developer".`);
  sweep();
  const state = randomToken(18);
  grants.set(state, { family, userId, createdAt: Date.now() });
  const uri = redirectUri(ctx, family);
  const url = family === 'meta' ? metaAuthorizeUrl(app, uri, state) : family === 'google' ? googleAuthorizeUrl(app, uri, state) : tiktokAuthorizeUrl(app, uri, state);
  return { url, state };
}

/** Dipanggil saat platform mengarahkan balik ke CRM. Mengembalikan state untuk dibuka di halaman Integrasi. */
export async function finishOAuth(ctx: Ctx, family: Family, state: string, code: string | undefined, error: string | undefined) {
  const g = grants.get(state);
  if (!g || g.family !== family) throw badRequest('Sesi login kedaluwarsa — ulangi dari Pengaturan › Integrasi');
  if (error || !code) {
    g.error = error ?? 'Login dibatalkan';
    return state;
  }
  try {
    const app = (await getApp(ctx, family))!;
    const uri = redirectUri(ctx, family);
    const cred = family === 'meta' ? await metaExchangeCode(app, uri, code) : family === 'google' ? await googleExchangeCode(app, uri, code) : await tiktokExchangeCode(app, uri, code);
    g.accounts = family === 'meta' ? await metaDiscover(cred) : family === 'google' ? await googleDiscover(cred) : await tiktokDiscover(cred);
  } catch (e) {
    g.error = (e as Error).message;
  }
  return state;
}

/** Jalur Meta yang disarankan: tempel token System User dari Business Manager. */
export async function grantFromMetaToken(ctx: Ctx, token: string, userId: string) {
  sweep();
  let cred: Cred = { accessToken: token.trim(), expiresAt: null };
  const app = await getApp(ctx, 'meta');
  cred.expiresAt = await metaTokenExpiry(cred.accessToken, app);
  const accounts = await metaDiscover(cred);
  const state = randomToken(18);
  grants.set(state, { family: 'meta', userId, createdAt: Date.now(), accounts });
  return state;
}

export function grantAccounts(state: string, userId: string) {
  const g = grants.get(state);
  if (!g || g.userId !== userId) throw notFound('Sesi login kedaluwarsa — ulangi');
  return { family: g.family, error: g.error ?? null, accounts: (g.accounts ?? []).map(({ cred, ...a }) => ({ ...a, expiresAt: cred.expiresAt ?? null })) };
}

export async function connectFromGrant(ctx: Ctx, state: string, picks: { provider: ProviderId; accountId: string }[], userId: string) {
  const g = grants.get(state);
  if (!g || g.userId !== userId || !g.accounts) throw notFound('Sesi login kedaluwarsa — ulangi');
  const made: Integration[] = [];
  for (const p of picks) {
    const a = g.accounts.find((x) => x.provider === p.provider && x.accountId === p.accountId);
    if (!a) continue;
    const values = {
      provider: a.provider,
      accountId: a.accountId,
      accountName: a.name,
      accountType: a.type,
      status: 'connected' as const,
      syncOn: true,
      credEnc: ctx.box.encrypt(JSON.stringify(a.cred)),
      expiresAt: a.cred.expiresAt ? new Date(a.cred.expiresAt) : null,
      lastError: null,
      meta: a.meta ?? {},
      connectedBy: userId,
    };
    const [row] = await ctx.db
      .insert(integrations)
      .values(values)
      .onConflictDoUpdate({ target: [integrations.provider, integrations.accountId], set: values })
      .returning();
    made.push(row!);
  }
  grants.delete(state);
  return made;
}

export async function connectUptime(ctx: Ctx, url: string, userId: string) {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw badRequest('Alamat website tidak valid (contoh: https://sonokembangmalang.com)');
  }
  if (!/^https?:$/.test(u.protocol)) throw badRequest('Alamat harus diawali http:// atau https://');
  const [row] = await ctx.db
    .insert(integrations)
    .values({ provider: 'uptime', accountId: u.toString(), accountName: u.host, accountType: 'Cek tiap 5 menit', connectedBy: userId })
    .onConflictDoUpdate({ target: [integrations.provider, integrations.accountId], set: { status: 'connected', syncOn: true } })
    .returning();
  return row!;
}

export async function listIntegrations(ctx: Ctx) {
  const rows = await ctx.db.select().from(integrations).where(ne(integrations.status, 'disconnected')).orderBy(integrations.createdAt);
  return rows.map(({ credEnc, ...r }) => {
    const p = PROVIDERS[r.provider as ProviderId];
    return { ...r, providerLabel: p?.label ?? r.provider, category: p?.category ?? 'web', expires: p?.expires ?? false };
  });
}

/** Putuskan: token dihapus, data lama tetap tersimpan. */
export async function disconnect(ctx: Ctx, id: string) {
  await ctx.db.update(integrations).set({ status: 'disconnected', syncOn: false, credEnc: null }).where(eq(integrations.id, id));
}

export async function connected(ctx: Ctx, provider: ProviderId) {
  return ctx.db.select().from(integrations).where(and(eq(integrations.provider, provider), eq(integrations.status, 'connected')));
}

// ---------------------------------------------------------------- Token & sinkron

/** Token yang siap dipakai (Google/TikTok diperbarui otomatis lalu disimpan). */
export async function credFor(ctx: Ctx, i: Integration): Promise<Cred> {
  if (!i.credEnc) throw new PlatformError('Belum ada token — hubungkan ulang', 401, true);
  let cred = JSON.parse(ctx.box.decrypt(i.credEnc)) as Cred;
  const family = PROVIDERS[i.provider as ProviderId]?.auth;
  if (family === 'google' || family === 'tiktok') {
    const app = await getApp(ctx, family);
    if (!app) throw new PlatformError(`Kredensial aplikasi ${family} belum diisi`, 0, true);
    const r = family === 'google' ? await googleFresh(app, cred) : await tiktokFresh(app, cred);
    if (r.changed) {
      cred = r.cred;
      await ctx.db.update(integrations).set({ credEnc: ctx.box.encrypt(JSON.stringify(cred)) }).where(eq(integrations.id, i.id));
    }
  }
  return cred;
}

async function runProvider(ctx: Ctx, i: Integration): Promise<SyncOutput> {
  if (i.provider === 'uptime') return checkUptime(ctx, i);
  const cred = await credFor(ctx, i);
  switch (i.provider as ProviderId) {
    case 'meta_ads':
      return syncMetaAds(cred, i.accountId);
    case 'instagram':
      return syncInstagram(cred, i.accountId);
    case 'facebook':
      return syncFacebook(cred, i.accountId);
    case 'tiktok':
      return syncTiktok(cred);
    case 'gbp':
      return syncGbp(cred, i.accountId);
    case 'ga4':
      return syncGa4(cred, i.accountId);
    case 'gsc':
      return syncGsc(cred, i.accountId);
    default:
      throw new Error(`Penyedia tidak dikenal: ${i.provider}`);
  }
}

const SOCIAL_PROVIDER: Record<string, string> = { instagram: 'instagram', facebook: 'facebook', tiktok: 'tiktok' };

/** Simpan hasil sinkron. Mengembalikan id ulasan baru (untuk otomasi balasan). */
export async function persistSync(ctx: Ctx, provider: string, integrationId: string | null, out: SyncOutput): Promise<{ newReviewIds: string[] }> {
  for (let k = 0; k < out.metrics.length; k += 500) {
    const chunk = out.metrics.slice(k, k + 500);
    await ctx.db
      .insert(metricDaily)
      .values(chunk.map((m) => ({ provider, account: integrationId ?? '', metric: m.metric, dim: m.dim, day: m.day, value: m.value })))
      .onConflictDoUpdate({ target: [metricDaily.provider, metricDaily.account, metricDaily.metric, metricDaily.dim, metricDaily.day], set: { value: sql`excluded.value`, manual: false } });
  }
  for (const c of out.campaigns ?? []) {
    const v = { integrationId, externalId: c.externalId, name: c.name, objective: c.objective, status: c.status, adIds: c.adIds, updatedAt: new Date() };
    await ctx.db.insert(adCampaigns).values(v).onConflictDoUpdate({ target: adCampaigns.externalId, set: v });
  }
  const sp = SOCIAL_PROVIDER[provider];
  for (const p of out.posts ?? []) {
    const v = { provider: sp ?? provider, ...p, updatedAt: new Date() };
    await ctx.db.insert(socialPosts).values(v).onConflictDoUpdate({ target: [socialPosts.provider, socialPosts.externalId], set: v });
  }
  const newReviewIds: string[] = [];
  for (const r of out.reviews ?? []) {
    const [existing] = await ctx.db.select({ id: reviews.id, replyStatus: reviews.replyStatus }).from(reviews).where(and(eq(reviews.provider, 'gbp'), eq(reviews.externalId, r.externalId)));
    if (existing) {
      // Balasan yang ditulis langsung di Google ikut tercatat.
      if (r.replyText && existing.replyStatus !== 'sent') await ctx.db.update(reviews).set({ replyText: r.replyText, repliedAt: r.repliedAt, replyStatus: 'sent', replyDueAt: null }).where(eq(reviews.id, existing.id));
      continue;
    }
    // onConflictDoNothing: dua sinkron yang berjalan bersamaan tidak boleh gagal karena ulasan yang sama.
    const [row] = await ctx.db
      .insert(reviews)
      .values({ provider: 'gbp', externalId: r.externalId, author: r.author, rating: r.rating, text: r.text, reviewedAt: r.reviewedAt, replyText: r.replyText, repliedAt: r.repliedAt, replyStatus: r.replyText ? 'sent' : 'none' })
      .onConflictDoNothing()
      .returning({ id: reviews.id });
    if (row && !r.replyText) newReviewIds.push(row.id);
  }
  return { newReviewIds };
}

export async function syncOne(ctx: Ctx, i: Integration) {
  try {
    const out = await runProvider(ctx, i);
    const { newReviewIds } = await persistSync(ctx, i.provider, i.id, out);
    await ctx.db.update(integrations).set({ lastSyncAt: new Date(), lastError: null, status: 'connected' }).where(eq(integrations.id, i.id));
    if (newReviewIds.length) {
      const { onNewReviews } = await import('../services/reputation.js');
      await onNewReviews(ctx, newReviewIds);
    }
    return { ok: true as const, note: out.note };
  } catch (e) {
    const err = e as PlatformError;
    const msg = err.message.slice(0, 300);
    await ctx.db.update(integrations).set({ lastSyncAt: new Date(), lastError: msg, ...(err.authExpired ? { status: 'error' as const } : {}) }).where(eq(integrations.id, i.id));
    if (err.authExpired && i.status !== 'error') {
      const admins = await usersWithRole(ctx, 'admin');
      await notify(ctx, admins, 'sistem', `${PROVIDERS[i.provider as ProviderId]?.label ?? i.provider} (${i.accountName}) perlu login ulang: ${msg}`, '/pengaturan/integrasi');
    }
    return { ok: false as const, error: msg };
  }
}

/** Dipanggil worker tiap menit: sinkron yang sudah waktunya + peringatan token hampir habis. */
export async function runDueSyncs(ctx: Ctx, now = new Date()) {
  const list = await ctx.db.select().from(integrations).where(and(eq(integrations.syncOn, true), inArray(integrations.status, ['connected', 'error'])));
  let ran = 0;
  for (const i of list) {
    const every = PROVIDERS[i.provider as ProviderId]?.syncEvery ?? 360;
    // Akun yang butuh login ulang dicoba lagi paling cepat 6 jam sekali.
    const wait = (i.status === 'error' ? Math.max(every, 360) : every) * 60_000;
    if (i.lastSyncAt && now.getTime() - i.lastSyncAt.getTime() < wait) continue;
    await syncOne(ctx, i);
    ran++;
  }
  await warnExpiring(ctx, list, now);
  return ran;
}

async function warnExpiring(ctx: Ctx, list: Integration[], now: Date) {
  const today = wibDateString(now);
  for (const i of list) {
    if (!i.expiresAt) continue;
    const days = Math.ceil((i.expiresAt.getTime() - now.getTime()) / 86_400_000);
    if (days > 14 || (i.meta as any).expiryNotifiedOn === today) continue;
    const admins = await usersWithRole(ctx, 'admin');
    await notify(ctx, admins, 'sistem', `Izin ${PROVIDERS[i.provider as ProviderId]?.label} (${i.accountName}) ${days > 0 ? `habis ${days} hari lagi` : 'sudah habis'} — klik Login ulang di Pengaturan › Integrasi`, '/pengaturan/integrasi');
    await ctx.db.update(integrations).set({ meta: { ...i.meta, expiryNotifiedOn: today } }).where(eq(integrations.id, i.id));
  }
}

// ---------------------------------------------------------------- Pemantau website (berjalan sekarang, tanpa akun platform)

interface UptimeState {
  up: boolean | null;
  lastMs: number | null;
  lastStatus: number | null;
  checkedAt: string | null;
  downSince: string | null;
  fails: number;
}

async function checkUptime(ctx: Ctx, i: Integration): Promise<SyncOutput> {
  const prev = ((i.meta as any).uptime ?? { up: null, fails: 0, downSince: null }) as UptimeState;
  const t0 = Date.now();
  let status = 0;
  let ok = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(i.accountId, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'SonokembangCRM-Uptime/1.0' } });
    clearTimeout(timer);
    status = res.status;
    ok = res.status < 500;
    await res.body?.cancel();
  } catch {
    ok = false;
  }
  const ms = Date.now() - t0;
  const fails = ok ? 0 : prev.fails + 1;
  const isDown = fails >= 2; // dua kali gagal berturut-turut baru dianggap mati
  const state: UptimeState = { up: ok ? true : isDown ? false : prev.up, lastMs: ok ? ms : null, lastStatus: status || null, checkedAt: new Date().toISOString(), downSince: isDown ? (prev.downSince ?? new Date().toISOString()) : null, fails };
  await ctx.db.update(integrations).set({ meta: { ...i.meta, uptime: state } }).where(eq(integrations.id, i.id));
  if (isDown && prev.up !== false) {
    const admins = await usersWithRole(ctx, 'admin', 'marketing');
    await notify(ctx, admins, 'sistem', `Website ${i.accountName} tidak bisa dibuka (${status ? `HTTP ${status}` : 'tidak merespons'})`, '/website');
  } else if (ok && prev.up === false) {
    const admins = await usersWithRole(ctx, 'admin', 'marketing');
    await notify(ctx, admins, 'sistem', `Website ${i.accountName} sudah bisa dibuka lagi`, '/website');
  }
  const day = wibDateString(new Date());
  // Hitungan kumulatif harian (ditambah, bukan ditimpa).
  const inc = [
    { metric: 'checks', value: 1 },
    { metric: 'up', value: ok ? 1 : 0 },
    { metric: 'ms_total', value: ok ? ms : 0 },
  ];
  for (const m of inc) {
    await ctx.db
      .insert(metricDaily)
      .values({ provider: 'uptime', metric: m.metric, dim: i.accountId, day, value: m.value })
      .onConflictDoUpdate({ target: [metricDaily.provider, metricDaily.account, metricDaily.metric, metricDaily.dim, metricDaily.day], set: { value: sql`${metricDaily.value} + excluded.value` } });
  }
  return { metrics: [], note: ok ? `${ms} ms` : 'tidak bisa dibuka' };
}

/** Uji token aplikasi developer (dipakai tombol "Uji" di Pengaturan). */
export async function testApp(ctx: Ctx, family: Family) {
  const app = await getApp(ctx, family);
  if (!app) throw badRequest('Belum diisi');
  if (family === 'meta') {
    await callJson(`https://graph.facebook.com/v23.0/${app.id}?fields=name&access_token=${encodeURIComponent(`${app.id}|${app.secret}`)}`);
    return 'App Meta valid';
  }
  return 'Tersimpan — diuji saat login pertama';
}

export { FAMILY_PROVIDERS };
