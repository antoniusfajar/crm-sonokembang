import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { contacts, conversations, leads, messages, pipelines, stages, targets, users } from '../src/db/schema.js';
import { createLead, moveStage } from '../src/services/leads.js';
import { resolvePeriod, previousPeriod, summary, salesView, marketingView, scoreCalibration } from '../src/services/analytics.js';
import { hashPassword } from '../src/lib/password.js';

let t: Awaited<ReturnType<typeof setup>>;

describe('periode', () => {
  it('bulan, kuartal, minggu dalam WIB', () => {
    const now = new Date('2026-10-07T03:00:00Z'); // 7 Okt 10.00 WIB
    const m = resolvePeriod('this_month', now);
    expect([m.startDate, m.endDate, m.label]).toEqual(['2026-10-01', '2026-10-31', 'Oktober 2026']);
    expect(m.start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    const lm = resolvePeriod('last_month', now);
    expect([lm.startDate, lm.endDate]).toEqual(['2026-09-01', '2026-09-30']);
    expect(previousPeriod(m, now).startDate).toBe('2026-09-01');
    // Bulan berjalan dibanding hari yang sama di bulan lalu
    expect([previousPeriod(m, now).endDate, previousPeriod(m, now).label]).toEqual(['2026-09-07', '1–7 September 2026']);
    expect(previousPeriod(resolvePeriod('last_month', now), now).label).toBe('Agustus 2026');
    const yr = previousPeriod(resolvePeriod('this_year', now), now);
    expect([yr.startDate, yr.endDate]).toEqual(['2025-01-01', '2025-10-07']);
    const q = resolvePeriod('this_quarter', now);
    expect([q.startDate, q.endDate, q.months]).toEqual(['2026-10-01', '2026-12-31', ['2026-10', '2026-11', '2026-12']]);
    const w = resolvePeriod('this_week', now); // Rabu → Senin 5 Okt
    expect([w.startDate, w.endDate]).toEqual(['2026-10-05', '2026-10-11']);
    const jan = resolvePeriod('last_month', new Date('2026-01-10T03:00:00Z'));
    expect([jan.startDate, jan.endDate]).toEqual(['2025-12-01', '2025-12-31']);
  });
});

describe('angka dashboard', () => {
  let s1: string, s2: string;
  beforeAll(async () => {
    t = await setup();
    const pw = await hashPassword('x1234567890');
    [{ id: s1 }] = (await t.ctx.db.insert(users).values({ name: 'Dewi', email: 'd@t', role: 'sales', passwordHash: pw }).returning()) as any;
    [{ id: s2 }] = (await t.ctx.db.insert(users).values({ name: 'Bachtiar', email: 'b@t', role: 'sales', passwordHash: pw }).returning()) as any;
    const [wedding] = await t.ctx.db.select().from(pipelines).where(eq(pipelines.name, 'Wedding'));
    const st = await t.ctx.db.select().from(stages).where(eq(stages.pipelineId, wedding!.id));
    const won = st.find((x) => x.kind === 'won')!;
    const lost = st.find((x) => x.kind === 'lost')!;
    const proposal = st.find((x) => x.name === 'Proposal')!;
    // 4 lead Dewi, 2 lead Bachtiar; Dewi closing 2 (100 jt + 50 jt), 1 lost; Bachtiar closing 1 (30 jt)
    const mk = async (owner: string, i: number) => {
      const [c] = await t.ctx.db.insert(contacts).values({ waPhone: `62811000${owner === s1 ? 1 : 2}${i}00`, name: `C${i}` }).returning();
      return createLead(t.ctx, { contactId: c!.id, ownerId: owner, origin: 'manual', pipelineId: wedding!.id });
    };
    const d = [await mk(s1, 1), await mk(s1, 2), await mk(s1, 3), await mk(s1, 4)];
    const b = [await mk(s2, 1), await mk(s2, 2)];
    const skip = { skipRequirements: ['source_known', 'proposal_sent'] };
    await moveStage(t.ctx, d[0]!.id, { stageId: proposal.id }, s1, skip);
    await moveStage(t.ctx, d[0]!.id, { stageId: won.id, dpAmount: 30_000_000, dpProofPath: 'x.jpg', dealValue: 100_000_000 }, s1);
    await moveStage(t.ctx, d[1]!.id, { stageId: won.id, dpAmount: 10_000_000, dpProofPath: 'x.jpg', dealValue: 50_000_000 }, s1);
    await moveStage(t.ctx, d[2]!.id, { stageId: lost.id, lostKind: 'Lost', lostReason: 'Harga di atas budget' }, s1);
    await moveStage(t.ctx, b[0]!.id, { stageId: won.id, dpAmount: 5_000_000, dpProofPath: 'x.jpg', dealValue: 30_000_000 }, s2);
    await t.ctx.db.update(leads).set({ score: 80 }).where(eq(leads.id, d[0]!.id));
    const month = resolvePeriod('this_month').months[0]!;
    await t.ctx.db.insert(targets).values([
      { period: month, scope: 'team', amount: 360_000_000 },
      { period: month, scope: s1, amount: 200_000_000 },
      { period: month, scope: s2, amount: 100_000_000 },
    ]);
  });
  afterAll(async () => {
    await t.app.close();
    await t.pool.end();
  });

  it('ringkasan: peluang, closing, omzet, target, konversi', async () => {
    const r = await summary(t.ctx, resolvePeriod('this_month'), {});
    expect(r.kpi).toMatchObject({ created: 6, closings: 3, omzet: 180_000_000, target: 360_000_000, targetPct: 50, conversion: 50 });
    const wedding = r.pipelines.find((p) => p.name === 'Wedding')!;
    expect(wedding).toMatchObject({ created: 6, won: 3, lost: 1, omzet: 180_000_000, target: 216_000_000 });
    expect(r.active.find((a) => a.name === 'Wedding')!.active).toBe(2);
  });

  it('cakupan "milik sendiri" hanya menghitung data sales itu', async () => {
    const r = await summary(t.ctx, resolvePeriod('this_month'), { ownerIds: [s2] });
    expect(r.kpi).toMatchObject({ created: 2, closings: 1, omzet: 30_000_000 });
  });

  it('leaderboard, funnel, alasan lost', async () => {
    const r = await salesView(t.ctx, resolvePeriod('this_month'), {});
    const dewi = r.leaderboard.find((x) => x.name === 'Dewi')!;
    expect(dewi).toMatchObject({ leads: 4, closings: 2, omzet: 150_000_000, target: 200_000_000, targetPct: 75, conversion: 50, active: 1 });
    expect(r.leaderboard[0]!.name).toBe('Dewi');
    expect(r.funnel[0]).toMatchObject({ name: 'Lead baru', n: 6 });
    expect(r.funnel.at(-1)).toMatchObject({ name: 'Closing (DP)', n: 3 });
    expect(r.lost).toEqual([{ reason: 'Harga di atas budget', n: 1, abandoned: 0, pct: 100 }]);
  });

  it('waktu respons sales setelah serah terima AI (menit jam kerja)', async () => {
    const [c] = await t.ctx.db.insert(contacts).values({ waPhone: '6281100099900', name: 'Resp' }).returning();
    const handoff = new Date('2026-09-07T10:00:00+07:00'); // Senin
    const [cv] = await t.ctx.db.insert(conversations).values({ contactId: c!.id, assigneeId: s2, aiActive: false, handoffAt: handoff, createdAt: handoff }).returning();
    await t.ctx.db.insert(messages).values({ conversationId: cv!.id, direction: 'out', senderType: 'user', body: 'Halo', status: 'sent', createdAt: new Date('2026-09-07T10:12:00+07:00') });
    const p = resolvePeriod('custom', new Date(), { from: '2026-09-07', to: '2026-09-07' });
    const r = await salesView(t.ctx, p, {});
    expect(r.leaderboard.find((x) => x.name === 'Bachtiar')).toMatchObject({ responseAvg: 12, slaPct: 100 });
    const sm = await summary(t.ctx, p, {});
    expect(sm.kpi.responseAvg).toBe(12);
  });

  it('follow-up: hanya lead yang kontaknya dibalas sales di periode', async () => {
    const [l] = await t.ctx.db.select().from(leads).where(eq(leads.ownerId, s1)).limit(1);
    const [cv] = await t.ctx.db.insert(conversations).values({ contactId: l!.contactId, assigneeId: s1 }).returning();
    await t.ctx.db.insert(messages).values({ conversationId: cv!.id, direction: 'out', senderType: 'user', body: 'Follow up', status: 'sent' });
    const r = await salesView(t.ctx, resolvePeriod('this_month'), {});
    expect(r.leaderboard.find((x) => x.name === 'Dewi')!.followUpPct).toBe(25);
    expect(r.leaderboard.find((x) => x.name === 'Bachtiar')!.followUpPct).toBe(0);
  });

  it('marketing per sumber & kalibrasi skor', async () => {
    const m = await marketingView(t.ctx, resolvePeriod('this_month'), {});
    expect(m.totalLeads).toBe(6);
    expect(m.sources.find((s) => s.name === 'Tanpa sumber')).toMatchObject({ leads: 6, closings: 3 });
    const c = await scoreCalibration(t.ctx);
    expect(c.closedLeads).toBe(4);
    expect(c.bands.find((b) => b.range === '70–85')).toMatchObject({ leads: 1, won: 1, closingRate: 100 });
  });

  it('endpoint target: simpan & realisasi', async () => {
    const admin = await login(t.app, 'admin@test.local', 'adminpass123');
    const month = resolvePeriod('this_month').months[0]!;
    const res = await t.app.inject({ method: 'GET', url: `/api/targets?month=${month}`, headers: { cookie: admin.cookie } });
    const body = JSON.parse(res.body);
    expect(body.team).toBe(360_000_000);
    expect(body.teamRealized).toBe(180_000_000);
    expect(body.sales.find((x: any) => x.name === 'Dewi')).toMatchObject({ target: 200_000_000, realized: 150_000_000 });
    const put = await t.app.inject({ method: 'PUT', url: '/api/targets', payload: { month, team: 400_000_000, sales: [{ id: s1, target: 250_000_000 }] }, headers: { cookie: admin.cookie } });
    expect(put.statusCode).toBe(200);
    const sum = await t.app.inject({ method: 'GET', url: '/api/analytics/summary?period=this_month', headers: { cookie: admin.cookie } });
    expect(JSON.parse(sum.body).kpi.target).toBe(400_000_000);
  });
});
