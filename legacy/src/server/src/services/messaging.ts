import { and, desc, eq, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, conversations, leadSources, leads, messages, users } from '../db/schema.js';
import { normalizePhone } from '../lib/phone.js';
import { badRequest, notFound } from '../lib/http.js';
import type { InboundMessage, StatusUpdate } from '../whatsapp/provider.js';
import { pickAssignee } from './distribution.js';
import { createLead, leadCode, openLeadForContact, recordActivity } from './leads.js';
import { notify, usersWithRole } from './notify.js';
import { enqueue } from './jobs.js';
import { getSetting } from './settings.js';

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

const WINDOW_MS = 24 * 60 * 60 * 1000;
import { broadcastSourceId, isStop, markReplied, onStatus as broadcastStatus, recentRecipient } from './broadcasts.js';

const NON_LEAD_TYPES = ['Bukan prospek', 'Supplier', 'Vendor / WO', 'Lainnya'];

export function windowOpen(conv: Pick<Conversation, 'lastInboundAt'>, now = new Date()): boolean {
  return !!conv.lastInboundAt && now.getTime() - conv.lastInboundAt.getTime() < WINDOW_MS;
}

export function windowRemainingMs(conv: Pick<Conversation, 'lastInboundAt'>, now = new Date()): number {
  if (!conv.lastInboundAt) return 0;
  return Math.max(0, WINDOW_MS - (now.getTime() - conv.lastInboundAt.getTime()));
}

/** Sumber lead dari pesan pertama: kode penanda (mis. "IGADS-wisuda") atau data iklan click-to-WhatsApp. */
export async function detectSource(ctx: Ctx, text: string, referral?: InboundMessage['referral']) {
  const all = await ctx.db.select().from(leadSources).where(eq(leadSources.active, true));
  if (referral?.sourceId || referral?.ctwaClid) {
    const ads = all.find((s) => s.refCode === 'IGADS');
    if (ads) return { source: ads, note: `Iklan click-to-WhatsApp${referral.headline ? ` · ${referral.headline}` : ''}` };
  }
  const upper = text.toUpperCase();
  for (const s of all) {
    if (!s.refCode) continue;
    const re = new RegExp(`(^|[^A-Z0-9])${s.refCode}([-_ ]([A-Z0-9-]+))?`, 'i');
    const m = upper.match(re);
    if (m) return { source: s, note: `Penanda ${s.refCode}${m[3] ? `-${m[3].toLowerCase()}` : ''} di pesan pertama` };
  }
  const unknown = all.find((s) => s.name === 'Tidak diketahui');
  return { source: unknown ?? null, note: 'Tanpa penanda sumber' };
}

async function systemMessage(ctx: Ctx, conversationId: string, body: string) {
  await ctx.db.insert(messages).values({ conversationId, direction: 'system', senderType: 'system', kind: 'system', body, status: 'sent' });
}

