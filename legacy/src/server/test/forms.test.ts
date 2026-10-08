import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { activities, contacts, formSubmissions, leads, leadSources } from '../src/db/schema.js';
import { handleInbound } from '../src/services/messaging.js';
import { setSetting, getSetting } from '../src/services/settings.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
const api = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: admin.cookie, ...headers } });
  const isJson = r.headers['content-type']?.toString().includes('json');
  return { status: r.statusCode, body: isJson ? JSON.parse(r.body) : r.body, headers: r.headers };
};
const pub = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers, remoteAddress: `10.0.0.${Math.floor(Math.random() * 200)}` });
  const isJson = r.headers['content-type']?.toString().includes('json');
  return { status: r.statusCode, body: isJson ? JSON.parse(r.body) : r.body, headers: r.headers };
};
let form: any;

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('form management', () => {
  it('buat dari contoh, aktifkan, halaman publik tampil', async () => {
    const c = await api('POST', '/api/forms', { preset: 'consultation' });
    expect(c.status).toBe(200);
    form = c.body;
    expect(form.slug).toBe('form-konsultasi');
    expect((await pub('GET', `/f/${form.slug}`)).status).toBe(404); // masih draf
    const u = await api('PUT', `/api/forms/${form.id}`, { ...form, status: 'active', settings: { ...form.settings, waTemplate: 'follow_up_umum' } });
    expect(u.status).toBe(200);
    const page = await pub('GET', `/f/${form.slug}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('Nomor WhatsApp');
    expect(page.body).toContain('name="_hp"');
  });

  it('validasi: lead wajib punya field nomor WA; isian wajib dicek', async () => {
    const bad = await api('POST', '/api/forms', { name: 'Tanpa nomor', purpose: 'lead', fields: [{ key: 'nama', label: 'Nama', type: 'text', required: true, mapTo: 'name' }] });
    expect(bad.status).toBe(400);
    const r = await pub('POST', `/api/public/forms/${form.slug}`, { answers: { nama: 'Ratna', acara: 'Wedding' } });
    expect(r.status).toBe(400);
    expect(r.body.details.errors.wa).toBeTruthy();
    expect(r.headers['access-control-allow-origin']).toBe('*');
  });

  it('kiriman → kontak + lead (sumber Website, data kualifikasi terisi) + WA otomatis; nomor sama digabung', async () => {
    const r = await pub('POST', `/api/public/forms/${form.slug}`, { answers: { nama: 'Ratna Sari', wa: '0812-3456-7890', acara: 'Wedding', tanggal: '2027-03-14', pax: '400', budget: '60.000.000', catatan: 'Prasmanan + gubuk' }, _page: 'https://sonokembangmalang.com/paket-wedding' });
    expect(r.status).toBe(200);
    const [c] = await t.ctx.db.select().from(contacts).where(eq(contacts.waPhone, '6281234567890'));
    expect(c!.name).toBe('Ratna Sari');
    const [l] = await t.ctx.db.select().from(leads).where(eq(leads.contactId, c!.id));
    expect(l).toMatchObject({ eventType: 'Wedding', eventDate: '2027-03-14', pax: 400, budget: 60_000_000 });
    const [web] = await t.ctx.db.select().from(leadSources).where(eq(leadSources.refCode, 'WEB'));
    expect(l!.sourceId).toBe(web!.id);
    expect(l!.score).toBeGreaterThan(50);
    const acts = await t.ctx.db.select().from(activities).where(eq(activities.leadId, l!.id));
    expect(acts.some((a) => a.note?.includes('Prasmanan + gubuk'))).toBe(true);
    expect(t.wa.sent.some((s) => s.to === '6281234567890' && s.body.startsWith('follow_up_umum(Ratna'))).toBe(true);

    await pub('POST', `/api/public/forms/${form.slug}`, { answers: { nama: 'Ratna', wa: '+62 812 3456 7890', acara: 'Lamaran' } });
    const all = await t.ctx.db.select().from(leads).where(eq(leads.contactId, c!.id));
    expect(all).toHaveLength(1); // digabung ke lead terbuka
    const subs = await t.ctx.db.select().from(formSubmissions).where(eq(formSubmissions.formId, form.id));
    expect(subs).toHaveLength(2);
    expect(subs.every((s) => s.leadId === l!.id)).toBe(true);
    const list = await api('GET', '/api/forms');
    expect(list.body.rows[0].stats).toMatchObject({ submissions: 2, leads: 1 });
  });

  it('honeypot: bot dianggap sukses tapi tidak disimpan', async () => {
    const r = await pub('POST', `/api/public/forms/${form.slug}`, { answers: { nama: 'Bot', wa: '081111111111', acara: 'Wedding' }, _hp: 'http://spam' });
    expect(r.status).toBe(200);
    const [c] = await t.ctx.db.select().from(contacts).where(eq(contacts.waPhone, '6281111111111'));
    expect(c).toBeUndefined();
  });

  it('ekspor CSV kiriman', async () => {
    const r = await api('GET', `/api/forms/${form.id}/export.csv`);
    expect(r.status).toBe(200);
    expect(String(r.body)).toContain('Nomor WhatsApp');
    expect(String(r.body)).toContain('0812-3456-7890'); // Admin melihat nomor
  });
});

describe('livechat widget', () => {
  it('nonaktif secara bawaan; aktif setelah diatur + hotline diisi', async () => {
    expect((await pub('GET', '/api/public/widget')).body).toEqual({ enabled: false });
    const w = await api('GET', '/api/widget');
    await api('PUT', '/api/widget', { ...w.body.config, enabled: true, allowedDomains: ['sonokembangmalang.com'] });
    const biz = await getSetting<any>(t.ctx.db, 'business_profile');
    await setSetting(t.ctx.db, 'business_profile', { ...biz, hotline: '0341-555-2130' });
    const ok = await pub('GET', '/api/public/widget', undefined, { origin: 'https://www.sonokembangmalang.com' });
    expect(ok.body).toMatchObject({ enabled: true, hotline: '623415552130', prechat: true });
    expect(ok.body.allowedDomains).toBeUndefined();
    expect((await pub('GET', '/api/public/widget', undefined, { origin: 'https://situs-lain.com' })).body.enabled).toBe(false);
    const js = await pub('GET', '/widget.js');
    expect(js.headers['content-type']).toContain('javascript');
    expect(w.body.embedCode).toContain('/widget.js');
  });

  it('form pra-chat → lead Website + link WA bertanda halaman; chat berikutnya menempel ke lead itu', async () => {
    const r = await pub('POST', '/api/public/widget/lead', { name: 'Budi Hartono', phone: '081299998888', eventType: 'Acara kantor / gathering', page: '/paket/kantor' });
    expect(r.status).toBe(200);
    expect(r.body.waUrl).toContain('https://wa.me/623415552130?text=');
    expect(decodeURIComponent(r.body.waUrl)).toContain('(WEB-widget-paket-kantor)');
    const [c] = await t.ctx.db.select().from(contacts).where(eq(contacts.waPhone, '6281299998888'));
    const before = await t.ctx.db.select().from(leads).where(eq(leads.contactId, c!.id));
    expect(before).toHaveLength(1);
    expect(before[0]!.originNote).toContain('Livechat widget');
    await handleInbound(t.ctx, { type: 'message', from: '6281299998888', waMessageId: 'w1', timestamp: new Date(), kind: 'text', text: decodeURIComponent(r.body.waUrl.split('text=')[1]) });
    const after = await t.ctx.db.select().from(leads).where(eq(leads.contactId, c!.id));
    expect(after).toHaveLength(1);
  });
});
