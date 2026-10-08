import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { broadcastRecipients, broadcasts, contacts, conversations, leads, leadSources, messages, stages, waTemplates } from '../db/schema.js';
import { badRequest, notFound } from '../lib/http.js';
import { getSetting } from './settings.js';
import { addDays } from '../lib/time.js';

// Broadcast WhatsApp (Fase 3 §3.3). Aturan dari prototype:
// - di luar jendela 24 jam wajib template yang disetujui Meta
// - balasan STOP → kontak tidak dikirimi broadcast lagi
// - maksimal 1 broadcast per kontak per minggu (bisa diatur)
// - balasan otomatis jadi percakapan di Conversation dengan sumber "Broadcast"

export interface Segment {
  contactTypes?: string[];
  segments?: string[]; // Personal | Korporat | Institusi
  leadState?: 'any' | 'open' | 'won' | 'lost' | 'none';
  temperatures?: string[]; // Hot | Warm | Cold (lead terbuka)
  pipelineId?: string | null;
  eventTypeContains?: string | null;
  lastOrderOlderThanDays?: number | null; // pelanggan dorman
  createdWithinDays?: number | null; // kontak baru dalam N hari
  sourceIds?: string[];
  repeatOpportunity?: string | null; // kelompok peluang repeat order dari menu Pelanggan
}

/** Preset dari kartu "Peluang repeat order" di menu Pelanggan; isinya dihitung ulang saat dikirim. */
export const REPEAT_PRESETS: { key: string; label: string; segment: Segment }[] = [
  { key: 'repeat:cycle', label: 'Repeat: siklus tahunan', segment: { repeatOpportunity: 'cycle' } },
  { key: 'repeat:anniversary', label: 'Repeat: anniversary pernikahan', segment: { repeatOpportunity: 'anniversary' } },
  { key: 'repeat:dormant_high', label: 'Repeat: dorman bernilai tinggi', segment: { repeatOpportunity: 'dormant_high' } },
  { key: 'repeat:corporate_quiet', label: 'Repeat: korporat diam > 90 hari', segment: { repeatOpportunity: 'corporate_quiet' } },
];

export interface BroadcastSettings {
  costPerMsg: number;
  frequencyDays: number;
  perTick: number;
}

export const PRESETS: { key: string; label: string; segment: Segment }[] = [
  { key: 'hotwarm_wedding', label: 'Lead Hot & Warm wedding', segment: { leadState: 'open', temperatures: ['Hot', 'Warm'], eventTypeContains: 'wedding' } },
  { key: 'corporate', label: 'Pelanggan korporat', segment: { contactTypes: ['Pelanggan'], segments: ['Korporat', 'Institusi'] } },
  { key: 'graduation90', label: 'Lead wisuda 90 hari', segment: { eventTypeContains: 'wisuda', createdWithinDays: 90 } },
  { key: 'dormant', label: 'Dorman > 6 bulan', segment: { contactTypes: ['Pelanggan'], lastOrderOlderThanDays: 180 } },
  { key: 'lost90', label: 'Lead Lost 90 hari (follow-up ulang)', segment: { leadState: 'lost', createdWithinDays: 90 } },
];

const NON_MARKETING = ['Bukan prospek', 'Supplier', 'Vendor / WO', 'Lainnya'];

