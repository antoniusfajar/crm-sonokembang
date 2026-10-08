import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { runResponder } from '../src/ai/responder.js';
import { checkSla } from '../src/services/sla.js';
import { conversations, leads, pushSubscriptions, stages } from '../src/db/schema.js';
import { notify } from '../src/services/notify.js';
import { flushChannels, runDailyDigest } from '../src/services/channels.js';
import { runDueJobs } from '../src/services/jobs.js';
import { JOB_HANDLERS } from '../src/worker.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
let sales: { cookie: string; id: string };
let sales2: { cookie: string; id: string };

const api = async (who: { cookie: string }, method: string, url: string, payload?: unknown) => {
  const res = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: who.cookie } });
  return { status: res.statusCode, body: res.body ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : null };
};

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
  // Admin membuat dua sales
  const mk = async (name: string, email: string) => {
    const r = await api(admin, 'POST', '/api/users', { name, email, role: 'sales' });
    expect(r.status).toBe(200);
    const s = await login(t.app, email, r.body.tempPassword);
    await api(s, 'POST', '/api/auth/password', { current: r.body.tempPassword, next: 'passwordbaru1' });
    return { ...(await login(t.app, email, 'passwordbaru1')), id: r.body.id };
  };
  sales = await mk('Dewi', 'dewi@test.local');
  sales2 = await mk('Bachtiar', 'bachtiar@test.local');
  // Pasang API key AI (palsu) — diuji lewat adapter palsu
  const key = await api(admin, 'POST', '/api/ai/keys', { provider: 'anthropic', apiKey: 'sk-ant-test-1234567890', model: 'claude-haiku-4-5' });
  expect(key.status).toBe(200);
});

afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('auth & hak akses', () => {
  it('menolak tanpa login & kata sandi salah', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.local', password: 'x' } })).statusCode).toBe(401);
  });
  it('sales tidak bisa membuka pengaturan, admin bisa', async () => {
    expect((await api(sales, 'GET', '/api/users')).status).toBe(403);
    expect((await api(admin, 'GET', '/api/users')).status).toBe(200);
    const me = await api(sales, 'GET', '/api/me');
    const keys = me.body.menus.flatMap((g: any) => g.items.map((i: any) => i.key));
    expect(keys).toContain('inbox');
    expect(keys).not.toContain('setting');
  });
  it('webhook publik ditolak di mode simulasi', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/webhooks/whatsapp', payload: { entry: [] } });
    expect(res.statusCode).toBe(401);
  });
  it('API key tidak pernah dikirim balik utuh', async () => {
    const r = await api(admin, 'GET', '/api/ai/config');
    expect(JSON.stringify(r.body)).not.toContain('sk-ant-test-1234567890');
    expect(r.body.keys.anthropic.last4).toBe('••••7890');
  });
});

