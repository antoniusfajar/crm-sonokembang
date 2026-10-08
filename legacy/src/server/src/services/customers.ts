import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, leads, pipelines, stages, tasks, users } from '../db/schema.js';
import { formatPhone } from '../lib/phone.js';
import { addDays, wibAt, wibDateString } from '../lib/time.js';

// Pelanggan = kontak yang punya minimal satu lead closing (tahap "won").
// Semua angka & peluang repeat order dihitung script dari riwayat order.

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DAY = 86_400_000;
export const DORMANT_DAYS = 180;
const HIGH_VALUE = 50_000_000;

export interface Order {
  leadId: string;
  ownerId: string | null;
  pipeline: string;
  eventType: string | null;
  eventDate: string | null;
  closedAt: Date;
  value: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  waPhone: string;
  company: string | null;
  segment: string | null;
  orders: number;
  firstOrder: string;
  lastOrder: string;
  total: number;
  status: 'Aktif' | 'Dorman';
  daysSince: number;
  picId: string | null;
  pic: string | null;
  openLead: { id: string; stage: string } | null;
  next: string;
  history: Order[];
}

/** Tanggal acara (atau tanggal closing) setahun kemudian yang jatuh 0–60 hari dari sekarang. */
function upcomingAnniversary(o: Order, now: Date): Date | null {
  const base = o.eventDate ? new Date(o.eventDate + 'T00:00:00+07:00') : o.closedAt;
  if (now.getTime() - base.getTime() < 300 * DAY) return null; // belum setahun
  const y = Number(wibDateString(now).slice(0, 4));
  for (const yy of [y, y + 1]) {
    const d = new Date(`${yy}-${wibDateString(base).slice(5)}T00:00:00+07:00`);
    const diff = d.getTime() - now.getTime();
    if (diff >= -DAY && diff <= 60 * DAY) return d;
  }
  return null;
}

function nextHint(c: Omit<Customer, 'next'>, now: Date): string {
  if (c.openLead) return `Lead berjalan · ${c.openLead.stage}`;
  const last = c.history[0]!;
  const ann = upcomingAnniversary(last, now);
  if (ann) {
    const bln = BULAN[Number(wibDateString(ann).slice(5, 7)) - 1];
    return last.pipeline.toLowerCase().includes('wedding') && !last.pipeline.toLowerCase().includes('non')
      ? `Anniversary pernikahan ${bln} — tawarkan paket syukuran`
      : `Siklus tahunan: ${last.eventType ?? 'acara'} biasanya ${bln}`;
  }
  if (c.status === 'Dorman') return `Belum order ${Math.floor(c.daysSince / 30)} bulan`;
  if (c.orders >= 3) return 'Pelanggan setia — jaga hubungan';
  return '—';
}

/** Semua pelanggan (opsional: hanya yang punya order milik sales tertentu). */
export async function loadCustomers(ctx: Ctx, opts: { ownerIds?: string[] | null; now?: Date } = {}): Promise<Customer[]> {
  const now = opts.now ?? new Date();
  const won = await ctx.db
    .select({
      leadId: leads.id,
      contactId: leads.contactId,
      ownerId: leads.ownerId,
      pipeline: pipelines.name,
      eventType: leads.eventType,
      eventDate: leads.eventDate,
      closedAt: leads.closedAt,
      dealValue: leads.dealValue,
      estimatedValue: leads.estimatedValue,
      budget: leads.budget,
    })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .innerJoin(pipelines, eq(pipelines.id, leads.pipelineId))
    .where(eq(stages.kind, 'won'));
  const byContact = new Map<string, Order[]>();
  for (const w of won) {
    const o: Order = {
      leadId: w.leadId,
      ownerId: w.ownerId,
      pipeline: w.pipeline,
      eventType: w.eventType,
      eventDate: w.eventDate,
      closedAt: w.closedAt ?? now,
      value: Number(w.dealValue ?? w.estimatedValue ?? w.budget ?? 0),
    };
    byContact.set(w.contactId, [...(byContact.get(w.contactId) ?? []), o]);
  }
  let ids = [...byContact.keys()];
  if (opts.ownerIds) {
    const own = new Set(opts.ownerIds);
    ids = ids.filter((id) => byContact.get(id)!.some((o) => o.ownerId && own.has(o.ownerId)));
  }
  if (!ids.length) return [];

  const cts = await ctx.db.select().from(contacts).where(inArray(contacts.id, ids));
  const people = new Map((await ctx.db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]));
  const open = await ctx.db
    .select({ id: leads.id, contactId: leads.contactId, stage: stages.name })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(stages.kind, 'open'), inArray(leads.contactId, ids)));
  const openBy = new Map(open.map((o) => [o.contactId, { id: o.id, stage: o.stage }]));

  return cts.map((c) => {
    const history = byContact.get(c.id)!.sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());
    const last = history[0]!;
    const daysSince = Math.floor((now.getTime() - last.closedAt.getTime()) / DAY);
    const picId = last.ownerId ?? c.ownerId;
    const base = {
      id: c.id,
      name: c.name ?? c.company ?? formatPhone(c.waPhone),
      phone: formatPhone(c.waPhone),
      waPhone: c.waPhone,
      company: c.company,
      segment: c.segment,
      orders: history.length,
      firstOrder: wibDateString(history.at(-1)!.closedAt),
      lastOrder: wibDateString(last.closedAt),
      total: history.reduce((a, o) => a + o.value, 0),
      status: (daysSince > DORMANT_DAYS ? 'Dorman' : 'Aktif') as 'Aktif' | 'Dorman',
      daysSince,
      picId,
      pic: picId ? (people.get(picId) ?? null) : null,
      openLead: openBy.get(c.id) ?? null,
      history,
    };
    return { ...base, next: nextHint(base, now) };
  });
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

