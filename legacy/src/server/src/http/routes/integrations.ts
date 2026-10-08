import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { integrations } from '../../db/schema.js';
import { requireMenu, requireRole } from '../auth.js';
import { audit } from '../../services/audit.js';
import { notFound } from '../../lib/http.js';
import { PROVIDERS, type ProviderId } from '../../integrations/catalog.js';
import {
  appsPublic,
  connectFromGrant,
  connectUptime,
  disconnect,
  finishOAuth,
  grantAccounts,
  grantFromMetaToken,
  listIntegrations,
  saveApp,
  startOAuth,
  syncOne,
  testApp,
} from '../../integrations/service.js';

const FAMILY = z.enum(['meta', 'google', 'tiktok']);
const MARKETING_MENUS = ['setting', 'ads', 'sosmed', 'website', 'reputasi', 'dashboard'];

export function integrationRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  app.get('/api/integrations', async (req) => {
    requireMenu(req, ...MARKETING_MENUS);
    return { providers: Object.values(PROVIDERS), accounts: await listIntegrations(ctx) };
  });

  // ---------- Aplikasi developer (App ID / Client ID) ----------
  app.get('/api/integrations/apps', async (req) => {
    requireRole(req, 'admin');
    return appsPublic(ctx);
  });
  app.put('/api/integrations/apps/:family', async (req) => {
    const me = requireRole(req, 'admin');
    const family = FAMILY.parse((req.params as any).family);
    const b = z.object({ id: z.string().trim().min(3).max(200), secret: z.string().trim().min(6).max(500) }).parse(req.body);
    await saveApp(ctx, family, b.id, b.secret);
    await audit(db, me.id, 'integration.app_update', 'integration_app', family);
    return { ok: true };
  });
  app.post('/api/integrations/apps/:family/test', async (req) => {
    requireRole(req, 'admin');
    return { message: await testApp(ctx, FAMILY.parse((req.params as any).family)) };
  });

  // ---------- Login (OAuth) & pilih akun ----------
  app.post('/api/integrations/oauth/:family/start', async (req) => {
    const me = requireRole(req, 'admin');
    return startOAuth(ctx, FAMILY.parse((req.params as any).family), me.id);
  });

  // Platform mengarahkan browser kembali ke sini. Keamanan dijaga oleh "state" acak sekali pakai.
  app.get('/api/integrations/oauth/:family/callback', async (req, reply) => {
    const family = FAMILY.parse((req.params as any).family);
    const q = z.object({ state: z.string(), code: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() }).parse(req.query);
    try {
      const state = await finishOAuth(ctx, family, q.state, q.code, q.error_description ?? q.error);
      return reply.redirect(`/pengaturan/integrasi?grant=${encodeURIComponent(state)}`);
    } catch (e) {
      return reply.redirect(`/pengaturan/integrasi?error=${encodeURIComponent((e as Error).message)}`);
    }
  });

  app.post('/api/integrations/meta/token', async (req) => {
    const me = requireRole(req, 'admin');
    const b = z.object({ token: z.string().trim().min(20).max(1000) }).parse(req.body);
    return { state: await grantFromMetaToken(ctx, b.token, me.id) };
  });

  app.get('/api/integrations/grants/:state', async (req) => {
    const me = requireRole(req, 'admin');
    return grantAccounts((req.params as any).state, me.id);
  });

  app.post('/api/integrations/grants/:state/connect', async (req) => {
    const me = requireRole(req, 'admin');
    const b = z.object({ picks: z.array(z.object({ provider: z.enum(Object.keys(PROVIDERS) as [ProviderId, ...ProviderId[]]), accountId: z.string() })).min(1) }).parse(req.body);
    const made = await connectFromGrant(ctx, (req.params as any).state, b.picks, me.id);
    for (const m of made) await audit(db, me.id, 'integration.connect', 'integration', m.id, { provider: m.provider, account: m.accountName });
    // Tarik data pertama di latar belakang.
    for (const m of made) void syncOne(ctx, m).catch(() => {});
    return { connected: made.length };
  });

  app.post('/api/integrations/uptime', async (req) => {
    const me = requireRole(req, 'admin');
    const b = z.object({ url: z.string().trim().min(4).max(300) }).parse(req.body);
    const row = await connectUptime(ctx, b.url, me.id);
    await audit(db, me.id, 'integration.connect', 'integration', row.id, { provider: 'uptime', account: row.accountName });
    void syncOne(ctx, row).catch(() => {});
    return { id: row.id };
  });

  // ---------- Per akun ----------
  app.post('/api/integrations/:id/sync', async (req) => {
    requireMenu(req, ...MARKETING_MENUS);
    const [i] = await db.select().from(integrations).where(eq(integrations.id, (req.params as any).id));
    if (!i || i.status === 'disconnected') throw notFound('Akun tidak ditemukan');
    return syncOne(ctx, i);
  });

  app.patch('/api/integrations/:id', async (req) => {
    const me = requireRole(req, 'admin');
    const b = z.object({ syncOn: z.boolean() }).parse(req.body);
    await db.update(integrations).set({ syncOn: b.syncOn }).where(eq(integrations.id, (req.params as any).id));
    await audit(db, me.id, 'integration.sync_toggle', 'integration', (req.params as any).id, b);
    return { ok: true };
  });

  app.delete('/api/integrations/:id', async (req) => {
    const me = requireRole(req, 'admin');
    await disconnect(ctx, (req.params as any).id);
    await audit(db, me.id, 'integration.disconnect', 'integration', (req.params as any).id);
    return { ok: true };
  });
}
