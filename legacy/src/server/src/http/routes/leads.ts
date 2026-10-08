import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import {
  activities,
  contacts,
  conversations,
  customFields,
  distributionMembers,
  leadSources,
  leadStageHistory,
  leads,
  pipelines,
  proposals,
  stages,
  tasks,
  testFoods,
  users,
} from '../../db/schema.js';
import { badRequest, forbidden, notFound } from '../../lib/http.js';
import { toCsv } from '../../lib/csv.js';
import { formatPhone, normalizePhone } from '../../lib/phone.js';
import { ownOnly, requireMenu, requireRole, requireUser, type AuthUser } from '../auth.js';
import { applyQualification, createLead, leadCode, moveStage, openLeadForContact, recordActivity } from '../../services/leads.js';
import { audit } from '../../services/audit.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { STAGE_REQUIREMENTS } from '../../services/defaults.js';
import type { DistributionSettings } from '../../services/distribution.js';
import { addDays, wibAt, wibDateString, wibDateTimeLabel } from '../../lib/time.js';

const ALLOWED_UPLOAD = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['application/pdf', '.pdf'],
]);

/** Simpan file unggahan (bukti DP, dll.) ke folder upload. */
export async function saveUpload(ctx: Ctx, req: FastifyRequest, prefix: string, opts: { imagesOnly?: boolean } = {}) {
  const file = await req.file();
  if (!file) throw badRequest('File belum dipilih');
  const ext = ALLOWED_UPLOAD.get(file.mimetype);
  if (!ext || (opts.imagesOnly && ext === '.pdf')) throw badRequest(opts.imagesOnly ? 'Format file harus JPG atau PNG' : 'Format file harus JPG, PNG, atau PDF');
  const buf = await file.toBuffer();
  if (file.file.truncated) throw badRequest('Ukuran file maksimal 5 MB');
  const name = `${prefix}-${randomUUID()}${ext}`;
  const dir = path.resolve(ctx.config.UPLOAD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(file.fields)) {
    const f = v as any;
    if (f && typeof f === 'object' && 'value' in f) fields[k] = String(f.value);
  }
  return { name, fields, mime: file.mimetype, buffer: buf, filename: file.filename };
}

async function loadLeadFor(ctx: Ctx, me: AuthUser, id: string) {
  const [l] = await ctx.db.select().from(leads).where(eq(leads.id, id));
  if (!l) throw notFound('Lead tidak ditemukan');
  if (ownOnly(me) && l.ownerId !== me.id) throw forbidden('Lead ini milik sales lain');
  return l;
}

