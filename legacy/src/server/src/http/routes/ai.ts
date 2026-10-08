import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { aiCalls, contacts, conversations, guardrailLogs, leads, promptVersions, stages, users } from '../../db/schema.js';
import { badRequest } from '../../lib/http.js';
import { last4 } from '../../lib/crypto.js';
import { formatPhone } from '../../lib/phone.js';
import { ownOnly, requireMenu, requireRole } from '../auth.js';
import { audit } from '../../services/audit.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { DEFAULT_PRICING, MODEL_SUGGESTIONS } from '../../ai/providers.js';
import type { AiKeys, AiSettings } from '../../ai/service.js';
import { sandboxReply } from '../../ai/responder.js';
import { leadCode } from '../../services/leads.js';
import { wibDateString } from '../../lib/time.js';

const Provider = z.enum(['anthropic', 'google', 'openai']);

export function aiRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  const monthStart = () => new Date(wibDateString(new Date()).slice(0, 7) + '-01T00:00:00+07:00');

  // ---------- Model AI & API key (hanya Admin) ----------
  app.get('/api/ai/config', async (req) => {
    requireRole(req, 'admin');
    const s = await getSetting<AiSettings>(db, 'ai');
    const keys = await getSetting<AiKeys>(db, 'ai_keys');
    const spend = await ctx.ai.monthSpendIdr();
    const usage = await db
      .select({ task: aiCalls.task, model: aiCalls.model, calls: count(), cost: sql<number>`coalesce(sum(${aiCalls.costIdr}),0)::int`, failed: sql<number>`count(*) filter (where not ${aiCalls.ok})` })
      .from(aiCalls)
      .where(gte(aiCalls.at, monthStart()))
      .groupBy(aiCalls.task, aiCalls.model);
    return {
      settings: s,
      // Key tidak pernah dikirim balik ke browser — hanya 4 karakter terakhir.
      keys: Object.fromEntries(Object.entries(keys).map(([p, k]) => [p, k ? { last4: k.last4, updatedAt: k.updatedAt } : null])),
      spendIdr: spend,
      usage,
      suggestions: MODEL_SUGGESTIONS,
      defaultPricing: DEFAULT_PRICING,
    };
  });

  app.put('/api/ai/config', async (req) => {
    const me = requireRole(req, 'admin');
    const body = z
      .object({
        enabled: z.boolean(),
        provider: Provider,
        fallbackProvider: Provider.nullable(),
        models: z.object({ chat: z.string().trim().min(1), smart: z.string().trim().min(1) }),
        fallbackModels: z.object({ chat: z.string().trim(), smart: z.string().trim() }).optional(),
        monthlyBudgetIdr: z.number().int().min(0),
        maskPii: z.boolean(),
        logRetentionDays: z.number().int().min(7).max(365),
        usdToIdr: z.number().int().min(1000),
        layer2: z.boolean().optional(),
        pricing: z.record(z.string(), z.object({ input: z.number().min(0), output: z.number().min(0), cachedInput: z.number().min(0).optional() })).optional(),
      })
      .parse(req.body);
    await setSetting(db, 'ai', body, me.id);
    await audit(db, me.id, 'ai.config', 'setting', 'ai', { ...body, pricing: undefined });
    return { ok: true };
  });

  app.post('/api/ai/keys', async (req) => {
    const me = requireRole(req, 'admin');
    const body = z.object({ provider: Provider, apiKey: z.string().trim().min(10), model: z.string().trim().min(1) }).parse(req.body);
    const test = await ctx.ai.testKey(body.provider, body.apiKey, body.model);
    if (!test.ok) throw badRequest(`Uji koneksi gagal: ${test.message}`);
    const keys = await getSetting<AiKeys>(db, 'ai_keys');
    keys[body.provider] = { enc: ctx.box.encrypt(body.apiKey), last4: last4(body.apiKey), updatedAt: new Date().toISOString(), updatedBy: me.id };
    await setSetting(db, 'ai_keys', keys, me.id);
    await audit(db, me.id, 'ai.key.save', 'ai_key', body.provider, { last4: last4(body.apiKey) });
    return { ok: true, message: test.message, last4: last4(body.apiKey) };
  });

  app.post('/api/ai/keys/:provider/test', async (req) => {
    requireRole(req, 'admin');
    const provider = Provider.parse((req.params as any).provider);
    const keys = await getSetting<AiKeys>(db, 'ai_keys');
    const k = keys[provider];
    if (!k) throw badRequest('Key untuk penyedia ini belum dipasang');
    const s = await getSetting<AiSettings>(db, 'ai');
    const model = provider === s.provider ? s.models.chat : (s.fallbackModels?.chat ?? s.models.chat);
    return ctx.ai.testKey(provider, ctx.box.decrypt(k.enc), model);
  });

  app.delete('/api/ai/keys/:provider', async (req) => {
    const me = requireRole(req, 'admin');
    const provider = Provider.parse((req.params as any).provider);
    const keys = await getSetting<AiKeys>(db, 'ai_keys');
    delete keys[provider];
    await setSetting(db, 'ai_keys', keys, me.id);
    await audit(db, me.id, 'ai.key.delete', 'ai_key', provider);
    return { ok: true };
  });

  // ---------- Layar AI & Otomasi ----------
  app.get('/api/ai/overview', async (req) => {
    const me = requireMenu(req, 'ai');
    const own = ownOnly(me);
    const queue = await db
      .select({ c: conversations, name: contacts.name, phone: contacts.waPhone, owner: users.name })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(users, eq(users.id, conversations.assigneeId))
      .where(and(eq(conversations.aiActive, false), isNotNull(conversations.handoffAt), isNull(conversations.handoffClaimedAt), own ? eq(conversations.assigneeId, me.id) : undefined))
      .orderBy(desc(conversations.handoffAt))
      .limit(50);
    const contactIds = queue.map((q) => q.c.contactId);
    const qLeads = contactIds.length
      ? await db
          .select({ l: leads })
          .from(leads)
          .innerJoin(stages, eq(stages.id, leads.stageId))
          .where(and(eq(stages.kind, 'open'), inArray(leads.contactId, contactIds)))
      : [];
    const logs = await db.select().from(guardrailLogs).orderBy(desc(guardrailLogs.at)).limit(50);
    const [cnt] = await db
      .select({ calls: count(), failed: sql<number>`count(*) filter (where not ${aiCalls.ok})` })
      .from(aiCalls)
      .where(gte(aiCalls.at, monthStart()));
    const [handling] = await db.select({ n: count() }).from(conversations).where(eq(conversations.aiActive, true));
    const s = await getSetting<AiSettings>(db, 'ai');
    const g = await getSetting<{ allow: string[]; deny: string[] }>(db, 'guardrails');
    const keys = await getSetting<AiKeys>(db, 'ai_keys');
    return {
      queue: queue.map(({ c, name, phone, owner }) => {
        const l = qLeads.find((x) => x.l.contactId === c.contactId)?.l;
        return {
          conversationId: c.id,
          name: name ?? formatPhone(phone),
          owner,
          ownerId: c.assigneeId,
          handoffAt: c.handoffAt,
          reason: c.handoffReason,
          summary: c.handoffSummary,
          awaitingSince: c.awaitingReplySince,
          lead: l ? { id: l.id, code: leadCode(l.code), score: l.score, temperature: l.temperature } : null,
        };
      }),
      logs,
      stats: { calls: Number(cnt?.calls ?? 0), failed: Number(cnt?.failed ?? 0), spendIdr: await ctx.ai.monthSpendIdr(), budgetIdr: s.monthlyBudgetIdr, aiHandling: Number(handling?.n ?? 0) },
      enabled: s.enabled,
      keyReady: !!keys[s.provider],
      provider: s.provider,
      models: s.models,
      allow: g.allow,
      deny: g.deny,
    };
  });

  // ---------- Prompt (berversi) ----------
  app.get('/api/ai/prompts', async (req) => {
    requireMenu(req, 'ai', 'setting');
    return db
      .select({ id: promptVersions.id, version: promptVersions.version, content: promptVersions.content, note: promptVersions.note, active: promptVersions.active, at: promptVersions.createdAt, by: users.name })
      .from(promptVersions)
      .leftJoin(users, eq(users.id, promptVersions.createdBy))
      .orderBy(desc(promptVersions.version));
  });

  app.post('/api/ai/prompts', async (req) => {
    const me = requireRole(req, 'admin');
    const body = z.object({ content: z.string().trim().min(20).max(8000), note: z.string().trim().max(200).optional() }).parse(req.body);
    const [{ max }] = (await db.select({ max: sql<number>`coalesce(max(${promptVersions.version}),0)::int` }).from(promptVersions)) as [{ max: number }];
    await db.update(promptVersions).set({ active: false });
    const [p] = await db.insert(promptVersions).values({ version: Number(max) + 1, content: body.content, note: body.note ?? null, active: true, createdBy: me.id }).returning();
    await audit(db, me.id, 'ai.prompt.create', 'prompt', String(p!.version));
    return p;
  });

  app.post('/api/ai/prompts/:id/activate', async (req) => {
    const me = requireRole(req, 'admin');
    const id = Number((req.params as any).id);
    await db.update(promptVersions).set({ active: false });
    await db.update(promptVersions).set({ active: true }).where(eq(promptVersions.id, id));
    await audit(db, me.id, 'ai.prompt.activate', 'prompt', String(id));
    return { ok: true };
  });

  app.post('/api/ai/sandbox', async (req) => {
    requireRole(req, 'admin');
    const body = z
      .object({ prompt: z.string().min(20), chat: z.array(z.object({ from: z.enum(['customer', 'ai']), text: z.string().min(1) })).min(1).max(30) })
      .parse(req.body);
    try {
      return await sandboxReply(ctx, body.prompt, body.chat);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  });
}