export async function handleInbound(ctx: Ctx, m: InboundMessage) {
  const phone = normalizePhone(m.from);
  if (!phone) return null;

  // Duplikat (Meta bisa mengirim ulang webhook yang sama)
  const [dupe] = await ctx.db.select({ id: messages.id }).from(messages).where(eq(messages.waMessageId, m.waMessageId));
  if (dupe) return null;

  let [contact] = await ctx.db.select().from(contacts).where(eq(contacts.waPhone, phone));
  let isNewContact = false;
  let sourceNote: string | undefined;
  if (!contact) {
    const det = await detectSource(ctx, m.text, m.referral);
    sourceNote = det.note;
    [contact] = await ctx.db
      .insert(contacts)
      .values({ waPhone: phone, name: m.profileName ?? null, sourceId: det.source?.id ?? null, firstMessageAt: m.timestamp, adRefId: m.referral?.sourceId ?? null })
      .returning();
    isNewContact = true;
  } else if (!contact.name && m.profileName) {
    await ctx.db.update(contacts).set({ name: m.profileName }).where(eq(contacts.id, contact.id));
  }
  await ctx.db.update(contacts).set({ lastMessageAt: m.timestamp }).where(eq(contacts.id, contact!.id));

  let [conv] = await ctx.db.select().from(conversations).where(and(eq(conversations.contactId, contact!.id), eq(conversations.channel, 'whatsapp')));
  const ai = await getSetting<{ enabled: boolean }>(ctx.db, 'ai');
  if (!conv) {
    // Assignee ditetapkan saat pesan pertama masuk, walaupun AI yang membalas lebih dulu.
    const assigneeId = contact!.ownerId ?? (await pickAssignee(ctx, { hint: m.text }));
    [conv] = await ctx.db
      .insert(conversations)
      .values({ contactId: contact!.id, assigneeId, aiActive: ai.enabled })
      .returning();
    if (assigneeId && !contact!.ownerId) await ctx.db.update(contacts).set({ ownerId: assigneeId }).where(eq(contacts.id, contact!.id));
  }

  const [msg] = await ctx.db
    .insert(messages)
    .values({
      conversationId: conv!.id,
      direction: 'in',
      senderType: 'customer',
      kind: m.kind === 'other' ? 'text' : m.kind,
      body: m.text,
      waMessageId: m.waMessageId,
      status: 'received',
      meta: m.referral ? { referral: m.referral } : null,
      createdAt: m.timestamp,
    })
    .onConflictDoNothing()
    .returning();
  if (!msg) return null;

  await ctx.db
    .update(conversations)
    .set({
      lastInboundAt: m.timestamp,
      lastMessageAt: m.timestamp,
      lastMessagePreview: m.text.slice(0, 140),
      unreadCount: sql`${conversations.unreadCount} + 1`,
      awaitingReplySince: sql`coalesce(${conversations.awaitingReplySince}, ${m.timestamp.toISOString()}::timestamptz)`,
    })
    .where(eq(conversations.id, conv!.id));

  // Balasan broadcast: STOP → berhenti berlangganan; balasan lain → dicatat & jadi sumber "Broadcast".
  const bc = isNewContact ? null : await recentRecipient(ctx, contact!.id);
  if (isStop(m.text)) {
    await ctx.db.update(contacts).set({ optOutAt: m.timestamp }).where(eq(contacts.id, contact!.id));
    await systemMessage(ctx, conv!.id, 'Kontak membalas STOP — tidak akan dikirimi broadcast lagi.');
    // Bukan pertanyaan → tidak perlu dibalas, jangan memicu SLA.
    await ctx.db.update(conversations).set({ awaitingReplySince: null }).where(eq(conversations.id, conv!.id));
    if (bc) await markReplied(ctx, bc.r.id, m.text, null);
    ctx.events.emit({ type: 'message', conversationId: conv!.id, ownerId: conv!.assigneeId });
    return { conversation: conv!, message: msg, contact: contact!, lead: null };
  }

  // Lead otomatis: chat dari calon pembeli tanpa lead terbuka → lead baru (termasuk repeat order pelanggan).
  let lead = await openLeadForContact(ctx, contact!.id);
  if (!lead && !NON_LEAD_TYPES.includes(contact!.contactType)) {
    const repeat = !isNewContact && contact!.contactType === 'Pelanggan';
    lead = await createLead(ctx, {
      contactId: contact!.id,
      ownerId: conv!.assigneeId,
      sourceId: bc ? ((await broadcastSourceId(ctx)) ?? contact!.sourceId) : contact!.sourceId,
      origin: 'auto',
      originNote: bc ? `Balasan broadcast "${bc.name}"` : repeat ? 'Pelanggan lama chat lagi (repeat order)' : `Chat WA pertama dari nomor baru · ${sourceNote ?? 'nomor lama'}`,
    });
    await notify(ctx, [conv!.assigneeId], 'lead', `Lead baru ${leadCode(lead.code)} — ${contact!.name ?? phone}`, `/inbox/${conv!.id}`);
    if (bc) await markReplied(ctx, bc.r.id, m.text, lead.id);
  } else if (bc) {
    await markReplied(ctx, bc.r.id, m.text, lead?.id ?? null);
  }

  ctx.events.emit({ type: 'message', conversationId: conv!.id, ownerId: conv!.assigneeId });

  const [fresh] = await ctx.db.select().from(conversations).where(eq(conversations.id, conv!.id));
  if (fresh!.aiActive) {
    // Jeda singkat supaya pesan beruntun dari customer dibalas sekaligus.
    await enqueue(ctx, 'ai_reply', { conversationId: conv!.id, messageId: msg.id }, { delayMs: 4000 });
  }
  return { conversation: fresh!, message: msg, contact: contact!, lead };
}

