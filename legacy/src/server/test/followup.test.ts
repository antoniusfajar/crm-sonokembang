import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { conversations, leads, notifications, tasks, users, waTemplates } from '../src/db/schema.js';
import { runTaskDueReminders } from '../src/services/reminders.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
let adminId: string;
const api = async (method: string, url: string, payload?: unknown) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: admin.cookie } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

let leadId: string;
let convId: string;

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
  adminId = (await t.ctx.db.select().from(users).where(eq(users.email, 'admin@test.local')))[0]!.id;
  const r = await api('POST', '/api/simulator/inbound', { phone: '081299990001', name: 'Mbak Laras 💐', text: 'Halo mau tanya paket wedding' });
  convId = r.body.conversationId;
  const [conv] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, convId));
  leadId = (await t.ctx.db.select().from(leads).where(eq(leads.contactId, conv!.contactId)))[0]!.id;
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('test food terstruktur', () => {
  it('jadwal → catat hasil (menu, rating, keputusan); revisi menu membuat tugas revisi proposal', async () => {
    const s = await api('POST', `/api/leads/${leadId}/test-food`, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), place: 'Dapur', people: 3 });
    expect(s.status).toBe(200);
    const r = await api('PATCH', `/api/test-food/${s.body.id}`, { menus: ['Nasi liwet', 'Ayam bakar madu'], rating: 4, decision: 'revisi', note: 'Sambal kurang pedas' });
    expect(r.status).toBe(200);
    const lead = (await api('GET', `/api/leads/${leadId}`)).body;
    expect(lead.testFoods[0]).toMatchObject({ menus: ['Nasi liwet', 'Ayam bakar madu'], rating: 4, decision: 'revisi', result: 'Sambal kurang pedas' });
    expect(lead.activities.some((a: any) => a.title === 'Hasil test food dicatat' && a.note.includes('Revisi menu dulu'))).toBe(true);
    const tk = await t.ctx.db.select().from(tasks).where(and(eq(tasks.leadId, leadId), eq(tasks.title, 'Revisi proposal setelah test food')));
    expect(tk).toHaveLength(1);
    // Simpan ulang tidak membuat tugas ganda
    await api('PATCH', `/api/test-food/${s.body.id}`, { menus: [], decision: 'revisi' });
    expect(await t.ctx.db.select().from(tasks).where(and(eq(tasks.leadId, leadId), eq(tasks.title, 'Revisi proposal setelah test food')))).toHaveLength(1);
    // Mode "Catat hasil" langsung tanpa jadwal sebelumnya
    const direct = await api('POST', `/api/leads/${leadId}/test-food`, { scheduledAt: new Date().toISOString(), result: { menus: ['Soto'], rating: 5, decision: 'lanjut' } });
    expect(direct.status).toBe(200);
    expect((await api('PATCH', `/api/test-food/${s.body.id}`, { decision: 'nanti' })).status).toBe(400);
  });
});

describe('pengingat janji follow-up', () => {
  it('notifikasi 30 menit sebelum jatuh tempo, sekali saja; tugas otomatis harian tidak ikut', async () => {
    const now = new Date();
    const [manual] = await t.ctx.db.insert(tasks).values({ leadId, userId: adminId, title: 'Telepon Laras soal menu', dueAt: new Date(now.getTime() + 20 * 60_000) }).returning();
    await t.ctx.db.insert(tasks).values({ leadId, userId: adminId, title: 'Auto harian', dueAt: new Date(now.getTime() + 10 * 60_000), auto: true, ruleKey: 'x-auto' });
    await t.ctx.db.insert(tasks).values({ leadId, userId: adminId, title: 'Masih lama', dueAt: new Date(now.getTime() + 3 * 3_600_000) });
    expect(await runTaskDueReminders(t.ctx, now)).toBe(1);
    expect(await runTaskDueReminders(t.ctx, now)).toBe(0);
    const n = await t.ctx.db.select().from(notifications).where(eq(notifications.userId, adminId));
    const hit = n.filter((x) => x.text.includes('Telepon Laras soal menu'));
    expect(hit).toHaveLength(1);
    expect(hit[0]!.text).toMatch(/^20 menit lagi: Telepon Laras soal menu · Wedding_Laras|^20 menit lagi: Telepon Laras soal menu · /);
    const [after] = await t.ctx.db.select().from(tasks).where(eq(tasks.id, manual!.id));
    expect(after!.remindedAt).toBeTruthy();
    // aturan muncul di pengaturan & bisa dimatikan
    const rules = (await api('GET', '/api/settings/reminder_rules')).body;
    expect(rules.some((r: any) => r.key === 'task_due_soon')).toBe(true);
  });
});

describe('status kontak otomatis', () => {
  it('dihitung dari siklus lead dan bisa difilter', async () => {
    const all = (await api('GET', '/api/contacts')).body;
    const laras = all.rows.find((r: any) => r.name === 'Mbak Laras 💐');
    expect(laras.status).toBe('Lead aktif');
    expect(all.statusCounts['Lead aktif']).toBeGreaterThan(0);
    const f = (await api('GET', '/api/contacts?status=Pelanggan')).body;
    expect(f.rows.every((r: any) => r.status === 'Pelanggan')).toBe(true);
    // Lead ditandai Lost → kontak masuk segmen Lost / Abandoned
    const lead = (await api('GET', `/api/leads/${leadId}`)).body;
    const lostStage = lead.stages.find((s: any) => s.kind === 'lost');
    const mv = await api('POST', `/api/leads/${leadId}/stage`, { stageId: lostStage.id, lostKind: 'Lost', lostReason: 'Harga' });
    expect(mv.status).toBe(200);
    const lostList = (await api('GET', '/api/contacts?status=' + encodeURIComponent('Lost / Abandoned'))).body;
    expect(lostList.rows.some((r: any) => r.id === laras.id)).toBe(true);
  });
});

describe('template WA terisi otomatis', () => {
  it('variabel yang dipetakan terisi dari data CRM; Admin bisa mengubah peta', async () => {
    const [tpl] = await t.ctx.db.select().from(waTemplates).where(eq(waTemplates.name, 'follow_up_umum'));
    expect(tpl!.varMap).toEqual(['customer.firstName', 'sender.firstName']);
    let fill = (await api('GET', `/api/conversations/${convId}/template-fill/${tpl!.id}`)).body;
    expect(fill.params).toEqual(['Laras', 'Admin']);
    expect(fill.labels[0]).toBe('Nama depan customer');
    // Nama pemesan dari chat/sales lebih diutamakan daripada nama profil WA
    await t.ctx.db.update(leads).set({ customerName: 'Larasati Putri', eventType: 'Wedding' }).where(eq(leads.id, leadId));
    expect((await api('PUT', `/api/wa-templates/${tpl!.id}/vars`, { varMap: ['customer.firstName', 'lead.eventType'] })).status).toBe(200);
    fill = (await api('GET', `/api/conversations/${convId}/template-fill/${tpl!.id}`)).body;
    expect(fill.params).toEqual(['Larasati', 'Wedding']);
    // Kunci tidak dikenal disimpan sebagai manual
    const bad = await api('PUT', `/api/wa-templates/${tpl!.id}/vars`, { varMap: ['customer.firstName', 'hack.me'] });
    expect(bad.body.varMap).toEqual(['customer.firstName', '']);
  });
});
