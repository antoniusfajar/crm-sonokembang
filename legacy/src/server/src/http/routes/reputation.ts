import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { competitors, reviews } from '../../db/schema.js';
import { requireMenu } from '../auth.js';
import { audit } from '../../services/audit.js';
import { badRequest, notFound } from '../../lib/http.js';
import { parseCsv } from '../../lib/csv.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { aiSummary, analyzeCompetitor, analyzeSelf, draftReply, publishReply, reputationSettings, reviewRequestCandidates, sendReviewRequest, sentimentOf, summary } from '../../services/reputation.js';
import { randomToken } from '../../lib/crypto.js';

export function reputationRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;
  const M = 'reputasi';

  app.get('/api/reputation/summary', async (req) => {
    requireMenu(req, M, 'dashboard', 'reports');
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(730).default(30) }).parse(req.query);
    return summary(ctx, days);
  });
  app.post('/api/reputation/summary/ai', async (req) => {
    requireMenu(req, M);
    try {
      return await aiSummary(ctx);
    } catch (e) {
      throw badRequest(`AI belum bisa meringkas: ${(e as Error).message}`);
    }
  });

  app.get('/api/reputation/reviews', async (req) => {
    requireMenu(req, M);
    const q = z.object({ stars: z.string().optional(), status: z.enum(['all', 'unreplied', 'scheduled', 'replied']).default('all'), q: z.string().optional() }).parse(req.query);
    const conds: SQL[] = [];
    const stars = (q.stars ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 5);
    if (stars.length) conds.push(inArray(reviews.rating, stars));
    if (q.status === 'unreplied') conds.push(inArray(reviews.replyStatus, ['none', 'draft', 'failed']));
    if (q.status === 'scheduled') conds.push(eq(reviews.replyStatus, 'scheduled'));
    if (q.status === 'replied') conds.push(eq(reviews.replyStatus, 'sent'));
    if (q.q) conds.push(or(ilike(reviews.text, `%${q.q}%`), ilike(reviews.author, `%${q.q}%`))!);
    return db.select().from(reviews).where(conds.length ? and(...conds) : undefined).orderBy(desc(reviews.reviewedAt)).limit(300);
  });

  const ReviewIn = z.object({ author: z.string().trim().min(1).max(80), rating: z.number().int().min(1).max(5), text: z.string().trim().max(4000).default(''), reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), replyText: z.string().trim().max(4000).optional() });

  // Ulasan manual (mis. dipindah dari CRM lama selama Google Business belum terhubung).
  app.post('/api/reputation/reviews', async (req) => {
    const me = requireMenu(req, M);
    const b = ReviewIn.parse(req.body);
    const [r] = await db
      .insert(reviews)
      .values({ provider: 'manual', externalId: `m.${randomToken(8)}`, author: b.author, rating: b.rating, text: b.text, reviewedAt: new Date(`${b.reviewedAt}T12:00:00+07:00`), sentiment: sentimentOf(b.rating), replyText: b.replyText || null, replyStatus: b.replyText ? 'sent' : 'none', repliedAt: b.replyText ? new Date() : null })
      .returning();
    await audit(db, me.id, 'review.add', 'review', r!.id);
    return r;
  });

  app.post('/api/reputation/reviews/import', async (req) => {
    const me = requireMenu(req, M);
    const { csv } = z.object({ csv: z.string().min(10).max(2_000_000) }).parse(req.body);
    const rows = parseCsv(csv);
    const head = rows[0]!.map((h) => h.trim().toLowerCase());
    const col = (names: string[]) => head.findIndex((h) => names.includes(h));
    const ci = { author: col(['nama', 'author', 'reviewer', 'name']), rating: col(['bintang', 'rating', 'stars']), text: col(['ulasan', 'text', 'review', 'komentar']), date: col(['tanggal', 'date']), reply: col(['balasan', 'reply']) };
    if (ci.rating < 0 || ci.date < 0) throw badRequest('Kolom wajib: bintang/rating dan tanggal/date (format YYYY-MM-DD). Opsional: nama, ulasan, balasan.');
    let added = 0;
    for (const r of rows.slice(1)) {
      const rating = Number(r[ci.rating]);
      const date = (r[ci.date] ?? '').trim().slice(0, 10);
      if (!(rating >= 1 && rating <= 5) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const reply = ci.reply >= 0 ? (r[ci.reply] ?? '').trim() : '';
      const author = ci.author >= 0 ? (r[ci.author] ?? '').trim() || 'Pengguna Google' : 'Pengguna Google';
      const text = ci.text >= 0 ? (r[ci.text] ?? '').trim() : '';
      await db
        .insert(reviews)
        .values({ provider: 'manual', externalId: `imp.${date}.${author}.${text.slice(0, 40)}`.slice(0, 200), author, rating, text, reviewedAt: new Date(`${date}T12:00:00+07:00`), sentiment: sentimentOf(rating), replyText: reply || null, replyStatus: reply ? 'sent' : 'none', repliedAt: reply ? new Date(`${date}T18:00:00+07:00`) : null })
        .onConflictDoNothing();
      added++;
    }
    await audit(db, me.id, 'review.import', 'review', null, { added });
    return { added };
  });

  app.post('/api/reputation/reviews/:id/draft', async (req) => {
    requireMenu(req, M);
    const [r] = await db.select().from(reviews).where(eq(reviews.id, (req.params as any).id));
    if (!r) throw notFound();
    try {
      const text = await draftReply(ctx, r);
      await db.update(reviews).set({ replyText: text, replyStatus: r.replyStatus === 'sent' ? 'sent' : 'draft', replyError: null }).where(eq(reviews.id, r.id));
      return { text };
    } catch (e) {
      throw badRequest(`AI belum bisa menulis balasan: ${(e as Error).message}`);
    }
  });

  app.post('/api/reputation/reviews/:id/reply', async (req) => {
    const me = requireMenu(req, M);
    const { text } = z.object({ text: z.string().trim().min(2).max(4000) }).parse(req.body);
    await publishReply(ctx, (req.params as any).id, text);
    await audit(db, me.id, 'review.reply', 'review', (req.params as any).id);
    return { ok: true };
  });

  // Batalkan balasan AI terjadwal (teks tetap disimpan sebagai draf untuk diedit).
  app.post('/api/reputation/reviews/:id/cancel', async (req) => {
    const me = requireMenu(req, M);
    await db.update(reviews).set({ replyStatus: 'draft', replyDueAt: null }).where(and(eq(reviews.id, (req.params as any).id), eq(reviews.replyStatus, 'scheduled')));
    await audit(db, me.id, 'review.cancel_auto', 'review', (req.params as any).id);
    return { ok: true };
  });

  app.delete('/api/reputation/reviews/:id', async (req) => {
    const me = requireMenu(req, M);
    await db.delete(reviews).where(and(eq(reviews.id, (req.params as any).id), eq(reviews.provider, 'manual')));
    await audit(db, me.id, 'review.delete', 'review', (req.params as any).id);
    return { ok: true };
  });

  // ---------- Pengaturan ----------
  app.get('/api/reputation/settings', async (req) => {
    requireMenu(req, M);
    return reputationSettings(ctx);
  });
  app.put('/api/reputation/settings', async (req) => {
    const me = requireMenu(req, M);
    const b = z
      .object({
        autoReply: z.boolean(),
        notifyLow: z.boolean(),
        delayMinutes: z.number().int().min(0).max(1440),
        hotlineOnNegative: z.boolean(),
        request: z.object({ on: z.boolean(), timing: z.enum(['h1', 'h2', 'same_day']), template: z.string().min(1).max(80), link: z.string().trim().max(300), cooldownDays: z.number().int().min(7).max(365) }),
      })
      .parse(req.body);
    if (b.request.on && !/^https:\/\//.test(b.request.link)) throw badRequest('Link ulasan Google wajib diisi (diawali https://) sebelum permintaan otomatis dinyalakan');
    await setSetting(db, 'reputation', b, me.id);
    await audit(db, me.id, 'reputation.settings', 'setting', 'reputation');
    return { ok: true };
  });

  // ---------- Permintaan ulasan ----------
  app.get('/api/reputation/requests/candidates', async (req) => {
    requireMenu(req, M);
    const list = await reviewRequestCandidates(ctx, new Date(Date.now() + 24 * 3600_000)); // termasuk yang jatuh tempo besok
    return list.slice(0, 100);
  });
  app.post('/api/reputation/requests', async (req) => {
    const me = requireMenu(req, M);
    const { leadId } = z.object({ leadId: z.string().uuid() }).parse(req.body);
    await sendReviewRequest(ctx, leadId);
    await audit(db, me.id, 'review.request', 'lead', leadId);
    return { ok: true };
  });

  // ---------- Kompetitor (maks. 3) ----------
  app.get('/api/reputation/competitors', async (req) => {
    requireMenu(req, M);
    const list = await db.select().from(competitors).orderBy(competitors.createdAt);
    const s = await summary(ctx, 30);
    const ai = await getSetting<{ self?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; at: string } }>(db, 'reputation_ai');
    const biz = await getSetting<{ name: string }>(db, 'business_profile');
    return { self: { name: biz.name, rating: s.kpi.totalAvg, reviewCount: s.kpi.total, analysis: ai?.self ?? null }, list };
  });
  const CompIn = z.object({ name: z.string().trim().min(2).max(100), mapsUrl: z.string().trim().max(400).nullable().optional(), rating: z.number().min(1).max(5).nullable().optional(), reviewCount: z.number().int().min(0).nullable().optional(), notes: z.string().max(20_000).nullable().optional() });
  app.post('/api/reputation/competitors', async (req) => {
    const me = requireMenu(req, M);
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(competitors)) as [{ n: number }];
    if (n >= 3) throw badRequest('Maksimal 3 kompetitor');
    const [c] = await db.insert(competitors).values(CompIn.parse(req.body)).returning();
    await audit(db, me.id, 'competitor.add', 'competitor', c!.id);
    return c;
  });
  app.put('/api/reputation/competitors/:id', async (req) => {
    requireMenu(req, M);
    const [c] = await db.update(competitors).set({ ...CompIn.parse(req.body), updatedAt: new Date() }).where(eq(competitors.id, (req.params as any).id)).returning();
    if (!c) throw notFound();
    return c;
  });
  app.delete('/api/reputation/competitors/:id', async (req) => {
    requireMenu(req, M);
    await db.delete(competitors).where(eq(competitors.id, (req.params as any).id));
    return { ok: true };
  });
  app.post('/api/reputation/competitors/:id/analyze', async (req) => {
    requireMenu(req, M);
    try {
      return await analyzeCompetitor(ctx, (req.params as any).id);
    } catch (e) {
      if ((e as any).statusCode) throw e;
      throw badRequest(`AI belum bisa menganalisa: ${(e as Error).message}`);
    }
  });
  app.post('/api/reputation/self/analyze', async (req) => {
    requireMenu(req, M);
    try {
      return await analyzeSelf(ctx);
    } catch (e) {
      if ((e as any).statusCode) throw e;
      throw badRequest(`AI belum bisa menganalisa: ${(e as Error).message}`);
    }
  });

}
