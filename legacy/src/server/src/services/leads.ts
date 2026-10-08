import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { activities, contacts, leadSources, leadStageHistory, leads, pipelines, proposals, stages } from '../db/schema.js';
import { badRequest, notFound } from '../lib/http.js';
import { computeScore, type ScoreRules } from './scoring.js';
import { getSetting } from './settings.js';
import { STAGE_REQUIREMENTS } from './defaults.js';

export type Lead = typeof leads.$inferSelect;

export const leadCode = (code: number) => `L-${String(code).padStart(4, '0')}`;

export async function recordActivity(ctx: Ctx, leadId: string, type: string, title: string, note?: string | null, userId?: string | null) {
  await ctx.db.insert(activities).values({ leadId, type, title, note: note ?? null, userId: userId ?? null });
  await ctx.db.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, leadId));
}

/** Pipeline yang cocok dengan jenis acara; bila tidak ada yang cocok → pipeline pertama. */
export async function pipelineForEvent(ctx: Ctx, eventType?: string | null) {
  const all = await ctx.db.select().from(pipelines).where(eq(pipelines.active, true)).orderBy(asc(pipelines.sortOrder));
  if (!all.length) throw new Error('Belum ada pipeline. Jalankan seed atau buat di Pengaturan › Pipeline.');
  const et = (eventType ?? '').toLowerCase();
  if (et) {
    const hit = all.find((p) => p.eventTypes.some((k) => et.includes(k.toLowerCase())));
    if (hit) return hit;
  }
  return all[0]!;
}

export async function firstStage(ctx: Ctx, pipelineId: string) {
  const [s] = await ctx.db
    .select()
    .from(stages)
    .where(and(eq(stages.pipelineId, pipelineId), eq(stages.kind, 'open')))
    .orderBy(asc(stages.sortOrder))
    .limit(1);
  if (!s) throw new Error('Pipeline belum punya tahap');
  return s;
}

/** Lead yang masih terbuka (belum won/lost) untuk sebuah kontak. */
export async function openLeadForContact(ctx: Ctx, contactId: string): Promise<Lead | null> {
  const [row] = await ctx.db
    .select({ l: leads })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(leads.contactId, contactId), eq(stages.kind, 'open')))
    .orderBy(asc(leads.createdAt))
    .limit(1);
  return row?.l ?? null;
}

export async function createLead(
  ctx: Ctx,
  input: {
    contactId: string;
    ownerId: string | null;
    sourceId?: string | null;
    origin: 'auto' | 'manual';
    originNote?: string;
    eventType?: string | null;
    pipelineId?: string;
    userId?: string | null;
  },
): Promise<Lead> {
  const pipeline = input.pipelineId
    ? (await ctx.db.select().from(pipelines).where(eq(pipelines.id, input.pipelineId)))[0]
    : await pipelineForEvent(ctx, input.eventType);
  if (!pipeline) throw notFound('Pipeline tidak ditemukan');
  const stage = await firstStage(ctx, pipeline.id);
  const [lead] = await ctx.db
    .insert(leads)
    .values({
      contactId: input.contactId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      ownerId: input.ownerId,
      sourceId: input.sourceId ?? null,
      origin: input.origin,
      originNote: input.originNote ?? null,
      eventType: input.eventType ?? null,
    })
    .returning();
  await ctx.db.insert(leadStageHistory).values({ leadId: lead!.id, stageId: stage.id, userId: input.userId ?? null });
  await recordActivity(ctx, lead!.id, 'lead_created', input.origin === 'auto' ? 'Lead dibuat otomatis' : 'Lead ditandai manual', input.originNote, input.userId);
  ctx.events.emit({ type: 'lead', leadId: lead!.id, ownerId: lead!.ownerId });
  return lead!;
}