describe('alur chat → AI → serah terima → pipeline', () => {
  let convId: string;
  it('chat masuk membuat kontak, lead, dan assignee', async () => {
    const r = await api(admin, 'POST', '/api/simulator/inbound', { phone: '081233449021', name: 'Retno', text: 'Pagi, mau tanya resepsi pernikahan IGADS-wedding' });
    expect(r.status).toBe(200);
    convId = r.body.conversationId;
    const [conv] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv!.assigneeId).toBeTruthy();
    expect(conv!.aiActive).toBe(true);
  });

  it('AI membalas, mengisi data lead, lalu serah terima saat data lengkap', async () => {
    t.fake.next = () => ({
      reply: 'Baik Bu Retno, terima kasih infonya. Tim sales kami akan segera menghubungi.',
      extracted: { customer_name: 'Retno Wulandari', event_type: 'Wedding', event_date: '2026-12-12', event_date_text: null, location: 'Graha Cakrawala', pax: 800, budget_idr: 120_000_000 },
      wants_handoff: false,
      handoff_reason: null,
    });
    t.fake.calls = [];
    const out = await runResponder(t.ctx, convId);
    expect(out).toBe('handoff');
    expect(t.fake.calls.length).toBe(2); // responder + pagar lapis 2
    const [conv] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, convId));
    expect(conv!.aiActive).toBe(false);
    expect(conv!.handoffSummary).toContain('Pax: 800');
    const [lead] = await t.ctx.db.select().from(leads).where(eq(leads.contactId, conv!.contactId));
    expect(lead!.temperature).toBe('Hot');
    expect(lead!.aiFilled).toContain('pax');
    // Nomor HP tidak dikirim ke AI
    expect(JSON.stringify(t.fake.calls[0])).not.toContain('081233449021');
    expect(t.wa.sent.at(-1)?.body).toContain('Bu Retno');
  });

  it('balasan AI yang menyebut harga ditahan lapis 1', async () => {
    const r = await api(admin, 'POST', '/api/simulator/inbound', { phone: '085677814402', name: 'Dinda', text: 'Halo mau tanya wedding' });
    t.fake.next = () => ({ reply: 'Paket kami mulai Rp 85.000 per pax kak', extracted: {}, wants_handoff: false, handoff_reason: null });
    expect(await runResponder(t.ctx, r.body.conversationId)).toBe('handoff');
    const ov = await api(admin, 'GET', '/api/ai/overview');
    expect(ov.body.logs[0].reason).toContain('harga');
    expect(t.wa.sent.at(-1)?.body).not.toContain('85.000');
  });

  it('customer tanya harga → langsung ke sales tanpa memanggil AI', async () => {
    const r = await api(admin, 'POST', '/api/simulator/inbound', { phone: '087899037715', name: 'Sri', text: 'Untuk 150 orang berapa harganya?' });
    t.fake.calls = [];
    expect(await runResponder(t.ctx, r.body.conversationId)).toBe('handoff');
    expect(t.fake.calls.length).toBe(0);
  });

  it('pesan beruntun digabung jadi satu job balasan', async () => {
    await api(admin, 'POST', '/api/simulator/inbound', { phone: '081111111111', name: 'A', text: 'halo' });
    await api(admin, 'POST', '/api/simulator/inbound', { phone: '081111111111', name: 'A', text: 'mau tanya' });
    const rows = await t.ctx.db.execute(`select count(*)::int n from jobs where status='pending' and payload->>'conversationId' = (select c.id::text from conversations c join contacts ct on ct.id=c.contact_id where ct.wa_phone='6281111111111')` as any);
    expect((rows.rows[0] as any).n).toBe(1);
  });

  it('sales hanya melihat percakapan miliknya', async () => {
    const [conv] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, convId));
    const owner = conv!.assigneeId === sales.id ? sales : sales2;
    const other = owner === sales ? sales2 : sales;
    expect((await api(owner, 'GET', `/api/conversations/${convId}`)).status).toBe(200);
    expect((await api(other, 'GET', `/api/conversations/${convId}`)).status).toBe(403);
    const list = await api(other, 'GET', '/api/conversations');
    expect(list.body.find((c: any) => c.id === convId)).toBeUndefined();    // Menu Notifikasi & SLA juga hanya menampilkan miliknya sendiri.
    await notify(t.ctx, [owner.id], 'lead', 'Lead baru untuk pemilik', '/inbox');
    const before = { aiActive: conv!.aiActive, awaitingReplySince: conv!.awaitingReplySince };
    await t.ctx.db.update(conversations).set({ aiActive: false, awaitingReplySince: new Date() }).where(eq(conversations.id, convId));
    const mine = await api(owner, 'GET', '/api/notifications/team');
    const theirs = await api(other, 'GET', '/api/notifications/team');
    expect(mine.body.waiting.some((w: any) => w.id === convId)).toBe(true);
    expect(theirs.body.waiting.some((w: any) => w.id === convId)).toBe(false);
    expect(theirs.body.feed.some((f: any) => f.text === 'Lead baru untuk pemilik')).toBe(false);
    expect((await api(admin, 'GET', '/api/notifications/team')).body.waiting.some((w: any) => w.id === convId)).toBe(true);
    await t.ctx.db.update(conversations).set(before).where(eq(conversations.id, convId));
  });

  it('sales membalas, lalu syarat tahap ditegakkan', async () => {
    const [conv] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, convId));
    const owner = conv!.assigneeId === sales.id ? sales : sales2;
    const send = await api(owner, 'POST', `/api/conversations/${convId}/messages`, { body: 'Selamat pagi Bu, saya siapkan proposalnya ya' });
    expect(send.status).toBe(200);
    const [lead] = await t.ctx.db.select().from(leads).where(eq(leads.contactId, conv!.contactId));
    const pl = await api(owner, 'GET', '/api/pipelines');
    const p = pl.body.pipelines.find((x: any) => x.id === lead!.pipelineId);
    const lost = p.stages.find((s: any) => s.kind === 'lost');
    const won = p.stages.find((s: any) => s.kind === 'won');
    const proposal = p.stages.find((s: any) => s.name === 'Proposal');
    // Lost tanpa alasan → ditolak
    expect((await api(owner, 'POST', `/api/leads/${lead!.id}/stage`, { stageId: lost.id })).status).toBe(400);
    // Closing tanpa bukti DP → ditolak
    expect((await api(owner, 'POST', `/api/leads/${lead!.id}/stage`, { stageId: won.id })).status).toBe(400);
    // Proposal tanpa proposal terkirim → ditolak
    const r = await api(owner, 'POST', `/api/leads/${lead!.id}/stage`, { stageId: proposal.id });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('Proposal sudah terkirim');
    // Kirim proposal → lead otomatis naik ke tahap Proposal
    const tpls = await api(owner, 'GET', '/api/proposal-templates');
    const sent = await api(owner, 'POST', `/api/leads/${lead!.id}/proposals`, { templateId: tpls.body[0].id, pricePerPax: 95000 });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('sent');
    const [after] = await t.ctx.db.select({ s: stages }).from(leads).innerJoin(stages, eq(stages.id, leads.stageId)).where(eq(leads.id, lead!.id));
    expect(after!.s.name).toBe('Proposal');
    // Lost dengan alasan → boleh
    expect((await api(owner, 'POST', `/api/leads/${lead!.id}/stage`, { stageId: lost.id, lostKind: 'Lost', lostReason: 'Pilih kompetitor' })).status).toBe(200);
  });

  it('diskon di atas 5% oleh sales menunggu persetujuan SPV', async () => {
    const r = await api(admin, 'POST', '/api/simulator/inbound', { phone: '081933126650', name: 'Bagus', text: 'Mau tanya gathering kantor' });
    const [conv] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, r.body.conversationId));
    const owner = conv!.assigneeId === sales.id ? sales : sales2;
    const [lead] = await t.ctx.db.select().from(leads).where(eq(leads.contactId, conv!.contactId));
    const tpls = await api(owner, 'GET', '/api/proposal-templates');
    const res = await api(owner, 'POST', `/api/leads/${lead!.id}/proposals`, { templateId: tpls.body[0].id, pricePerPax: 80000, discountPct: 10 });
    expect(res.body.status).toBe('waiting_approval');
  });
});