/** Repeat rate: dari pelanggan yang order dalam jendela 12 bulan, berapa persen yang sudah order sebelumnya / ≥2x. */
function repeatRate(all: Customer[], end: Date) {
  const start = new Date(end.getTime() - 365 * DAY);
  const inWin = all.filter((c) => c.history.some((o) => o.closedAt >= start && o.closedAt < end));
  if (!inWin.length) return null;
  const repeat = inWin.filter((c) => c.history.filter((o) => o.closedAt < end).length >= 2);
  return Math.round((repeat.length / inWin.length) * 1000) / 10;
}

export function customerStats(all: Customer[], now = new Date()) {
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const orders12 = all.flatMap((c) => c.history.filter((o) => o.closedAt >= yearAgo).map((o) => o.value)).filter((v) => v > 0);
  const rr = repeatRate(all, now);
  const rrPrev = repeatRate(all, yearAgo);
  return {
    total: all.length,
    repeatRate: rr,
    repeatRateDelta: rr !== null && rrPrev !== null ? Math.round((rr - rrPrev) * 10) / 10 : null,
    avgOrder: orders12.length ? Math.round(orders12.reduce((a, b) => a + b, 0) / orders12.length) : 0,
    medianOrder: median(orders12),
    dormant: all.filter((c) => c.status === 'Dorman' && !c.openLead).length,
  };
}

export interface Opportunity {
  key: string;
  title: string;
  detail: string;
  taskTitle: string;
  customers: { id: string; name: string; pic: string | null }[];
}

/** Kelompok peluang repeat order (tanpa pelanggan yang sedang punya lead berjalan). */
export function repeatOpportunities(all: Customer[], now = new Date()): Opportunity[] {
  const idle = all.filter((c) => !c.openLead);
  const pick = (xs: Customer[]) => xs.map((c) => ({ id: c.id, name: c.name, pic: c.pic }));
  const isWedding = (p: string) => /wedding/i.test(p) && !/non/i.test(p);

  const annWedding = idle.filter((c) => isWedding(c.history[0]!.pipeline) && upcomingAnniversary(c.history[0]!, now));
  const cycle = idle.filter((c) => !isWedding(c.history[0]!.pipeline) && upcomingAnniversary(c.history[0]!, now));
  const dormantHigh = idle.filter((c) => c.status === 'Dorman' && c.total >= HIGH_VALUE).sort((a, b) => b.total - a.total);
  const corpQuiet = idle.filter((c) => (c.segment === 'Korporat' || c.segment === 'Institusi') && c.daysSince > 90 && c.status === 'Aktif');

  const list: Opportunity[] = [
    {
      key: 'cycle',
      title: 'Siklus tahunan dalam 60 hari',
      detail: `${cycle.length} pelanggan biasanya order di sekitar bulan ini/depan (wisuda, ulang tahun kantor, syukuran tahunan) dan belum dihubungi.`,
      taskTitle: 'Repeat order: tawarkan acara tahunan',
      customers: pick(cycle),
    },
    {
      key: 'anniversary',
      title: 'Anniversary pernikahan',
      detail: `${annWedding.length} pelanggan wedding memasuki bulan anniversary dalam 60 hari — tawarkan paket syukuran.`,
      taskTitle: 'Repeat order: anniversary pernikahan',
      customers: pick(annWedding),
    },
    {
      key: 'dormant_high',
      title: 'Pelanggan dorman bernilai tinggi',
      detail: `${dormantHigh.length} pelanggan dengan total order ≥ Rp 50 jt tidak order lebih dari 6 bulan.`,
      taskTitle: 'Repeat order: sapa pelanggan lama',
      customers: pick(dormantHigh),
    },
    {
      key: 'corporate_quiet',
      title: 'Korporat / institusi diam > 90 hari',
      detail: `${corpQuiet.length} pelanggan korporat/institusi belum order lagi 3–6 bulan. Biasanya masih ada acara rutin.`,
      taskTitle: 'Repeat order: cek kebutuhan acara kantor',
      customers: pick(corpQuiet),
    },
  ];
  return list;
}

/** Buat tugas follow-up untuk PIC terakhir tiap pelanggan. Pelanggan yang sudah punya tugas sama & belum selesai dilewati. */
export async function createOpportunityTasks(ctx: Ctx, opp: Opportunity, all: Customer[], fallbackUserId: string) {
  const byId = new Map(all.map((c) => [c.id, c]));
  const active = new Set((await ctx.db.select({ id: users.id }).from(users).where(eq(users.status, 'aktif'))).map((u) => u.id));
  const due = wibAt(wibDateString(addDays(new Date(), 1)), '10:00');
  let created = 0;
  let skipped = 0;
  const notified = new Set<string>();
  for (const oc of opp.customers) {
    const c = byId.get(oc.id);
    if (!c) continue;
    const leadId = c.history[0]!.leadId;
    const userId = c.picId && active.has(c.picId) ? c.picId : fallbackUserId;
    const exists = await ctx.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.leadId, leadId), eq(tasks.title, opp.taskTitle), isNull(tasks.doneAt)))
      .limit(1);
    if (exists.length) {
      skipped++;
      continue;
    }
    await ctx.db.insert(tasks).values({ leadId, userId, title: opp.taskTitle, kind: 'Repeat order', dueAt: due });
    notified.add(userId);
    created++;
  }
  for (const userId of notified) ctx.events.emit({ type: 'task', userId });
  return { created, skipped };
}
