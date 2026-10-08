import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolveTemplateParams, TEMPLATE_FIELDS, templateSlots } from '../../services/templates.js';
import type { Ctx } from '../../context.js';
import { contacts, conversations, leadSources, leads, messages, notes, pipelines, snippets, stages, users, waTemplates } from '../../db/schema.js';
import { badRequest, forbidden, notFound } from '../../lib/http.js';
import { formatPhone, normalizePhone } from '../../lib/phone.js';
import { ownOnly, requireMenu, requireRole, requireUser, type AuthUser } from '../auth.js';
import { handleInbound, handleStatus, handoff, resumeAi, sendOutbound, windowRemainingMs } from '../../services/messaging.js';
import { createLead, leadCode, openLeadForContact, recordActivity } from '../../services/leads.js';
import { buildInboundPayload } from '../../whatsapp/simulator.js';
import { audit } from '../../services/audit.js';
import { getSetting, setSetting } from '../../services/settings.js';

export async function loadConversationFor(ctx: Ctx, me: AuthUser, id: string) {
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) throw notFound('Percakapan tidak ditemukan');
  if (ownOnly(me) && conv.assigneeId !== me.id) throw forbidden('Percakapan ini milik sales lain');
  return conv;
}

/** Ganti variabel snippet: {{contact.name}}, {{sales.name}}. */
export function fillSnippet(body: string, vars: { contactName?: string | null; salesName?: string | null }) {
  return body.replace(/\{\{\s*contact\.name\s*\}\}/g, vars.contactName ?? 'kak').replace(/\{\{\s*sales\.name\s*\}\}/g, vars.salesName ?? '');
}

