import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { competitors, contacts, integrations, leads, metricDaily, reviews, stages } from '../db/schema.js';
import { checkReplyLayer1, type GuardrailConfig } from '../ai/guardrails.js';
import { badRequest, notFound } from '../lib/http.js';
import { addDays, wibAt, wibDateString } from '../lib/time.js';
import { notify, usersWithRole } from './notify.js';
import { sendTemplateToContact } from './outreach.js';
import { getSetting, setSetting } from './settings.js';

// Reputasi Google (Fase 2 fitur 9–11, Fase 3 §3.4):
// - script: notifikasi SPV untuk ≤3★, jeda 30 menit, sentimen dari bintang, permintaan ulasan H+1
// - AI: menulis balasan (semua bintang), ringkasan ulasan, analisa kompetitor

export interface ReputationSettings {
  autoReply: boolean;
  notifyLow: boolean;
  delayMinutes: number;
  hotlineOnNegative: boolean;
  request: { on: boolean; timing: 'h1' | 'h2' | 'same_day'; template: string; link: string; cooldownDays: number };
}

export type Review = typeof reviews.$inferSelect;

export const sentimentOf = (rating: number): 'positif' | 'netral' | 'negatif' => (rating >= 4 ? 'positif' : rating === 3 ? 'netral' : 'negatif');

export async function reputationSettings(ctx: Ctx) {
  return getSetting<ReputationSettings>(ctx.db, 'reputation');
}

const REPLY_SCHEMA = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] };

/** Draf balasan AI untuk satu ulasan. Pagar lapis 1: tidak boleh menyebut harga / kata terlarang. */
export async function draftReply(ctx: Ctx, r: Review): Promise<string> {
  const cfg = await reputationSettings(ctx);
  const biz = await getSetting<{ name: string; hotline?: string }>(ctx.db, 'business_profile');
  const g = await getSetting<GuardrailConfig>(ctx.db, 'guardrails');
  const first = r.author.trim().split(/\s+/)[0] ?? '';
  const res = await ctx.ai.complete('review_reply', 'chat', {
    system: [
      `Kamu menulis balasan publik di Google atas nama ${biz.name}, usaha catering di Malang.`,
      'Gaya: ramah, tulus, bahasa Indonesia sopan, 2–4 kalimat, sebut nama depan customer bila wajar.',
      'Ulasan positif: berterima kasih dengan spesifik pada hal yang dipuji, tanpa berlebihan.',
      'Ulasan negatif/netral: minta maaf tanpa defensif, akui masalahnya, sampaikan akan diperbaiki. Jangan menyalahkan customer.',
      'Dilarang: menyebut harga, diskon, kompensasi, janji tanggal, atau data pribadi. Jangan pakai emoji berlebihan.',
    ].join('\n'),
    messages: [{ role: 'user', content: `Nama: ${first || 'Customer'}\nBintang: ${r.rating}\nUlasan: ${r.text || '(tanpa teks)'}` }],
    maxTokens: 400,
    jsonSchema: REPLY_SCHEMA,
  });
  let reply = String((res.json as any)?.reply ?? '').trim().slice(0, 900);
  if (!reply) throw new Error('AI tidak memberi balasan');
  const guard = checkReplyLayer1(reply, g);
  if (!guard.ok) throw new Error(`Draf ditahan pagar pengaman: ${guard.reason}`);
  // Ajakan ke hotline ditambahkan script (bukan AI) supaya nomornya pasti benar.
  if (r.rating <= 3 && cfg.hotlineOnNegative && biz.hotline) reply += ` Mohon hubungi kami di WhatsApp ${biz.hotline} agar bisa kami bantu langsung.`;
  return reply;
}

/** Dipanggil saat sinkron Google menemukan ulasan baru. */
export async function onNewReviews(ctx: Ctx, ids: string[]) {
  if (!ids.length) return;
  const cfg = await reputationSettings(ctx);
  const list = await ctx.db.select().from(reviews).where(inArray(reviews.id, ids));
  for (const r of list) {
    await ctx.db.update(reviews).set({ sentiment: sentimentOf(r.rating) }).where(eq(reviews.id, r.id));
    if (cfg.notifyLow && r.rating <= 3) {
      const team = await usersWithRole(ctx, 'spv', 'marketing', 'admin');
      await notify(ctx, team, 'sistem', `Ulasan ${r.rating}★ dari ${r.author}: "${r.text.slice(0, 80)}${r.text.length > 80 ? '…' : ''}"`, '/reputasi?tab=reviews');
    }
    if (cfg.autoReply) {
      try {
        const text = await draftReply(ctx, r);
        await ctx.db.update(reviews).set({ replyText: text, replyStatus: 'scheduled', replyDueAt: new Date(Date.now() + cfg.delayMinutes * 60_000), replyError: null }).where(eq(reviews.id, r.id));
      } catch (e) {
        await ctx.db.update(reviews).set({ replyError: (e as Error).message.slice(0, 300) }).where(eq(reviews.id, r.id));
      }
    }
  }
}

