import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { reports, reportSchedules, users } from '../../db/schema.js';
import { ownOnly, requireMenu, requireRole } from '../auth.js';
import { audit } from '../../services/audit.js';
import { badRequest, forbidden, notFound } from '../../lib/http.js';
import { AUDIENCES, createReport, getReport, REPORT_PERIODS, REPORT_TYPES, type ReportType } from '../../services/reports.js';
import { brand, renderReportPdf, renderReportPptx, reportFileName } from '../../services/reportFiles.js';
import { runSchedule, scheduleLabel } from '../../services/reportSchedules.js';
import type { PeriodKey } from '../../services/analytics.js';

const TYPE = z.enum(['exec', 'sales', 'team', 'mkt', 'rep']);
const AUD = z.enum(['dir', 'spv', 'tim']);
const FMT = z.enum(['pdf', 'pptx']);
const PERIOD = z.enum(REPORT_PERIODS.map(([k]) => k) as [PeriodKey, ...PeriodKey[]]);

const ScheduleBody = z.object({
  type: TYPE,
  audience: AUD,
  format: FMT,
  frequency: z.enum(['monthly', 'weekly']),
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  dayOfWeek: z.number().int().min(0).max(6).default(1),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('07:00'),
  recipientIds: z.array(z.string().uuid()).min(1, 'Pilih minimal satu penerima'),
  active: z.boolean().default(true),
});

