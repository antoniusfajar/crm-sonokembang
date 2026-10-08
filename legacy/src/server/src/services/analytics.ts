import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { conversations, leadSources, leadStageHistory, leads, messages, pipelines, proposals, stages, targets, users } from '../db/schema.js';
import { addDays, wibAt, wibDateString, workingMinutesBetween, type WorkingHours } from '../lib/time.js';
import { getSetting } from './settings.js';
import type { SlaSettings } from './sla.js';

// Semua angka laporan dihitung di sini (script). AI hanya menulis narasi dari hasil ini.

/**
 * Konversi = dari lead yang MASUK di periode, berapa yang sudah closing (kohort).
 * Closing periode ini bisa berasal dari lead bulan-bulan lalu, jadi tidak boleh dibagi
 * dengan lead baru periode ini (hasilnya bisa > 100%).
 */
const wonOfCreated = () => sql<number>`count(*) filter (where ${leads.stageId} in (select ${stages.id} from ${stages} where ${stages.kind} = 'won'))`;

export type PeriodKey = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'this_week' | 'last_week' | 'custom';

export interface Period {
  key: PeriodKey;
  label: string;
  start: Date; // inklusif (UTC, setara 00.00 WIB)
  end: Date; // eksklusif
  startDate: string; // YYYY-MM-DD (WIB)
  endDate: string; // inklusif, YYYY-MM-DD (WIB)
  months: string[]; // YYYY-MM yang tercakup (untuk target)
}

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function addMonths(y: number, m: number, n: number): [number, number] {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

function build(key: PeriodKey, label: string, startDate: string, endExclusiveDate: string): Period {
  const start = wibAt(startDate, '00:00');
  const end = wibAt(endExclusiveDate, '00:00');
  const months: string[] = [];
  let [y, m] = startDate.split('-').map(Number) as [number, number];
  while (ymd(y, m, 1) < endExclusiveDate) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    [y, m] = addMonths(y, m, 1);
  }
  return { key, label, start, end, startDate, endDate: wibDateString(addDays(end, -1)), months };
}

export function resolvePeriod(key: PeriodKey, now = new Date(), custom?: { from: string; to: string }): Period {
  const today = wibDateString(now);
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  switch (key) {
    case 'this_month': {
      const [ny, nm] = addMonths(y, m, 1);
      return build(key, `${BULAN[m - 1]} ${y}`, ymd(y, m, 1), ymd(ny, nm, 1));
    }
    case 'last_month': {
      const [py, pm] = addMonths(y, m, -1);
      return build(key, `${BULAN[pm - 1]} ${py}`, ymd(py, pm, 1), ymd(y, m, 1));
    }
    case 'this_quarter':
    case 'last_quarter': {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      let [qy, qm] = [y, qStartMonth];
      if (key === 'last_quarter') [qy, qm] = addMonths(y, qStartMonth, -3);
      const [ey, em] = addMonths(qy, qm, 3);
      return build(key, `Kuartal ${Math.floor((qm - 1) / 3) + 1} ${qy}`, ymd(qy, qm, 1), ymd(ey, em, 1));
    }
    case 'this_year':
      return build(key, `Tahun ${y}`, ymd(y, 1, 1), ymd(y + 1, 1, 1));
    case 'this_week':
    case 'last_week': {
      const dow = new Date(today + 'T00:00:00Z').getUTCDay(); // 0 = Minggu
      const monday = addDays(new Date(today + 'T00:00:00Z'), -((dow + 6) % 7) - (key === 'last_week' ? 7 : 0));
      const s = monday.toISOString().slice(0, 10);
      const e = addDays(monday, 7).toISOString().slice(0, 10);
      return build(key, `${key === 'this_week' ? 'Minggu ini' : 'Minggu lalu'} (${s.slice(8)}/${s.slice(5, 7)}–${addDays(monday, 6).toISOString().slice(8, 10)}/${addDays(monday, 6).toISOString().slice(5, 7)})`, s, e);
    }
    case 'custom': {
      if (!custom) throw new Error('Periode custom butuh tanggal');
      const e = addDays(new Date(custom.to + 'T00:00:00Z'), 1).toISOString().slice(0, 10);
      return build(key, `${custom.from} s/d ${custom.to}`, custom.from, e);
    }
  }
}

