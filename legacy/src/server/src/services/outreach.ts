import { and, eq } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, conversations, leadSources, messages, tasks, users, waTemplates } from '../db/schema.js';
import { normalizePhone } from '../lib/phone.js';
import { badRequest } from '../lib/http.js';
import { pickAssignee } from './distribution.js';
import { applyQualification, createLead, leadCode, openLeadForContact, recordActivity, type Qualification } from './leads.js';
import { notify } from './notify.js';
import { getSetting } from './settings.js';

// Lead dari luar WhatsApp (form website, widget, QR pameran) + kirim template WA otomatis.

export async function sourceByRef(ctx: Ctx, refCode: string) {
  const [s] = await ctx.db.select().from(leadSources).where(eq(leadSources.refCode, refCode));
  return s ?? null;
}

async function ensureConversation(ctx: Ctx, contactId: string, ownerId: string | null) {
  const [conv] = await ctx.db.select().from(conversations).where(and(eq(conversations.contactId, contactId), eq(conversations.channel, 'whatsapp')));
  if (conv) return conv;
  const ai = await getSetting<{ enabled: boolean }>(ctx.db, 'ai');
  const [n] = await ctx.db.insert(conversations).values({ contactId, assigneeId: ownerId, aiActive: ai.enabled }).returning();
  return n!;
}

/** Kirim template WA ke kontak (di luar jendela 24 jam wajib template). Pesan tercatat di percakapannya. */
export async function sendTemplateToContact(ctx: Ctx, contactId: string, templateName: string, params: string[], meta: Record<string, unknown> = {}) {
  const [c] = await ctx.db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) throw badRequest('Kontak tidak ditemukan');
  const [t] = await ctx.db.select().from(waTemplates).where(eq(waTemplates.name, templateName)).limit(1);
  if (!t) throw badRequest(`Template "${templateName}" tidak ditemukan`);
  if (ctx.wa.mode === 'meta' && t.status !== 'APPROVED') throw badRequest(`Template "${templateName}" belum disetujui Meta`);
  const body = t.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1] ?? '');
  const conv = await ensureConversation(ctx, c.id, c.ownerId);
  const [msg] = await ctx.db.insert(messages).values({ conversationId: conv.id, direction: 'out', senderType: 'system', kind: 'template', body, templateName: t.name, status: 'queued', meta }).returning();
  try {
    const r = await ctx.wa.sendTemplate(c.waPhone, t.name, t.language, params);
    await ctx.db.update(messages).set({ status: 'sent', waMessageId: r.waMessageId }).where(eq(messages.id, msg!.id));
    await ctx.db.update(conversations).set({ lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 140) }).where(eq(conversations.id, conv.id));
    ctx.events.emit({ type: 'message', conversationId: conv.id, ownerId: conv.assigneeId });
    return { ok: true as const, conversationId: conv.id };
  } catch (e) {
    await ctx.db.update(messages).set({ status: 'failed', error: (e as Error).message.slice(0, 300) }).where(eq(messages.id, msg!.id));
    return { ok: false as const, error: (e as Error).message };
  }
}

export interface InboundLeadInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  qualification?: Qualification;
  sourceId: string | null;
  originNote: string;
  answers: [string, string][]; // untuk catatan aktivitas
  createTask?: boolean;
  notifyUserIds?: string[];
  waTemplate?: string | null;
}

/**
 * Buat / gabungkan lead dari form atau widget. Nomor WA jadi kunci: kontak lama dipakai ulang,
 * dan bila masih ada lead terbuka, data ditambahkan ke lead itu (tidak dobel).
 */
export async function upsertLeadFromSubmission(ctx: Ctx, input: InboundLeadInput) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw badRequest('Nomor WhatsApp tidak valid');
  let [contact] = await ctx.db.select().from(contacts).where(eq(contacts.waPhone, phone));
  if (!contact) {
    const ownerId = await pickAssignee(ctx, { hint: input.qualification?.eventType ?? null });
    [contact] = await ctx.db
      .insert(contacts)
      .values({ waPhone: phone, name: input.name || null, email: input.email || null, company: input.company || null, sourceId: input.sourceId, ownerId, firstMessageAt: new Date() })
      .returning();
  } else {
    const patch: Partial<typeof contacts.$inferInsert> = {};
    if (!contact.name && input.name) patch.name = input.name;
    if (!contact.email && input.email) patch.email = input.email;
    if (!contact.company && input.company) patch.company = input.company;
    if (Object.keys(patch).length) await ctx.db.update(contacts).set(patch).where(eq(contacts.id, contact.id));
  }
  const c = contact!;
  let lead = await openLeadForContact(ctx, c.id);
  const merged = !!lead;
  if (!lead) {
    lead = await createLead(ctx, { contactId: c.id, ownerId: c.ownerId, sourceId: input.sourceId ?? c.sourceId, origin: 'auto', originNote: input.originNote, eventType: input.qualification?.eventType ?? null });
  }
  if (input.qualification && Object.values(input.qualification).some((v) => v !== null && v !== undefined && v !== '')) {
    await applyQualification(ctx, lead.id, input.qualification, 'ai');
  }
  await recordActivity(ctx, lead.id, 'form', merged ? `${input.originNote} (digabung ke lead yang masih terbuka)` : input.originNote, input.answers.map(([k, v]) => `${k}: ${v}`).join('\n').slice(0, 2000));

  const owner = c.ownerId ?? lead.ownerId;
  const text = `${merged ? 'Data baru dari' : 'Lead baru dari'} ${input.originNote.toLowerCase()} — ${input.name || c.name || phone} (${leadCode(lead.code)})`;
  await notify(ctx, [owner, ...(input.notifyUserIds ?? [])], 'lead', text, `/leads/${lead.id}`);
  if (input.createTask && owner) {
    // Hitung mundur respons dimulai saat submit, bukan saat dibuka.
    await ctx.db.insert(tasks).values({ leadId: lead.id, userId: owner, title: `Hubungi lead dari ${input.originNote.toLowerCase()}`, kind: 'Follow-up', dueAt: new Date(Date.now() + 15 * 60_000), auto: true });
    ctx.events.emit({ type: 'task', userId: owner });
  }
  let wa: { ok: boolean; error?: string } | null = null;
  if (input.waTemplate) {
    const first = (input.name || c.name || '').trim().split(/\s+/)[0] || 'Kak';
    const [o] = owner ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, owner)) : [];
    wa = await sendTemplateToContact(ctx, c.id, input.waTemplate, [first, o?.name ?? 'tim kami'], { origin: 'form' });
  }
  return { contactId: c.id, leadId: lead.id, merged, wa };
}
