import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { forms, formSubmissions, leadSources, type FormField } from '../db/schema.js';
import { badRequest, notFound } from '../lib/http.js';
import { normalizePhone } from '../lib/phone.js';
import { getSetting } from './settings.js';
import { sourceByRef, upsertLeadFromSubmission } from './outreach.js';
import type { Qualification } from './leads.js';

export type Form = typeof forms.$inferSelect;

export const MAP_TARGETS: [string, string][] = [
  ['name', 'Nama kontak'],
  ['phone', 'Nomor WhatsApp (kunci duplikat)'],
  ['email', 'Email'],
  ['company', 'Perusahaan / instansi'],
  ['eventType', 'Jenis acara'],
  ['eventDate', 'Tanggal acara'],
  ['location', 'Lokasi'],
  ['pax', 'Jumlah pax'],
  ['budget', 'Budget'],
  ['note', 'Catatan untuk sales'],
];

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'form';

export const CONSULTATION_FIELDS: FormField[] = [
  { key: 'nama', label: 'Nama lengkap', type: 'text', required: true, mapTo: 'name' },
  { key: 'wa', label: 'Nomor WhatsApp', type: 'phone', required: true, mapTo: 'phone' },
  { key: 'acara', label: 'Jenis acara', type: 'select', required: true, options: ['Wedding', 'Lamaran', 'Acara kantor / gathering', 'Ulang tahun', 'Syukuran', 'Wisuda', 'Kantin karyawan', 'Lainnya'], mapTo: 'eventType' },
  { key: 'tanggal', label: 'Tanggal acara', type: 'date', required: false, mapTo: 'eventDate' },
  { key: 'pax', label: 'Jumlah tamu (pax)', type: 'number', required: false, mapTo: 'pax' },
  { key: 'budget', label: 'Perkiraan budget (Rp)', type: 'number', required: false, mapTo: 'budget' },
  { key: 'catatan', label: 'Catatan', type: 'textarea', required: false, mapTo: 'note' },
];

/** Validasi & bersihkan jawaban sesuai susunan field. */
export function validateAnswers(fields: FormField[], raw: Record<string, unknown>) {
  const out: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = String(raw[f.key] ?? '').trim().slice(0, f.type === 'textarea' ? 2000 : 300);
    if (!v) {
      if (f.required) errors[f.key] = `${f.label} wajib diisi`;
      continue;
    }
    if (f.type === 'phone' && !normalizePhone(v)) errors[f.key] = 'Nomor WhatsApp tidak valid';
    else if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.key] = 'Email tidak valid';
    else if (f.type === 'number' && !/^[\d.,\s]+$/.test(v)) errors[f.key] = 'Harus angka';
    else if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[f.key] = 'Tanggal tidak valid';
    else if (f.type === 'select' && f.options?.length && !f.options.includes(v)) errors[f.key] = 'Pilihan tidak dikenal';
    out[f.key] = v;
  }
  return { values: out, errors };
}