const BLN = BULAN.map((b) => b.slice(0, 3));
function rangeLabel(startDate: string, endDate: string) {
  const [y1, m1, d1] = startDate.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = endDate.split('-').map(Number) as [number, number, number];
  if (y1 === y2 && m1 === m2) return d1 === d2 ? `${d1} ${BULAN[m1 - 1]} ${y1}` : `${d1}–${d2} ${BULAN[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${BLN[m1 - 1]}–${d2} ${BLN[m2 - 1]} ${y1}`;
  return `${d1} ${BLN[m1 - 1]} ${y1}–${d2} ${BLN[m2 - 1]} ${y2}`;
}

/**
 * Periode pembanding. Bulan/kuartal/tahun → periode kalender sebelumnya. Bila periode sedang berjalan,
 * pembandingnya dipotong sepanjang hari yang sudah lewat (1–7 Okt dibanding 1–7 Sep), supaya adil.
 */
export function previousPeriod(p: Period, now = new Date()): Period {
  const [y, m] = p.startDate.split('-').map(Number) as [number, number];
  let full: Period;
  if (p.key === 'this_month' || p.key === 'last_month') {
    const [py, pm] = addMonths(y, m, -1);
    full = build('custom', `${BULAN[pm - 1]} ${py}`, ymd(py, pm, 1), p.startDate);
  } else if (p.key === 'this_quarter' || p.key === 'last_quarter') {
    const [py, pm] = addMonths(y, m, -3);
    full = build('custom', `Kuartal ${Math.floor((pm - 1) / 3) + 1} ${py}`, ymd(py, pm, 1), p.startDate);
  } else if (p.key === 'this_year') {
    full = build('custom', `Tahun ${y - 1}`, ymd(y - 1, 1, 1), p.startDate);
  } else {
    const len = p.end.getTime() - p.start.getTime();
    const s = wibDateString(new Date(p.start.getTime() - len));
    full = build('custom', 'periode sebelumnya', s, p.startDate);
    full.label = rangeLabel(full.startDate, full.endDate);
    return full;
  }
  if (now >= p.start && now < p.end) {
    const elapsedDays = Math.round((wibAt(wibDateString(now), '00:00').getTime() - p.start.getTime()) / 86_400_000) + 1;
    const endEx = addDays(new Date(full.startDate + 'T00:00:00Z'), elapsedDays).toISOString().slice(0, 10);
    const fullEndEx = wibDateString(full.end);
    const cut = build('custom', '', full.startDate, endEx < fullEndEx ? endEx : fullEndEx);
    cut.label = rangeLabel(cut.startDate, cut.endDate);
    return cut;
  }
  return full;
}

export interface Scope {
  pipelineId?: string | null;
  ownerIds?: string[] | null; // null = semua
}

const omzetExpr = sql<number>`coalesce(${leads.dealValue}, ${leads.estimatedValue}, ${leads.budget}, 0)`;

function leadScope(s: Scope): SQL | undefined {
  const c: SQL[] = [];
  if (s.pipelineId) c.push(eq(leads.pipelineId, s.pipelineId));
  if (s.ownerIds) c.push(s.ownerIds.length ? inArray(leads.ownerId, s.ownerIds) : sql`false`);
  return c.length ? and(...c) : undefined;
}

const num = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

async function wonInPeriod(ctx: Ctx, p: Period, s: Scope) {
  return ctx.db
    .select({ id: leads.id, ownerId: leads.ownerId, pipelineId: leads.pipelineId, sourceId: leads.sourceId, value: omzetExpr, dp: leads.dpAmount })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(stages.kind, 'won'), gte(leads.closedAt, p.start), lt(leads.closedAt, p.end), leadScope(s)));
}