export function leadRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  // ---------- Pipeline & tahap ----------
  app.get('/api/pipelines', async (req) => {
    requireUser(req);
    const ps = await db.select().from(pipelines).orderBy(asc(pipelines.sortOrder));
    const ss = await db.select().from(stages).orderBy(asc(stages.sortOrder));
    return { pipelines: ps.map((p) => ({ ...p, stages: ss.filter((s) => s.pipelineId === p.id) })), requirements: STAGE_REQUIREMENTS };
  });

  const PipelineBody = z.object({
    name: z.string().trim().min(1),
    color: z.string().default('#db6262'),
    targetShare: z.number().int().min(0).max(100).default(0),
    eventTypes: z.array(z.string()).default([]),
    active: z.boolean().default(true),
    stages: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(1),
          kind: z.enum(['open', 'won', 'lost']),
          probability: z.number().int().min(0).max(100),
          slaDays: z.number().int().min(0).nullable().optional(),
          requirements: z.array(z.enum(['lost_reason', 'dp_proof', 'source_known', 'proposal_sent'])).default([]),
        }),
      )
      .min(2),
  });

  async function saveStages(pipelineId: string, list: z.infer<typeof PipelineBody>['stages']) {
    if (!list.some((s) => s.kind === 'open')) throw badRequest('Minimal satu tahap terbuka');
    if (!list.some((s) => s.kind === 'lost')) throw badRequest('Pipeline wajib punya tahap Lost');
    const existing = await db.select().from(stages).where(eq(stages.pipelineId, pipelineId));
    const keep = new Set(list.filter((s) => s.id).map((s) => s.id!));
    for (const old of existing.filter((s) => !keep.has(s.id))) {
      const [{ n }] = (await db.select({ n: count() }).from(leads).where(eq(leads.stageId, old.id))) as [{ n: number }];
      if (Number(n) > 0) throw badRequest(`Tahap "${old.name}" masih berisi ${n} lead. Pindahkan dulu sebelum dihapus.`);
      await db.delete(stages).where(eq(stages.id, old.id));
    }
    for (const [i, s] of list.entries()) {
      const v = { name: s.name, kind: s.kind, probability: s.probability, slaDays: s.slaDays ?? null, requirements: s.requirements, sortOrder: i, pipelineId };
      if (s.id && existing.some((e) => e.id === s.id)) await db.update(stages).set(v).where(eq(stages.id, s.id));
      else await db.insert(stages).values(v);
    }
  }

  app.post('/api/pipelines', async (req) => {
    const me = requireRole(req, 'admin');
    const body = PipelineBody.parse(req.body);
    const [{ n }] = (await db.select({ n: count() }).from(pipelines)) as [{ n: number }];
    const [p] = await db.insert(pipelines).values({ name: body.name, color: body.color, targetShare: body.targetShare, eventTypes: body.eventTypes, active: body.active, sortOrder: Number(n) }).returning();
    await saveStages(p!.id, body.stages);
    await audit(db, me.id, 'pipeline.create', 'pipeline', p!.id, { name: body.name });
    return p;
  });

  app.put('/api/pipelines/:id', async (req) => {
    const me = requireRole(req, 'admin');
    const id = (req.params as any).id as string;
    const body = PipelineBody.parse(req.body);
    await db.update(pipelines).set({ name: body.name, color: body.color, targetShare: body.targetShare, eventTypes: body.eventTypes, active: body.active }).where(eq(pipelines.id, id));
    await saveStages(id, body.stages);
    await audit(db, me.id, 'pipeline.update', 'pipeline', id, { name: body.name });
    return { ok: true };
  });

  // ---------- Sumber lead ----------
  app.get('/api/sources', async (req) => {
    requireUser(req);
    return db.select().from(leadSources).orderBy(asc(leadSources.sortOrder));
  });
  const SourceBody = z.object({
    name: z.string().trim().min(1),
    channel: z.string().trim().min(1),
    refCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,12}$/, 'Kode penanda 2–12 huruf/angka')
      .nullable()
      .optional(),
    howRecorded: z.string().nullable().optional(),
    offline: z.boolean().default(false),
    active: z.boolean().default(true),
  });
  app.post('/api/sources', async (req) => {
    requireRole(req, 'admin');
    const body = SourceBody.parse(req.body);
    const [{ n }] = (await db.select({ n: count() }).from(leadSources)) as [{ n: number }];
    const [s] = await db.insert(leadSources).values({ ...body, refCode: body.refCode ?? null, sortOrder: Number(n) }).returning();
    return s;
  });
  app.patch('/api/sources/:id', async (req) => {
    requireRole(req, 'admin');
    const body = SourceBody.partial().parse(req.body);
    await db.update(leadSources).set(body).where(eq(leadSources.id, (req.params as any).id));
    return { ok: true };
  });

  // ---------- Custom field ----------
  app.get('/api/custom-fields', async (req) => {
    requireUser(req);
    return db.select().from(customFields).orderBy(asc(customFields.entity), asc(customFields.sortOrder));
  });
  const FieldBody = z.object({
    entity: z.enum(['lead', 'contact']),
    name: z.string().trim().min(1),
    type: z.enum(['text', 'number', 'date', 'select', 'boolean']),
    options: z.array(z.string().trim().min(1)).default([]),
    required: z.boolean().default(false),
    aiFillable: z.boolean().default(false),
    showInTable: z.boolean().default(false),
  });
  app.post('/api/custom-fields', async (req) => {
    const me = requireRole(req, 'admin');
    const body = FieldBody.parse(req.body);
    if (body.type === 'select' && !body.options.length) throw badRequest('Tipe pilihan wajib punya daftar pilihan');
    const key = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
    const [{ n }] = (await db.select({ n: count() }).from(customFields).where(eq(customFields.entity, body.entity))) as [{ n: number }];
    const [f] = await db.insert(customFields).values({ ...body, key, sortOrder: Number(n) }).returning();
    await audit(db, me.id, 'custom_field.create', 'custom_field', f!.id, body);
    return f;
  });
  app.patch('/api/custom-fields/:id', async (req) => {
    requireRole(req, 'admin');
    const body = FieldBody.omit({ entity: true }).partial().parse(req.body);
    await db.update(customFields).set(body).where(eq(customFields.id, (req.params as any).id));
    return { ok: true };
  });
  app.delete('/api/custom-fields/:id', async (req) => {
    requireRole(req, 'admin');
    await db.delete(customFields).where(eq(customFields.id, (req.params as any).id));
    return { ok: true };
  });

  // ---------- Distribusi lead ----------
  app.get('/api/distribution', async (req) => {
    requireMenu(req, 'setting');
    const settings = await getSetting<DistributionSettings>(db, 'distribution');
    const people = await db
      .select({ id: users.id, name: users.name, role: users.role, status: users.status })
      .from(users)
      .where(inArray(users.role, ['sales', 'spv']));
    const members = await db.select().from(distributionMembers).where(eq(distributionMembers.channel, 'default'));
    const monthStart = new Date(wibDateString(new Date()).slice(0, 7) + '-01T00:00:00+07:00');
    const month = await db
      .select({ ownerId: leads.ownerId, n: count() })
      .from(leads)
      .where(sql`${leads.createdAt} >= ${monthStart.toISOString()}::timestamptz`)
      .groupBy(leads.ownerId);
    return {
      ...settings,
      members: people.map((p) => {
        const m = members.find((x) => x.userId === p.id);
        return { ...p, weight: m?.weight ?? (p.role === 'sales' ? 1 : 0), included: m ? m.included : p.role === 'sales', month: Number(month.find((x) => x.ownerId === p.id)?.n ?? 0) };
      }),
    };
  });

  app.put('/api/distribution', async (req) => {
    const me = requireRole(req, 'admin');
    const body = z
      .object({
        method: z.enum(['weighted', 'round_robin', 'manual']),
        rules: z.object({ sticky: z.boolean(), skipLeave: z.boolean(), cap: z.boolean(), capCount: z.number().int().min(1), escalate: z.boolean() }),
        members: z.array(z.object({ id: z.string().uuid(), weight: z.number().int().min(0).max(100), included: z.boolean() })),
        specialRules: z
          .array(
            z.object({
              id: z.string().min(1),
              label: z.string().trim().min(1),
              keywords: z.array(z.string().trim().min(1)).min(1, 'Aturan khusus wajib punya kata kunci'),
              userIds: z.array(z.string().uuid()).min(1, 'Aturan khusus wajib punya minimal satu sales'),
              active: z.boolean(),
            }),
          )
          .default([]),
      })
      .parse(req.body);
    await setSetting(db, 'distribution', { method: body.method, rules: body.rules, specialRules: body.specialRules }, me.id);
    for (const m of body.members) {
      await db
        .insert(distributionMembers)
        .values({ userId: m.id, channel: 'default', weight: m.weight, included: m.included })
        .onConflictDoUpdate({ target: [distributionMembers.userId, distributionMembers.channel], set: { weight: m.weight, included: m.included } });
    }
    await audit(db, me.id, 'distribution.update', 'setting', 'distribution', body);
    return { ok: true };
  });

  // ---------- Lead ----------
  app.get('/api/leads', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const q = z
      .object({
        pipelineId: z.string().uuid().optional(),
        q: z.string().optional(),
        owner: z.string().optional(),
        source: z.string().optional(),
        temp: z.string().optional(),
        includeClosed: z.coerce.boolean().default(true),
      })
      .parse(req.query);
    const conds = [];
    if (ownOnly(me)) conds.push(eq(leads.ownerId, me.id));
    if (q.pipelineId) conds.push(eq(leads.pipelineId, q.pipelineId));
    if (q.owner) conds.push(inArray(leads.ownerId, q.owner.split(',')));
    if (q.source) conds.push(inArray(leads.sourceId, q.source.split(',')));
    if (q.temp) conds.push(inArray(leads.temperature, q.temp.split(',') as any));
    if (q.q?.trim()) {
      const term = `%${q.q.trim()}%`;
      conds.push(or(ilike(leads.name, term), ilike(contacts.name, term), ilike(leads.eventType, term), ilike(leads.location, term), ilike(contacts.waPhone, `%${q.q.replace(/\D/g, '') || '§'}%`)));
    }
    const rows = await db
      .select({ l: leads, ct: contacts, stage: stages, owner: users.name, source: leadSources.name })
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .innerJoin(stages, eq(stages.id, leads.stageId))
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .where(and(...conds))
      .orderBy(desc(leads.updatedAt))
      .limit(1000);
    return rows
      .filter((r) => q.includeClosed || r.stage.kind === 'open')
      .map(({ l, ct, stage, owner, source }) => ({
        id: l.id,
        code: leadCode(l.code),
        name: l.name,
        contactName: ct.name ?? formatPhone(ct.waPhone),
        customerName: l.customerName,
        expectedDpMonth: l.expectedDpMonth?.slice(0, 7) ?? null,
        phone: formatPhone(ct.waPhone),
        contactId: ct.id,
        pipelineId: l.pipelineId,
        stageId: l.stageId,
        stageName: stage.name,
        stageKind: stage.kind,
        stageSlaDays: stage.slaDays,
        stageChangedAt: l.stageChangedAt,
        owner: owner,
        ownerId: l.ownerId,
        source,
        origin: l.origin,
        eventType: l.eventType,
        eventDate: l.eventDate,
        eventDateText: l.eventDateText,
        location: l.location,
        pax: l.pax,
        budget: l.budget,
        estimatedValue: l.estimatedValue,
        potensi: l.potensi,
        score: l.score,
        temperature: l.temperature,
        lostReason: l.lostReason,
        lostKind: l.lostKind,
        custom: l.custom,
        createdAt: l.createdAt,
        lastActivityAt: l.lastActivityAt,
      }));
  });

  app.get('/api/leads/:id', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const l = await loadLeadFor(ctx, me, (req.params as any).id);
    const [ct] = await db.select().from(contacts).where(eq(contacts.id, l.contactId));
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, l.pipelineId));
    const pStages = await db.select().from(stages).where(eq(stages.pipelineId, l.pipelineId)).orderBy(asc(stages.sortOrder));
    const history = await db.select().from(leadStageHistory).where(eq(leadStageHistory.leadId, l.id)).orderBy(asc(leadStageHistory.at));
    const acts = await db
      .select({ id: activities.id, type: activities.type, title: activities.title, note: activities.note, at: activities.at, by: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.userId))
      .where(eq(activities.leadId, l.id))
      .orderBy(desc(activities.at))
      .limit(100);
    const tf = await db.select().from(testFoods).where(eq(testFoods.leadId, l.id)).orderBy(desc(testFoods.scheduledAt));
    const props = await db.select().from(proposals).where(eq(proposals.leadId, l.id)).orderBy(desc(proposals.createdAt));
    const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, l.contactId));
    const [owner] = l.ownerId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, l.ownerId)) : [];
    const src = l.sourceId ? (await db.select().from(leadSources).where(eq(leadSources.id, l.sourceId)))[0] : null;
    return {
      ...l,
      code: leadCode(l.code),
      expectedDpMonth: l.expectedDpMonth?.slice(0, 7) ?? null,
      contact: { id: ct!.id, name: ct!.name, phone: formatPhone(ct!.waPhone), type: ct!.contactType, email: ct!.email, company: ct!.company },
      pipeline: { id: pipeline!.id, name: pipeline!.name },
      stages: pStages.map((s) => ({ ...s, enteredAt: [...history].reverse().find((h) => h.stageId === s.id)?.at ?? null })),
      activities: acts,
      testFoods: tf,
      proposals: props,
      conversationId: conv?.id ?? null,
      owner: owner ?? null,
      source: src ? { id: src.id, name: src.name, offline: src.offline } : null,
    };
  });

  app.post('/api/leads', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox', 'kontak');
    const body = z
      .object({
        contactId: z.string().uuid().optional(),
        phone: z.string().optional(),
        name: z.string().trim().optional(),
        sourceId: z.string().uuid().nullable().optional(),
        pipelineId: z.string().uuid().optional(),
        ownerId: z.string().uuid().optional(),
        note: z.string().optional(),
      })
      .parse(req.body);
    let contactId = body.contactId;
    if (!contactId) {
      const phone = normalizePhone(body.phone ?? '');
      if (!phone) throw badRequest('Nomor WhatsApp tidak valid');
      const [existing] = await db.select().from(contacts).where(eq(contacts.waPhone, phone));
      if (existing) contactId = existing.id;
      else {
        const [c] = await db.insert(contacts).values({ waPhone: phone, name: body.name || null, sourceId: body.sourceId ?? null, ownerId: body.ownerId ?? me.id }).returning();
        contactId = c!.id;
      }
    }
    const open = await openLeadForContact(ctx, contactId!);
    if (open) throw badRequest(`Kontak ini sudah punya lead aktif (${leadCode(open.code)})`);
    const lead = await createLead(ctx, {
      contactId: contactId!,
      ownerId: ownOnly(me) ? me.id : (body.ownerId ?? me.id),
      sourceId: body.sourceId ?? null,
      origin: 'manual',
      originNote: body.note || `Dibuat manual oleh ${me.name}`,
      pipelineId: body.pipelineId,
      userId: me.id,
    });
    return { id: lead.id };
  });

  app.patch('/api/leads/:id', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const l = await loadLeadFor(ctx, me, (req.params as any).id);
    const body = z
      .object({
        eventType: z.string().nullable().optional(),
        eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        eventDateText: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        pax: z.number().int().min(0).nullable().optional(),
        budget: z.number().int().min(0).nullable().optional(),
        estimatedValue: z.number().int().min(0).nullable().optional(),
        dealValue: z.number().int().min(0).nullable().optional(),
        custom: z.record(z.string(), z.unknown()).optional(),
        sourceId: z.string().uuid().nullable().optional(),
        ownerId: z.string().uuid().optional(),
        contactName: z.string().trim().optional(),
        customerName: z.string().trim().max(80).nullable().optional(),
        expectedDpMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(), // YYYY-MM
      })
      .parse(req.body);
    const { sourceId, ownerId, contactName, expectedDpMonth, ...rest } = body;
    const qual = { ...rest, ...(expectedDpMonth !== undefined ? { expectedDpMonth: expectedDpMonth ? `${expectedDpMonth}-01` : null } : {}) };
    if (sourceId !== undefined) {
      await db.update(leads).set({ sourceId }).where(eq(leads.id, l.id));
      await db.update(contacts).set({ sourceId }).where(eq(contacts.id, l.contactId));
    }
    if (ownerId && ownerId !== l.ownerId) {
      if (ownOnly(me)) throw forbidden('Hanya SPV yang bisa memindahkan PIC');
      await db.update(leads).set({ ownerId }).where(eq(leads.id, l.id));
      await db.update(contacts).set({ ownerId }).where(eq(contacts.id, l.contactId));
      await db.update(conversations).set({ assigneeId: ownerId }).where(eq(conversations.contactId, l.contactId));
      await recordActivity(ctx, l.id, 'owner_change', 'PIC lead diganti', null, me.id);
    }
    if (contactName) await db.update(contacts).set({ name: contactName }).where(eq(contacts.id, l.contactId));
    if (Object.keys(qual).length) await applyQualification(ctx, l.id, qual, 'user', me.id);
    return { ok: true };
  });

  app.post('/api/leads/:id/stage', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const l = await loadLeadFor(ctx, me, (req.params as any).id);
    const body = z
      .object({
        stageId: z.string().uuid(),
        lostKind: z.enum(['Lost', 'Abandoned']).optional(),
        lostReason: z.string().optional(),
        lostNote: z.string().optional(),
      })
      .parse(req.body);
    await moveStage(ctx, l.id, body, me.id);
    return { ok: true };
  });

  // Konfirmasi DP: unggah bukti transfer + nilai DP, lalu pindah ke tahap Closing.
  app.post('/api/leads/:id/dp', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const l = await loadLeadFor(ctx, me, (req.params as any).id);
    const up = await saveUpload(ctx, req, 'dp');
    const amount = Number(String(up.fields.amount ?? '').replace(/\D/g, ''));
    const dealValue = Number(String(up.fields.dealValue ?? '').replace(/\D/g, '')) || undefined;
    const date = up.fields.date;
    if (!amount) throw badRequest('Nilai DP wajib diisi');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Tanggal DP wajib diisi');
    let stageId = up.fields.stageId;
    if (!stageId) {
      const [won] = await db
        .select()
        .from(stages)
        .where(and(eq(stages.pipelineId, l.pipelineId), eq(stages.kind, 'won')))
        .orderBy(asc(stages.sortOrder))
        .limit(1);
      if (!won) throw badRequest('Pipeline ini belum punya tahap Closing');
      stageId = won.id;
    }
    if (dealValue !== undefined && dealValue < amount) throw badRequest('Nilai total order tidak boleh lebih kecil dari DP');
    await db.update(leads).set({ dpAmount: amount, dpDate: date, dpProofPath: up.name, ...(dealValue ? { dealValue } : {}) }).where(eq(leads.id, l.id));
    await moveStage(ctx, l.id, { stageId, dpAmount: amount, dpDate: date, dpProofPath: up.name, dealValue }, me.id);
    await recordActivity(ctx, l.id, 'dp', 'Bukti DP diunggah', `Rp ${amount.toLocaleString('id-ID')} · ${date}`, me.id);
    return { ok: true };
  });

  // Hasil test food terstruktur. "Revisi menu" otomatis membuat tugas revisi proposal untuk PIC.
  const TfResult = z.object({
    menus: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    decision: z.enum(['lanjut', 'revisi', 'belum']),
    note: z.string().trim().max(2000).optional(),
  });
  const DECISION_LABEL = { lanjut: 'Lanjut ke closing', revisi: 'Revisi menu dulu', belum: 'Belum memutuskan' } as const;
  const saveTfResult = async (tfId: number, leadId: string, ownerId: string | null, r: z.infer<typeof TfResult>, me: { id: string }) => {
    await db
      .update(testFoods)
      .set({ menus: r.menus, rating: r.rating ?? null, decision: r.decision, result: r.note || null, resultAt: new Date() })
      .where(eq(testFoods.id, tfId));
    const lines = [
      `Keputusan: ${DECISION_LABEL[r.decision]}`,
      ...(r.rating ? [`Rating: ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} (${r.rating}/5)`] : []),
      ...(r.menus.length ? [`Menu dicoba: ${r.menus.join(', ')}`] : []),
      ...(r.note ? [r.note] : []),
    ];
    await recordActivity(ctx, leadId, 'test_food', 'Hasil test food dicatat', lines.join('\n'), me.id);
    if (r.decision === 'revisi') {
      const due = wibAt(wibDateString(addDays(new Date(), 1)), '10:00');
      await db
        .insert(tasks)
        .values({ leadId, userId: ownerId ?? me.id, title: 'Revisi proposal setelah test food', kind: 'Proposal', dueAt: due, auto: true, ruleKey: `tf-revisi-${tfId}` })
        .onConflictDoNothing();
    }
  };

  app.post('/api/leads/:id/test-food', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const l = await loadLeadFor(ctx, me, (req.params as any).id);
    const body = z
      .object({ scheduledAt: z.coerce.date(), place: z.string().optional(), people: z.number().int().min(1).optional(), result: TfResult.optional() })
      .parse(req.body);
    const [tf] = await db.insert(testFoods).values({ leadId: l.id, scheduledAt: body.scheduledAt, place: body.place ?? null, people: body.people ?? null, createdBy: me.id }).returning();
    if (body.result) await saveTfResult(tf!.id, l.id, l.ownerId, body.result, me);
    else await recordActivity(ctx, l.id, 'test_food', 'Test food dijadwalkan', `${wibDateTimeLabel(body.scheduledAt)} · ${body.place ?? ''}`, me.id);
    return { ok: true, id: tf!.id };
  });

  app.patch('/api/test-food/:id', async (req) => {
    const me = requireMenu(req, 'pipeline', 'inbox');
    const id = Number((req.params as any).id);
    const [tf] = await db.select().from(testFoods).where(eq(testFoods.id, id));
    if (!tf) throw notFound();
    const l = await loadLeadFor(ctx, me, tf.leadId);
    await saveTfResult(id, tf.leadId, l.ownerId, TfResult.parse(req.body), me);
    return { ok: true };
  });

  // ---------- Kontak ----------
  // Status kontak otomatis dari siklus lead-nya (prototype v16): tidak perlu diisi manual.
  // Nama tabel ditulis lengkap: Drizzle membuang awalan tabel pada query satu tabel, padahal subquery juga punya kolom "id".
  const lifecycle = sql<string>`case
    when "contacts"."contact_type" in ('Bukan prospek', 'Supplier', 'Vendor / WO') then 'Bukan prospek'
    when "contacts"."contact_type" = 'Pelanggan' or exists (select 1 from leads l join stages st on st.id = l.stage_id where l.contact_id = "contacts"."id" and st.kind = 'won') then 'Pelanggan'
    when exists (select 1 from leads l join stages st on st.id = l.stage_id where l.contact_id = "contacts"."id" and st.kind = 'open') then 'Lead aktif'
    when exists (select 1 from leads l join stages st on st.id = l.stage_id where l.contact_id = "contacts"."id" and st.kind = 'lost') then 'Lost / Abandoned'
    else 'Belum diklasifikasi' end`;

  app.get('/api/contacts', async (req) => {
    const me = requireMenu(req, 'kontak', 'pelanggan');
    const q = z.object({ status: z.string().optional(), type: z.string().optional(), q: z.string().optional(), page: z.coerce.number().min(1).default(1), size: z.coerce.number().max(200).default(50) }).parse(req.query);
    const conds = [];
    if (ownOnly(me)) conds.push(eq(contacts.ownerId, me.id));
    if (q.type) conds.push(eq(contacts.contactType, q.type));
    if (q.status) conds.push(sql`${lifecycle} = ${q.status}`);
    if (q.q?.trim()) {
      const term = `%${q.q.trim()}%`;
      const digits = q.q.replace(/\D/g, '');
      conds.push(or(ilike(contacts.name, term), ilike(contacts.company, term), ...(digits.length >= 4 ? [ilike(contacts.waPhone, `%${digits}%`)] : [])));
    }
    const where = and(...conds);
    const [{ n: total }] = (await db.select({ n: count() }).from(contacts).where(where)) as [{ n: number }];
    const rows = await db
      .select({ c: contacts, status: lifecycle, owner: users.name, source: leadSources.name, convId: conversations.id })
      .from(contacts)
      .leftJoin(users, eq(users.id, contacts.ownerId))
      .leftJoin(leadSources, eq(leadSources.id, contacts.sourceId))
      .leftJoin(conversations, eq(conversations.contactId, contacts.id))
      .where(where)
      .orderBy(desc(sql`coalesce(${contacts.lastMessageAt}, ${contacts.createdAt})`))
      .limit(q.size)
      .offset((q.page - 1) * q.size);
    const ids = rows.map((r) => r.c.id);
    const leadAgg = ids.length
      ? await db
          .select({ contactId: leads.contactId, n: count(), won: sql<number>`count(*) filter (where ${stages.kind} = 'won')`, lost: sql<number>`count(*) filter (where ${stages.kind} = 'lost')` })
          .from(leads)
          .innerJoin(stages, eq(stages.id, leads.stageId))
          .where(inArray(leads.contactId, ids))
          .groupBy(leads.contactId)
      : [];
    const typeCounts = await db
      .select({ type: contacts.contactType, n: count() })
      .from(contacts)
      .where(ownOnly(me) ? eq(contacts.ownerId, me.id) : undefined)
      .groupBy(contacts.contactType);
    const statusCounts = await db
      .select({ status: lifecycle, n: count() })
      .from(contacts)
      .where(ownOnly(me) ? eq(contacts.ownerId, me.id) : undefined)
      .groupBy(sql`1`);
    return {
      total: Number(total),
      typeCounts: Object.fromEntries(typeCounts.map((t) => [t.type, Number(t.n)])),
      statusCounts: Object.fromEntries(statusCounts.map((t) => [t.status, Number(t.n)])),
      rows: rows.map(({ c, status, owner, source, convId }) => {
        const a = leadAgg.find((x) => x.contactId === c.id);
        return {
          id: c.id,
          name: c.name,
          phone: formatPhone(c.waPhone),
          type: c.contactType,
          status,
          company: c.company,
          segment: c.segment,
          email: c.email,
          source,
          owner,
          conversationId: convId,
          leads: Number(a?.n ?? 0),
          won: Number(a?.won ?? 0),
          lost: Number(a?.lost ?? 0),
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
          custom: c.custom,
        };
      }),
    };
  });

  app.patch('/api/contacts/:id', async (req) => {
    const me = requireMenu(req, 'kontak', 'inbox', 'pipeline');
    const id = (req.params as any).id as string;
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    if (!c) throw notFound();
    if (ownOnly(me) && c.ownerId !== me.id) throw forbidden();
    const body = z
      .object({
        name: z.string().trim().nullable().optional(),
        contactType: z.string().optional(),
        email: z.string().email().nullable().optional().or(z.literal('')),
        company: z.string().nullable().optional(),
        segment: z.enum(['Personal', 'Korporat', 'Institusi']).nullable().optional(),
        sourceId: z.string().uuid().nullable().optional(),
        custom: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);
    await db.update(contacts).set({ ...body, email: body.email || null, custom: body.custom ? { ...c.custom, ...body.custom } : undefined }).where(eq(contacts.id, id));
    return { ok: true };
  });

  // Ekspor CSV: Admin dapat nomor telepon; peran lain tanpa nomor telepon.
  app.get('/api/contacts/export.csv', async (req, reply) => {
    const me = requireRole(req, 'admin', 'spv');
    const withPhone = me.role === 'admin';
    const rows = await db
      .select({ c: contacts, owner: users.name, source: leadSources.name })
      .from(contacts)
      .leftJoin(users, eq(users.id, contacts.ownerId))
      .leftJoin(leadSources, eq(leadSources.id, contacts.sourceId))
      .orderBy(asc(contacts.createdAt));
    const out: unknown[][] = [['Nama', ...(withPhone ? ['No. WhatsApp'] : []), 'Tipe', 'Segmen', 'Perusahaan', 'Email', 'Sumber', 'PIC', 'Dibuat']];
    for (const { c, owner, source } of rows) {
      out.push([c.name, ...(withPhone ? [c.waPhone] : []), c.contactType, c.segment, c.company, c.email, source, owner, c.createdAt.toISOString()]);
    }
    await audit(db, me.id, 'contact.export', 'contact', null, { count: rows.length, withPhone });
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="kontak-${wibDateString(new Date())}.csv"`);
    return toCsv(out);
  });

  // Berkas unggahan (bukti DP, proposal) — hanya untuk pengguna yang login.
  app.get('/api/uploads/:name', async (req, reply) => {
    requireUser(req);
    const name = path.basename((req.params as any).name);
    const file = path.join(path.resolve(ctx.config.UPLOAD_DIR), name);
    if (!fs.existsSync(file)) throw notFound();
    const ext = path.extname(name);
    reply.type(ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg');
    return reply.send(fs.createReadStream(file));
  });
}
