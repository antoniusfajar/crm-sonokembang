import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { ownOnly, requireMenu, requireRole } from '../auth.js';
import { audit } from '../../services/audit.js';
import { createOpportunityTasks, customerStats, loadCustomers, repeatOpportunities, type Customer } from '../../services/customers.js';
import { badRequest, notFound } from '../../lib/http.js';
import { toCsv } from '../../lib/csv.js';
import { wibDateString } from '../../lib/time.js';

const ListQ = z.object({
  q: z.string().trim().optional(),
  range: z.enum(['all', '90', '180', '365', 'older']).default('all'),
  status: z.enum(['all', 'Aktif', 'Dorman']).default('all'),
  segment: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(10).max(200).default(25),
});

function filter(all: Customer[], q: z.infer<typeof ListQ>) {
  const needle = q.q?.toLowerCase().replace(/[\s+-]/g, '');
  return all
    .filter((c) => {
      if (needle && !`${c.name}${c.company ?? ''}`.toLowerCase().replace(/\s/g, '').includes(needle) && !c.waPhone.includes(needle.replace(/^0/, '62'))) return false;
      if (q.range === 'older' ? c.daysSince <= 365 : q.range !== 'all' && c.daysSince > Number(q.range)) return false;
      if (q.status !== 'all' && c.status !== q.status) return false;
      if (q.segment && (q.segment === '-' ? c.segment : c.segment !== q.segment)) return false;
      return true;
    })
    .sort((a, b) => b.lastOrder.localeCompare(a.lastOrder) || b.total - a.total);
}

export function customerRoutes(app: FastifyInstance, ctx: Ctx) {
  const load = (me: ReturnType<typeof requireMenu>) => loadCustomers(ctx, { ownerIds: ownOnly(me) ? [me.id] : null });

  app.get('/api/customers', async (req) => {
    const me = requireMenu(req, 'pelanggan');
    const q = ListQ.parse(req.query);
    const all = await load(me);
    const rows = filter(all, q);
    const page = rows.slice((q.page - 1) * q.size, q.page * q.size).map(({ history, waPhone, ...c }) => ({ ...c, lastEvent: history[0]!.eventType, lastPipeline: history[0]!.pipeline }));
    return { stats: customerStats(all), total: rows.length, page: q.page, size: q.size, rows: page, opportunities: repeatOpportunities(all).map((o) => ({ ...o, count: o.customers.length, customers: o.customers.slice(0, 8) })) };
  });

  app.get('/api/customers/:id', async (req) => {
    const me = requireMenu(req, 'pelanggan');
    const c = (await load(me)).find((x) => x.id === (req.params as any).id);
    if (!c) throw notFound('Pelanggan tidak ditemukan');
    const { waPhone, ...rest } = c;
    return rest;
  });

  // Buat tugas follow-up untuk satu kelompok peluang repeat order.
  app.post('/api/customers/opportunities/:key/tasks', async (req) => {
    const me = requireMenu(req, 'pelanggan');
    if (me.role === 'marketing') throw badRequest('Tugas follow-up dibuat oleh sales / SPV');
    const all = await load(me);
    const opp = repeatOpportunities(all).find((o) => o.key === (req.params as any).key);
    if (!opp) throw notFound('Kelompok peluang tidak dikenal');
    if (!opp.customers.length) throw badRequest('Tidak ada pelanggan di kelompok ini');
    const r = await createOpportunityTasks(ctx, opp, all, me.id);
    await audit(ctx.db, me.id, 'customers.tasks', 'opportunity', opp.key, r);
    return r;
  });

  // Ekspor: nomor telepon hanya untuk Admin (aturan akun di prototype).
  app.get('/api/customers/export.csv', async (req, reply) => {
    const me = requireRole(req, 'admin', 'spv');
    const q = ListQ.parse(req.query);
    const rows = filter(await load(me), q);
    const withPhone = me.role === 'admin';
    const out: unknown[][] = [['Pelanggan', ...(withPhone ? ['No. WhatsApp'] : []), 'Perusahaan', 'Segmen', 'Jumlah order', 'Order pertama', 'Order terakhir', 'Nilai total', 'Status', 'PIC', 'Peluang berikutnya']];
    for (const c of rows) out.push([c.name, ...(withPhone ? [c.waPhone] : []), c.company, c.segment, c.orders, c.firstOrder, c.lastOrder, c.total, c.status, c.pic, c.next]);
    await audit(ctx.db, me.id, 'customers.export', 'contact', null, { count: rows.length, withPhone });
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="pelanggan-${wibDateString(new Date())}.csv"`);
    return toCsv(out);
  });
}
