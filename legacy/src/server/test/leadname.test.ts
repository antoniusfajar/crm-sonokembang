import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { contacts, leads, pipelines } from '../src/db/schema.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
const api = async (method: string, url: string, payload?: unknown) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: admin.cookie } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('nama lead otomatis', () => {
  it('format [pipeline]_[nama depan]_[tgl acara]_[lokasi], ikut berubah bila datanya berubah', async () => {
    const [wedding] = await t.ctx.db.select().from(pipelines).where(eq(pipelines.name, 'Wedding'));
    const c = await api('POST', '/api/leads', { phone: '081234560001', name: 'Bu ratna 🌸 Sari', pipelineId: wedding!.id });
    expect(c.status).toBe(200);
    const get = async () => (await api('GET', `/api/leads/${c.body.id}`)).body;
    // Belum ada tanggal & lokasi: bagian kosong dilewati, sapaan & emoji dibuang.
    expect((await get()).name).toBe('Wedding_Ratna');
    expect((await get()).contact.name).toBe('Bu ratna 🌸 Sari');

    await api('PATCH', `/api/leads/${c.body.id}`, { eventDate: '2026-12-12', location: 'Graha Cakra, Jl. Tlogomas Malang', expectedDpMonth: '2026-11' });
    let l = await get();
    expect(l.name).toBe('Wedding_Ratna_12 Des 2026_Graha Cakra');
    expect(l.expectedDpMonth).toBe('2026-11');

    // Nama pemesan dari chat/sales menggantikan nama depan; nama kontak WA tidak berubah.
    await api('PATCH', `/api/leads/${c.body.id}`, { customerName: 'Dewi Anggraini' });
    l = await get();
    expect(l.name).toBe('Wedding_Dewi_12 Des 2026_Graha Cakra');
    expect(l.contact.name).toBe('Bu ratna 🌸 Sari');

    // Pipeline diganti nama → nama lead ikut.
    await t.ctx.db.update(pipelines).set({ name: 'Pernikahan' }).where(eq(pipelines.id, wedding!.id));
    expect((await get()).name).toBe('Pernikahan_Dewi_12 Des 2026_Graha Cakra');
    await t.ctx.db.update(pipelines).set({ name: 'Wedding' }).where(eq(pipelines.id, wedding!.id));

    // Daftar lead: nama lead + nama kontak terpisah, bisa dicari pakai nama lead.
    const list = await api('GET', '/api/leads?q=Graha');
    const row = list.body.find((x: any) => x.id === c.body.id);
    expect(row).toMatchObject({ name: 'Wedding_Dewi_12 Des 2026_Graha Cakra', contactName: 'Bu ratna 🌸 Sari', expectedDpMonth: '2026-11' });
  });

  it('kontak tanpa nama WA memakai 4 digit terakhir nomor; berubah saat nama profil WA masuk', async () => {
    const c = await api('POST', '/api/leads', { phone: '081234569876' });
    const [l] = await t.ctx.db.select().from(leads).where(eq(leads.id, c.body.id));
    expect(l!.name).toMatch(/_Customer 9876$/);
    await t.ctx.db.update(contacts).set({ name: 'Andi Wijaya' }).where(eq(contacts.id, l!.contactId));
    const [l2] = await t.ctx.db.select().from(leads).where(eq(leads.id, c.body.id));
    expect(l2!.name).toMatch(/_Andi$/);
  });
});