const STATUS_ORDER = ['queued', 'sent', 'delivered', 'read'];

export async function handleStatus(ctx: Ctx, s: StatusUpdate) {
  await broadcastStatus(ctx, s.waMessageId, s.status, s.error);
  const [msg] = await ctx.db.select().from(messages).where(eq(messages.waMessageId, s.waMessageId));
  if (!msg) return;
  if (s.status === 'failed') {
    await ctx.db.update(messages).set({ status: 'failed', error: s.error ?? 'Gagal terkirim' }).where(eq(messages.id, msg.id));
  } else if (STATUS_ORDER.indexOf(s.status) > STATUS_ORDER.indexOf(msg.status)) {
    await ctx.db.update(messages).set({ status: s.status }).where(eq(messages.id, msg.id));
  }
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, msg.conversationId));
  ctx.events.emit({ type: 'message', conversationId: msg.conversationId, ownerId: conv?.assigneeId ?? null });
}

export interface OutboundInput {
  conversationId: string;
  sender: { type: 'user'; userId: string } | { type: 'ai' };
  kind: 'text' | 'template' | 'document';
  body: string;
  template?: { name: string; language: string; params: string[] };
  document?: { buffer: Buffer; filename: string; mime: string; path: string };
}

export async function sendOutbound(ctx: Ctx, input: OutboundInput): Promise<Message> {
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, input.conversationId));
  if (!conv) throw notFound('Percakapan tidak ditemukan');
  const [contact] = await ctx.db.select().from(contacts).where(eq(contacts.id, conv.contactId));
  if (input.kind !== 'template' && !windowOpen(conv)) {
    throw badRequest('Jendela 24 jam sudah tutup. Balasan harus memakai template resmi WhatsApp.');
  }
  const userId = input.sender.type === 'user' ? input.sender.userId : null;
  const [msg] = await ctx.db
    .insert(messages)
    .values({
      conversationId: conv.id,
      direction: 'out',
      senderType: input.sender.type,
      userId,
      kind: input.kind,
      body: input.body,
      templateName: input.template?.name ?? null,
      mediaPath: input.document?.path ?? null,
      mediaName: input.document?.filename ?? null,
      status: 'queued',
    })
    .returning();

  let status: Message['status'] = 'sent';
  let waMessageId: string | null = null;
  let error: string | null = null;
  try {
    const to = contact!.waPhone;
    const r =
      input.kind === 'template'
        ? await ctx.wa.sendTemplate(to, input.template!.name, input.template!.language, input.template!.params)
        : input.kind === 'document'
          ? await ctx.wa.sendDocument(to, { ...input.document!, caption: input.body || undefined })
          : await ctx.wa.sendText(to, input.body);
    waMessageId = r.waMessageId;
  } catch (e) {
    status = 'failed';
    error = (e as Error).message.slice(0, 500);
  }
  const [updated] = await ctx.db.update(messages).set({ status, waMessageId, error }).where(eq(messages.id, msg!.id)).returning();

  if (status !== 'failed') {
    const now = new Date();
    await ctx.db
      .update(conversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: (input.kind === 'document' ? `📄 ${input.document?.filename}` : input.body).slice(0, 140),
        // Pesan dari manusia atau AI = customer sudah dibalas.
        awaitingReplySince: null,
        slaLevel: 0,
        ...(input.sender.type === 'user' ? { unreadCount: 0 } : {}),
        // Sales membalas sendiri saat AI masih aktif → AI berhenti.
        ...(input.sender.type === 'user' && conv.aiActive ? { aiActive: false, handoffAt: now, handoffReason: 'Sales mengambil alih percakapan', handoffClaimedAt: now } : {}),
        ...(input.sender.type === 'user' && conv.handoffAt && !conv.handoffClaimedAt ? { handoffClaimedAt: now } : {}),
      })
      .where(eq(conversations.id, conv.id));
    if (input.sender.type === 'user') {
      const lead = await openLeadForContact(ctx, conv.contactId);
      if (lead) await recordActivity(ctx, lead.id, 'message_out', input.kind === 'template' ? `Template "${input.template?.name}" terkirim` : 'Follow-up terkirim di chat', input.body.slice(0, 160), userId);
    }
  }
  ctx.events.emit({ type: 'message', conversationId: conv.id, ownerId: conv.assigneeId });
  if (status === 'failed') throw badRequest(`Pesan gagal terkirim: ${error}`);
  return updated!;
}

