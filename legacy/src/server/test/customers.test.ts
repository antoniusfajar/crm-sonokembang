import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { contacts, leads, pipelines, stages, tasks, users } from '../src/db/schema.js';
import { createLead, moveStage } from '../src/services/leads.js';
import { hashPassword } from '../src/lib/password.js';
import { wibDateString } from '../src/lib/time.js';

let t: Awaited<ReturnType<typeof setup>>;
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

describe('pelanggan & repeat order', () => {
  let dewi: string, bachtiar: string, cB: string;
  beforeAll(async () => {
    t = await setup();
    const pw = await hashPassword('sales12345');
    [{ id: dewi }] = (await t.ctx.db.insert(users).values({ name: 'Dewi', email: 'dewi@t', role: 'sales', passwordHash: pw }).returning()) as any;
    [{ id: bachtiar }] = (await t.ctx.db.insert(users).values({ name: 'Bachtiar', email: 'bach@t', role: 'sales', passwordHash: pw }).returning()) as any;
    await t.ctx.db.insert(users).values({ name: 'Rahman', email: 'spv@t', role: 'spv', passwordHash: pw });
    const pipes = await t.ctx.db.select().from(pipelines);
    const pid = (n: string) => pipes.find((p) => p.name === n)!.id;
    const allStages = await t.ctx.db.select().from(stages);
    const wonOf = (p: string) => allStages.find((s) => s.pipelineId === p && s.kind === 'won')!.id;

    const contact = async (phone: string, name: string, segment: any = null) => (await t.ctx.db.insert(contacts).values({ waPhone: phone, name, segment }).returning())[0]!.id;
    const order = async (contactId: string, owner: string, pipe: string, daysAgo: number, value: number, extra: Partial<typeof leads.$inferInsert> = {}) => {
      const l = await createLead(t.ctx, { contactId, ownerId: owner, origin: 'manual', pipelineId: pid(pipe) });
      await moveStage(t.ctx, l.id, { stageId: wonOf(pid(pipe)), dealValue: value }, owner, { skipRequirements: ['dp_proof', 'source_known', 'proposal_sent'] });
      await t.ctx.db.update(leads).set({ closedAt: ago(daysAgo), ...extra }).where(eq(leads.id, l.id));
    };

    const cA = await contact('6281200000001', 'Ibu Ratna');
    await order(cA, dewi, 'Non Wedding', 400, 10_000_000, { eventType: 'Aqiqah' });
    await order(cA, dewi, 'Non Wedding', 30, 15_000_000, { eventType: 'Ulang tahun' });
    cB = await contact('6281200000002', 'Keluarga Wulandari');
    await order(cB, dewi, 'Wedding', 380, 120_000_000, { eventType: 'Wedding', eventDate: wibDateString(new Date(Date.now() - 345 * DAY)) });
    const cC = await contact('6281200000003', 'PT Otsuka', 'Korporat');
    await order(cC, bachtiar, 'Non Wedding', 120, 20_000_000, { eventType: 'Rapat' });
    const cD = await contact('6281200000004', 'RS Panti Waluya', 'Korporat');
    await order(cD, bachtiar, 'Non Wedding', 200, 60_000_000);
    await createLead(t.ctx, { contactId: cD, ownerId: bachtiar, origin: 'manual', pipelineId: pid('Non Wedding') }); // sedang berjalan
  });
  afterAll(async () => {
    await t.app.close();
    await t.pool.end();
  });

  it('statistik, status, dan peluang berikutnya', async () => {
    const admin = await login(t.app, 'admin@test.local', 'adminpass123');
    const res = await t.app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: admin.cookie } });
    expect(res.statusCode).toBe(200);
    const b = JSON.parse(res.body);
    expect(b.stats).toMatchObject({ total: 4, dormant: 1, repeatRate: 33.3, avgOrder: 31_666_667, medianOrder: 20_000_000 });
    expect(b.rows.map((r: any) => r.name)).toEqual(['Ibu Ratna', 'PT Otsuka', 'RS Panti Waluya', 'Keluarga Wulandari']);
    const w = b.rows.find((r: any) => r.name === 'Keluarga Wulandari');
    expect(w).toMatchObject({ orders: 1, total: 120_000_000, status: 'Dorman', pic: 'Dewi' });
    expect(w.next).toMatch(/^Anniversary pernikahan/);
    expect(b.rows.find((r: any) => r.name === 'RS Panti Waluya').next).toMatch(/^Lead berjalan/);
    expect(b.rows.find((r: any) => r.name === 'Ibu Ratna')).toMatchObject({ orders: 2, total: 25_000_000, status: 'Aktif' });
    expect(b.rows[0].waPhone).toBeUndefined();

    const opp = Object.fromEntries(b.opportunities.map((o: any) => [o.key, o.customers.map((c: any) => c.name)]));
    expect(opp.anniversary).toEqual(['Keluarga Wulandari']);
    expect(opp.dormant_high).toEqual(['Keluarga Wulandari']);
    expect(opp.corporate_quiet).toEqual(['PT Otsuka']);
    expect(opp.cycle).toEqual([]);

    const f = await t.app.inject({ method: 'GET', url: '/api/customers?status=Dorman&q=wulan', headers: { cookie: admin.cookie } });
    expect(JSON.parse(f.body).rows.map((r: any) => r.name)).toEqual(['Keluarga Wulandari']);
    const r90 = await t.app.inject({ method: 'GET', url: '/api/customers?range=90', headers: { cookie: admin.cookie } });
    expect(JSON.parse(r90.body).total).toBe(1);
  });

  it('sales hanya melihat pelanggannya sendiri', async () => {
    const s = await login(t.app, 'bach@t', 'sales12345');
    const b = JSON.parse((await t.app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: s.cookie } })).body);
    expect(b.rows.map((r: any) => r.name).sort()).toEqual(['PT Otsuka', 'RS Panti Waluya']);
    expect((await t.app.inject({ method: 'GET', url: '/api/customers/export.csv', headers: { cookie: s.cookie } })).statusCode).toBe(403);
  });

  it('buat tugas repeat order ke PIC terakhir, tanpa dobel', async () => {
    const admin = await login(t.app, 'admin@test.local', 'adminpass123');
    const r1 = await t.app.inject({ method: 'POST', url: '/api/customers/opportunities/anniversary/tasks', headers: { cookie: admin.cookie } });
    expect(JSON.parse(r1.body)).toEqual({ created: 1, skipped: 0 });
    const r2 = await t.app.inject({ method: 'POST', url: '/api/customers/opportunities/anniversary/tasks', headers: { cookie: admin.cookie } });
    expect(JSON.parse(r2.body)).toEqual({ created: 0, skipped: 1 });
    const [lead] = await t.ctx.db.select().from(leads).where(eq(leads.contactId, cB));
    const tk = await t.ctx.db.select().from(tasks).where(and(eq(tasks.leadId, lead!.id), eq(tasks.kind, 'Repeat order')));
    expect(tk).toHaveLength(1);
    expect(tk[0]!.userId).toBe(dewi);
  });

  it('ekspor CSV: nomor telepon hanya untuk Admin', async () => {
    const admin = await login(t.app, 'admin@test.local', 'adminpass123');
    const a = await t.app.inject({ method: 'GET', url: '/api/customers/export.csv', headers: { cookie: admin.cookie } });
    expect(a.body.split('\n')[0]).toContain('No. WhatsApp');
    expect(a.body).toContain('6281200000002');
    const spv = await login(t.app, 'spv@t', 'sales12345');
    const s = await t.app.inject({ method: 'GET', url: '/api/customers/export.csv', headers: { cookie: spv.cookie } });
    expect(s.statusCode).toBe(200);
    expect(s.body).not.toContain('6281200000002');
    expect(s.body.split('\n')).toHaveLength(5);
  });
});
