import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { targets, users } from '../../db/schema.js';
import { ownOnly, requireMenu, requireRole } from '../auth.js';
import { audit } from '../../services/audit.js';
import { badRequest } from '../../lib/http.js';
import { marketingView, resolvePeriod, salesView, scoreCalibration, summary, targetRealization, trend, type PeriodKey, type Scope } from '../../services/analytics.js';
import { wibDateString } from '../../lib/time.js';
import { cachedAiInsights, generateAiInsights, scriptInsights, weeklyFacts } from '../../services/insights.js';

const PeriodQ = z.object({
  period: z.enum(['this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'this_week', 'last_week', 'custom']).default('this_month'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pipelineId: z.string().uuid().optional(),
});

export function analyticsRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  const parse = (req: FastifyRequest, ...menus: string[]) => {
    const me = requireMenu(req, ...menus);
    const q = PeriodQ.parse(req.query);
    const p = resolvePeriod(q.period as PeriodKey, new Date(), q.period === 'custom' && q.from && q.to ? { from: q.from, to: q.to } : undefined);
    const scope: Scope = { pipelineId: q.pipelineId ?? null, ownerIds: ownOnly(me) ? [me.id] : null };
    return { me, p, scope };
  };

  app.get('/api/analytics/summary', async (req) => {
    const { p, scope } = parse(req, 'dashboard', 'reports');
    return summary(ctx, p, scope);
  });
  app.get('/api/analytics/trend', async (req) => {
    const { scope } = parse(req, 'dashboard', 'reports');
    return trend(ctx, scope);
  });
  app.get('/api/analytics/sales', async (req) => {
    const { p, scope } = parse(req, 'dashboard', 'reports');
    return salesView(ctx, p, scope);
  });
  app.get('/api/analytics/marketing', async (req) => {
    const { p, scope } = parse(req, 'dashboard', 'reports');
    return marketingView(ctx, p, scope);
  });
  // Ringkasan mingguan: poin script selalu ada, narasi AI opsional (dibuat saat diminta, disimpan).
  const weeklyScope = (req: FastifyRequest) => {
    const me = requireMenu(req, 'dashboard');
    const q = z.object({ pipelineId: z.string().uuid().optional() }).parse(req.query);
    return { pipelineId: q.pipelineId ?? null, ownerIds: ownOnly(me) ? [me.id] : null } as Scope;
  };
  app.get('/api/analytics/weekly', async (req) => {
    const scope = weeklyScope(req);
    const f = await weeklyFacts(ctx, scope);
    const ai = await ctx.ai.settings();
    const keys = await ctx.ai.keys();
    return { period: f.period, insights: scriptInsights(f), ai: await cachedAiInsights(ctx, f, scope), aiAvailable: ai.enabled && !!keys[ai.provider] };
  });
  app.post('/api/analytics/weekly/ai', async (req) => {
    const scope = weeklyScope(req);
    const f = await weeklyFacts(ctx, scope);
    try {
      return { ai: await generateAiInsights(ctx, f, scope) };
    } catch (e) {
      throw badRequest(`AI belum bisa menulis ringkasan: ${(e as Error).message}`);
    }
  });

  app.get('/api/analytics/score-calibration', async (req) => {
    requireMenu(req, 'setting', 'dashboard');
    return scoreCalibration(ctx);
  });

  // ---------- Target omzet ----------
  app.get('/api/targets', async (req) => {
    requireMenu(req, 'setting', 'dashboard');
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(wibDateString(new Date()).slice(0, 7)) }).parse(req.query);
    const rows = await db.select().from(targets).where(eq(targets.period, month));
    const people = await db
      .select({ id: users.id, name: users.name, role: users.role, status: users.status })
      .from(users)
      .where(inArray(users.role, ['sales', 'spv']));
    const real = await targetRealization(ctx, month);
    return {
      month,
      team: rows.find((r) => r.scope === 'team')?.amount ?? 0,
      teamRealized: real.team,
      sales: people
        .filter((u) => u.status !== 'nonaktif' || rows.some((r) => r.scope === u.id))
        .map((u) => ({ ...u, target: rows.find((r) => r.scope === u.id)?.amount ?? 0, realized: real.byOwner.get(u.id) ?? 0 })),
    };
  });

  app.put('/api/targets', async (req) => {
    const me = requireRole(req, 'admin');
    const body = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        team: z.number().int().min(0),
        sales: z.array(z.object({ id: z.string().uuid(), target: z.number().int().min(0) })),
      })
      .parse(req.body);
    const rows = [{ scope: 'team', amount: body.team }, ...body.sales.map((s) => ({ scope: s.id, amount: s.target }))];
    for (const r of rows) {
      await db
        .insert(targets)
        .values({ period: body.month, scope: r.scope, amount: r.amount })
        .onConflictDoUpdate({ target: [targets.period, targets.scope], set: { amount: r.amount, updatedAt: new Date() } });
    }
    await audit(db, me.id, 'targets.update', 'targets', body.month, { team: body.team });
    return { ok: true };
  });

  // Salin target bulan lalu ke bulan ini (tombol cepat)
  app.post('/api/targets/copy', async (req) => {
    requireRole(req, 'admin');
    const { from, to } = z.object({ from: z.string().regex(/^\d{4}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.body);
    const rows = await db.select().from(targets).where(eq(targets.period, from));
    for (const r of rows) {
      await db.insert(targets).values({ period: to, scope: r.scope, amount: r.amount }).onConflictDoNothing();
    }
    return { copied: rows.length };
  });
}