/** Kontak yang cocok dengan segmen (belum dikurangi pengecualian). */
async function segmentContactIds(ctx: Ctx, s: Segment): Promise<string[]> {
  const db = ctx.db;
  const conds: SQL[] = [sql`${contacts.contactType} not in (${sql.join(NON_MARKETING.map((x) => sql`${x}`), sql`, `)})`];
  if (s.contactTypes?.length) {
    // "Pelanggan" = tipe kontak Pelanggan atau pernah closing (sama dengan menu Pelanggan).
    const wonLead = sql`exists (select 1 from leads l join stages st on st.id = l.stage_id where l.contact_id = ${contacts.id} and st.kind = 'won')`;
    conds.push(s.contactTypes.includes('Pelanggan') ? or(inArray(contacts.contactType, s.contactTypes), wonLead)! : inArray(contacts.contactType, s.contactTypes));
  }
  if (s.segments?.length) conds.push(inArray(contacts.segment, s.segments as any));
  if (s.sourceIds?.length) conds.push(inArray(contacts.sourceId, s.sourceIds));
  if (s.createdWithinDays) conds.push(gte(contacts.createdAt, addDays(new Date(), -s.createdWithinDays)));
  if (s.repeatOpportunity) {
    const { loadCustomers, repeatOpportunities } = await import('./customers.js');
    const opp = repeatOpportunities(await loadCustomers(ctx)).find((o) => o.key === s.repeatOpportunity);
    const ids = opp?.customers.map((c) => c.id) ?? [];
    if (!ids.length) return [];
    conds.push(inArray(contacts.id, ids));
  }

  // Syarat berbasis lead: kontak harus punya minimal satu lead yang memenuhi semuanya.
  const leadConds: SQL[] = [];
  if (s.leadState && s.leadState !== 'any' && s.leadState !== 'none') leadConds.push(sql`${stages.kind} = ${s.leadState}`);
  if (s.temperatures?.length) leadConds.push(inArray(leads.temperature, s.temperatures as any));
  if (s.pipelineId) leadConds.push(eq(leads.pipelineId, s.pipelineId));
  if (s.eventTypeContains) leadConds.push(sql`${leads.eventType} ilike ${'%' + s.eventTypeContains + '%'}`);
  if (leadConds.length) {
    conds.push(sql`exists (select 1 from ${leads} join ${stages} on ${stages.id} = ${leads.stageId} where ${leads.contactId} = ${contacts.id} and ${and(...leadConds)})`);
  }
  if (s.leadState === 'none') conds.push(sql`not exists (select 1 from ${leads} where ${leads.contactId} = ${contacts.id})`);
  if (s.lastOrderOlderThanDays) {
    const cut = addDays(new Date(), -s.lastOrderOlderThanDays).toISOString();
    conds.push(sql`(select max(l.closed_at) from leads l join stages st on st.id = l.stage_id where l.contact_id = ${contacts.id} and st.kind = 'won') < ${cut}::timestamptz`);
    conds.push(sql`not exists (select 1 from leads l join stages st on st.id = l.stage_id where l.contact_id = ${contacts.id} and st.kind = 'open')`);
  }
  const rows = await db.select({ id: contacts.id }).from(contacts).where(and(...conds));
  return rows.map((r) => r.id);
}

export async function broadcastSettings(ctx: Ctx) {
  return getSetting<BroadcastSettings>(ctx.db, 'broadcast');
}

/** Estimasi penerima: cocok segmen dikurangi opt-out & batas frekuensi. */
export async function estimate(ctx: Ctx, s: Segment) {
  const ids = await segmentContactIds(ctx, s);
  const cfg = await broadcastSettings(ctx);
  if (!ids.length) return { matched: 0, eligible: 0, optOut: 0, recent: 0, cost: 0, costPerMsg: cfg.costPerMsg, sample: [] as string[] };
  const cut = addDays(new Date(), -cfg.frequencyDays);
  const rows = await ctx.db.select({ id: contacts.id, name: contacts.name, optOutAt: contacts.optOutAt, lastBroadcastAt: contacts.lastBroadcastAt }).from(contacts).where(inArray(contacts.id, ids));
  const optOut = rows.filter((r) => r.optOutAt).length;
  const recent = rows.filter((r) => !r.optOutAt && r.lastBroadcastAt && r.lastBroadcastAt > cut).length;
  const ok = rows.filter((r) => !r.optOutAt && !(r.lastBroadcastAt && r.lastBroadcastAt > cut));
  return { matched: rows.length, eligible: ok.length, optOut, recent, cost: ok.length * cfg.costPerMsg, costPerMsg: cfg.costPerMsg, sample: ok.slice(0, 5).map((r) => r.name ?? 'Tanpa nama') };
}

export function segmentLabel(s: Segment, presetLabel?: string) {
  if (presetLabel) return presetLabel;
  const parts: string[] = [];
  if (s.contactTypes?.length) parts.push(s.contactTypes.join('/'));
  if (s.segments?.length) parts.push(s.segments.join('/'));
  if (s.temperatures?.length) parts.push(`lead ${s.temperatures.join('/')}`);
  else if (s.leadState && s.leadState !== 'any') parts.push({ open: 'lead aktif', won: 'pernah closing', lost: 'lead Lost', none: 'tanpa lead' }[s.leadState]);
  if (s.eventTypeContains) parts.push(`acara "${s.eventTypeContains}"`);
  if (s.lastOrderOlderThanDays) parts.push(`tidak order > ${s.lastOrderOlderThanDays} hari`);
  if (s.createdWithinDays) parts.push(`kontak ${s.createdWithinDays} hari terakhir`);
  if (s.repeatOpportunity) parts.push(REPEAT_PRESETS.find((p) => p.segment.repeatOpportunity === s.repeatOpportunity)?.label ?? 'peluang repeat order');
  return parts.join(' · ') || 'Semua kontak';
}