async function teamTarget(ctx: Ctx, months: string[]): Promise<number> {
  if (!months.length) return 0;
  const rows = await ctx.db
    .select({ amount: targets.amount })
    .from(targets)
    .where(and(inArray(targets.period, months), eq(targets.scope, 'team')));
  return rows.reduce((a, r) => a + num(r.amount), 0);
}

async function salesTargets(ctx: Ctx, months: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!months.length) return m;
  const rows = await ctx.db.select().from(targets).where(and(inArray(targets.period, months), sql`${targets.scope} <> 'team'`));
  for (const r of rows) m.set(r.scope, (m.get(r.scope) ?? 0) + num(r.amount));
  return m;
}

/** Waktu respons sales setelah serah terima AI (menit jam kerja), per percakapan. */
async function responseTimes(ctx: Ctx, p: Period, s: Scope) {
  const wh = await getSetting<WorkingHours>(ctx.db, 'working_hours');
  const conds: SQL[] = [isNotNull(conversations.handoffAt), gte(conversations.handoffAt, p.start), lt(conversations.handoffAt, p.end)];
  if (s.ownerIds) conds.push(s.ownerIds.length ? inArray(conversations.assigneeId, s.ownerIds) : sql`false`);
  const rows = await ctx.db
    .select({
      ownerId: conversations.assigneeId,
      handoffAt: conversations.handoffAt,
      // epoch ms — string timestamptz mentah dari pg ("…+00") tidak selalu terbaca oleh new Date().
      firstReplyMs: sql<number | null>`(select extract(epoch from min(m.created_at)) * 1000 from messages m where m.conversation_id = "conversations"."id" and m.sender_type = 'user' and m.created_at >= "conversations"."handoff_at")`,
    })
    .from(conversations)
    .where(and(...conds));
  const now = new Date();
  return rows.map((r) => {
    const reply = r.firstReplyMs !== null && r.firstReplyMs !== undefined ? new Date(Number(r.firstReplyMs)) : null;
    return { ownerId: r.ownerId, minutes: workingMinutesBetween(r.handoffAt!, reply ?? now, wh), answered: !!reply };
  });
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

// ---------------------------------------------------------------- Ringkasan

export async function summary(ctx: Ctx, p: Period, s: Scope) {
  const db = ctx.db;
  const prev = previousPeriod(p);

  const leadIn = async (pp: Period) => {
    const conds: SQL[] = [gte(conversations.createdAt, pp.start), lt(conversations.createdAt, pp.end)];
    if (s.ownerIds) conds.push(s.ownerIds.length ? inArray(conversations.assigneeId, s.ownerIds) : sql`false`);
    return num((await db.select({ n: count() }).from(conversations).where(and(...conds)))[0]?.n);
  };
  const created = async (pp: Period) => (await db.select({ n: count(), won: wonOfCreated() }).from(leads).where(and(gte(leads.createdAt, pp.start), lt(leads.createdAt, pp.end), leadScope(s))))[0];

  const [inNow, inPrev, crNowRow, crPrevRow, wonNow, wonPrev] = await Promise.all([leadIn(p), leadIn(prev), created(p), created(prev), wonInPeriod(ctx, p, s), wonInPeriod(ctx, prev, s)]);
  const crNow = num(crNowRow?.n);
  const crPrev = num(crPrevRow?.n);
  const omzet = wonNow.reduce((a, w) => a + num(w.value), 0);
  const omzetPrev = wonPrev.reduce((a, w) => a + num(w.value), 0);
  const target = await teamTarget(ctx, p.months);
  const resp = await responseTimes(ctx, p, s);
  const kpi = await getSetting<{ responseMinutes: number; responseIdeal: number }>(db, 'kpi_targets');

  // Per pipeline
  const pipes = await db.select().from(pipelines).where(eq(pipelines.active, true)).orderBy(asc(pipelines.sortOrder));
  const perPipe = await Promise.all(
    pipes
      .filter((pp) => !s.pipelineId || pp.id === s.pipelineId)
      .map(async (pp) => {
        const sc = { ...s, pipelineId: pp.id };
        const crRow = (await db.select({ n: count(), won: wonOfCreated() }).from(leads).where(and(gte(leads.createdAt, p.start), lt(leads.createdAt, p.end), leadScope(sc))))[0];
        const cr = num(crRow?.n);
        const won = wonNow.filter((w) => w.pipelineId === pp.id);
        const lost = num(
          (
            await db
              .select({ n: count() })
              .from(leads)
              .innerJoin(stages, eq(stages.id, leads.stageId))
              .where(and(eq(stages.kind, 'lost'), gte(leads.closedAt, p.start), lt(leads.closedAt, p.end), leadScope(sc)))
          )[0]?.n,
        );
        const omz = won.reduce((a, w) => a + num(w.value), 0);
        const tgt = Math.round((target * pp.targetShare) / 100);
        return { id: pp.id, name: pp.name, color: pp.color, targetShare: pp.targetShare, created: cr, won: won.length, lost, conversion: pct(num(crRow?.won), cr), omzet: omz, target: tgt, targetPct: pct(omz, tgt) };
      }),
  );

  // Peluang yang sedang dikejar (posisi hari ini)
  const yearEnd = `${wibDateString(new Date()).slice(0, 4)}-12-31`;
  const active = await db
    .select({ pipelineId: leads.pipelineId, n: count(), thisYear: sql<number>`count(*) filter (where coalesce(${leads.expectedDpMonth}, ${leads.eventDate}) <= ${yearEnd})` })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(stages.kind, 'open'), leadScope(s)))
    .groupBy(leads.pipelineId);

  return {
    period: { label: p.label, start: p.startDate, end: p.endDate, prevLabel: prev.label },
    kpi: {
      leadIn: inNow,
      leadInPrev: inPrev,
      created: crNow,
      createdPrev: crPrev,
      createdPctOfLeadIn: pct(crNow, inNow),
      closings: wonNow.length,
      closingsPrev: wonPrev.length,
      omzet,
      omzetPrev,
      target,
      targetPct: pct(omzet, target),
      conversion: pct(num(crNowRow?.won), crNow),
      conversionPrev: pct(num(crPrevRow?.won), crPrev),
      responseAvg: avg(resp.filter((r) => r.answered).map((r) => r.minutes)),
      responseTarget: kpi.responseMinutes,
      responseIdeal: kpi.responseIdeal,
      dpTotal: wonNow.reduce((a, w) => a + num(w.dp), 0),
    },
    pipelines: perPipe,
    active: pipes
      .filter((pp) => !s.pipelineId || pp.id === s.pipelineId)
      .map((pp) => {
        const a = active.find((x) => x.pipelineId === pp.id);
        return { id: pp.id, name: pp.name, color: pp.color, active: num(a?.n), thisYear: num(a?.thisYear) };
      }),
  };
}

