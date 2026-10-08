import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { contacts, notifications, pipelines, reports, reportSchedules, stages, users } from '../src/db/schema.js';
import { createLead, moveStage } from '../src/services/leads.js';
import { hashPassword } from '../src/lib/password.js';
import { lastDue, runDueSchedules } from '../src/services/reportSchedules.js';
import { pdfSafe } from '../src/services/reportFiles.js';
import type { MailAttachment } from '../src/services/channels.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
let adminId: string;
const api = async (who: { cookie: string }, method: string, url: string, payload?: unknown) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: who.cookie } });
  return { status: r.statusCode, body: r.headers['content-type']?.toString().includes('json') ? JSON.parse(r.body) : r.body, raw: r.rawPayload, headers: r.headers };
};
const sent: { to: string[]; subject: string; attachments?: MailAttachment[] }[] = [];

beforeAll(async () => {
  t = await setup();
  t.ctx.mail = { send: async (to, subject, _text, _html, attachments) => void sent.push({ to, subject, attachments }) };
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
  adminId = (await t.ctx.db.select().from(users).where(eq(users.email, 'admin@test.local')))[0]!.id;
  const pw = await hashPassword('sales12345');
  const [dewi] = await t.ctx.db.insert(users).values({ name: 'Dewi', email: 'dewi@t', role: 'sales', passwordHash: pw }).returning();
  const [wedding] = await t.ctx.db.select().from(pipelines).where(eq(pipelines.name, 'Wedding'));
  const won = (await t.ctx.db.select().from(stages).where(eq(stages.pipelineId, wedding!.id))).find((s) => s.kind === 'won')!;
  for (let i = 0; i < 3; i++) {
    const [c] = await t.ctx.db.insert(contacts).values({ waPhone: `62812300000${i}`, name: `C${i}` }).returning();
    const l = await createLead(t.ctx, { contactId: c!.id, ownerId: dewi!.id, origin: 'manual', pipelineId: wedding!.id });
    if (i < 2) await moveStage(t.ctx, l.id, { stageId: won.id, dealValue: 100_000_000 }, dewi!.id, { skipRequirements: ['dp_proof', 'source_known', 'proposal_sent'] });
  }
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('laporan AI', () => {
  it('tanpa API key: angka tetap dihitung, narasi ditulis sistem', async () => {
    const r = await api(admin, 'POST', '/api/reports', { type: 'exec', period: 'this_month', audience: 'dir', format: 'pdf' });
    expect(r.status).toBe(200);
    expect(r.body.aiUsed).toBe(false);
    expect(r.body.data.kpis).toHaveLength(4);
    expect(r.body.data.kpis[0]).toMatchObject({ label: 'Omzet', value: 'Rp 200 jt' });
    expect(r.body.narrative.summary).toContain('Omzet Rp 200 jt');
    expect(r.body.data.aiError).toMatch(/API key/);
  });

  it('dengan AI: narasi dari AI, angka dari script, gaya sesuai pembaca', async () => {
    expect((await api(admin, 'POST', '/api/ai/keys', { provider: 'anthropic', apiKey: 'sk-ant-test-1234567890', model: 'claude-haiku-4-5' })).status).toBe(200);
    t.fake.calls = [];
    t.fake.next = () => ({ summary: 'Omzet bulan ini Rp 200 jt → bagus 🎉', findings: ['A', 'B', 'C'], recommendations: ['X', 'Y', 'Z'] });
    const r = await api(admin, 'POST', '/api/reports', { type: 'team', period: 'this_month', audience: 'spv', format: 'pptx', notes: 'fokus ke respons' });
    expect(r.status).toBe(200);
    expect(r.body.aiUsed).toBe(true);
    expect(r.body.narrative.findings).toEqual(['A', 'B', 'C']);
    const call = t.fake.calls.at(-1)!;
    expect(call.model).toBe('claude-sonnet-5'); // model "pintar"
    expect(call.system).toContain('SPV');
    expect(call.system).toContain('fokus ke respons');
    expect(call.messages[0]!.content).toContain('200000000');
    expect(call.messages[0]!.content).not.toContain('628123'); // tidak ada nomor pelanggan
  });

  it('jawaban AI rusak → kembali ke narasi sistem', async () => {
    t.fake.next = () => ({ hello: 'x' });
    const r = await api(admin, 'POST', '/api/reports', { type: 'sales', period: 'this_month', audience: 'tim', format: 'pdf' });
    expect(r.body.aiUsed).toBe(false);
    expect(r.body.narrative.findings.length).toBeGreaterThan(0);
  });

  it('edit narasi, unduh PDF & PPTX, riwayat', async () => {
    const list = await api(admin, 'GET', '/api/reports');
    expect(list.body.length).toBeGreaterThanOrEqual(3);
    const id = list.body[0].id;
    const e = await api(admin, 'PATCH', `/api/reports/${id}`, { summary: 'Ringkasan baru → naik ≥ 10% 🚀', findings: ['Satu'], recommendations: ['Dua'] });
    expect(e.status).toBe(200);
    const pdf = await api(admin, 'GET', `/api/reports/${id}/file.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.raw.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.headers['content-disposition']).toContain('.pdf');
    const ppt = await api(admin, 'GET', `/api/reports/${id}/file.pptx`);
    expect(ppt.status).toBe(200);
    expect(ppt.raw.subarray(0, 2).toString()).toBe('PK');
    expect(pdfSafe('naik → ≥ 10% 🚀 “ok”')).toBe('naik -> >= 10%  “ok”');
  });

  it('laporan Reputasi & media sosial; sales tidak punya akses', async () => {
    t.fake.next = () => ({ hello: 'x' }); // narasi sistem
    const rep = await api(admin, 'POST', '/api/reports', { type: 'rep', period: 'this_month', audience: 'dir', format: 'pdf' });
    expect(rep.status).toBe(200);
    expect(rep.body.data.kpis.map((k: any) => k.label)).toEqual(['Rating periode ini', 'Ulasan baru', 'Belum dibalas', 'Impressions sosmed']);
    expect((await api(admin, 'GET', `/api/reports/${rep.body.id}/file.pdf`)).status).toBe(200);
    const s = await login(t.app, 'dewi@t', 'sales12345');
    expect((await api(s, 'GET', '/api/reports')).status).toBe(403);
  });
});

describe('laporan terjadwal', () => {
  it('jatuh tempo bulanan & mingguan (WIB)', () => {
    const now = new Date('2026-10-07T03:00:00Z'); // Rabu 7 Okt 10.00 WIB
    expect(lastDue({ frequency: 'monthly', dayOfMonth: 1, dayOfWeek: 1, time: '07:00' }, now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(lastDue({ frequency: 'monthly', dayOfMonth: 8, dayOfWeek: 1, time: '07:00' }, now).toISOString()).toBe('2026-09-08T00:00:00.000Z');
    expect(lastDue({ frequency: 'monthly', dayOfMonth: 31, dayOfWeek: 1, time: '07:00' }, new Date('2026-03-01T03:00:00Z')).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(lastDue({ frequency: 'weekly', dayOfMonth: 1, dayOfWeek: 1, time: '08:00' }, now).toISOString()).toBe('2026-10-05T01:00:00.000Z');
    expect(lastDue({ frequency: 'weekly', dayOfMonth: 1, dayOfWeek: 3, time: '11:00' }, now).toISOString()).toBe('2026-09-30T04:00:00.000Z');
  });

  it('dibuat sekali per siklus, dikirim ke penerima (notifikasi + email berlampiran)', async () => {
    t.fake.next = () => ({ summary: 'Ringkas', findings: ['A'], recommendations: ['B'] });
    const c = await api(admin, 'POST', '/api/report-schedules', { type: 'exec', audience: 'dir', format: 'pdf', frequency: 'monthly', dayOfMonth: 1, time: '07:00', recipientIds: [adminId] });
    expect(c.status).toBe(200);
    await t.ctx.db.update(reportSchedules).set({ createdAt: new Date(Date.now() - 60 * 86_400_000) }).where(eq(reportSchedules.id, c.body.id));
    expect(await runDueSchedules(t.ctx)).toBe(1);
    expect(await runDueSchedules(t.ctx)).toBe(0);
    const made = await t.ctx.db.select().from(reports).where(eq(reports.scheduleId, c.body.id));
    expect(made).toHaveLength(1);
    expect(made[0]!.periodLabel).not.toContain('Minggu');
    const n = await t.ctx.db.select().from(notifications).where(eq(notifications.userId, adminId));
    expect(n.some((x) => x.link === `/reports?id=${made[0]!.id}`)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(['admin@test.local']);
    expect(sent[0]!.attachments![0]!.filename).toMatch(/^ringkasan-direksi-.*\.pdf$/);
    expect(sent[0]!.attachments![0]!.content.subarray(0, 4).toString()).toBe('%PDF');
    const list = await api(admin, 'GET', '/api/report-schedules');
    expect(list.body[0]).toMatchObject({ title: 'Ringkasan direksi', when: 'Tiap tanggal 1 · 07.00', recipients: ['Admin'] });
  });
});