/** Isi parameter template: {nama} → nama depan kontak. */
export function fillParams(params: string[], c: { name: string | null }) {
  const first = (c.name ?? '').trim().split(/\s+/)[0] || 'Kak';
  return params.map((p) => p.replace(/\{nama\}/gi, first));
}

export function renderTemplate(body: string, params: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}

export async function sendableTemplate(ctx: Ctx, name: string, language: string) {
  const [t] = await ctx.db.select().from(waTemplates).where(and(eq(waTemplates.name, name), eq(waTemplates.language, language)));
  if (!t) throw badRequest('Template tidak ditemukan');
  // Mode simulasi boleh memakai template lokal untuk uji coba; mode Meta wajib yang sudah disetujui.
  if (ctx.wa.mode === 'meta' && t.status !== 'APPROVED') throw badRequest(`Template "${name}" belum disetujui Meta (status ${t.status})`);
  return t;
}

export interface CreateInput {
  name: string;
  segment: Segment;
  presetLabel?: string;
  templateName: string;
  templateLanguage: string;
  params: string[];
  scheduledAt: Date;
}

export async function createBroadcast(ctx: Ctx, input: CreateInput, userId: string) {
  await sendableTemplate(ctx, input.templateName, input.templateLanguage);
  const cfg = await broadcastSettings(ctx);
  const est = await estimate(ctx, input.segment);
  if (!est.eligible) throw badRequest('Tidak ada penerima yang memenuhi syarat untuk segmen ini');
  const [b] = await ctx.db
    .insert(broadcasts)
    .values({
      name: input.name,
      segment: input.segment as Record<string, unknown>,
      segmentLabel: segmentLabel(input.segment, input.presetLabel),
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
      params: input.params,
      scheduledAt: input.scheduledAt,
      costPerMsg: cfg.costPerMsg,
      createdBy: userId,
    })
    .returning();
  return b!;
}

export async function cancelBroadcast(ctx: Ctx, id: string) {
  const [b] = await ctx.db.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!b) throw notFound();
  if (b.status !== 'scheduled') throw badRequest('Hanya broadcast yang belum terkirim yang bisa dibatalkan');
  await ctx.db.update(broadcasts).set({ status: 'cancelled' }).where(eq(broadcasts.id, id));
}

async function ensureConversation(ctx: Ctx, c: typeof contacts.$inferSelect) {
  const [conv] = await ctx.db.select().from(conversations).where(and(eq(conversations.contactId, c.id), eq(conversations.channel, 'whatsapp')));
  if (conv) return conv;
  const ai = await getSetting<{ enabled: boolean }>(ctx.db, 'ai');
  const [n] = await ctx.db.insert(conversations).values({ contactId: c.id, assigneeId: c.ownerId, aiActive: ai.enabled }).returning();
  return n!;
}

/** Mulai broadcast yang sudah jatuh tempo: ambil potret penerima, lalu kirim bertahap. */
async function start(ctx: Ctx, b: typeof broadcasts.$inferSelect) {
  const ids = await segmentContactIds(ctx, b.segment as Segment);
  const cfg = await broadcastSettings(ctx);
  const cut = addDays(new Date(), -cfg.frequencyDays);
  const rows = ids.length ? await ctx.db.select({ id: contacts.id, optOutAt: contacts.optOutAt, lastBroadcastAt: contacts.lastBroadcastAt }).from(contacts).where(inArray(contacts.id, ids)) : [];
  const values = rows.map((r) => ({
    broadcastId: b.id,
    contactId: r.id,
    status: (r.optOutAt || (r.lastBroadcastAt && r.lastBroadcastAt > cut) ? 'skipped' : 'queued') as 'skipped' | 'queued',
    skipReason: r.optOutAt ? 'Berhenti berlangganan (STOP)' : r.lastBroadcastAt && r.lastBroadcastAt > cut ? `Sudah menerima broadcast < ${cfg.frequencyDays} hari` : null,
  }));
  for (let k = 0; k < values.length; k += 500) await ctx.db.insert(broadcastRecipients).values(values.slice(k, k + 500)).onConflictDoNothing();
  await ctx.db.update(broadcasts).set({ status: 'sending', startedAt: new Date() }).where(eq(broadcasts.id, b.id));
}

