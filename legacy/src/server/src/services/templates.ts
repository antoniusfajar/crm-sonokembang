import { eq } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, leads, users } from '../db/schema.js';
import { formatPhone } from '../lib/phone.js';
import { getSetting } from './settings.js';

// Isi variabel {{n}} template WhatsApp dari data CRM, supaya sales tidak mengetik ulang.
// Kunci yang tidak dikenal / kosong ('') = diketik manual saat mengirim.

export const TEMPLATE_FIELDS: [string, string][] = [
  ['customer.firstName', 'Nama depan customer'],
  ['customer.name', 'Nama lengkap customer'],
  ['lead.eventType', 'Jenis acara'],
  ['lead.eventDate', 'Tanggal acara'],
  ['lead.location', 'Lokasi acara'],
  ['lead.pax', 'Jumlah pax'],
  ['lead.code', 'Kode lead'],
  ['sender.firstName', 'Nama depan sales (pengirim)'],
  ['sender.name', 'Nama lengkap sales (pengirim)'],
  ['biz.name', 'Nama usaha'],
  ['biz.hotline', 'Nomor hotline'],
  ['review.link', 'Link ulasan Google'],
];

const HONORIFIC = /^(ibu|bu|bapak|pak|mbak|mba|mas|kak|kakak|bunda|mama|mami|papa|papi|om|tante|mr|mrs|ms|miss|dr|drg|hj|h|ir)\.?\s+/i;
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/** "Bu ratna 🌸 Sari" → "Ratna" (aturan yang sama dengan nama lead). */
export function firstNameOf(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().replace(HONORIFIC, '');
  const first = clean.split(' ')[0] ?? '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}

export async function resolveTemplateParams(ctx: Ctx, varMap: string[], n: number, ref: { contactId: string; leadId?: string | null; senderId?: string | null }): Promise<string[]> {
  if (!varMap.some(Boolean)) return Array.from({ length: n }, () => '');
  const [c] = await ctx.db.select().from(contacts).where(eq(contacts.id, ref.contactId));
  const [l] = ref.leadId ? await ctx.db.select().from(leads).where(eq(leads.id, ref.leadId)) : [];
  const [s] = ref.senderId ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ref.senderId)) : [];
  const biz = await getSetting<{ name?: string; hotline?: string }>(ctx.db, 'business_profile');
  const rep = await getSetting<{ request?: { link?: string } }>(ctx.db, 'reputation');
  const customer = l?.customerName || c?.name || '';
  const value = (key: string): string => {
    switch (key) {
      case 'customer.firstName':
        return firstNameOf(customer) || 'Kak';
      case 'customer.name':
        return customer;
      case 'lead.eventType':
        return l?.eventType ?? '';
      case 'lead.eventDate':
        if (l?.eventDate) return `${Number(l.eventDate.slice(8))} ${MONTHS[Number(l.eventDate.slice(5, 7)) - 1]} ${l.eventDate.slice(0, 4)}`;
        return l?.eventDateText ?? '';
      case 'lead.location':
        return l?.location ?? '';
      case 'lead.pax':
        return l?.pax ? l.pax.toLocaleString('id-ID') : '';
      case 'lead.code':
        return l ? `L-${String(l.code).padStart(4, '0')}` : '';
      case 'sender.firstName':
        return firstNameOf(s?.name);
      case 'sender.name':
        return s?.name ?? '';
      case 'biz.name':
        return biz.name ?? '';
      case 'biz.hotline':
        return biz.hotline ? formatPhone(biz.hotline.replace(/\D/g, '').replace(/^0/, '62')) : '';
      case 'review.link':
        return rep.request?.link ?? '';
      default:
        return '';
    }
  };
  return Array.from({ length: n }, (_, i) => value(varMap[i] ?? ''));
}

export const templateSlots = (body: string) => Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