async function gbpIntegration(ctx: Ctx) {
  const [i] = await ctx.db.select().from(integrations).where(and(eq(integrations.provider, 'gbp'), eq(integrations.status, 'connected'))).limit(1);
  return i ?? null;
}

/** Terbitkan balasan ke Google (ulasan manual cukup ditandai terkirim). */
export async function publishReply(ctx: Ctx, id: string, text: string) {
  const [r] = await ctx.db.select().from(reviews).where(eq(reviews.id, id));
  if (!r) throw notFound('Ulasan tidak ditemukan');
  const clean = text.trim();
  if (!clean) throw badRequest('Balasan kosong');
  if (r.provider === 'gbp') {
    const i = await gbpIntegration(ctx);
    if (!i) throw badRequest('Google Business belum terhubung — hubungkan di Pengaturan › Integrasi');
    const { credFor } = await import('../integrations/service.js');
    const { replyGbp } = await import('../integrations/google.js');
    try {
      await replyGbp(await credFor(ctx, i), i.accountId, r.externalId, clean);
    } catch (e) {
      await ctx.db.update(reviews).set({ replyStatus: 'failed', replyError: (e as Error).message.slice(0, 300) }).where(eq(reviews.id, id));
      throw badRequest(`Gagal mengirim ke Google: ${(e as Error).message}`);
    }
  }
  await ctx.db.update(reviews).set({ replyText: clean, repliedAt: new Date(), replyStatus: 'sent', replyDueAt: null, replyError: null }).where(eq(reviews.id, id));
}

/** Worker: kirim balasan AI yang jedanya sudah lewat. */
export async function runScheduledReplies(ctx: Ctx, now = new Date()) {
  const due = await ctx.db
    .select()
    .from(reviews)
    .where(and(eq(reviews.replyStatus, 'scheduled'), lte(reviews.replyDueAt, now)))
    .limit(20);
  let sent = 0;
  for (const r of due) {
    try {
      await publishReply(ctx, r.id, r.replyText ?? '');
      sent++;
    } catch {
      // status sudah ditandai gagal di publishReply
    }
  }
  return sent;
}

// ---------------------------------------------------------------- Permintaan ulasan setelah acara

/** Kandidat: lead closing yang acaranya sudah lewat sesuai jadwal, belum pernah diminta, tidak dalam masa jeda. */
export async function reviewRequestCandidates(ctx: Ctx, now = new Date()) {
  const cfg = await reputationSettings(ctx);
  const today = wibDateString(now);
  const offset = cfg.request.timing === 'h2' ? 2 : cfg.request.timing === 'h1' ? 1 : 0;
  // Untuk "hari yang sama" kirim mulai 19.00 WIB; H+1/H+2 mulai 10.00 WIB.
  const sendFrom = cfg.request.timing === 'same_day' ? '19:00' : '10:00';
  if (now < wibAt(today, sendFrom)) return [];
  const latestEvent = wibDateString(addDays(new Date(today + 'T00:00:00Z'), -offset));
  const oldest = wibDateString(addDays(new Date(today + 'T00:00:00Z'), -offset - 14)); // jangan kirim untuk acara lama
  const rows = await ctx.db
    .select({ leadId: leads.id, contactId: leads.contactId, name: contacts.name, eventDate: leads.eventDate, optOut: contacts.optOutAt })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(and(eq(stages.kind, 'won'), isNull(leads.reviewRequestedAt), isNotNull(leads.eventDate), lte(leads.eventDate, latestEvent), gte(leads.eventDate, oldest)));
  const cut = addDays(now, -cfg.request.cooldownDays);
  const out: typeof rows = [];
  for (const r of rows) {
    if (r.optOut) continue;
    const [recent] = await ctx.db.select({ id: leads.id }).from(leads).where(and(eq(leads.contactId, r.contactId), gte(leads.reviewRequestedAt, cut))).limit(1);
    if (!recent) out.push(r);
  }
  return out;
}