export interface Qualification {
  customerName?: string | null;
  expectedDpMonth?: string | null; // YYYY-MM-01
  eventType?: string | null;
  eventDate?: string | null;
  eventDateText?: string | null;
  location?: string | null;
  pax?: number | null;
  budget?: number | null;
  estimatedValue?: number | null;
  dealValue?: number | null;
  custom?: Record<string, unknown>;
}

const QUAL_KEYS = ['customerName', 'expectedDpMonth', 'eventType', 'eventDate', 'eventDateText', 'location', 'pax', 'budget', 'estimatedValue', 'dealValue'] as const;

/**
 * Isi data kualifikasi + hitung ulang skor.
 * source='ai' hanya mengisi field kosong atau yang sebelumnya juga diisi AI (tidak menimpa isian sales).
 */
export async function applyQualification(ctx: Ctx, leadId: string, q: Qualification, source: 'ai' | 'user', userId?: string | null) {
  const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw notFound('Lead tidak ditemukan');
  const patch: Partial<Lead> = {};
  const aiFilled = new Set(lead.aiFilled);
  for (const k of QUAL_KEYS) {
    const v = q[k];
    if (v === undefined) continue;
    if (source === 'ai') {
      if (v === null || v === '') continue;
      const current = lead[k];
      if (current !== null && current !== undefined && current !== '' && !aiFilled.has(k)) continue;
      (patch as any)[k] = v;
      aiFilled.add(k);
    } else {
      (patch as any)[k] = v === '' ? null : v;
      aiFilled.delete(k);
    }
  }
  if (q.custom) patch.custom = { ...lead.custom, ...q.custom };
  const merged = { ...lead, ...patch };
  if (!merged.estimatedValue && merged.budget) patch.estimatedValue = merged.budget;

  const rules = await getSetting<ScoreRules>(ctx.db, 'score_rules');
  const sc = computeScore({ ...merged, estimatedValue: patch.estimatedValue ?? merged.estimatedValue }, rules);

  // Lead yang masih di tahap pertama pindah ke pipeline yang sesuai jenis acaranya.
  if (patch.eventType && lead.origin === 'auto') {
    const [st] = await ctx.db.select().from(stages).where(eq(stages.id, lead.stageId));
    const p = await pipelineForEvent(ctx, patch.eventType);
    if (st && p.id !== lead.pipelineId) {
      const first = await firstStage(ctx, lead.pipelineId);
      if (first.id === st.id) {
        const target = await firstStage(ctx, p.id);
        patch.pipelineId = p.id;
        patch.stageId = target.id;
      }
    }
  }

  await ctx.db
    .update(leads)
    .set({
      ...patch,
      aiFilled: [...aiFilled],
      score: sc.score,
      scoreBreakdown: sc.breakdown,
      temperature: sc.temperature,
      potensi: sc.potensi,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));
  if (source === 'user' && Object.keys(patch).length) {
    await recordActivity(ctx, leadId, 'qualification', 'Data kualifikasi diubah', Object.keys(patch).join(', '), userId);
  }
  ctx.events.emit({ type: 'lead', leadId, ownerId: lead.ownerId });
  return { ...sc };
}

export interface StageMoveInput {
  stageId: string;
  lostKind?: 'Lost' | 'Abandoned';
  lostReason?: string;
  lostNote?: string;
  dpAmount?: number;
  dpDate?: string;
  dpProofPath?: string;
  dealValue?: number;
}