const num = (v: string) => {
  const n = Number(v.replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Batas kiriman per IP (anti-spam ringan; form publik).
const hits = new Map<string, number[]>();
function rateLimited(key: string, max = 8, windowMs = 10 * 60_000) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

export interface SubmitMeta {
  ip: string;
  page?: string | null;
  utm?: Record<string, string> | null;
  honeypot?: string | null;
}

export async function submitForm(ctx: Ctx, slug: string, raw: Record<string, unknown>, meta: SubmitMeta) {
  const [f] = await ctx.db.select().from(forms).where(eq(forms.slug, slug));
  if (!f || f.status !== 'active') throw notFound('Form tidak ditemukan atau sudah ditutup');
  // Bot biasanya mengisi field tersembunyi → pura-pura sukses, tidak disimpan.
  if (meta.honeypot) return { ok: true, thankYou: f.settings.thankYou ?? 'Terima kasih!' };
  if (rateLimited(`${meta.ip}|${f.id}`)) throw badRequest('Terlalu banyak kiriman. Coba lagi beberapa menit lagi.');
  const { values, errors } = validateAnswers(f.fields, raw);
  if (Object.keys(errors).length) throw badRequest('Periksa isian form', { errors });

  const byMap = (target: string) => {
    const field = f.fields.find((x) => x.mapTo === target);
    return field ? (values[field.key] ?? null) : null;
  };
  let contactId: string | null = null;
  let leadId: string | null = null;
  if (f.purpose === 'lead') {
    const phone = byMap('phone');
    if (!phone) throw badRequest('Form ini butuh field Nomor WhatsApp yang dipetakan ke "phone"');
    const q: Qualification = {
      eventType: byMap('eventType'),
      eventDate: byMap('eventDate'),
      location: byMap('location'),
      pax: byMap('pax') ? num(byMap('pax')!) : null,
      budget: byMap('budget') ? num(byMap('budget')!) : null,
    };
    const custom: Record<string, unknown> = {};
    for (const fld of f.fields) if (fld.mapTo?.startsWith('custom:') && values[fld.key]) custom[fld.mapTo.slice(7)] = values[fld.key];
    if (Object.keys(custom).length) q.custom = custom;
    const website = await sourceByRef(ctx, 'WEB');
    const r = await upsertLeadFromSubmission(ctx, {
      phone,
      name: byMap('name'),
      email: byMap('email'),
      company: byMap('company'),
      qualification: q,
      sourceId: f.sourceId ?? website?.id ?? null,
      originNote: `Form "${f.name}"${meta.page ? ` · ${meta.page}` : ''}`,
      answers: f.fields.filter((x) => values[x.key]).map((x) => [x.label, values[x.key]!]),
      createTask: f.settings.createTask ?? true,
      notifyUserIds: f.settings.notifyUserIds ?? [],
      waTemplate: f.settings.waTemplate ?? null,
    });
    contactId = r.contactId;
    leadId = r.leadId;
  } else if (f.settings.notifyUserIds?.length) {
    const { notify } = await import('./notify.js');
    await notify(ctx, f.settings.notifyUserIds, 'sistem', `Kiriman baru di form "${f.name}"`, `/form?id=${f.id}`);
  }
  await ctx.db.insert(formSubmissions).values({ formId: f.id, data: values, contactId, leadId, page: meta.page?.slice(0, 300) ?? null, utm: meta.utm ?? null });
  return { ok: true, thankYou: f.settings.thankYou ?? 'Terima kasih! Tim kami akan menghubungi Anda lewat WhatsApp.' };
}

/** Angka per form: kiriman, jadi lead, closing. */
export async function formStats(ctx: Ctx, ids: string[], since?: Date) {
  if (!ids.length) return new Map<string, { submissions: number; leads: number; closings: number; last: Date | null }>();
  const rows = await ctx.db
    .select({
      id: formSubmissions.formId,
      submissions: sql<number>`count(*)::int`,
      leads: sql<number>`count(distinct ${formSubmissions.leadId})::int`,
      closings: sql<number>`count(distinct ${formSubmissions.leadId}) filter (where exists (select 1 from leads l join stages st on st.id = l.stage_id where l.id = ${formSubmissions.leadId} and st.kind = 'won'))::int`,
      last: sql<Date | null>`max(${formSubmissions.createdAt})`,
    })
    .from(formSubmissions)
    .where(and(inArray(formSubmissions.formId, ids), since ? gte(formSubmissions.createdAt, since) : undefined))
    .groupBy(formSubmissions.formId);
  return new Map(rows.map((r) => [r.id, { ...r, last: r.last ? new Date(r.last) : null }]));
}

export async function listSubmissions(ctx: Ctx, formId: string, limit = 200) {
  return ctx.db.select().from(formSubmissions).where(eq(formSubmissions.formId, formId)).orderBy(desc(formSubmissions.createdAt)).limit(limit);
}

// ---------------------------------------------------------------- Livechat widget

export interface WidgetSettings {
  enabled: boolean;
  position: 'right' | 'left';
  color: string;
  launcher: 'bubble' | 'pill';
  label: string;
  greeting: string;
  showGreeting: boolean;
  badge: boolean;
  prechat: boolean;
  askEvent: boolean;
  askDate: boolean;
  eventOptions: string[];
  hoursNote: string;
  allowedDomains: string[];
}

export async function widgetConfig(ctx: Ctx) {
  const w = await getSetting<WidgetSettings>(ctx.db, 'widget');
  const biz = await getSetting<{ name: string; hotline?: string; logoPath?: string | null }>(ctx.db, 'business_profile');
  const hotline = (biz.hotline || '').replace(/\D/g, '').replace(/^0/, '62');
  return { ...w, hotline, businessName: biz.name, logo: biz.logoPath ? '/api/public/logo' : null };
}

/** Isi form pra-chat widget → lead (sumber Website) + link wa.me berisi penanda halaman. */
export async function widgetLead(ctx: Ctx, body: { name?: string; phone?: string; eventType?: string; eventDate?: string; page?: string; honeypot?: string }, ip: string) {
  const cfg = await widgetConfig(ctx);
  if (!cfg.enabled) throw notFound('Widget tidak aktif');
  const page = slugify((body.page ?? '').replace(/^https?:\/\/[^/]+/, '') || 'beranda').slice(0, 30) || 'beranda';
  const tag = `WEB-widget-${page}`;
  const name = (body.name ?? '').trim().slice(0, 80);
  const first = name.split(/\s+/)[0];
  const text = `Halo Sonokembang${first ? `, saya ${first}` : ''}. Mau tanya catering${body.eventType ? ` untuk ${body.eventType.toLowerCase()}` : ''}. (${tag})`;
  const waUrl = `https://wa.me/${cfg.hotline}?text=${encodeURIComponent(text)}`;
  if (body.honeypot) return { waUrl };
  if (cfg.prechat && body.phone) {
    if (rateLimited(`${ip}|widget`)) throw badRequest('Terlalu banyak kiriman. Coba lagi nanti.');
    if (!normalizePhone(body.phone)) throw badRequest('Nomor WhatsApp tidak valid');
    const [web] = await ctx.db.select().from(leadSources).where(eq(leadSources.refCode, 'WEB'));
    await upsertLeadFromSubmission(ctx, {
      phone: body.phone,
      name,
      qualification: { eventType: body.eventType || null, eventDate: /^\d{4}-\d{2}-\d{2}$/.test(body.eventDate ?? '') ? body.eventDate! : null },
      sourceId: web?.id ?? null,
      originNote: `Livechat widget · halaman ${page}`,
      answers: [
        ['Nama', name],
        ['Nomor WA', body.phone],
        ...(body.eventType ? ([['Jenis acara', body.eventType]] as [string, string][]) : []),
        ...(body.eventDate ? ([['Tanggal', body.eventDate]] as [string, string][]) : []),
      ],
      createTask: false, // customer biasanya langsung chat di WA; SLA berjalan dari chat itu
    });
  }
  return { waUrl };
}
