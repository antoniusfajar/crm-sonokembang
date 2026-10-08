import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { broadcastRecipients, broadcasts, contacts, conversations, leads, users, waTemplates } from '../../db/schema.js';
import { requireMenu, requireRole } from '../auth.js';
import { audit } from '../../services/audit.js';
import { notFound } from '../../lib/http.js';
import { leadCode } from '../../services/leads.js';
import { setSetting } from '../../services/settings.js';
import { broadcastSettings, cancelBroadcast, createBroadcast, estimate, fillParams, listBroadcasts, PRESETS, REPEAT_PRESETS, renderTemplate, stats, type Segment } from '../../services/broadcasts.js';

const SegmentQ = z.object({
  contactTypes: z.array(z.string()).optional(),
  segments: z.array(z.string()).optional(),
  leadState: z.enum(['any', 'open', 'won', 'lost', 'none']).optional(),
  temperatures: z.array(z.string()).optional(),
  pipelineId: z.string().uuid().nullable().optional(),
  eventTypeContains: z.string().trim().max(60).nullable().optional(),
  lastOrderOlderThanDays: z.number().int().min(1).max(3650).nullable().optional(),
  createdWithinDays: z.number().int().min(1).max(3650).nullable().optional(),
  sourceIds: z.array(z.string().uuid()).optional(),
  repeatOpportunity: z.enum(['cycle', 'anniversary', 'dormant_high', 'corporate_quiet']).nullable().optional(),
});

export function broadcastRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  app.get('/api/broadcasts/meta', async (req) => {
    requireMenu(req, 'broadcast');
    const tpl = await db.select().from(waTemplates).orderBy(waTemplates.name);
    return {
      presets: PRESETS,
      repeatPresets: REPEAT_PRESETS,
      templates: tpl.map((t) => ({ name: t.name, language: t.language, category: t.category, status: t.status, body: t.body, usable: ctx.wa.mode !== 'meta' || t.status === 'APPROVED' })),
      settings: await broadcastSettings(ctx),
      waMode: ctx.wa.mode,
    };
  });

  app.put('/api/broadcasts/settings', async (req) => {
    const me = requireRole(req, 'admin');
    const b = z.object({ costPerMsg: z.number().int().min(0).max(100_000), frequencyDays: z.number().int().min(0).max(60), perTick: z.number().int().min(10).max(1000).default(200) }).parse(req.body);
    await setSetting(db, 'broadcast', b, me.id);
    return { ok: true };
  });

  app.post('/api/broadcasts/estimate', async (req) => {
    requireMenu(req, 'broadcast');
    return estimate(ctx, SegmentQ.parse((req.body as any)?.segment ?? {}) as Segment);
  });

  app.get('/api/broadcasts', async (req) => {
    requireMenu(req, 'broadcast');
    const q = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const list = await listBroadcasts(ctx, q.from ? new Date(q.from + 'T00:00:00+07:00') : undefined, q.to ? new Date(new Date(q.to + 'T00:00:00+07:00').getTime() + 86_400_000) : undefined);
    const sum = (k: 'sent' | 'read' | 'replied' | 'leads' | 'closings') => list.reduce((a, b) => a + b.stats[k], 0);
    const sent = sum('sent');
    const cost = list.reduce((a, b) => a + b.stats.sent * b.costPerMsg, 0);
    return {
      rows: list,
      totals: { broadcasts: list.length, sent, read: sum('read'), replied: sum('replied'), leads: sum('leads'), closings: sum('closings'), cost, costPerLead: sum('leads') ? Math.round(cost / sum('leads')) : null },
    };
  });

  app.post('/api/broadcasts', async (req) => {
    const me = requireMenu(req, 'broadcast');
    const b = z
      .object({
        name: z.string().trim().min(3).max(120),
        segment: SegmentQ,
        presetLabel: z.string().max(120).optional(),
        templateName: z.string().min(1),
        templateLanguage: z.string().default('id'),
        params: z.array(z.string().max(500)).max(10).default([]),
        scheduledAt: z.string().datetime({ offset: true }),
      })
      .parse(req.body);
    const at = new Date(b.scheduledAt);
    const row = await createBroadcast(ctx, { ...b, segment: b.segment as Segment, scheduledAt: at < new Date() ? new Date() : at }, me.id);
    await audit(db, me.id, 'broadcast.create', 'broadcast', row.id, { name: b.name, template: b.templateName });
    return row;
  });

  app.get('/api/broadcasts/:id', async (req) => {
    requireMenu(req, 'broadcast');
    const id = (req.params as any).id as string;
    const [b] = await db.select({ b: broadcasts, by: users.name }).from(broadcasts).leftJoin(users, eq(users.id, broadcasts.createdBy)).where(eq(broadcasts.id, id));
    if (!b) throw notFound('Broadcast tidak ditemukan');
    const st = (await stats(ctx, [id])).get(id) ?? { total: 0, sent: 0, read: 0, replied: 0, failed: 0, skipped: 0, leads: 0, closings: 0 };
    const replies = await db
      .select({ name: contacts.name, phone: contacts.waPhone, text: broadcastRecipients.replyText, at: broadcastRecipients.repliedAt, leadId: broadcastRecipients.leadId, leadCode: leads.code, conversationId: conversations.id, optOut: contacts.optOutAt })
      .from(broadcastRecipients)
      .innerJoin(contacts, eq(contacts.id, broadcastRecipients.contactId))
      .leftJoin(leads, eq(leads.id, broadcastRecipients.leadId))
      .leftJoin(conversations, and(eq(conversations.contactId, contacts.id), eq(conversations.channel, 'whatsapp')))
      .where(and(eq(broadcastRecipients.broadcastId, id), isNotNull(broadcastRecipients.repliedAt)))
      .orderBy(desc(broadcastRecipients.repliedAt))
      .limit(200);
    const failures = await db
      .select({ name: contacts.name, error: broadcastRecipients.error, reason: broadcastRecipients.skipReason, status: broadcastRecipients.status })
      .from(broadcastRecipients)
      .innerJoin(contacts, eq(contacts.id, broadcastRecipients.contactId))
      .where(and(eq(broadcastRecipients.broadcastId, id), inArray(broadcastRecipients.status, ['failed', 'skipped'])))
      .limit(50);
    const [tpl] = await db.select().from(waTemplates).where(and(eq(waTemplates.name, b.b.templateName), eq(waTemplates.language, b.b.templateLanguage)));
    const est = b.b.status === 'scheduled' ? await estimate(ctx, b.b.segment as Segment) : null;
    return {
      ...b.b,
      by: b.by ?? '—',
      stats: st,
      estimate: est,
      preview: tpl ? renderTemplate(tpl.body, fillParams(b.b.params, { name: 'Ratna' })) : `(template ${b.b.templateName} tidak ditemukan)`,
      replies: replies.map((r) => ({ ...r, leadCode: r.leadCode ? leadCode(r.leadCode) : null, stop: !!r.optOut && /^\s*(stop|berhenti|unsubscribe)/i.test(r.text ?? '') })),
      failures,
    };
  });

  app.post('/api/broadcasts/:id/cancel', async (req) => {
    const me = requireMenu(req, 'broadcast');
    await cancelBroadcast(ctx, (req.params as any).id);
    await audit(db, me.id, 'broadcast.cancel', 'broadcast', (req.params as any).id);
    return { ok: true };
  });
}