describe('SLA', () => {
  it('eskalasi level 1 setelah 15 menit jam kerja', async () => {
    const [c] = await t.ctx.db.select().from(conversations).where(eq(conversations.aiActive, false)).limit(1);
    const since = new Date('2026-10-07T02:00:00Z'); // 09:00 WIB
    await t.ctx.db.update(conversations).set({ awaitingReplySince: since, slaLevel: 0 }).where(eq(conversations.id, c!.id));
    await checkSla(t.ctx, new Date('2026-10-07T02:20:00Z')); // 09:20 WIB
    const [after] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, c!.id));
    expect(after!.slaLevel).toBe(1);
  });
});

describe('worker', () => {
  it('menjalankan job ai_reply yang jatuh tempo', async () => {
    await t.ctx.db.execute(`update jobs set run_at = now() - interval '1 minute' where status='pending'` as any);
    t.fake.next = () => ({ reply: 'Halo kak, untuk acara apa?', extracted: {}, wants_handoff: false, handoff_reason: null });
    const n = await runDueJobs(t.ctx, JOB_HANDLERS);
    expect(n).toBeGreaterThan(0);
  });
});

describe('import CSV', () => {
  it('preview lalu commit kontak tanpa menimpa data lama', async () => {
    const csv = 'Full Name,Phone,Email\nRetno Baru,081233449021,retno@x.com\nOrang Baru,081299998888,\n';
    const boundary = '----x';
    const payload =
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\ncontacts\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="k.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
    const res = await t.app.inject({ method: 'POST', url: '/api/import', payload, headers: { cookie: admin.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(res.statusCode).toBe(200);
    const prev = JSON.parse(res.body);
    expect(prev.mapping).toMatchObject({ name: 'Full Name', phone: 'Phone' });
    const c = await api(admin, 'POST', `/api/import/${prev.id}/commit`, { mapping: prev.mapping });
    expect(c.body).toMatchObject({ created: 1, updated: 1, errorCount: 0 });
    const list = await api(admin, 'GET', '/api/contacts?q=Retno');
    expect(list.body.rows[0].name).toBe('Retno'); // nama lama tidak ditimpa "Retno Baru"
  });
});

describe('P1 lanjutan: logo, profil WA, aturan distribusi khusus', () => {
  const multipart = (name: string, filename: string, type: string, content: Buffer) => {
    const boundary = '----y';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  };
  // PNG 1x1
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  it('admin mengunggah logo, tampil publik di halaman login', async () => {
    const m = multipart('file', 'logo.png', 'image/png', PNG);
    const res = await t.app.inject({ method: 'POST', url: '/api/settings/logo', payload: m.payload, headers: { ...m.headers, cookie: admin.cookie } });
    expect(res.statusCode).toBe(200);
    const brand = await t.app.inject({ method: 'GET', url: '/api/public/brand' });
    expect(JSON.parse(brand.body).logo).toContain('/api/public/logo');
    const logo = await t.app.inject({ method: 'GET', url: '/api/public/logo' });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    // sales tidak boleh mengganti logo; PDF ditolak
    const m2 = multipart('file', 'x.png', 'image/png', PNG);
    expect((await t.app.inject({ method: 'POST', url: '/api/settings/logo', payload: m2.payload, headers: { ...m2.headers, cookie: sales.cookie } })).statusCode).toBe(403);
    const m3 = multipart('file', 'x.pdf', 'application/pdf', Buffer.from('%PDF-1.4'));
    expect((await t.app.inject({ method: 'POST', url: '/api/settings/logo', payload: m3.payload, headers: { ...m3.headers, cookie: admin.cookie } })).statusCode).toBe(400);
  });

  it('profil bisnis WA tersimpan lokal di mode simulasi & divalidasi', async () => {
    const bad = await api(admin, 'PUT', '/api/whatsapp/profile', { about: 'x'.repeat(140), description: '', address: '', email: '', websites: [], vertical: 'EVENT_PLAN' });
    expect(bad.status).toBe(400);
    const ok = await api(admin, 'PUT', '/api/whatsapp/profile', { about: 'Catering Malang', description: 'Wedding & event', address: 'Malang', email: 'halo@sk.id', websites: ['https://sk.id', ''], vertical: 'EVENT_PLAN' });
    expect(ok.status).toBe(200);
    expect(ok.body.syncedAt).toBeNull();
    const got = await api(admin, 'GET', '/api/whatsapp/profile');
    expect(got.body).toMatchObject({ about: 'Catering Malang', source: 'local' });
  });

  it('aturan khusus: kantin → sales tertentu, dari pesan pertama dan dari deteksi AI', async () => {
    const dist = await api(admin, 'GET', '/api/distribution');
    const rule = { id: 'r1', label: 'Korporat / kantin', keywords: ['kantin', 'nasi kotak harian'], userIds: [sales2.id], active: true };
    const put = await api(admin, 'PUT', '/api/distribution', {
      method: dist.body.method,
      rules: dist.body.rules,
      members: dist.body.members.map((m: any) => ({ id: m.id, weight: m.weight, included: m.included })),
      specialRules: [rule],
    });
    expect(put.status).toBe(200);
    // pesan pertama sudah menyebut kantin → langsung ke sales2
    const r1 = await api(admin, 'POST', '/api/simulator/inbound', { phone: '081377770001', name: 'PT A', text: 'Mau tanya catering kantin karyawan' });
    const [c1] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, r1.body.conversationId));
    expect(c1!.assigneeId).toBe(sales2.id);
    // pesan pertama umum → dibagi biasa, lalu AI mengenali "nasi kotak harian" → dipindah ke sales2
    for (let i = 0; i < 4; i++) {
      const r = await api(admin, 'POST', '/api/simulator/inbound', { phone: `08137777100${i}`, name: 'PT B', text: 'Halo mau tanya' });
      const [c] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, r.body.conversationId));
      if (c!.assigneeId === sales2.id) continue;
      t.fake.next = () => ({ reply: 'Baik, untuk berapa porsi per hari?', extracted: { customer_name: null, event_type: 'Nasi kotak harian karyawan', event_date: null, event_date_text: null, location: null, pax: null, budget_idr: null }, wants_handoff: false, handoff_reason: null });
      await runResponder(t.ctx, c!.id);
      const [after] = await t.ctx.db.select().from(conversations).where(eq(conversations.id, c!.id));
      expect(after!.assigneeId).toBe(sales2.id);
      return;
    }
    throw new Error('semua percakapan kebetulan sudah ke sales2 — test tidak bisa membuktikan pemindahan');
  });
});