export function inboxRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  async function enrich(rows: { c: typeof conversations.$inferSelect; ct: typeof contacts.$inferSelect; owner: string | null }[]) {
    const contactIds = rows.map((r) => r.ct.id);
    const openLeads = contactIds.length
      ? await db
          .select({ l: leads, stageName: stages.name, sourceName: leadSources.name, pipelineName: pipelines.name })
          .from(leads)
          .innerJoin(stages, eq(stages.id, leads.stageId))
          .innerJoin(pipelines, eq(pipelines.id, leads.pipelineId))
          .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
          .where(and(inArray(leads.contactId, contactIds), eq(stages.kind, 'open')))
      : [];
    const sources = await db.select().from(leadSources);
    return rows.map(({ c, ct, owner }) => {
      const ol = openLeads.find((x) => x.l.contactId === ct.id);
      return {
        id: c.id,
        contact: { id: ct.id, name: ct.name, phone: formatPhone(ct.waPhone), type: ct.contactType },
        owner: { id: c.assigneeId, name: owner },
        aiActive: c.aiActive,
        handoffAt: c.handoffAt,
        handoffClaimed: !!c.handoffClaimedAt,
        lastMessageAt: c.lastMessageAt,
        preview: c.lastMessagePreview,
        unread: c.unreadCount,
        awaitingSince: c.awaitingReplySince,
        slaLevel: c.slaLevel,
        source: ol?.sourceName ?? sources.find((s) => s.id === ct.sourceId)?.name ?? null,
        lead: ol
          ? { id: ol.l.id, code: leadCode(ol.l.code), score: ol.l.score, temperature: ol.l.temperature, stage: ol.stageName, pipeline: ol.pipelineName, potensi: ol.l.potensi }
          : null,
      };
    });
  }

  app.get('/api/conversations', async (req) => {
    const me = requireMenu(req, 'inbox');
    const q = z
      .object({
        tab: z.enum(['all', 'unreplied', 'ai', 'hot', 'mine']).default('all'),
        q: z.string().optional(),
        status: z.string().optional(), // Hot,Warm,Cold
        sales: z.string().optional(), // userId,...
        source: z.string().optional(),
        aiOnly: z.coerce.boolean().optional(),
        limit: z.coerce.number().max(500).default(200),
      })
      .parse(req.query);
    const conds = [];
    if (ownOnly(me) || q.tab === 'mine') conds.push(eq(conversations.assigneeId, me.id));
    if (q.tab === 'unreplied') conds.push(isNotNull(conversations.awaitingReplySince));
    if (q.tab === 'ai' || q.aiOnly) conds.push(eq(conversations.aiActive, true));
    if (q.q?.trim()) {
      const term = `%${q.q.trim()}%`;
      const digits = q.q.replace(/\D/g, '');
      conds.push(or(ilike(contacts.name, term), ilike(conversations.lastMessagePreview, term), ...(digits.length >= 4 ? [ilike(contacts.waPhone, `%${digits}%`)] : [])));
    }
    if (q.sales) conds.push(inArray(conversations.assigneeId, q.sales.split(',')));
    const rows = await db
      .select({ c: conversations, ct: contacts, owner: users.name })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(users, eq(users.id, conversations.assigneeId))
      .where(and(...conds))
      .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
      .limit(q.limit);
    let list = await enrich(rows);
    if (q.tab === 'hot') list = list.filter((x) => x.lead?.temperature === 'Hot');
    if (q.status) {
      const st = q.status.split(',');
      list = list.filter((x) => x.lead && st.includes(x.lead.temperature));
    }
    if (q.source) {
      const src = q.source.split(',');
      list = list.filter((x) => x.source && src.includes(x.source));
    }
    return list;
  });

  app.get('/api/conversations/counts', async (req) => {
    const me = requireMenu(req, 'inbox');
    const base = ownOnly(me) ? eq(conversations.assigneeId, me.id) : undefined;
    const c = async (...w: any[]) => Number((await db.select({ n: sql<number>`count(*)` }).from(conversations).where(and(base, ...w)))[0]?.n ?? 0);
    const hot = await db
      .select({ n: sql<number>`count(distinct ${conversations.id})` })
      .from(conversations)
      .innerJoin(leads, eq(leads.contactId, conversations.contactId))
      .innerJoin(stages, eq(stages.id, leads.stageId))
      .where(and(base, eq(stages.kind, 'open'), eq(leads.temperature, 'Hot')));
    return {
      all: await c(),
      unreplied: await c(isNotNull(conversations.awaitingReplySince)),
      ai: await c(eq(conversations.aiActive, true)),
      hot: Number(hot[0]?.n ?? 0),
      mine: Number((await db.select({ n: sql<number>`count(*)` }).from(conversations).where(eq(conversations.assigneeId, me.id)))[0]?.n ?? 0),
    };
  });

  app.get('/api/conversations/:id', async (req) => {
    const me = requireMenu(req, 'inbox', 'pipeline', 'kontak');
    const conv = await loadConversationFor(ctx, me, (req.params as any).id);
    const [ct] = await db.select().from(contacts).where(eq(contacts.id, conv.contactId));
    const msgs = await db
      .select({ m: messages, userName: users.name })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.userId))
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.createdAt))
      .limit(500);
    const [owner] = conv.assigneeId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, conv.assigneeId)) : [];
    const lead = await openLeadForContact(ctx, ct!.id);
    const [{ n: noteCount }] = (await db.select({ n: sql<number>`count(*)` }).from(notes).where(eq(notes.contactId, ct!.id))) as [{ n: number }];
    const src = ct!.sourceId ? (await db.select().from(leadSources).where(eq(leadSources.id, ct!.sourceId)))[0] : null;
    return {
      id: conv.id,
      contact: { id: ct!.id, name: ct!.name, phone: formatPhone(ct!.waPhone), type: ct!.contactType, source: src?.name ?? null },
      owner: owner ?? null,
      aiActive: conv.aiActive,
      handoff: conv.handoffAt ? { at: conv.handoffAt, reason: conv.handoffReason, summary: conv.handoffSummary, claimed: !!conv.handoffClaimedAt } : null,
      windowRemainingMs: windowRemainingMs(conv),
      slaLevel: conv.slaLevel,
      awaitingSince: conv.awaitingReplySince,
      leadId: lead?.id ?? null,
      noteCount: Number(noteCount),
      messages: msgs.map(({ m, userName }) => ({
        id: m.id,
        direction: m.direction,
        senderType: m.senderType,
        senderName: m.senderType === 'ai' ? 'AI Responder' : m.senderType === 'user' ? userName : null,
        kind: m.kind,
        body: m.body,
        templateName: m.templateName,
        mediaName: m.mediaName,
        hasMedia: !!m.mediaPath,
        status: m.status,
        error: m.error,
        at: m.createdAt,
      })),
    };
  });

  app.post('/api/conversations/:id/read', async (req) => {
    const me = requireMenu(req, 'inbox');
    const conv = await loadConversationFor(ctx, me, (req.params as any).id);
    await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conv.id));
    return { ok: true };
  });

  app.post('/api/conversations/:id/messages', async (req) => {
    const me = requireMenu(req, 'inbox');
    const conv = await loadConversationFor(ctx, me, (req.params as any).id);
    const body = z
      .object({
        body: z.string().trim().max(4096).optional(),
        template: z.object({ name: z.string(), language: z.string().default('id'), params: z.array(z.string()).default([]) }).optional(),
        snippetId: z.string().uuid().optional(),
      })
      .parse(req.body);
    if (body.snippetId) await db.update(snippets).set({ useCount: sql`${snippets.useCount} + 1` }).where(eq(snippets.id, body.snippetId));
    if (body.template) {
      const [t] = await db.select().from(waTemplates).where(and(eq(waTemplates.name, body.template.name), eq(waTemplates.language, body.template.language)));
      if (!t) throw badRequest('Template tidak ditemukan');
      if (ctx.wa.mode === 'meta' && t.status !== 'APPROVED') throw badRequest('Template belum disetujui Meta');
      let preview = t.body;
      body.template.params.forEach((p, i) => (preview = preview.replaceAll(`{{${i + 1}}}`, p)));
      return sendOutbound(ctx, { conversationId: conv.id, sender: { type: 'user', userId: me.id }, kind: 'template', body: preview, template: body.template });
    }
    if (!body.body) throw badRequest('Pesan kosong');
    return sendOutbound(ctx, { conversationId: conv.id, sender: { type: 'user', userId: me.id }, kind: 'text', body: body.body });
  });

  // Ambil percakapan dari antrean serah terima
  app.post('/api/conversations/:id/claim', async (req) => {
    const me = requireMenu(req, 'inbox', 'ai');
    const conv = await loadConversationFor(ctx, me, (req.params as any).id);
    await db.update(conversations).set({ assigneeId: me.id, handoffClaimedAt: new Date(), aiActive: false }).where(eq(conversations.id, conv.id));
    await db.update(contacts).set({ ownerId: me.id }).where(eq(contacts.id, conv.contactId));
    const lead = await openLeadForContact(ctx, conv.contactId);
    if (lead) await db.update(leads).set({ ownerId: me.id }).where(eq(leads.id, lead.id));
    ctx.events.emit({ type: 'conversation', conversationId: conv.id, ownerId: me.id });
    return { ok: true };
  });

  app.post('/api/conversations/:id/assign', async (req) => {
    const me = requireRole(req, 'spv', 'admin');
    const conv = await loadConversationFor(ctx, me, (req.params as any).id);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    await db.update(conversations).set({ assigneeId: userId }).where(eq(conversations.id, conv.id));
    await db.update(contacts).set({ ownerId: userId }).where(eq(contacts.id, conv.contactId));
    const lead = await openLeadForContact(ctx, conv.contactId);
    if (lead) await db.update(leads).set({ ownerId: userId }).where(eq(leads.id, lead.id));
    await audit(db, me.id, 'conversation.assign', 'conversation', conv.id, { userId });
    ctx.events.emit({ type: 'conversation', conversationId: conv.id, ownerId: userId });
    return { ok: true };
  });

  app.post('/api/conversations/:id/handoff', async (req) => {
    const me = requireMenu(req, 'inbox');
    const conv = await loadConversationFor(ctx, me, (req.params as any).id);
    await handoff(ctx, conv.id, `Diambil alih manual oleh ${me.name}`);
    await db.update(conversations).set({ handoffClaimedAt: new Date() }).where(eq(conversations.id, conv.id));
    return { ok: true };
  });

  app.post('/api/conversations/:id/resume-ai', async (req) => {
    const me = requireMenu(req, 'inbox');
    const conv = await loadConversationFor(ctx, me, (req.params as any).id);
    await resumeAi(ctx, conv.id);
    return { ok: true };
  });

  // Tandai / batalkan sebagai lead (toggle di panel kanan inbox)
  app.post('/api/conversations/:id/lead', async (req) => {
    const me = requireMenu(req, 'inbox');
    const conv = await loadConversationFor(ctx, me, (req.params as any).id);
    const { isLead } = z.object({ isLead: z.boolean() }).parse(req.body);
    const existing = await openLeadForContact(ctx, conv.contactId);
    if (isLead) {
      if (existing) return { leadId: existing.id };
      await db.update(contacts).set({ contactType: 'Calon pelanggan' }).where(eq(contacts.id, conv.contactId));
      const [ct] = await db.select().from(contacts).where(eq(contacts.id, conv.contactId));
      const lead = await createLead(ctx, {
        contactId: conv.contactId,
        ownerId: conv.assigneeId ?? me.id,
        sourceId: ct?.sourceId,
        origin: 'manual',
        originNote: `Ditandai manual sebagai lead dari Inbox oleh ${me.name}`,
        userId: me.id,
      });
      return { leadId: lead.id };
    }
    if (existing) {
      const [st] = await db.select().from(stages).where(eq(stages.id, existing.stageId));
      const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(stages).where(and(eq(stages.pipelineId, existing.pipelineId), sql`${stages.sortOrder} < ${st!.sortOrder}`))) as [{ n: number }];
      if (Number(n) > 0) throw badRequest('Lead ini sudah berjalan di pipeline. Tutup lewat "Tandai Lost / Abandoned" supaya alasannya tercatat.');
      await db.delete(leads).where(eq(leads.id, existing.id));
    }
    await db.update(contacts).set({ contactType: 'Bukan prospek' }).where(eq(contacts.id, conv.contactId));
    await audit(db, me.id, 'contact.not_lead', 'contact', conv.contactId);
    return { leadId: null };
  });

  // ---------- Catatan internal ----------
  app.get('/api/contacts/:id/notes', async (req) => {
    requireUser(req);
    return db
      .select({ id: notes.id, body: notes.body, at: notes.createdAt, by: users.name })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.userId))
      .where(eq(notes.contactId, (req.params as any).id))
      .orderBy(desc(notes.createdAt));
  });

  app.post('/api/contacts/:id/notes', async (req) => {
    const me = requireUser(req);
    const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    const contactId = (req.params as any).id as string;
    await db.insert(notes).values({ contactId, userId: me.id, body });
    const lead = await openLeadForContact(ctx, contactId);
    if (lead) await recordActivity(ctx, lead.id, 'note', 'Catatan internal', body.slice(0, 160), me.id);
    return { ok: true };
  });

  // ---------- Snippet ----------
  app.get('/api/snippets', async (req) => {
    requireUser(req);
    return db.select().from(snippets).orderBy(desc(snippets.useCount));
  });

  app.get('/api/snippets/render/:id', async (req) => {
    const me = requireUser(req);
    const { conversationId } = z.object({ conversationId: z.string().uuid().optional() }).parse(req.query);
    const [s] = await db.select().from(snippets).where(eq(snippets.id, (req.params as any).id));
    if (!s) throw notFound();
    let contactName: string | null = null;
    if (conversationId) {
      const conv = await loadConversationFor(ctx, me, conversationId);
      contactName = (await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, conv.contactId)))[0]?.name ?? null;
    }
    return { body: fillSnippet(s.body, { contactName, salesName: me.name }) };
  });

  const SnippetBody = z.object({
    folder: z.string().trim().min(1).default('Umum'),
    name: z.string().trim().min(1),
    shortcut: z.string().trim().regex(/^\/[a-z0-9_-]+$/i, 'Shortcut diawali "/" tanpa spasi'),
    body: z.string().trim().min(1).max(4096),
  });
  app.post('/api/snippets', async (req) => {
    const me = requireMenu(req, 'proposal');
    const body = SnippetBody.parse(req.body);
    const [s] = await db.insert(snippets).values(body).returning();
    await audit(db, me.id, 'snippet.create', 'snippet', s!.id);
    return s;
  });
  app.patch('/api/snippets/:id', async (req) => {
    requireMenu(req, 'proposal');
    const body = SnippetBody.partial().parse(req.body);
    await db.update(snippets).set({ ...body, updatedAt: new Date() }).where(eq(snippets.id, (req.params as any).id));
    return { ok: true };
  });
  app.delete('/api/snippets/:id', async (req) => {
    requireMenu(req, 'proposal');
    await db.delete(snippets).where(eq(snippets.id, (req.params as any).id));
    return { ok: true };
  });

  // ---------- Template pesan WhatsApp ----------
  app.get('/api/wa-templates', async (req) => {
    requireUser(req);
    return db.select().from(waTemplates).orderBy(waTemplates.folder, waTemplates.name);
  });
  const WaTplBody = z.object({
    name: z.string().trim().regex(/^[a-z0-9_]+$/, 'Nama template: huruf kecil, angka, garis bawah'),
    language: z.string().default('id'),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('UTILITY'),
    body: z.string().trim().min(1).max(1024),
    folder: z.string().default('Umum'),
  });
  app.post('/api/wa-templates', async (req) => {
    requireRole(req, 'admin');
    const body = WaTplBody.parse(req.body);
    // Di mode simulasi template lokal dianggap sudah disetujui supaya alur bisa diuji.
    const [t] = await db.insert(waTemplates).values({ ...body, status: ctx.wa.mode === 'simulator' ? 'APPROVED' : 'LOCAL' }).returning();
    return t;
  });
  // Isi otomatis variabel template dari data CRM.
  app.get('/api/wa-templates/fields', async (req) => {
    requireUser(req);
    return TEMPLATE_FIELDS.map(([key, label]) => ({ key, label }));
  });
  app.put('/api/wa-templates/:id/vars', async (req) => {
    const me = requireRole(req, 'admin');
    const { varMap } = z.object({ varMap: z.array(z.string().max(40)).max(20) }).parse(req.body);
    const known = new Set(TEMPLATE_FIELDS.map(([k]) => k));
    const [t] = await db
      .update(waTemplates)
      .set({ varMap: varMap.map((k) => (known.has(k) ? k : '')) })
      .where(eq(waTemplates.id, (req.params as any).id))
      .returning();
    if (!t) throw notFound();
    await audit(db, me.id, 'wa_template.vars', 'wa_template', t.id);
    return t;
  });
  app.get('/api/conversations/:id/template-fill/:templateId', async (req) => {
    const me = requireMenu(req, 'inbox');
    const p = req.params as any;
    const conv = await loadConversationFor(ctx, me, p.id);
    const [t] = await db.select().from(waTemplates).where(eq(waTemplates.id, p.templateId));
    if (!t) throw notFound();
    // Lead aktif, atau lead terakhir (mis. sapa ulang lead Lost / pelanggan lama).
    const lead = (await openLeadForContact(ctx, conv.contactId)) ?? (await db.select().from(leads).where(eq(leads.contactId, conv.contactId)).orderBy(desc(leads.createdAt)).limit(1))[0];
    const n = templateSlots(t.body);
    const params = await resolveTemplateParams(ctx, t.varMap, n, { contactId: conv.contactId, leadId: lead?.id ?? null, senderId: me.id });
    const labels = Object.fromEntries(TEMPLATE_FIELDS);
    return { params, labels: Array.from({ length: n }, (_, i) => labels[t.varMap[i] ?? ''] ?? null) };
  });
  app.delete('/api/wa-templates/:id', async (req) => {
    requireRole(req, 'admin');
    await db.delete(waTemplates).where(eq(waTemplates.id, (req.params as any).id));
    return { ok: true };
  });
  app.post('/api/wa-templates/sync', async (req) => {
    requireRole(req, 'admin');
    if (ctx.wa.mode !== 'meta') throw badRequest('Sinkron template hanya bisa setelah WhatsApp tersambung ke Meta (WA_MODE=meta)');
    const remote = await ctx.wa.listTemplates();
    // Template lokal yang tidak ada di Meta tidak boleh dianggap disetujui.
    const remoteKeys = new Set(remote.map((t) => `${t.name}|${t.language}`));
    for (const local of await db.select().from(waTemplates)) {
      if (!remoteKeys.has(`${local.name}|${local.language}`) && local.status !== 'LOCAL') {
        await db.update(waTemplates).set({ status: 'LOCAL' }).where(eq(waTemplates.id, local.id));
      }
    }
    for (const t of remote) {
      await db
        .insert(waTemplates)
        .values({ name: t.name, language: t.language, category: t.category, body: t.body, status: (t.status as any) ?? 'PENDING' })
        .onConflictDoUpdate({ target: [waTemplates.name, waTemplates.language], set: { body: t.body, status: t.status as any, category: t.category, updatedAt: new Date() } });
    }
    return { synced: remote.length };
  });

  // ---------- Status WhatsApp ----------
  app.get('/api/whatsapp/status', async (req) => {
    requireMenu(req, 'setting');
    const c = ctx.config;
    const [{ n: lastIn }] = (await db.select({ n: sql<string>`max(${messages.createdAt})` }).from(messages).where(eq(messages.direction, 'in'))) as [{ n: string }];
    return {
      mode: ctx.wa.mode,
      phoneNumberId: c.WA_PHONE_NUMBER_ID ? `••••${c.WA_PHONE_NUMBER_ID.slice(-4)}` : null,
      businessAccountId: c.WA_BUSINESS_ACCOUNT_ID ? `••••${c.WA_BUSINESS_ACCOUNT_ID.slice(-4)}` : null,
      webhookUrl: `${c.PUBLIC_URL.replace(/\/$/, '')}/api/webhooks/whatsapp`,
      verifyTokenSet: !!c.WA_VERIFY_TOKEN,
      appSecretSet: !!c.WA_APP_SECRET,
      graphVersion: c.WA_GRAPH_VERSION,
      lastInboundAt: lastIn,
    };
  });

  // ---------- Profil bisnis WhatsApp ----------
  const WaProfile = z.object({
    about: z.string().trim().max(139, 'Bio singkat maksimal 139 karakter'),
    description: z.string().trim().max(512, 'Deskripsi maksimal 512 karakter'),
    address: z.string().trim().max(256),
    email: z.union([z.literal(''), z.string().trim().email('Email tidak valid').max(128)]),
    websites: z.array(z.union([z.literal(''), z.string().trim().url('Website harus diawali https://').max(256)])).max(2),
    vertical: z.enum(['RESTAURANT', 'EVENT_PLAN', 'GROCERY', 'OTHER', 'UNDEFINED']),
  });

  app.get('/api/whatsapp/profile', async (req) => {
    requireMenu(req, 'setting');
    const local = await getSetting<any>(db, 'wa_profile');
    if (ctx.wa.mode === 'meta') {
      try {
        const remote = await ctx.wa.getBusinessProfile();
        if (remote) return { ...remote, websites: [...remote.websites, '', ''].slice(0, 2), source: 'meta', syncedAt: local.syncedAt };
      } catch (e) {
        return { ...local, source: 'local', error: `Gagal membaca profil dari Meta: ${(e as Error).message}` };
      }
    }
    return { ...local, source: 'local' };
  });

  app.put('/api/whatsapp/profile', async (req) => {
    const me = requireRole(req, 'admin');
    const body = WaProfile.parse(req.body);
    let syncedAt: string | null = null;
    if (ctx.wa.mode === 'meta') {
      try {
        await ctx.wa.updateBusinessProfile(body);
        syncedAt = new Date().toISOString();
      } catch (e) {
        throw badRequest(`Meta menolak perubahan profil: ${(e as Error).message}`);
      }
    }
    await setSetting(db, 'wa_profile', { ...body, syncedAt }, me.id);
    await audit(db, me.id, 'whatsapp.profile', 'setting', 'wa_profile');
    return { ok: true, syncedAt };
  });

  // ---------- Webhook Meta ----------
  app.get('/api/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && ctx.wa.verifyToken(q['hub.verify_token'])) return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    return reply.status(403).send('forbidden');
  });

  app.post('/api/webhooks/whatsapp', async (req, reply) => {
    if (!ctx.wa.verifySignature(req.rawBody ?? Buffer.alloc(0), req.headers['x-hub-signature-256'] as string | undefined)) {
      return reply.status(401).send({ error: 'Tanda tangan webhook tidak valid' });
    }
    await processWebhook(ctx, req.body, req);
    return { ok: true };
  });

  // ---------- Simulasi (hanya mode simulator) ----------
  app.post('/api/simulator/inbound', async (req) => {
    const me = requireRole(req, 'admin', 'spv');
    if (ctx.wa.mode !== 'simulator') throw badRequest('Simulasi hanya tersedia saat WA_MODE=simulator');
    const body = z.object({ phone: z.string(), name: z.string().default(''), text: z.string().min(1), adRef: z.boolean().optional() }).parse(req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest('Nomor tidak valid');
    const payload = buildInboundPayload(phone, body.name, body.text, body.adRef ? { referral: { source_type: 'ad', source_id: 'SIM-AD', headline: 'Iklan simulasi', ctwa_clid: 'sim' } } : {});
    await processWebhook(ctx, payload, req);
    await audit(db, me.id, 'simulator.inbound', 'contact', phone);
    const [ct] = await db.select().from(contacts).where(eq(contacts.waPhone, phone));
    const [conv] = ct ? await db.select().from(conversations).where(eq(conversations.contactId, ct.id)) : [];
    return { conversationId: conv?.id ?? null };
  });

  // ---------- Server-Sent Events (inbox real-time) ----------
  app.get('/api/events', async (req, reply) => {
    const me = requireUser(req);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');
    const own = ownOnly(me);
    const off = ctx.events.on((e) => {
      if ((e.type === 'notification' || e.type === 'task') && e.userId !== me.id) return;
      if ((e.type === 'message' || e.type === 'conversation' || e.type === 'lead') && own && e.ownerId !== me.id) return;
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
    });
    return reply;
  });
}

export async function processWebhook(ctx: Ctx, body: unknown, req?: FastifyRequest) {
  for (const ev of ctx.wa.parseWebhook(body)) {
    try {
      if (ev.type === 'message') await handleInbound(ctx, ev);
      else await handleStatus(ctx, ev);
    } catch (e) {
      req?.log.error(e, 'Gagal memproses webhook WhatsApp');
    }
  }
}