/** Lead dibuat per bulan, 12 bulan terakhir vs tahun sebelumnya. */
export async function trend(ctx: Ctx, s: Scope, now = new Date()) {
  const today = wibDateString(now);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const months: { key: string; label: string; prevKey: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const [ty, tm] = addMonths(y, m, -i);
    months.push({ key: `${ty}-${String(tm).padStart(2, '0')}`, label: BULAN[tm - 1]!.slice(0, 3), prevKey: `${ty - 1}-${String(tm).padStart(2, '0')}` });
  }
  const from = wibAt(`${months[0]!.prevKey}-01`, '00:00');
  const rows = await ctx.db
    .select({ month: sql<string>`to_char(${leads.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM')`, n: count() })
    .from(leads)
    .where(and(gte(leads.createdAt, from), leadScope(s)))
    .groupBy(sql`1`);
  const by = new Map(rows.map((r) => [r.month, num(r.n)]));
  return months.map((mo) => ({ month: mo.key, label: mo.label, current: by.get(mo.key) ?? 0, previous: by.get(mo.prevKey) ?? 0 }));
}

// ---------------------------------------------------------------- Sales

export async function salesView(ctx: Ctx, p: Period, s: Scope) {
  const db = ctx.db;
  const pipeList = await db.select().from(pipelines).orderBy(asc(pipelines.sortOrder));

  // Funnel: lead yang dibuat dalam periode, sampai tahap mana mereka pernah masuk.
  const cohort = await db
    .select({ id: leads.id, pipelineId: leads.pipelineId })
    .from(leads)
    .where(and(gte(leads.createdAt, p.start), lt(leads.createdAt, p.end), leadScope(s)));
  const ids = cohort.map((c) => c.id);
  const reached = ids.length
    ? await db
        .select({ leadId: leadStageHistory.leadId, name: stages.name, kind: stages.kind, sortOrder: stages.sortOrder })
        .from(leadStageHistory)
        .innerJoin(stages, eq(stages.id, leadStageHistory.stageId))
        .where(inArray(leadStageHistory.leadId, ids))
    : [];
  const byLead = new Map<string, { names: Set<string>; maxOpen: number; won: boolean }>();
  for (const r of reached) {
    const e = byLead.get(r.leadId) ?? { names: new Set(), maxOpen: 0, won: false };
    e.names.add(r.name.toLowerCase());
    if (r.kind === 'open') e.maxOpen = Math.max(e.maxOpen, r.sortOrder);
    if (r.kind === 'won') e.won = true;
    byLead.set(r.leadId, e);
  }
  const all = [...byLead.values()];
  const steps: { name: string; n: number }[] = [];
  const selected = s.pipelineId ? pipeList.find((x) => x.id === s.pipelineId) : null;
  if (selected) {
    const st = (await db.select().from(stages).where(eq(stages.pipelineId, selected.id)).orderBy(asc(stages.sortOrder))).filter((x) => x.kind !== 'lost');
    const firstWon = st.find((x) => x.kind === 'won');
    for (const stage of st) {
      if (stage.kind === 'won' && stage.id !== firstWon?.id) continue;
      const n = stage.kind === 'won' ? all.filter((e) => e.won).length : all.filter((e) => e.won || e.maxOpen >= stage.sortOrder).length;
      steps.push({ name: stage.kind === 'won' ? 'Closing (DP)' : stage.name, n: stage.sortOrder === 0 ? cohort.length : n });
    }
  } else {
    steps.push({ name: 'Lead baru', n: cohort.length });
    steps.push({ name: 'Dikontak (lewat tahap pertama)', n: all.filter((e) => e.won || e.maxOpen >= 1).length });
    steps.push({ name: 'Proposal', n: all.filter((e) => e.won || e.names.has('proposal')).length });
    steps.push({ name: 'Closing (DP)', n: all.filter((e) => e.won).length });
  }
  const funnel = steps.map((st, i) => ({ ...st, dropPct: i === 0 || !steps[i - 1]!.n ? null : Math.round((1 - st.n / steps[i - 1]!.n) * 100) }));

  // Peluang mandek > 14 hari
  const staleRows = await db
    .select({ stage: stages.name, n: count(), value: sql<number>`coalesce(sum(${omzetExpr}),0)` })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(stages.kind, 'open'), lt(leads.lastActivityAt, addDays(new Date(), -14)), leadScope(s)))
    .groupBy(stages.name, stages.sortOrder)
    .orderBy(asc(stages.sortOrder));

  // Leaderboard
  const people = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(inArray(users.role, ['sales', 'spv']), s.ownerIds ? (s.ownerIds.length ? inArray(users.id, s.ownerIds) : sql`false`) : undefined));
  const created = await db
    .select({ ownerId: leads.ownerId, n: count(), won: wonOfCreated() })
    .from(leads)
    .where(and(gte(leads.createdAt, p.start), lt(leads.createdAt, p.end), leadScope(s)))
    .groupBy(leads.ownerId);
  const yearEnd = `${wibDateString(new Date()).slice(0, 4)}-12-31`;
  const activeNow = await db
    .select({ ownerId: leads.ownerId, n: count(), thisYear: sql<number>`count(*) filter (where coalesce(${leads.expectedDpMonth}, ${leads.eventDate}) <= ${yearEnd})` })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(stages.kind, 'open'), leadScope(s)))
    .groupBy(leads.ownerId);
  const props = await db
    .select({ ownerId: leads.ownerId, n: count() })
    .from(proposals)
    .innerJoin(leads, eq(leads.id, proposals.leadId))
    .where(and(eq(proposals.status, 'sent'), gte(proposals.createdAt, p.start), lt(proposals.createdAt, p.end), leadScope(s)))
    .groupBy(leads.ownerId);
  const won = await wonInPeriod(ctx, p, s);
  const tgts = await salesTargets(ctx, p.months);
  const resp = await responseTimes(ctx, p, s);
  const sla = await getSetting<SlaSettings>(db, 'sla');
  const lvl1 = Math.min(...sla.levels.map((l) => l.minutes));

  // Follow-up nyata: lead milik sales yang aktif di periode & menerima ≥1 pesan dari sales di periode.
  const fu = await db
    .select({
      ownerId: leads.ownerId,
      total: count(),
      followed: sql<number>`count(*) filter (where exists (select 1 from messages m join conversations c on c.id = m.conversation_id where c.contact_id = "leads"."contact_id" and m.sender_type = 'user' and m.created_at >= ${p.start.toISOString()}::timestamptz and m.created_at < ${p.end.toISOString()}::timestamptz))`,
    })
    .from(leads)
    .where(and(lt(leads.createdAt, p.end), or(isNull(leads.closedAt), gte(leads.closedAt, p.start)), leadScope(s)))
    .groupBy(leads.ownerId);

  const leaderboard = people
    .map((u) => {
      const w = won.filter((x) => x.ownerId === u.id);
      const omz = w.reduce((a, x) => a + num(x.value), 0);
      const tgt = tgts.get(u.id) ?? 0;
      const r = resp.filter((x) => x.ownerId === u.id);
      const answered = r.filter((x) => x.answered);
      const f = fu.find((x) => x.ownerId === u.id);
      const cr = created.find((x) => x.ownerId === u.id);
      const leadsN = num(cr?.n);
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        leads: leadsN,
        active: num(activeNow.find((x) => x.ownerId === u.id)?.n),
        thisYear: num(activeNow.find((x) => x.ownerId === u.id)?.thisYear),
        proposals: num(props.find((x) => x.ownerId === u.id)?.n),
        closings: w.length,
        omzet: omz,
        target: tgt,
        targetPct: pct(omz, tgt),
        conversion: pct(num(cr?.won), leadsN),
        slaPct: pct(r.filter((x) => x.answered && x.minutes <= lvl1).length, r.length),
        responseAvg: avg(answered.map((x) => x.minutes)),
        followUpPct: pct(num(f?.followed), num(f?.total)),
      };
    })
    .sort((a, b) => b.omzet - a.omzet || b.closings - a.closings);

  return { funnel, stale: staleRows.map((x) => ({ stage: x.stage, n: num(x.n), value: num(x.value) })), leaderboard, lost: await lostReasons(ctx, p, s), slaLevel1: lvl1 };
}