export async function sendReviewRequest(ctx: Ctx, leadId: string) {
  const cfg = await reputationSettings(ctx);
  if (!cfg.request.link) throw badRequest('Isi dulu link ulasan Google di Reputasi › Pengaturan');
  const [l] = await ctx.db.select({ id: leads.id, contactId: leads.contactId, name: contacts.name }).from(leads).innerJoin(contacts, eq(contacts.id, leads.contactId)).where(eq(leads.id, leadId));
  if (!l) throw notFound('Lead tidak ditemukan');
  const first = (l.name ?? '').trim().split(/\s+/)[0] || 'Kak';
  const r = await sendTemplateToContact(ctx, l.contactId, cfg.request.template, [first, cfg.request.link], { origin: 'review_request' });
  if (!r.ok) throw badRequest(`Gagal mengirim: ${r.error}`);
  await ctx.db.update(leads).set({ reviewRequestedAt: new Date() }).where(eq(leads.id, leadId));
  return r;
}

/** Worker: kirim permintaan ulasan otomatis. */
export async function runReviewRequests(ctx: Ctx, now = new Date()) {
  const cfg = await reputationSettings(ctx);
  if (!cfg.request.on || !cfg.request.link) return 0;
  let n = 0;
  for (const c of await reviewRequestCandidates(ctx, now)) {
    try {
      await sendReviewRequest(ctx, c.leadId);
      n++;
    } catch {
      // ditandai supaya tidak dicoba terus-menerus
      await ctx.db.update(leads).set({ reviewRequestedAt: now }).where(eq(leads.id, c.leadId));
    }
  }
  return n;
}

// ---------------------------------------------------------------- Ringkasan

export async function summary(ctx: Ctx, days: number, now = new Date()) {
  const start = addDays(now, -days);
  const prevStart = addDays(now, -2 * days);
  const all = await ctx.db.select({ rating: reviews.rating, reviewedAt: reviews.reviewedAt, replyStatus: reviews.replyStatus, repliedAt: reviews.repliedAt, sentiment: reviews.sentiment }).from(reviews);
  const inP = all.filter((r) => r.reviewedAt >= start);
  const prev = all.filter((r) => r.reviewedAt >= prevStart && r.reviewedAt < start);
  const avg = (xs: { rating: number }[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b.rating, 0) / xs.length) * 10) / 10 : null);
  const replied = inP.filter((r) => r.replyStatus === 'sent' && r.repliedAt);
  const respHours = replied.map((r) => (r.repliedAt!.getTime() - r.reviewedAt.getTime()) / 3_600_000).filter((h) => h >= 0);
  const weeks: { label: string; n: number; avg: number | null }[] = [];
  for (let i = 11; i >= 0; i--) {
    const ws = addDays(now, -7 * (i + 1));
    const we = addDays(now, -7 * i);
    const w = all.filter((r) => r.reviewedAt >= ws && r.reviewedAt < we);
    const d = wibDateString(ws);
    weeks.push({ label: `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`, n: w.length, avg: avg(w) });
  }
  const dist = [5, 4, 3, 2, 1].map((s) => ({ stars: s, n: all.filter((r) => r.rating === s).length, pct: all.length ? Math.round((all.filter((r) => r.rating === s).length / all.length) * 100) : 0 }));
  const sent = (k: string) => (inP.length ? Math.round((inP.filter((r) => sentimentOf(r.rating) === k).length / inP.length) * 100) : 0);
  const cache = await getSetting<{ summary?: { text: string; good: string[]; bad: string[]; at: string; count: number } }>(ctx.db, 'reputation_ai');
  // Angka resmi Google (rating & jumlah seluruh ulasan) bila tersedia; ulasan yang tersimpan bisa lebih sedikit.
  const latest = async (metric: string) => (await ctx.db.select({ v: metricDaily.value }).from(metricDaily).where(and(eq(metricDaily.provider, 'gbp'), eq(metricDaily.metric, metric))).orderBy(desc(metricDaily.day)).limit(1))[0]?.v ?? null;
  const [offAvg, offTotal] = await Promise.all([latest('rating_avg'), latest('review_total')]);
  return {
    connected: !!(await gbpIntegration(ctx)),
    kpi: {
      avg: avg(inP),
      avgPrev: avg(prev),
      count: inP.length,
      countPrev: prev.length,
      replied: replied.length,
      unreplied: inP.filter((r) => r.replyStatus !== 'sent').length,
      unrepliedLow: inP.filter((r) => r.replyStatus !== 'sent' && r.rating <= 3).length,
      respHours: respHours.length ? Math.round((respHours.reduce((a, b) => a + b, 0) / respHours.length) * 10) / 10 : null,
      totalAvg: offAvg !== null && offTotal ? Math.round(offAvg * 10) / 10 : avg(all),
      total: offTotal !== null ? Math.max(offTotal, all.length) : all.length,
    },
    weeks,
    dist,
    sentiment: { positif: sent('positif'), netral: sent('netral'), negatif: sent('negatif') },
    ai: cache?.summary ?? null,
  };
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, good: { type: 'array', items: { type: 'string' } }, bad: { type: 'array', items: { type: 'string' } } },
  required: ['summary', 'good', 'bad'],
};

