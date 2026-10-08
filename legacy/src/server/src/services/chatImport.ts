import { eq, inArray, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, conversations, messages, users } from '../db/schema.js';
import { normalizePhone } from '../lib/phone.js';

// Impor riwayat chat dari CRM lama (CSV/Excel). Satu baris = satu pesan.
// Kontak dicocokkan lewat nomor WhatsApp, atau lewat contact_id CRM lama yang
// sudah diimpor sebelumnya bersama kontak (kolom "ID kontak CRM lama").
// Pesan hasil impor tidak memicu AI, SLA, notifikasi, maupun lead baru.

export interface ChatImportResult {
  created: number;
  updated: number;
  skipped: number;
  conversations: number;
  otherChannel: number; // baris kanal selain WhatsApp (IG DM, dll.) dilewati
  errors: { row: number; error: string }[];
  unknownContacts: string[];
}

const IN = new Set(['inbound', 'in', 'masuk', 'incoming', 'customer', 'received']);
const OUT = new Set(['outbound', 'out', 'keluar', 'outgoing', 'agent', 'admin', 'sent']);

/** "2026-04-04 15:30:44" / "04/04/2026 15:30" (WIB) / ISO dengan zona waktu → Date. */
export function parseLegacyTime(s: string): Date | null {
  const v = s.trim();
  if (!v) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return new Date(v);
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(`${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}T${m[4]!.padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}+07:00`);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(`${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}T${m[4]!.padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}+07:00`);
  return null;
}

