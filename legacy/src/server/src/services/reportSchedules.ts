import { eq, inArray } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { reportSchedules, users } from '../db/schema.js';
import { toWib, wibAt, wibDateString } from '../lib/time.js';
import { mailer } from './channels.js';
import { notify, usersWithRole } from './notify.js';
import { brand, renderReportPdf, renderReportPptx, reportFileName } from './reportFiles.js';
import { AUDIENCES, createReport, REPORT_TYPES, type Audience, type ReportType } from './reports.js';

type Schedule = typeof reportSchedules.$inferSelect;
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function scheduleLabel(s: Pick<Schedule, 'frequency' | 'dayOfMonth' | 'dayOfWeek' | 'time'>) {
  return s.frequency === 'monthly' ? `Tiap tanggal ${s.dayOfMonth} · ${s.time.replace(':', '.')}` : `Tiap ${HARI[s.dayOfWeek]} · ${s.time.replace(':', '.')}`;
}

/** Waktu jatuh tempo terakhir (≤ now) untuk jadwal ini, dalam UTC. */
export function lastDue(s: Pick<Schedule, 'frequency' | 'dayOfMonth' | 'dayOfWeek' | 'time'>, now = new Date()): Date {
  const today = wibDateString(now);
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (s.frequency === 'monthly') {
    const dueIn = (yy: number, mm: number) => {
      const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const d = Math.min(s.dayOfMonth, last);
      return wibAt(`${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`, s.time);
    };
    const thisMonth = dueIn(y, m);
    if (thisMonth <= now) return thisMonth;
    return m === 1 ? dueIn(y - 1, 12) : dueIn(y, m - 1);
  }
  const dow = toWib(now).getUTCDay();
  const back = (dow - s.dayOfWeek + 7) % 7;
  const candidate = wibAt(wibDateString(new Date(now.getTime() - back * 86_400_000)), s.time);
  return candidate <= now ? candidate : new Date(candidate.getTime() - 7 * 86_400_000);
}

/** Buat laporan dari jadwal lalu kirim: notifikasi + push ke penerima, dan email berlampiran bila SMTP aktif. */
export async function runSchedule(ctx: Ctx, s: Schedule, now = new Date()) {
  const report = await createReport(
    ctx,
    { type: s.type as ReportType, period: s.frequency === 'monthly' ? 'last_month' : 'last_week', audience: s.audience as Audience, format: s.format },
    s.createdBy,
    s.id,
    now,
  );
  const recipients = s.recipientIds.length
    ? await ctx.db.select({ id: users.id, email: users.email, status: users.status }).from(users).where(inArray(users.id, s.recipientIds))
    : [];
  const active = recipients.filter((r) => r.status === 'aktif');
  const text = `${report.title} — ${report.periodLabel} sudah siap${report.aiUsed ? '' : ' (narasi ditulis sistem)'}.`;
  await notify(ctx, active.map((r) => r.id), 'sistem', text, `/reports?id=${report.id}`);

  let emailed = 0;
  const m = mailer(ctx);
  if (m && active.length) {
    const b = await brand(ctx);
    const ext = s.format === 'pptx' ? 'pptx' : 'pdf';
    const content = ext === 'pptx' ? await renderReportPptx(report, b) : await renderReportPdf(report, b);
    const nar = report.narrative;
    const body = [
      `${report.title} — ${report.periodLabel} (untuk ${AUDIENCES[report.audience as Audience]?.label ?? report.audience})`,
      '',
      nar.summary,
      '',
      'Rekomendasi:',
      ...nar.recommendations.map((r, i) => `${i + 1}. ${r}`),
      '',
      `Lihat & unduh ulang: ${ctx.config.PUBLIC_URL}/reports?id=${report.id}`,
    ].join('\n');
    try {
      await m.send(
        active.map((r) => r.email),
        `[CRM] ${report.title} — ${report.periodLabel}`,
        body,
        undefined,
        [{ filename: reportFileName(report, ext), content, contentType: ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }],
      );
      emailed = active.length;
    } catch (e) {
      const admins = await usersWithRole(ctx, 'admin');
      await notify(ctx, admins, 'sistem', `Email laporan "${report.title}" gagal terkirim: ${(e as Error).message.slice(0, 160)}`, '/reports');
    }
  }
  return { report, notified: active.length, emailed };
}

/** Dipanggil worker tiap menit. Jadwal yang sudah lewat jatuh tempo & belum dijalankan untuk siklus ini akan dibuat. */
export async function runDueSchedules(ctx: Ctx, now = new Date()) {
  const list = await ctx.db.select().from(reportSchedules).where(eq(reportSchedules.active, true));
  let ran = 0;
  for (const s of list) {
    const due = lastDue(s, now);
    // Jadwal baru tidak "mengejar" siklus sebelum ia dibuat.
    if (s.createdAt > due || (s.lastRunAt && s.lastRunAt >= due)) continue;
    if (!REPORT_TYPES[s.type as ReportType]?.available) continue;
    // Tandai dulu supaya kegagalan tidak membuat laporan berulang tiap menit.
    await ctx.db.update(reportSchedules).set({ lastRunAt: now }).where(eq(reportSchedules.id, s.id));
    try {
      await runSchedule(ctx, s, now);
      ran++;
    } catch (e) {
      const admins = await usersWithRole(ctx, 'admin');
      await notify(ctx, admins, 'sistem', `Laporan terjadwal "${REPORT_TYPES[s.type as ReportType]?.title ?? s.type}" gagal dibuat: ${(e as Error).message.slice(0, 160)}`, '/reports');
    }
  }
  return ran;
}