/** Cek syarat wajib tahap tujuan. Mengembalikan daftar pesan yang belum terpenuhi. */
export async function missingRequirements(ctx: Ctx, lead: Lead, target: typeof stages.$inferSelect, input: StageMoveInput): Promise<string[]> {
  const missing: string[] = [];
  for (const r of target.requirements) {
    if (r === 'lost_reason' && (!input.lostKind || !input.lostReason?.trim())) missing.push(STAGE_REQUIREMENTS.lost_reason!);
    if (r === 'dp_proof' && !(input.dpProofPath ?? lead.dpProofPath)) missing.push(STAGE_REQUIREMENTS.dp_proof!);
    if (r === 'dp_proof' && !(input.dpAmount ?? lead.dpAmount)) missing.push('Nilai DP wajib diisi');
    if (r === 'source_known') {
      let known = !!lead.sourceId;
      if (known) {
        const [src] = await ctx.db.select().from(leadSources).where(eq(leadSources.id, lead.sourceId!));
        known = !!src && src.name !== 'Tidak diketahui';
      }
      if (!known) missing.push(STAGE_REQUIREMENTS.source_known!);
    }
    if (r === 'proposal_sent') {
      const sent = await ctx.db.select({ id: proposals.id }).from(proposals).where(and(eq(proposals.leadId, lead.id), eq(proposals.status, 'sent'))).limit(1);
      if (!sent.length) missing.push(STAGE_REQUIREMENTS.proposal_sent!);
    }
  }
  return missing;
}

export async function moveStage(ctx: Ctx, leadId: string, input: StageMoveInput, userId: string | null, opts: { skipRequirements?: string[] } = {}) {
  const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw notFound('Lead tidak ditemukan');
  const [target] = await ctx.db.select().from(stages).where(eq(stages.id, input.stageId));
  if (!target) throw notFound('Tahap tidak ditemukan');
  if (target.id === lead.stageId) return lead;

  const skip = new Set(opts.skipRequirements ?? []);
  const effective = { ...target, requirements: target.requirements.filter((r) => !skip.has(r)) };
  const missing = await missingRequirements(ctx, lead, effective, input);
  if (missing.length) throw badRequest(`Belum bisa pindah ke "${target.name}": ${missing.join('; ')}`, { missing });

  const patch: Partial<Lead> = { stageId: target.id, pipelineId: target.pipelineId, stageChangedAt: new Date(), updatedAt: new Date() };
  if (target.kind === 'lost') {
    Object.assign(patch, { lostKind: input.lostKind, lostReason: input.lostReason, lostNote: input.lostNote ?? null, closedAt: new Date() });
  } else {
    Object.assign(patch, { lostKind: null, lostReason: null, lostNote: null });
  }
  if (target.kind === 'won') {
    if (input.dpAmount !== undefined) patch.dpAmount = input.dpAmount;
    if (input.dpDate !== undefined) patch.dpDate = input.dpDate;
    if (input.dpProofPath !== undefined) patch.dpProofPath = input.dpProofPath;
    if (input.dealValue !== undefined) patch.dealValue = input.dealValue;
    if (!lead.closedAt) patch.closedAt = new Date();
  }
  if (target.kind === 'open') patch.closedAt = null;

  await ctx.db.update(leads).set(patch).where(eq(leads.id, leadId));
  await ctx.db.insert(leadStageHistory).values({ leadId, stageId: target.id, userId });
  const note =
    target.kind === 'lost'
      ? `${input.lostKind}: ${input.lostReason}${input.lostNote ? ` — ${input.lostNote}` : ''}`
      : target.kind === 'won' && patch.dpAmount
        ? `DP Rp ${Number(patch.dpAmount).toLocaleString('id-ID')}`
        : null;
  await recordActivity(ctx, leadId, 'stage_change', `Pindah ke tahap ${target.name}`, note, userId);

  // Kontak yang sudah DP jadi Pelanggan.
  if (target.kind === 'won') await ctx.db.update(contacts).set({ contactType: 'Pelanggan' }).where(eq(contacts.id, lead.contactId));
  ctx.events.emit({ type: 'lead', leadId, ownerId: lead.ownerId });
  return { ...lead, ...patch };
}

export async function stagesByPipeline(ctx: Ctx, pipelineIds: string[]) {
  if (!pipelineIds.length) return [];
  return ctx.db.select().from(stages).where(inArray(stages.pipelineId, pipelineIds)).orderBy(asc(stages.sortOrder));
}