export async function aiSummary(ctx: Ctx) {
  const last = await ctx.db.select({ rating: reviews.rating, text: reviews.text }).from(reviews).where(sql`length(${reviews.text}) > 0`).orderBy(desc(reviews.reviewedAt)).limit(100);
  if (last.length < 3) throw badRequest('Butuh minimal 3 ulasan bertulisan untuk diringkas');
  const r = await ctx.ai.complete('review_summary', 'smart', {
    system: 'Rangkum ulasan pelanggan usaha catering dalam bahasa Indonesia. summary: 2–3 kalimat. good: maks 4 hal yang sering dipuji (2–3 kata). bad: maks 3 keluhan yang berulang (2–3 kata). Hanya dari isi ulasan, jangan mengarang.',
    messages: [{ role: 'user', content: last.map((x) => `[${x.rating}★] ${x.text.slice(0, 400)}`).join('\n') }],
    maxTokens: 700,
    jsonSchema: SUMMARY_SCHEMA,
  });
  const j = r.json as { summary?: string; good?: string[]; bad?: string[] };
  if (!j?.summary) throw new Error('Format jawaban AI tidak sesuai');
  const out = { text: j.summary.slice(0, 800), good: (j.good ?? []).slice(0, 4).map((x) => x.slice(0, 40)), bad: (j.bad ?? []).slice(0, 3).map((x) => x.slice(0, 40)), at: new Date().toISOString(), count: last.length };
  const cache = (await getSetting<Record<string, unknown>>(ctx.db, 'reputation_ai')) ?? {};
  await setSetting(ctx.db, 'reputation_ai', { ...cache, summary: out });
  return out;
}

// ---------------------------------------------------------------- Kompetitor

const SWOT_SCHEMA = {
  type: 'object',
  properties: { strengths: { type: 'array', items: { type: 'string' } }, weaknesses: { type: 'array', items: { type: 'string' } }, opportunities: { type: 'array', items: { type: 'string' } } },
  required: ['strengths', 'weaknesses', 'opportunities'],
};

async function swot(ctx: Ctx, name: string, material: string) {
  const r = await ctx.ai.complete('competitor_analysis', 'smart', {
    system: 'Analisa kekuatan & kelemahan usaha catering dari kumpulan ulasan pelanggan. Bahasa Indonesia, poin singkat (≤ 8 kata). strengths & weaknesses maks 3 poin, opportunities maks 2 poin: apa yang bisa dimanfaatkan Sonokembang. Hanya dari bahan yang diberikan.',
    messages: [{ role: 'user', content: `Usaha: ${name}\n\nUlasan:\n${material.slice(0, 12_000)}` }],
    maxTokens: 600,
    jsonSchema: SWOT_SCHEMA,
  });
  const j = r.json as { strengths?: string[]; weaknesses?: string[]; opportunities?: string[] };
  if (!j?.strengths) throw new Error('Format jawaban AI tidak sesuai');
  return { strengths: j.strengths.slice(0, 3), weaknesses: (j.weaknesses ?? []).slice(0, 3), opportunities: (j.opportunities ?? []).slice(0, 2) };
}

export async function analyzeCompetitor(ctx: Ctx, id: string) {
  const [c] = await ctx.db.select().from(competitors).where(eq(competitors.id, id));
  if (!c) throw notFound();
  if (!c.notes || c.notes.trim().length < 40) throw badRequest('Tempel dulu beberapa ulasan publik kompetitor (dari Google Maps) di kolom catatan sebagai bahan analisa');
  const a = await swot(ctx, c.name, c.notes);
  await ctx.db.update(competitors).set({ analysis: a, analyzedAt: new Date(), updatedAt: new Date() }).where(eq(competitors.id, id));
  return a;
}

export async function analyzeSelf(ctx: Ctx) {
  const biz = await getSetting<{ name: string }>(ctx.db, 'business_profile');
  const last = await ctx.db.select({ rating: reviews.rating, text: reviews.text }).from(reviews).where(sql`length(${reviews.text}) > 0`).orderBy(desc(reviews.reviewedAt)).limit(100);
  if (last.length < 3) throw badRequest('Butuh minimal 3 ulasan bertulisan');
  const a = await swot(ctx, biz.name, last.map((x) => `[${x.rating}★] ${x.text}`).join('\n'));
  const cache = (await getSetting<Record<string, unknown>>(ctx.db, 'reputation_ai')) ?? {};
  await setSetting(ctx.db, 'reputation_ai', { ...cache, self: { ...a, at: new Date().toISOString() } });
  return a;
}

