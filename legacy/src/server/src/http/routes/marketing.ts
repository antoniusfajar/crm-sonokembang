import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { adCampaigns, metricDaily, postSchedules } from '../../db/schema.js';
import { requireMenu } from '../auth.js';
import { audit } from '../../services/audit.js';
import { badRequest, notFound } from '../../lib/http.js';
import { saveUpload } from './leads.js';
import { addManualCampaign, adsView, listSchedule, mapAdId, rangeOf, setManualSpend, socialView, validatePlatforms, websiteView, type Range } from '../../services/marketing.js';

const RangeQ = z.object({ days: z.coerce.number().int().min(1).max(730).default(30), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const range = (q: unknown): Range => {
  const r = RangeQ.parse(q);
  return r.from && r.to ? { from: r.from, to: r.to } : rangeOf(r.days);
};

export function marketingRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  // ---------- Meta Ads ----------
  app.get('/api/ads', async (req) => {
    requireMenu(req, 'ads', 'dashboard', 'reports');
    return adsView(ctx, range(req.query));
  });
  app.post('/api/ads/campaigns', async (req) => {
    const me = requireMenu(req, 'ads');
    const b = z.object({ name: z.string().trim().min(2).max(120), objective: z.string().trim().max(60).nullable().optional() }).parse(req.body);
    const c = await addManualCampaign(ctx, b.name, b.objective ?? null);
    await audit(db, me.id, 'ads.campaign_add', 'ad_campaign', c.id);
    return c;
  });
  app.put('/api/ads/campaigns/:id/spend', async (req) => {
    const me = requireMenu(req, 'ads');
    const b = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), amount: z.number().int().min(0).max(10_000_000_000) }).parse(req.body);
    await setManualSpend(ctx, (req.params as any).id, b.month, b.amount);
    await audit(db, me.id, 'ads.spend_manual', 'ad_campaign', (req.params as any).id, b);
    return { ok: true };
  });
  app.post('/api/ads/campaigns/:id/ad-ids', async (req) => {
    requireMenu(req, 'ads');
    const b = z.object({ adId: z.string().trim().min(1).max(64) }).parse(req.body);
    await mapAdId(ctx, (req.params as any).id, b.adId);
    return { ok: true };
  });
  app.delete('/api/ads/campaigns/:id', async (req) => {
    const me = requireMenu(req, 'ads');
    const [c] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, (req.params as any).id));
    if (!c) throw notFound();
    if (!c.externalId.startsWith('manual.')) throw badRequest('Kampanye dari Meta tidak bisa dihapus di CRM');
    await db.delete(metricDaily).where(and(eq(metricDaily.provider, 'meta_ads'), eq(metricDaily.dim, c.externalId)));
    await db.delete(adCampaigns).where(eq(adCampaigns.id, c.id));
    await audit(db, me.id, 'ads.campaign_delete', 'ad_campaign', c.id);
    return { ok: true };
  });

  // ---------- Media sosial ----------
  app.get('/api/social', async (req) => {
    requireMenu(req, 'sosmed', 'dashboard', 'reports');
    const p = z.object({ platforms: z.string().optional() }).parse(req.query);
    return socialView(ctx, range(req.query), p.platforms ? p.platforms.split(',') : undefined);
  });
  app.get('/api/social/schedule', async (req) => {
    requireMenu(req, 'sosmed');
    const q = z.object({ from: z.string(), to: z.string() }).parse(req.query);
    return listSchedule(ctx, new Date(`${q.from}T00:00:00+07:00`), new Date(new Date(`${q.to}T00:00:00+07:00`).getTime() + 86_400_000));
  });
  app.post('/api/social/media', async (req) => {
    requireMenu(req, 'sosmed');
    const up = await saveUpload(ctx, req, 'post', { imagesOnly: true });
    return { name: up.name };
  });
  // Toleransi 5 menit untuk jam perangkat yang sedikit meleset.
  const notPast = (iso: string) => {
    if (new Date(iso).getTime() < Date.now() - 5 * 60_000) throw badRequest('Jam posting sudah lewat. Pilih waktu yang akan datang.');
  };
  const SchedBody = z.object({ caption: z.string().trim().min(1).max(2200), platforms: z.array(z.string()).min(1), scheduledAt: z.string().datetime({ offset: true }), mediaName: z.string().regex(/^post-[\w-]+\.(jpg|png)$/).nullable().optional() });
  app.post('/api/social/schedule', async (req) => {
    const me = requireMenu(req, 'sosmed');
    const b = SchedBody.parse(req.body);
    validatePlatforms(b.platforms);
    notPast(b.scheduledAt);
    const [p] = await db.insert(postSchedules).values({ caption: b.caption, platforms: b.platforms, scheduledAt: new Date(b.scheduledAt), mediaPath: b.mediaName ?? null, mediaName: b.mediaName ?? null, createdBy: me.id }).returning();
    await audit(db, me.id, 'social.schedule', 'post_schedule', p!.id);
    return p;
  });
  app.put('/api/social/schedule/:id', async (req) => {
    requireMenu(req, 'sosmed');
    const b = SchedBody.parse(req.body);
    validatePlatforms(b.platforms);
    notPast(b.scheduledAt);
    const [p] = await db
      .update(postSchedules)
      .set({ caption: b.caption, platforms: b.platforms, scheduledAt: new Date(b.scheduledAt), mediaPath: b.mediaName ?? null, mediaName: b.mediaName ?? null, status: 'scheduled', results: {} })
      .where(and(eq(postSchedules.id, (req.params as any).id)))
      .returning();
    if (!p) throw notFound();
    return p;
  });
  // Tandai sudah diposting manual / batalkan
  app.post('/api/social/schedule/:id/status', async (req) => {
    requireMenu(req, 'sosmed');
    const { status } = z.object({ status: z.enum(['published', 'cancelled']) }).parse(req.body);
    await db.update(postSchedules).set({ status }).where(eq(postSchedules.id, (req.params as any).id));
    return { ok: true };
  });

  // Gambar posting dibuka publik HANYA bila dipakai jadwal posting (Instagram mengambil gambar dari URL).
  app.get('/api/public/media/:name', async (req, reply) => {
    const name = path.basename((req.params as any).name);
    const [p] = await db.select({ id: postSchedules.id }).from(postSchedules).where(eq(postSchedules.mediaPath, name)).limit(1);
    const file = path.join(path.resolve(ctx.config.UPLOAD_DIR), name);
    if (!p || !fs.existsSync(file)) throw notFound();
    reply.type(name.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return reply.send(fs.createReadStream(file));
  });

  // ---------- Website ----------
  app.get('/api/website', async (req) => {
    requireMenu(req, 'website', 'dashboard', 'reports');
    return websiteView(ctx, range(req.query));
  });
}