export function reportRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  app.get('/api/reports/meta', async (req) => {
    requireMenu(req, 'reports');
    const ai = await ctx.ai.settings();
    const keys = await ctx.ai.keys();
    return {
      types: Object.entries(REPORT_TYPES).map(([key, v]) => ({ key, ...v })),
      audiences: Object.entries(AUDIENCES).map(([key, v]) => ({ key, ...v })),
      periods: REPORT_PERIODS.map(([key, label]) => ({ key, label })),
      aiAvailable: ai.enabled && !!keys[ai.provider],
      smartModel: ai.models.smart,
    };
  });

  app.get('/api/reports', async (req) => {
    requireMenu(req, 'reports');
    const rows = await db
      .select({ r: reports, by: users.name })
      .from(reports)
      .leftJoin(users, eq(users.id, reports.createdBy))
      .orderBy(desc(reports.createdAt))
      .limit(200);
    return rows.map(({ r, by }) => ({ id: r.id, type: r.type, title: r.title, periodLabel: r.periodLabel, audience: r.audience, format: r.format, aiUsed: r.aiUsed, scheduled: !!r.scheduleId, by: r.scheduleId ? 'Terjadwal' : (by ?? '—'), createdAt: r.createdAt }));
  });

  app.post('/api/reports', async (req) => {
    const me = requireMenu(req, 'reports');
    const b = z.object({ type: TYPE, period: PERIOD, audience: AUD, format: FMT, notes: z.string().trim().max(500).optional() }).parse(req.body);
    if (!REPORT_TYPES[b.type].available) throw badRequest(`${REPORT_TYPES[b.type].title} butuh integrasi platform di Fase 3`);
    const r = await createReport(ctx, { ...b, notes: b.notes || null, scope: ownOnly(me) ? { ownerIds: [me.id] } : {} }, me.id);
    await audit(db, me.id, 'report.create', 'report', r.id, { type: b.type, period: b.period, ai: r.aiUsed });
    return r;
  });

  app.get('/api/reports/:id', async (req) => {
    requireMenu(req, 'reports');
    const r = await getReport(ctx, (req.params as any).id);
    if (!r) throw notFound('Laporan tidak ditemukan');
    return r;
  });

  // Edit narasi di pratinjau sebelum diunduh / dikirim.
  app.patch('/api/reports/:id', async (req) => {
    const me = requireMenu(req, 'reports');
    const r = await getReport(ctx, (req.params as any).id);
    if (!r) throw notFound('Laporan tidak ditemukan');
    if (me.role !== 'admin' && r.createdBy !== me.id) throw forbidden('Hanya pembuat laporan atau Admin yang bisa mengedit');
    const line = z.string().trim().min(1).max(600);
    const b = z.object({ summary: z.string().trim().min(1).max(2000), findings: z.array(line).max(6), recommendations: z.array(line).max(6) }).parse(req.body);
    await db.update(reports).set({ narrative: b }).where(eq(reports.id, r.id));
    await audit(db, me.id, 'report.edit', 'report', r.id);
    return { ok: true };
  });

  app.delete('/api/reports/:id', async (req) => {
    const me = requireRole(req, 'admin');
    await db.delete(reports).where(eq(reports.id, (req.params as any).id));
    await audit(db, me.id, 'report.delete', 'report', (req.params as any).id);
    return { ok: true };
  });

  app.get('/api/reports/:id/file.:ext', async (req, reply) => {
    const me = requireMenu(req, 'reports');
    const { id, ext } = req.params as { id: string; ext: string };
    if (ext !== 'pdf' && ext !== 'pptx') throw notFound();
    const r = await getReport(ctx, id);
    if (!r) throw notFound('Laporan tidak ditemukan');
    const b = await brand(ctx);
    const buf = ext === 'pdf' ? await renderReportPdf(r, b) : await renderReportPptx(r, b);
    await audit(db, me.id, 'report.download', 'report', r.id, { ext });
    reply
      .header('Content-Type', ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .header('Content-Disposition', `attachment; filename="${reportFileName(r, ext)}"`);
    return reply.send(buf);
  });

  // ---------- Jadwal ----------
  app.get('/api/report-schedules', async (req) => {
    requireMenu(req, 'reports');
    const list = await db.select().from(reportSchedules).orderBy(reportSchedules.createdAt);
    const ids = [...new Set(list.flatMap((s) => s.recipientIds))];
    const people = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
    const name = new Map(people.map((p) => [p.id, p.name]));
    return list.map((s) => ({ ...s, title: REPORT_TYPES[s.type as ReportType]?.title ?? s.type, when: scheduleLabel(s), recipients: s.recipientIds.map((id) => name.get(id) ?? '(dihapus)') }));
  });

  app.post('/api/report-schedules', async (req) => {
    const me = requireRole(req, 'admin', 'spv');
    const b = ScheduleBody.parse(req.body);
    if (!REPORT_TYPES[b.type].available) throw badRequest(`${REPORT_TYPES[b.type].title} butuh integrasi platform di Fase 3`);
    const [s] = await db.insert(reportSchedules).values({ ...b, createdBy: me.id }).returning();
    await audit(db, me.id, 'report_schedule.create', 'report_schedule', s!.id, b);
    return s;
  });

  app.patch('/api/report-schedules/:id', async (req) => {
    const me = requireRole(req, 'admin', 'spv');
    const b = ScheduleBody.partial().parse(req.body);
    const [s] = await db.update(reportSchedules).set(b).where(eq(reportSchedules.id, (req.params as any).id)).returning();
    if (!s) throw notFound();
    await audit(db, me.id, 'report_schedule.update', 'report_schedule', s.id, b);
    return s;
  });

  app.delete('/api/report-schedules/:id', async (req) => {
    const me = requireRole(req, 'admin', 'spv');
    await db.delete(reportSchedules).where(eq(reportSchedules.id, (req.params as any).id));
    await audit(db, me.id, 'report_schedule.delete', 'report_schedule', (req.params as any).id);
    return { ok: true };
  });

  // Jalankan sekarang (untuk mencoba penerima & format tanpa menunggu jadwal).
  app.post('/api/report-schedules/:id/run', async (req) => {
    requireRole(req, 'admin', 'spv');
    const [s] = await db.select().from(reportSchedules).where(eq(reportSchedules.id, (req.params as any).id));
    if (!s) throw notFound();
    const r = await runSchedule(ctx, s);
    return { reportId: r.report.id, notified: r.notified, emailed: r.emailed };
  });
}