describe('kanal notifikasi', () => {
  it('notifikasi diteruskan ke HP lewat web push; langganan kedaluwarsa dihapus', async () => {
    const sent: { endpoint: string; payload: any }[] = [];
    t.ctx.pushSend = async (sub, payload) => {
      if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    };
    const keys = { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', auth: 'tBHItJI5svbpez7KI4CCXg' };
    expect((await api(sales, 'POST', '/api/push/subscribe', { endpoint: 'https://push.example/ok', keys })).status).toBe(200);
    expect((await api(sales, 'POST', '/api/push/subscribe', { endpoint: 'https://push.example/gone', keys })).status).toBe(200);
    expect((await api(sales, 'GET', '/api/push/key')).body.publicKey.length).toBeGreaterThan(40);
    await notify(t.ctx, [sales.id], 'lead', 'Lead baru dari tes', '/inbox/abc');
    await flushChannels();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ title: 'Lead baru', body: 'Lead baru dari tes' });
    expect(sent[0]!.payload.url).toMatch(/^https?:\/\/.+\/inbox\/abc$/);
    const subs = await t.ctx.db.select().from(pushSubscriptions);
    expect(subs.map((s) => s.endpoint)).toEqual(['https://push.example/ok']);
  });

  it('eskalasi SLA level 2 dikirim lewat email ke SPV', async () => {
    const mails: { to: string[]; subject: string }[] = [];
    t.ctx.mail = { send: async (to, subject) => void mails.push({ to, subject }) };
    // SPV dengan nomor HP
    const r = await api(admin, 'POST', '/api/users', { name: 'Rahman', email: 'rahman@test.local', role: 'spv', phone: '081211112222' });
    expect(r.status).toBe(200);
    const ch = (await api(admin, 'GET', '/api/notif-channels')).body.settings;
    expect((await api(admin, 'PUT', '/api/notif-channels', ch)).status).toBe(200);
    const [c] = await t.ctx.db.select().from(conversations).where(eq(conversations.aiActive, false)).limit(1);
    await t.ctx.db.update(conversations).set({ awaitingReplySince: new Date('2026-10-07T02:00:00Z'), slaLevel: 1 }).where(eq(conversations.id, c!.id));
    await checkSla(t.ctx, new Date('2026-10-07T02:50:00Z')); // 50 menit jam kerja → level 2
    expect(mails.some((m) => m.to.includes('rahman@test.local') && m.subject.includes('level 2'))).toBe(true);
  });

  it('ringkasan harian terkirim sekali setelah jam yang diatur', async () => {
    const mails: { to: string[]; subject: string; text: string }[] = [];
    t.ctx.mail = { send: async (to, subject, text) => void mails.push({ to, subject, text }) };
    expect(await runDailyDigest(t.ctx, new Date('2026-10-08T12:00:00Z'))).toBe('skipped'); // 19.00 WIB
    expect(await runDailyDigest(t.ctx, new Date('2026-10-08T13:05:00Z'))).toBe('sent'); // 20.05 WIB
    expect(await runDailyDigest(t.ctx, new Date('2026-10-08T14:00:00Z'))).toBe('skipped'); // sudah terkirim hari ini
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toContain('admin@test.local');
    expect(mails[0]!.text).toContain('Lead baru');
  });
});
