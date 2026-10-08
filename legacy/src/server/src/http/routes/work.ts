import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { contacts, conversations, leads, notifications, proposalTemplates, proposals, stages, tasks, users } from '../../db/schema.js';
import { badRequest, forbidden, notFound } from '../../lib/http.js';
import { ownOnly, requireMenu, requireRole, requireUser, type AuthUser } from '../auth.js';
import { leadCode, moveStage, recordActivity } from '../../services/leads.js';
import { sendOutbound } from '../../services/messaging.js';
import { notify, usersWithRole } from '../../services/notify.js';
import { renderProposalPdf } from '../../services/proposal.js';
import { getSetting } from '../../services/settings.js';
import { addDays, wibAt, wibDateString } from '../../lib/time.js';
import { formatPhone } from '../../lib/phone.js';
import { audit } from '../../services/audit.js';

export function workRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  // ---------- Template proposal ----------
  app.get('/api/proposal-templates', async (req) => {
    requireUser(req);
    return db.select().from(proposalTemplates).orderBy(asc(proposalTemplates.name));
  });
  const TplBody = z.object({
    name: z.string().trim().min(1),
    segment: z.string().trim().default(''),
    sections: z.array(z.object({ title: z.string().trim().min(1), body: z.string() })).min(1),
  });
  app.post('/api/proposal-templates', async (req) => {
    const me = requireMenu(req, 'proposal');
    const body = TplBody.parse(req.body);
    const [t] = await db.insert(proposalTemplates).values(body).returning();
    await audit(db, me.id, 'proposal_template.create', 'proposal_template', t!.id);
    return t;
  });
  app.put('/api/proposal-templates/:id', async (req) => {
    requireMenu(req, 'proposal');
    const body = TplBody.parse(req.body);
    await db.update(proposalTemplates).set({ ...body, updatedAt: new Date() }).where(eq(proposalTemplates.id, (req.params as any).id));
    return { ok: true };
  });
  app.delete('/api/proposal-templates/:id', async (req) => {
    requireMenu(req, 'proposal');
    await db.delete(proposalTemplates).where(eq(proposalTemplates.id, (req.params as any).id));
    return { ok: true };
  });

  // ---------- Kirim proposal ----------
  async function leadForProposal(me: AuthUser, leadId: string) {
    const [row] = await db.select({ l: leads, ct: contacts }).from(leads).innerJoin(contacts, eq(contacts.id, leads.contactId)).where(eq(leads.id, leadId));
    if (!row) throw notFound('Lead tidak ditemukan');
    if (ownOnly(me) && row.l.ownerId !== me.id) throw forbidden('Lead ini milik sales lain');
    return row;
  }

  async function buildPdf(leadId: string, templateId: string, pricePerPax: number, discountPct: number, salesName: string) {
    const [{ l, ct }] = (await db.select({ l: leads, ct: contacts }).from(leads).innerJoin(contacts, eq(contacts.id, leads.contactId)).where(eq(leads.id, leadId))) as any[];
    const [tpl] = await db.select().from(proposalTemplates).where(eq(proposalTemplates.id, templateId));
    if (!tpl) throw notFound('Template tidak ditemukan');
    const biz = await getSetting<any>(db, 'business_profile');
    const buf = await renderProposalPdf(tpl.sections, { ...l, code: leadCode(l.code) }, {
      customerName: ct.name ?? 'Bapak/Ibu',
      salesName,
      businessName: biz.name,
      businessTagline: biz.tagline,
      logoFile: biz.logoPath ? path.join(path.resolve(ctx.config.UPLOAD_DIR), path.basename(biz.logoPath)) : null,
      pricePerPax,
      discountPct,
      bankAccounts: biz.bankAccounts,
    });
    return { buf, filename: `Proposal ${biz.name} - ${ct.name ?? leadCode(l.code)}.pdf`.replace(/[^\w .\-]/g, '') };
  }

  async function sendProposal(proposalId: string, sender: AuthUser) {
    const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
    if (!p) throw notFound();
    const [creator] = p.createdBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, p.createdBy)) : [];
    const { buf, filename } = await buildPdf(p.leadId, p.templateId!, p.pricePerPax, p.discountPct, creator?.name ?? sender.name);
    const [l] = await db.select().from(leads).where(eq(leads.id, p.leadId));
    const [conv] = await db.select().from(conversations).where(eq(conversations.contactId, l!.contactId));
    if (!conv) throw badRequest('Kontak ini belum punya percakapan WhatsApp');
    const file = `proposal-${randomUUID()}.pdf`;
    fs.mkdirSync(path.resolve(ctx.config.UPLOAD_DIR), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(ctx.config.UPLOAD_DIR), file), buf);
    await sendOutbound(ctx, {
      conversationId: conv.id,
      sender: { type: 'user', userId: p.createdBy ?? sender.id },
      kind: 'document',
      body: 'Berikut proposal penawaran dari Sonokembang Catering 🙏',
      document: { buffer: buf, filename, mime: 'application/pdf', path: file },
    });
    await db.update(proposals).set({ status: 'sent', filePath: file }).where(eq(proposals.id, p.id));
    await recordActivity(ctx, p.leadId, 'proposal_sent', 'Proposal terkirim', `${filename}${p.discountPct ? ` · diskon ${p.discountPct}%` : ''}`, p.createdBy ?? sender.id);

    // Naikkan ke tahap "Proposal" bila lead masih di tahap sebelumnya.
    const [cur] = await db.select().from(stages).where(eq(stages.id, l!.stageId));
    const [propStage] = await db.select().from(stages).where(and(eq(stages.pipelineId, l!.pipelineId), sql`lower(${stages.name}) = 'proposal'`));
    let warning: string | null = null;
    if (propStage && cur && cur.kind === 'open' && cur.sortOrder < propStage.sortOrder) {
      try {
        await moveStage(ctx, l!.id, { stageId: propStage.id }, sender.id);
      } catch (e) {
        warning = `Proposal terkirim, tapi lead belum bisa naik ke tahap Proposal: ${(e as Error).message}`;
      }
    }
    return { status: 'sent' as const, warning };
  }

  app.post('/api/leads/:id/proposals/preview', async (req, reply) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const { l } = await leadForProposal(me, (req.params as any).id);
    const body = z.object({ templateId: z.string().uuid(), pricePerPax: z.number().int().min(0), discountPct: z.number().int().min(0).max(100).default(0) }).parse(req.body);
    const { buf } = await buildPdf(l.id, body.templateId, body.pricePerPax, body.discountPct, me.name);
    reply.type('application/pdf');
    return reply.send(buf);
  });

  app.post('/api/leads/:id/proposals', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const { l } = await leadForProposal(me, (req.params as any).id);
    const body = z
      .object({ templateId: z.string().uuid(), pricePerPax: z.number().int().min(1, 'Harga per pax wajib diisi sales'), discountPct: z.number().int().min(0).max(100).default(0) })
      .parse(req.body);
    const approval = await getSetting<{ discountNeedsSpvAbove: number }>(db, 'approval');
    const needsApproval = body.discountPct > approval.discountNeedsSpvAbove && me.role === 'sales';
    const [p] = await db
      .insert(proposals)
      .values({ leadId: l.id, templateId: body.templateId, pricePerPax: body.pricePerPax, discountPct: body.discountPct, needsApproval, status: needsApproval ? 'waiting_approval' : 'draft', createdBy: me.id })
      .returning();
    if (needsApproval) {
      await notify(ctx, await usersWithRole(ctx, 'spv'), 'lead', `${me.name} minta persetujuan diskon ${body.discountPct}% untuk ${leadCode(l.code)}`, `/leads/${l.id}`);
      await recordActivity(ctx, l.id, 'proposal_approval', `Menunggu persetujuan SPV (diskon ${body.discountPct}%)`, null, me.id);
      return { status: 'waiting_approval', id: p!.id };
    }
    return { ...(await sendProposal(p!.id, me)), id: p!.id };
  });

  app.post('/api/proposals/:id/approve', async (req) => {
    const me = requireRole(req, 'spv', 'admin');
    const id = (req.params as any).id as string;
    const [p] = await db.select().from(proposals).where(eq(proposals.id, id));
    if (!p || p.status !== 'waiting_approval') throw badRequest('Proposal ini tidak sedang menunggu persetujuan');
    await db.update(proposals).set({ approvedBy: me.id }).where(eq(proposals.id, id));
    await audit(db, me.id, 'proposal.approve', 'proposal', id, { discountPct: p.discountPct });
    const r = await sendProposal(id, me);
    await notify(ctx, [p.createdBy], 'lead', `Diskon ${p.discountPct}% disetujui ${me.name} — proposal terkirim`, `/leads/${p.leadId}`);
    return r;
  });

  app.post('/api/proposals/:id/reject', async (req) => {
    const me = requireRole(req, 'spv', 'admin');
    const id = (req.params as any).id as string;
    const [p] = await db.select().from(proposals).where(eq(proposals.id, id));
    if (!p) throw notFound();
    await db.delete(proposals).where(eq(proposals.id, id));
    await recordActivity(ctx, p.leadId, 'proposal_approval', `Diskon ${p.discountPct}% ditolak ${me.name}`, null, me.id);
    await notify(ctx, [p.createdBy], 'lead', `Diskon ${p.discountPct}% ditolak ${me.name}`, `/leads/${p.leadId}`);
    return { ok: true };
  });

  app.get('/api/proposals/pending', async (req) => {
    requireRole(req, 'spv', 'admin');
    return db
      .select({ id: proposals.id, leadId: proposals.leadId, discountPct: proposals.discountPct, pricePerPax: proposals.pricePerPax, at: proposals.createdAt, by: users.name, customer: contacts.name, code: leads.code })
      .from(proposals)
      .innerJoin(leads, eq(leads.id, proposals.leadId))
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(users, eq(users.id, proposals.createdBy))
      .where(eq(proposals.status, 'waiting_approval'))
      .orderBy(desc(proposals.createdAt));
  });

  // ---------- Tugas ----------
  app.get('/api/tasks', async (req) => {
    const me = requireMenu(req, 'tugas');
    const q = z.object({ range: z.enum(['today', 'overdue', 'tomorrow', 'week', 'done']).default('today'), userId: z.string().uuid().optional() }).parse(req.query);
    const userId = q.userId && !ownOnly(me) ? q.userId : me.id;
    const now = new Date();
    const today = wibDateString(now);
    const startToday = wibAt(today, '00:00');
    const startTomorrow = wibAt(wibDateString(addDays(now, 1)), '00:00');
    const startDayAfter = wibAt(wibDateString(addDays(now, 2)), '00:00');
    const conds = [eq(tasks.userId, userId)];
    if (q.range === 'today') conds.push(lt(tasks.dueAt, startTomorrow), sql`(${tasks.doneAt} is null or ${tasks.doneAt} >= ${startToday.toISOString()}::timestamptz)`);
    if (q.range === 'overdue') conds.push(lt(tasks.dueAt, now), isNull(tasks.doneAt));
    if (q.range === 'tomorrow') conds.push(gte(tasks.dueAt, startTomorrow), lt(tasks.dueAt, startDayAfter));
    if (q.range === 'week') conds.push(gte(tasks.dueAt, startToday), lt(tasks.dueAt, addDays(startToday, 7)));
    if (q.range === 'done') conds.push(isNotNull(tasks.doneAt));
    const rows = await db
      .select({ t: tasks, leadTitle: leads.name, leadName: contacts.name, leadPhone: contacts.waPhone, leadCodeNum: leads.code, convId: conversations.id })
      .from(tasks)
      .leftJoin(leads, eq(leads.id, tasks.leadId))
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(conversations, eq(conversations.contactId, leads.contactId))
      .where(and(...conds))
      .orderBy(q.range === 'done' ? desc(tasks.doneAt) : asc(tasks.dueAt))
      .limit(300);
    const [{ total, done, late }] = (await db
      .select({
        total: sql<number>`count(*)`,
        done: sql<number>`count(*) filter (where ${tasks.doneAt} is not null)`,
        late: sql<number>`count(*) filter (where ${tasks.doneAt} is null and ${tasks.dueAt} < now())`,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), lt(tasks.dueAt, startTomorrow), sql`(${tasks.doneAt} is null or ${tasks.doneAt} >= ${startToday.toISOString()}::timestamptz)`))) as any[];
    return {
      summary: { total: Number(total), done: Number(done), late: Number(late) },
      rows: rows.map(({ t, leadTitle, leadName, leadPhone, leadCodeNum, convId }) => ({
        ...t,
        late: !t.doneAt && t.dueAt < now,
        lead: t.leadId ? { id: t.leadId, name: leadTitle || leadName || (leadPhone ? formatPhone(leadPhone) : null), contactName: leadName ?? (leadPhone ? formatPhone(leadPhone) : null), code: leadCodeNum ? leadCode(leadCodeNum) : null } : null,
        conversationId: convId,
      })),
    };
  });

  app.post('/api/tasks', async (req) => {
    const me = requireMenu(req, 'tugas', 'pipeline', 'inbox');
    const body = z
      .object({ title: z.string().trim().min(1), kind: z.string().default('Follow-up'), dueAt: z.coerce.date(), leadId: z.string().uuid().optional(), userId: z.string().uuid().optional() })
      .parse(req.body);
    const userId = body.userId && !ownOnly(me) ? body.userId : me.id;
    const [t] = await db.insert(tasks).values({ title: body.title, kind: body.kind, dueAt: body.dueAt, leadId: body.leadId ?? null, userId }).returning();
    if (body.leadId) await recordActivity(ctx, body.leadId, 'task', `Janji follow-up: ${body.title}`, body.dueAt.toISOString(), me.id);
    ctx.events.emit({ type: 'task', userId });
    return t;
  });

  app.patch('/api/tasks/:id', async (req) => {
    const me = requireUser(req);
    const id = (req.params as any).id as string;
    const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!t) throw notFound();
    if (t.userId !== me.id && ownOnly(me)) throw forbidden();
    const body = z.object({ done: z.boolean().optional(), dueAt: z.coerce.date().optional(), title: z.string().optional() }).parse(req.body);
    await db
      .update(tasks)
      .set({ ...(body.done !== undefined ? { doneAt: body.done ? new Date() : null } : {}), ...(body.dueAt ? { dueAt: body.dueAt } : {}), ...(body.title ? { title: body.title } : {}) })
      .where(eq(tasks.id, id));
    ctx.events.emit({ type: 'task', userId: t.userId });
    return { ok: true };
  });

  // ---------- Notifikasi ----------
  app.get('/api/notifications', async (req) => {
    const me = requireUser(req);
    return db.select().from(notifications).where(eq(notifications.userId, me.id)).orderBy(desc(notifications.createdAt)).limit(100);
  });
  app.post('/api/notifications/read', async (req) => {
    const me = requireUser(req);
    const { id } = z.object({ id: z.string().uuid().optional() }).parse(req.body ?? {});
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
    return { ok: true };
  });

  // Papan pengawasan SPV: semua notifikasi tim + statistik SLA
  app.get('/api/notifications/team', async (req) => {
    const me = requireMenu(req, 'notif');
    // Cakupan "milik sendiri": hanya notifikasi ke dirinya & chat yang ditugaskan kepadanya.
    const own = ownOnly(me);
    const since = addDays(new Date(), -7);
    const feed = await db
      .select({ id: notifications.id, kind: notifications.kind, text: notifications.text, link: notifications.link, readAt: notifications.readAt, at: notifications.createdAt, to: users.name })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(and(gte(notifications.createdAt, since), own ? eq(notifications.userId, me.id) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(200);
    const startToday = wibAt(wibDateString(new Date()), '00:00');
    const waiting = await db
      .select({ id: conversations.id, name: contacts.name, phone: contacts.waPhone, since: conversations.awaitingReplySince, level: conversations.slaLevel, owner: users.name })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(users, eq(users.id, conversations.assigneeId))
      .where(and(eq(conversations.aiActive, false), isNotNull(conversations.awaitingReplySince), own ? eq(conversations.assigneeId, me.id) : undefined))
      .orderBy(asc(conversations.awaitingReplySince))
      .limit(50);
    const slaToday = feed.filter((f) => f.kind === 'sla' && f.at >= startToday).length;
    return {
      feed,
      waiting: waiting.map((w) => ({ ...w, phone: formatPhone(w.phone) })),
      stats: { slaToday, waitingNow: waiting.length, sentWeek: feed.length, readPct: feed.length ? Math.round((feed.filter((f) => f.readAt).length / feed.length) * 100) : 0 },
    };
  });
}