export async function lostReasons(ctx: Ctx, p: Period, s: Scope) {
  const rows = await ctx.db
    .select({
      reason: leads.lostReason,
      n: count(),
      abandoned: sql<number>`count(*) filter (where ${leads.lostKind} = 'Abandoned')`,
    })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(stages.kind, 'lost'), gte(leads.closedAt, p.start), lt(leads.closedAt, p.end), leadScope(s)))
    .groupBy(leads.lostReason);
  const total = rows.reduce((a, r) => a + num(r.n), 0);
  return rows
    .map((r) => ({ reason: r.reason ?? 'Tanpa alasan', n: num(r.n), abandoned: num(r.abandoned), pct: pct(num(r.n), total) }))
    .sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------- Marketing

export async function marketingView(ctx: Ctx, p: Period, s: Scope) {
  const db = ctx.db;
  const srcs = await db.select().from(leadSources).orderBy(asc(leadSources.sortOrder));
  const created = await db
    .select({ sourceId: leads.sourceId, n: count(), won: wonOfCreated() })
    .from(leads)
    .where(and(gte(leads.createdAt, p.start), lt(leads.createdAt, p.end), leadScope(s)))
    .groupBy(leads.sourceId);
  const won = await wonInPeriod(ctx, p, s);
  const total = created.reduce((a, r) => a + num(r.n), 0);
  // Biaya hanya untuk kanal berbayar yang tercatat: iklan Meta & broadcast WhatsApp.
  const { channelCosts } = await import('./marketing.js');
  const costs = s.ownerIds ? { IGADS: 0, BC: 0 } : await channelCosts(ctx, p.start, p.end);
  const rows = [...srcs.map((x) => ({ id: x.id as string | null, name: x.name })), { id: null, name: 'Tanpa sumber' }]
    .map((src) => {
      const cr = created.find((c) => c.sourceId === src.id);
      const n = num(cr?.n);
      const w = won.filter((x) => x.sourceId === src.id);
      const ref = srcs.find((x) => x.id === src.id)?.refCode ?? '';
      const cost = ref in costs ? costs[ref as keyof typeof costs] : null;
      return { id: src.id, name: src.name, leads: n, share: pct(n, total), closings: w.length, conversion: pct(num(cr?.won), n), omzet: w.reduce((a, x) => a + num(x.value), 0), cost: cost || null, costPerLead: cost && n ? Math.round(cost / n) : null };
    })
    .filter((r) => r.leads || r.closings)
    .sort((a, b) => b.leads - a.leads);
  return { sources: rows, totalLeads: total };
}