async function sendBatch(ctx: Ctx, b: typeof broadcasts.$inferSelect, limit: number) {
  const tpl = await sendableTemplate(ctx, b.templateName, b.templateLanguage).catch(() => null);
  const queue = await ctx.db
    .select({ r: broadcastRecipients, c: contacts })
    .from(broadcastRecipients)
    .innerJoin(contacts, eq(contacts.id, broadcastRecipients.contactId))
    .where(and(eq(broadcastRecipients.broadcastId, b.id), eq(broadcastRecipients.status, 'queued')))
    .limit(limit);
  for (const { r, c } of queue) {
    if (!tpl) {
      await ctx.db.update(broadcastRecipients).set({ status: 'failed', error: 'Template tidak lagi tersedia / belum disetujui' }).where(eq(broadcastRecipients.id, r.id));
      continue;
    }
    // Cek ulang saat kirim: kontak bisa saja baru membalas STOP.
    if (c.optOutAt) {
      await ctx.db.update(broadcastRecipients).set({ status: 'skipped', skipReason: 'Berhenti berlangganan (STOP)' }).where(eq(broadcastRecipients.id, r.id));
      continue;
    }
    const params = fillParams(b.params, c);
    const body = renderTemplate(tpl.body, params);
    const conv = await ensureConversation(ctx, c);
    const [msg] = await ctx.db
      .insert(messages)
      .values({ conversationId: conv.id, direction: 'out', senderType: 'system', kind: 'template', body, templateName: tpl.name, status: 'queued', meta: { broadcastId: b.id } })
      .returning();
    try {
      const res = await ctx.wa.sendTemplate(c.waPhone, tpl.name, tpl.language, params);
      const now = new Date();
      await ctx.db.update(messages).set({ status: 'sent', waMessageId: res.waMessageId }).where(eq(messages.id, msg!.id));
      await ctx.db.update(broadcastRecipients).set({ status: 'sent', waMessageId: res.waMessageId, sentAt: now }).where(eq(broadcastRecipients.id, r.id));
      await ctx.db.update(contacts).set({ lastBroadcastAt: now }).where(eq(contacts.id, c.id));
      await ctx.db.update(conversations).set({ lastMessageAt: now, lastMessagePreview: `📣 ${b.name}`.slice(0, 140) }).where(eq(conversations.id, conv.id));
    } catch (e) {
      const err = (e as Error).message.slice(0, 300);
      await ctx.db.update(messages).set({ status: 'failed', error: err }).where(eq(messages.id, msg!.id));
      await ctx.db.update(broadcastRecipients).set({ status: 'failed', error: err }).where(eq(broadcastRecipients.id, r.id));
    }
  }
  const [left] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(broadcastRecipients).where(and(eq(broadcastRecipients.broadcastId, b.id), eq(broadcastRecipients.status, 'queued')));
  if (!left?.n) {
    const [sent] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(broadcastRecipients).where(and(eq(broadcastRecipients.broadcastId, b.id), inArray(broadcastRecipients.status, ['sent', 'delivered', 'read'])));
    await ctx.db.update(broadcasts).set({ status: sent?.n ? 'done' : 'failed', finishedAt: new Date() }).where(eq(broadcasts.id, b.id));
  }
  return queue.length;
}

/** Dipanggil worker tiap menit. */
export async function runBroadcasts(ctx: Ctx, now = new Date()) {
  const cfg = await broadcastSettings(ctx);
  const due = await ctx.db.select().from(broadcasts).where(and(eq(broadcasts.status, 'scheduled'), lt(broadcasts.scheduledAt, now)));
  for (const b of due) await start(ctx, b);
  const sending = await ctx.db.select().from(broadcasts).where(eq(broadcasts.status, 'sending'));
  let sent = 0;
  for (const b of sending) sent += await sendBatch(ctx, b, cfg.perTick);
  return sent;
}