/** Ringkasan serah terima (script): data kualifikasi + 3 chat terakhir customer. */
export async function buildHandoffSummary(ctx: Ctx, conversationId: string): Promise<string> {
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, conversationId));
  const lead = conv ? await openLeadForContact(ctx, conv.contactId) : null;
  const parts: string[] = [];
  if (lead) {
    const f = [
      lead.eventType && `Acara: ${lead.eventType}`,
      (lead.eventDate || lead.eventDateText) && `Tanggal: ${lead.eventDateText ?? lead.eventDate}`,
      lead.location && `Lokasi: ${lead.location}`,
      lead.pax && `Pax: ${lead.pax}`,
      lead.budget && `Budget: Rp ${lead.budget.toLocaleString('id-ID')}`,
    ].filter(Boolean);
    parts.push(f.length ? f.join(' · ') : 'Data kualifikasi belum lengkap');
    parts.push(`Skor ${lead.score} (${lead.temperature})`);
  }
  const last = await ctx.db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'in')))
    .orderBy(desc(messages.createdAt))
    .limit(3);
  if (last.length) parts.push('Chat terakhir: ' + last.reverse().map((x) => `"${x.body.slice(0, 80)}"`).join(' / '));
  return parts.join('\n');
}

/** AI menyerahkan percakapan ke sales. Hitungan SLA sales dimulai dari detik ini. */
export async function handoff(ctx: Ctx, conversationId: string, reason: string) {
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv || (!conv.aiActive && conv.handoffAt)) return;
  const summary = await buildHandoffSummary(ctx, conversationId);
  const now = new Date();
  let assigneeId = conv.assigneeId;
  if (!assigneeId) {
    assigneeId = await pickAssignee(ctx);
    if (assigneeId) await ctx.db.update(contacts).set({ ownerId: assigneeId }).where(eq(contacts.id, conv.contactId));
  }
  await ctx.db
    .update(conversations)
    .set({
      aiActive: false,
      handoffAt: now,
      handoffReason: reason,
      handoffSummary: summary,
      handoffClaimedAt: null,
      assigneeId,
      awaitingReplySince: conv.awaitingReplySince ? now : null,
      slaLevel: 0,
    })
    .where(eq(conversations.id, conversationId));
  const [owner] = assigneeId ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, assigneeId)) : [];
  await systemMessage(ctx, conversationId, `AI menyerahkan ke sales · ${owner?.name ?? 'belum ada PIC'} · ${reason}`);
  const lead = await openLeadForContact(ctx, conv.contactId);
  if (lead) {
    if (assigneeId && lead.ownerId !== assigneeId) await ctx.db.update(leads).set({ ownerId: assigneeId }).where(eq(leads.id, lead.id));
    await recordActivity(ctx, lead.id, 'handoff', 'AI menyerahkan ke sales', reason);
  }
  const [contact] = await ctx.db.select().from(contacts).where(eq(contacts.id, conv.contactId));
  const label = contact?.name ?? contact?.waPhone ?? 'customer';
  if (assigneeId) await notify(ctx, [assigneeId], 'ai', `Serah terima AI: ${label} — ${reason}`, `/inbox/${conversationId}`);
  else await notify(ctx, await usersWithRole(ctx, 'spv'), 'ai', `Serah terima AI tanpa PIC: ${label} — tugaskan sales`, `/ai`);
  ctx.events.emit({ type: 'conversation', conversationId, ownerId: assigneeId });
}

/** Sales/SPV mengembalikan percakapan ke AI. */
export async function resumeAi(ctx: Ctx, conversationId: string) {
  await ctx.db
    .update(conversations)
    .set({ aiActive: true, handoffAt: null, handoffReason: null, handoffSummary: null, handoffClaimedAt: null })
    .where(eq(conversations.id, conversationId));
  await systemMessage(ctx, conversationId, 'Percakapan dikembalikan ke AI');
}