// ---------------------------------------------------------------- Target

export async function targetRealization(ctx: Ctx, month: string) {
  const p = build('custom', month, `${month}-01`, (() => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const [ny, nm] = addMonths(y, m, 1);
    return ymd(ny, nm, 1);
  })());
  const won = await wonInPeriod(ctx, p, {});
  const byOwner = new Map<string, number>();
  for (const w of won) if (w.ownerId) byOwner.set(w.ownerId, (byOwner.get(w.ownerId) ?? 0) + num(w.value));
  return { team: won.reduce((a, w) => a + num(w.value), 0), byOwner };
}

// ---------------------------------------------------------------- Kalibrasi skor

/** Closing rate per rentang skor — dasar mengkalibrasi ambang Hot/Warm (Fase 2 §6 langkah 3). */
export async function scoreCalibration(ctx: Ctx, sinceDays = 180) {
  const rows = await ctx.db
    .select({ score: leads.score, kind: stages.kind })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(gte(leads.createdAt, addDays(new Date(), -sinceDays)), inArray(stages.kind, ['won', 'lost'])));
  const bands = [
    [0, 20],
    [20, 40],
    [40, 55],
    [55, 70],
    [70, 85],
    [85, 101],
  ] as const;
  return {
    closedLeads: rows.length,
    bands: bands.map(([lo, hi]) => {
      const inBand = rows.filter((r) => r.score >= lo && r.score < hi);
      const w = inBand.filter((r) => r.kind === 'won').length;
      return { range: `${lo}–${Math.min(hi, 100)}`, leads: inBand.length, won: w, closingRate: pct(w, inBand.length) };
    }),
  };
}


/** Peluang terbuka saat ini: jumlah & nilai (posisi hari ini, tidak terpengaruh periode). */
export async function openPipeline(ctx: Ctx, s: Scope) {
  const [r] = await ctx.db
    .select({ n: count(), value: sql<number>`coalesce(sum(${omzetExpr}),0)` })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(stages.kind, 'open'), leadScope(s)));
  return { n: num(r?.n), value: num(r?.value) };
}