const RANK = ['queued', 'sent', 'delivered', 'read'];
/** Status kiriman dari webhook WhatsApp (terkirim / dibaca / gagal). */
export async function onStatus(ctx: Ctx, waMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', error?: string) {
  const [r] = await ctx.db.select().from(broadcastRecipients).where(eq(broadcastRecipients.waMessageId, waMessageId));
  if (!r) return;
  if (status === 'failed') await ctx.db.update(broadcastRecipients).set({ status: 'failed', error: error ?? 'Gagal terkirim' }).where(eq(broadcastRecipients.id, r.id));
  else if (RANK.indexOf(status) > RANK.indexOf(r.status)) await ctx.db.update(broadcastRecipients).set({ status }).where(eq(broadcastRecipients.id, r.id));
}

const STOP_RE = /^\s*(stop|berhenti|unsubscribe|jangan kirim lagi)\s*[.!]*\s*$/i;
export const isStop = (text: string) => STOP_RE.test(text);

/** Broadcast terakhir yang diterima kontak dalam 7 hari dan belum dibalas. */
export async function recentRecipient(ctx: Ctx, contactId: string) {
  const [r] = await ctx.db
    .select({ r: broadcastRecipients, name: broadcasts.name })
    .from(broadcastRecipients)
    .innerJoin(broadcasts, eq(broadcasts.id, broadcastRecipients.broadcastId))
    .where(and(eq(broadcastRecipients.contactId, contactId), isNull(broadcastRecipients.repliedAt), gte(broadcastRecipients.sentAt, addDays(new Date(), -7))))
    .orderBy(desc(broadcastRecipients.sentAt))
    .limit(1);
  return r ?? null;
}

export async function markReplied(ctx: Ctx, recipientId: string, text: string, leadId: string | null) {
  await ctx.db.update(broadcastRecipients).set({ repliedAt: new Date(), replyText: text.slice(0, 300), status: 'read', leadId }).where(eq(broadcastRecipients.id, recipientId));
}

export async function broadcastSourceId(ctx: Ctx) {
  const [s] = await ctx.db.select({ id: leadSources.id }).from(leadSources).where(eq(leadSources.refCode, 'BC'));
  return s?.id ?? null;
}

// ---------------------------------------------------------------- Angka untuk daftar & detail

export async function stats(ctx: Ctx, ids: string[]) {
  if (!ids.length) return new Map<string, { total: number; sent: number; read: number; replied: number; failed: number; skipped: number; leads: number; closings: number }>();
  const rows = await ctx.db
    .select({
      id: broadcastRecipients.broadcastId,
      total: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) filter (where ${broadcastRecipients.status} in ('sent','delivered','read'))::int`,
      read: sql<number>`count(*) filter (where ${broadcastRecipients.status} = 'read')::int`,
      replied: sql<number>`count(*) filter (where ${broadcastRecipients.repliedAt} is not null)::int`,
      failed: sql<number>`count(*) filter (where ${broadcastRecipients.status} = 'failed')::int`,
      skipped: sql<number>`count(*) filter (where ${broadcastRecipients.status} = 'skipped')::int`,
      leads: sql<number>`count(${broadcastRecipients.leadId})::int`,
      closings: sql<number>`count(*) filter (where exists (select 1 from leads l join stages st on st.id = l.stage_id where l.id = ${broadcastRecipients.leadId} and st.kind = 'won'))::int`,
    })
    .from(broadcastRecipients)
    .where(inArray(broadcastRecipients.broadcastId, ids))
    .groupBy(broadcastRecipients.broadcastId);
  return new Map(rows.map((r) => [r.id, r]));
}

export async function listBroadcasts(ctx: Ctx, from?: Date, to?: Date) {
  const conds: SQL[] = [];
  if (from) conds.push(gte(broadcasts.scheduledAt, from));
  if (to) conds.push(lt(broadcasts.scheduledAt, to));
  const rows = await ctx.db.select().from(broadcasts).where(conds.length ? and(...conds) : undefined).orderBy(desc(broadcasts.scheduledAt)).limit(300);
  const st = await stats(ctx, rows.map((r) => r.id));
  return rows.map((b) => ({ ...b, stats: st.get(b.id) ?? { total: 0, sent: 0, read: 0, replied: 0, failed: 0, skipped: 0, leads: 0, closings: 0 } }));
}

