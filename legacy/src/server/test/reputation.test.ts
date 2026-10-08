import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { contacts, leads, notifications, pipelines, reviews, stages, users } from '../src/db/schema.js';
import { createLead, moveStage } from '../src/services/leads.js';
import { hashPassword } from '../src/lib/password.js';
import { onNewReviews, runReviewRequests, runScheduledReplies } from '../src/services/reputation.js';
import { getSetting, setSetting } from '../src/services/settings.js';
import { wibDateString } from '../src/lib/time.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
const api = async (method: string, url: string, payload?: unknown) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: admin.cookie } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
  await t.ctx.db.insert(users).values({ name: 'Rahman', email: 'spv@t', role: 'spv', passwordHash: await hashPassword('x1234567890') });
  // AI tiruan aktif
  expect((await api('POST', '/api/ai/keys', { provider: 'anthropic', apiKey: 'sk-ant-test-1234567890', model: 'claude-haiku-4-5' })).status).toBe(200);
  const biz = await getSetting<any>(t.ctx.db, 'business_profile');
  await setSetting(t.ctx.db, 'business_profile', { ...biz, hotline: '0341-555-2130' });
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('reputasi', () => {
  it('ulasan baru ≤3★ → notifikasi SPV, balasan AI dijadwalkan 30 menit + ajakan hotline; lalu terbit', async () => {
    t.fake.next = (req) => ({ reply: req.messages[0]!.content.includes('Bintang: 2') ? 'Mohon maaf atas pengalaman kurang menyenangkan, Pak Budi. Masukan ini akan kami perbaiki.' : 'Terima kasih banyak, Bu Ratna!' });
    const [r1] = await t.ctx.db.insert(reviews).values({ provider: 'manual', externalId: 'x1', author: 'Budi Hartono', rating: 2, text: 'Admin WA lambat sekali', reviewedAt: new Date() }).returning();
    const [r2] = await t.ctx.db.insert(reviews).values({ provider: 'manual', externalId: 'x2', author: 'Ratna Sari', rating: 5, text: 'Masakannya enak', reviewedAt: new Date() }).returning();
    await onNewReviews(t.ctx, [r1!.id, r2!.id]);
    const [a] = await t.ctx.db.select().from(reviews).where(eq(reviews.id, r1!.id));
    expect(a).toMatchObject({ sentiment: 'negatif', replyStatus: 'scheduled' });
    expect(a!.replyText).toContain('0341-555-2130'); // ditambahkan script
    expect(a!.replyDueAt!.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    const n = await t.ctx.db.select().from(notifications);
    expect(n.some((x) => x.text.startsWith('Ulasan 2★ dari Budi Hartono'))).toBe(true);
    expect(n.some((x) => x.text.startsWith('Ulasan 5★'))).toBe(false);
    expect(await runScheduledReplies(t.ctx)).toBe(0); // belum 30 menit
    expect(await runScheduledReplies(t.ctx, new Date(Date.now() + 31 * 60_000))).toBe(2);
    const [after] = await t.ctx.db.select().from(reviews).where(eq(reviews.id, r1!.id));
    expect(after!.replyStatus).toBe('sent');
  });

  it('pagar pengaman: draf AI yang menyebut harga ditolak', async () => {
    t.fake.next = () => ({ reply: 'Terima kasih! Paket kami mulai Rp 85.000 per pax.' });
    const [r] = await t.ctx.db.insert(reviews).values({ provider: 'manual', externalId: 'x3', author: 'Citra', rating: 4, text: 'Bagus', reviewedAt: new Date() }).returning();
    const d = await api('POST', `/api/reputation/reviews/${r!.id}/draft`);
    expect(d.status).toBe(400);
    expect(d.body.error).toContain('pagar pengaman');
  });

  it('balas manual, batalkan jadwal AI, impor CSV, ringkasan', async () => {
    const add = await api('POST', '/api/reputation/reviews', { author: 'Dewi', rating: 3, text: 'Parkir sempit', reviewedAt: wibDateString(new Date()) });
    expect(add.status).toBe(200);
    expect((await api('POST', `/api/reputation/reviews/${add.body.id}/reply`, { text: 'Terima kasih masukannya, Bu Dewi.' })).status).toBe(200);
    const imp = await api('POST', '/api/reputation/reviews/import', { csv: 'nama,bintang,ulasan,tanggal,balasan\nAndi,5,Enak dan tepat waktu,2026-09-01,Terima kasih Pak\nSusi,1,Telat datang,2026-09-02,\nRusak,9,x,2026-09-03,' });
    expect(imp.body.added).toBe(2);
    const s = await api('GET', '/api/reputation/summary?days=90');
    expect(s.body.kpi.total).toBe(6);
    expect(s.body.dist.find((d: any) => d.stars === 5).n).toBe(2);
    expect(s.body.connected).toBe(false);
    const list = await api('GET', '/api/reputation/reviews?stars=1,2&status=unreplied');
    expect(list.body.map((r: any) => r.author)).toEqual(['Susi']);
    t.fake.next = () => ({ summary: 'Pelanggan memuji rasa dan ketepatan waktu.', good: ['Makanan enak', 'Tepat waktu'], bad: ['Admin lambat'] });
    const ai = await api('POST', '/api/reputation/summary/ai');
    expect(ai.body.good).toEqual(['Makanan enak', 'Tepat waktu']);
    expect((await api('GET', '/api/reputation/summary')).body.ai.text).toContain('memuji');
  });

  it('kompetitor maks 3 + analisa AI dari ulasan yang ditempel', async () => {
    for (const n of ['Niki Eco', 'Duta Catering', 'Lain']) expect((await api('POST', '/api/reputation/competitors', { name: n, rating: 4.5, reviewCount: 400 })).status).toBe(200);
    expect((await api('POST', '/api/reputation/competitors', { name: 'Keempat' })).status).toBe(400);
    const list = await api('GET', '/api/reputation/competitors');
    const c = list.body.list[0];
    expect((await api('POST', `/api/reputation/competitors/${c.id}/analyze`)).status).toBe(400); // belum ada bahan
    await api('PUT', `/api/reputation/competitors/${c.id}`, { ...c, notes: '[5★] Rasa enak, pengiriman tepat. [2★] Pesanan salah, admin tidak membalas. [4★] Menu bervariasi.' });
    t.fake.next = () => ({ strengths: ['Rasa enak'], weaknesses: ['Pesanan salah'], opportunities: ['Tonjolkan respons cepat'] });
    const a = await api('POST', `/api/reputation/competitors/${c.id}/analyze`);
    expect(a.body.weaknesses).toEqual(['Pesanan salah']);
    expect(list.body.self.reviewCount).toBe(6);
  });

  it('permintaan ulasan H+1 setelah acara, sekali per 90 hari, tidak untuk opt-out', async () => {
    await api('PUT', '/api/reputation/settings', { autoReply: true, notifyLow: true, delayMinutes: 30, hotlineOnNegative: true, request: { on: true, timing: 'h1', template: 'minta_ulasan_google', link: 'https://g.page/r/sonokembang/review', cooldownDays: 90 } });
    const [wedding] = await t.ctx.db.select().from(pipelines).where(eq(pipelines.name, 'Wedding'));
    const won = (await t.ctx.db.select().from(stages).where(eq(stages.pipelineId, wedding!.id))).find((s) => s.kind === 'won')!;
    const yesterday = wibDateString(new Date(Date.now() - 86_400_000));
    const mk = async (phone: string, name: string, extra: any = {}) => {
      const [c] = await t.ctx.db.insert(contacts).values({ waPhone: phone, name, ...extra }).returning();
      const l = await createLead(t.ctx, { contactId: c!.id, ownerId: null, origin: 'manual', pipelineId: wedding!.id });
      await moveStage(t.ctx, l.id, { stageId: won.id }, null, { skipRequirements: ['dp_proof', 'source_known', 'proposal_sent'] });
      await t.ctx.db.update(leads).set({ eventDate: yesterday }).where(eq(leads.id, l.id));
      return l.id;
    };
    const l1 = await mk('628555000001', 'Ratna Sari');
    await mk('628555000002', 'Stop Saja', { optOutAt: new Date() });
    const at = new Date(`${wibDateString(new Date())}T11:00:00+07:00`);
    expect(await runReviewRequests(t.ctx, at)).toBe(1);
    expect(t.wa.sent.some((s) => s.to === '628555000001' && s.body === 'minta_ulasan_google(Ratna, https://g.page/r/sonokembang/review)')).toBe(true);
    const [l] = await t.ctx.db.select().from(leads).where(eq(leads.id, l1));
    expect(l!.reviewRequestedAt).toBeTruthy();
    expect(await runReviewRequests(t.ctx, at)).toBe(0); // tidak dobel
  });
});