export async function importChats(ctx: Ctx, rows: Record<string, string>[], mapping: Record<string, string>, filename: string): Promise<ChatImportResult> {
  const db = ctx.db;
  const val = (row: Record<string, string>, key: string) => (mapping[key] ? (row[mapping[key]!] ?? '').trim() : '');
  const result: ChatImportResult = { created: 0, updated: 0, skipped: 0, conversations: 0, otherChannel: 0, errors: [], unknownContacts: [] };
  const unknown = new Set<string>();

  // Sales dicocokkan dari nama (boleh terpotong, mis. "Dewi Rach…") atau email.
  const team = await db.select({ id: users.id, name: users.name, email: users.email }).from(users);
  const salesCache = new Map<string, string | null>();
  const findSales = (raw: string) => {
    const s = raw.replace(/…|\.\.\.$/g, '').trim().toLowerCase();
    if (!s) return null;
    if (!salesCache.has(s)) {
      // "Aziza SPC" → Aziza, "Dewi Rach…" → Dewi Rachmawati, "Rahman Al Firdausi" → Rahman Al Firdausi
      const u =
        team.find((x) => x.email.toLowerCase() === s || x.name.toLowerCase() === s) ??
        team.find((x) => x.name.toLowerCase().startsWith(s) || s.startsWith(x.name.toLowerCase() + ' ')) ??
        team.find((x) => x.name.toLowerCase().split(/\s+/)[0] === s.split(/\s+/)[0]);
      salesCache.set(s, u?.id ?? null);
    }
    return salesCache.get(s)!;
  };

  // Kontak lama berdasarkan contact_id CRM lama.
  const legacyKeys = [...new Set(rows.map((r) => val(r, 'contactKey')).filter(Boolean))];
  const byLegacy = new Map<string, { id: string }>();
  for (let i = 0; i < legacyKeys.length; i += 1000) {
    const part = legacyKeys.slice(i, i + 1000);
    for (const c of await db.select({ id: contacts.id, legacyId: contacts.legacyId }).from(contacts).where(inArray(contacts.legacyId, part))) byLegacy.set(c.legacyId!, { id: c.id });
  }

  const contactFor = async (row: Record<string, string>): Promise<string | null> => {
    const phone = normalizePhone(val(row, 'phone'));
    const key = val(row, 'contactKey');
    if (phone) {
      let [c] = await db.select({ id: contacts.id, legacyId: contacts.legacyId }).from(contacts).where(eq(contacts.waPhone, phone));
      if (!c) [c] = await db.insert(contacts).values({ waPhone: phone, name: val(row, 'name') || null, legacyId: key || null }).returning({ id: contacts.id, legacyId: contacts.legacyId });
      else if (key && !c.legacyId) await db.update(contacts).set({ legacyId: key }).where(eq(contacts.id, c.id));
      if (key) byLegacy.set(key, { id: c!.id });
      return c!.id;
    }
    if (key) {
      const c = byLegacy.get(key);
      if (c) return c.id;
      unknown.add(key);
    }
    return null;
  };

  const convFor = new Map<string, string>();
  const touched = new Map<string, { first: Date; last: Date; lastIn: Date | null; preview: string; sales: string | null }>();
  const batch: (typeof messages.$inferInsert)[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const ins = await db.insert(messages).values(batch.splice(0)).onConflictDoNothing().returning({ id: messages.id });
    result.created += ins.length;
  };

  // Ratakan ke daftar pesan. Format berpasangan → hingga 2 pesan per baris (masuk + balasan).
  const paired = !!(mapping.bodyIn || mapping.bodyOut);
  type Entry = { r: Record<string, string>; rowNo: number; dir: string; body: string; timeRaw: string; at: Date | null };
  const entries: Entry[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    if (paired) {
      for (const [dir, b, tm] of [['inbound', 'bodyIn', 'timeIn'], ['outbound', 'bodyOut', 'timeOut']] as const) {
        const body = val(r, b);
        if (body) entries.push({ r, rowNo, dir, body, timeRaw: val(r, tm), at: parseLegacyTime(val(r, tm)) });
      }
    } else entries.push({ r, rowNo, dir: val(r, 'direction'), body: val(r, 'body'), timeRaw: val(r, 'timestamp'), at: parseLegacyTime(val(r, 'timestamp')) });
  });
  entries.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  let attempted = 0;
  for (const { r, rowNo, dir: dirIn, body, timeRaw, at } of entries) {
    try {
      if (!body) {
        result.skipped++;
        continue;
      }
      const channel = val(r, 'channel').toLowerCase();
      if (channel && !/whats ?app|^wa$/.test(channel)) {
        result.otherChannel++;
        continue;
      }
      if (!at) throw new Error(`Waktu tidak terbaca: "${timeRaw}"`);
      const dirRaw = dirIn.toLowerCase();
      const dir = IN.has(dirRaw) ? 'in' : OUT.has(dirRaw) ? 'out' : null;
      if (!dir) throw new Error(`Arah pesan tidak dikenal: "${dirIn}" (pakai inbound/outbound)`);
      const contactId = await contactFor(r);
      if (!contactId) {
        if (!val(r, 'phone') && !val(r, 'contactKey')) throw new Error('Nomor WhatsApp / contact_id kosong');
        result.skipped++;
        continue;
      }
      let convId = convFor.get(contactId);
      if (!convId) {
        const [existing] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, contactId));
        convId = existing?.id ?? (await db.insert(conversations).values({ contactId, aiActive: true }).returning({ id: conversations.id }))[0]!.id;
        convFor.set(contactId, convId);
      }
      const salesId = findSales(val(r, 'sales'));
      const extId = val(r, 'messageId');
      attempted++;
      batch.push({
        conversationId: convId,
        direction: dir,
        senderType: dir === 'in' ? 'customer' : 'user',
        userId: dir === 'out' ? salesId : null,
        kind: 'text',
        body,
        // Kunci unik supaya impor ulang file yang sama tidak membuat pesan ganda.
        waMessageId: extId ? `legacy:${extId}${paired ? `:${dir}` : ''}` : `legacy:${contactId}:${at.getTime()}:${dir}:${body.slice(0, 40)}`,
        status: dir === 'in' ? 'received' : 'read',
        meta: { imported: filename, legacyConversationId: val(r, 'conversationKey') || undefined, firstReplyAt: val(r, 'firstReplyAt') || undefined },
        createdAt: at,
      });
      const t = touched.get(convId) ?? { first: at, last: at, lastIn: null, preview: '', sales: null };
      if (at < t.first) t.first = at;
      if (at >= t.last) {
        t.last = at;
        t.preview = body.slice(0, 120);
      }
      if (dir === 'in' && (!t.lastIn || at > t.lastIn)) t.lastIn = at;
      if (salesId) t.sales = salesId;
      touched.set(convId, t);
      if (batch.length >= 500) await flush();
    } catch (e) {
      if (result.errors.length < 500) result.errors.push({ row: rowNo, error: (e as Error).message });
    }
  }
  await flush();
  result.skipped += attempted - result.created; // sudah pernah diimpor

  // Ringkasan percakapan & kontak: hanya maju, tidak memundurkan data yang lebih baru.
  for (const [convId, t] of touched) {
    await db
      .update(conversations)
      .set({
        lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${t.last.toISOString()}::timestamptz)`,
        lastMessagePreview: sql`case when ${conversations.lastMessageAt} is null or ${conversations.lastMessageAt} <= ${t.last.toISOString()}::timestamptz then ${t.preview} else ${conversations.lastMessagePreview} end`,
        lastInboundAt: t.lastIn ? sql`greatest(${conversations.lastInboundAt}, ${t.lastIn.toISOString()}::timestamptz)` : undefined,
        assigneeId: t.sales ? sql`coalesce(${conversations.assigneeId}, ${t.sales}::uuid)` : undefined,
      })
      .where(eq(conversations.id, convId));
    const [cv] = await db.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, convId));
    await db
      .update(contacts)
      .set({
        firstMessageAt: sql`least(${contacts.firstMessageAt}, ${t.first.toISOString()}::timestamptz)`,
        lastMessageAt: sql`greatest(${contacts.lastMessageAt}, ${t.last.toISOString()}::timestamptz)`,
        ownerId: t.sales ? sql`coalesce(${contacts.ownerId}, ${t.sales}::uuid)` : undefined,
      })
      .where(eq(contacts.id, cv!.contactId));
  }
  result.conversations = touched.size;
  result.unknownContacts = [...unknown].slice(0, 50);
  if (unknown.size) {
    result.errors.unshift({ row: 0, error: `${unknown.size} contact_id belum dikenal (mis. ${[...unknown].slice(0, 3).join(', ')}). Impor dulu file kontak CRM lama dengan kolom contact_id → "ID kontak CRM lama", lalu impor ulang file chat ini.` });
  }
  return result;
}
