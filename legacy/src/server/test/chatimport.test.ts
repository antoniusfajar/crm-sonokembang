import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { contacts, conversations, leads, messages, notifications } from '../src/db/schema.js';
import { parseLegacyTime } from '../src/services/chatImport.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
const here = path.dirname(fileURLToPath(import.meta.url));

const upload = async (kind: string, filename: string, content: Buffer, type = 'text/csv') => {
  const boundary = '----sk' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await t.app.inject({ method: 'POST', url: '/api/import', payload, headers: { cookie: admin.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const commit = async (id: string, mapping: Record<string, string>) => {
  const r = await t.app.inject({ method: 'POST', url: `/api/import/${id}/commit`, payload: { mapping }, headers: { cookie: admin.cookie } });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

// Bentuk sama dengan ekspor CRM lama (contoh dari Sonokembang): tanpa nomor HP, hanya contact_id.
const CHATS = `message_id,conversation_id,contact_id,direction,body,timestamp,admin_first_reply_ts,nama_sales
tQPVjGSFbLtlBPv8kKmB,VAI40L4NRc61ThIlMzPK,3ea5wXLwUMAVAPqVzIN5,inbound,Betul,2026-04-04 15:30:44,2026-04-04 15:31:53,Dewi Rach…
skiBTIDQW2FRkdtl4XYr,VAI40L4NRc61ThIlMzPK,3ea5wXLwUMAVAPqVzIN5,inbound,Ada pricelist kah utk prasmanan pernikahan,2026-04-04 14:02:10,2026-04-04 15:30:17,Dewi Rach…
out-1,VAI40L4NRc61ThIlMzPK,3ea5wXLwUMAVAPqVzIN5,outbound,"Ada kak, untuk berapa pax?",2026-04-04 15:30:17,,Dewi Rach…
Vm8TPCe2ULdKA7nTU3Ug,rxlu9QnWXmlSsTLdvRtL,xfwqpBFDE1XJpbKCSnEl,inbound,"12 april, minggu
65 pax
Tempat : Rumah Pribadi",2026-04-04 13:59:10,2026-04-04 13:59:14,Bachtiar S…
ZZunknown,conv9,TIDAK-ADA,inbound,halo,2026-04-04 10:00:00,,
`;

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
  for (const [name, email] of [
    ['Dewi Rachmawati', 'dewi@test.local'],
    ['Bachtiar Saputra', 'bachtiar@test.local'],
    ['Aziza Nur', 'aziza@test.local'],
    ['Rahman Al Firdausi', 'rahman@test.local'],
  ]) {
    await t.app.inject({ method: 'POST', url: '/api/users', payload: { name, email, role: 'sales' }, headers: { cookie: admin.cookie } });
  }
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('impor riwayat chat CRM lama', () => {
  it('membaca format waktu CRM lama sebagai WIB', () => {
    expect(parseLegacyTime('2026-04-04 15:30:44')!.toISOString()).toBe('2026-04-04T08:30:44.000Z');
    expect(parseLegacyTime('04/04/2026 15:30')!.toISOString()).toBe('2026-04-04T08:30:00.000Z');
    expect(parseLegacyTime('2026-04-04T08:30:44Z')!.toISOString()).toBe('2026-04-04T08:30:44.000Z');
    expect(parseLegacyTime('kemarin')).toBeNull();
  });

  it('kontak dulu (contact_id → nomor), lalu chat; tanpa AI/SLA/lead; impor ulang tidak dobel', async () => {
    const kontak = `contact_id,nama,nomor\n3ea5wXLwUMAVAPqVzIN5,Ratna,081211110001\nxfwqpBFDE1XJpbKCSnEl,Pak Budi,081211110002\n`;
    const k = await upload('contacts', 'kontak.csv', Buffer.from(kontak));
    expect(k.body.mapping).toMatchObject({ phone: 'nomor', name: 'nama', legacyId: 'contact_id' });
    expect((await commit(k.body.id, k.body.mapping)).body.created).toBe(2);

    const notifBefore = (await t.ctx.db.select().from(notifications)).length;
    const leadsBefore = (await t.ctx.db.select().from(leads)).length;
    const c = await upload('chats', 'chat.csv', Buffer.from(CHATS));
    expect(c.status).toBe(200);
    expect(c.body.total).toBe(5);
    expect(c.body.mapping).toMatchObject({ body: 'body', timestamp: 'timestamp', direction: 'direction', contactKey: 'contact_id', sales: 'nama_sales', messageId: 'message_id', conversationKey: 'conversation_id', firstReplyAt: 'admin_first_reply_ts' });
    expect(c.body.mapping.name).toBeUndefined(); // "nama_sales" bukan nama kontak
    const r = await commit(c.body.id, c.body.mapping);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 4, conversations: 2, skipped: 1 });
    expect(r.body.errors[0].error).toContain('1 contact_id belum dikenal');

    const [ratna] = await t.ctx.db.select().from(contacts).where(eq(contacts.legacyId, '3ea5wXLwUMAVAPqVzIN5'));
    const [conv] = await t.ctx.db.select().from(conversations).where(eq(conversations.contactId, ratna!.id));
    const msgs = await t.ctx.db.select().from(messages).where(eq(messages.conversationId, conv!.id));
    expect(msgs.map((m) => m.body).sort()).toEqual(['Ada kak, untuk berapa pax?', 'Ada pricelist kah utk prasmanan pernikahan', 'Betul']);
    const out = msgs.find((m) => m.direction === 'out')!;
    expect(out.senderType).toBe('user');
    expect(out.userId).toBeTruthy(); // "Dewi Rach…" → Dewi Rachmawati
    expect(conv!.lastMessagePreview).toBe('Betul');
    expect(conv!.lastMessageAt!.toISOString()).toBe('2026-04-04T08:30:44.000Z');
    expect(conv!.awaitingReplySince).toBeNull();
    expect(conv!.assigneeId).toBe(out.userId);
    // Pesan multi-baris tetap utuh
    const [budi] = await t.ctx.db.select().from(contacts).where(eq(contacts.legacyId, 'xfwqpBFDE1XJpbKCSnEl'));
    const [bconv] = await t.ctx.db.select().from(conversations).where(eq(conversations.contactId, budi!.id));
    expect((await t.ctx.db.select().from(messages).where(eq(messages.conversationId, bconv!.id)))[0]!.body).toBe('12 april, minggu\n65 pax\nTempat : Rumah Pribadi');
    // Tidak memicu notifikasi atau lead baru
    expect((await t.ctx.db.select().from(notifications)).length).toBe(notifBefore);
    expect((await t.ctx.db.select().from(leads)).length).toBe(leadsBefore);

    // Impor ulang file yang sama → semua dilewati
    const again = await upload('chats', 'chat.csv', Buffer.from(CHATS));
    const r2 = await commit(again.body.id, again.body.mapping);
    expect(r2.body.created).toBe(0);
    expect(r2.body.skipped).toBe(5);
  });

  it('file Excel (.xlsx) dengan kolom tanggal Excel', async () => {
    await t.ctx.db.insert(contacts).values({ waPhone: '6281211110003', name: 'Sari', legacyId: 'CX-1' });
    const x = await upload('chats', 'chats.xlsx', fs.readFileSync(path.join(here, 'fixtures/chats.xlsx')), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(x.status).toBe(200);
    expect(x.body.sample[1].timestamp).toBe('2026-04-04 09:05:00');
    const r = await commit(x.body.id, x.body.mapping);
    expect(r.body).toMatchObject({ created: 2, conversations: 1 });
  });

  it('format berpasangan: satu baris = pesan masuk + balasan, nomor HP langsung di file', async () => {
    // Bentuk ekspor kedua dari CRM lama (contoh Sonokembang).
    const csv = `nama pelanggan,nomor telepon,kanal,timestamp inbound,isi pesan inbound,isi pesan outbound,timestamp outbound,nama sales / user
Pipi,+6288999600889,WhatsApp,2026-08-09 06:39:45,Lntai brpa,di lobby bu iin,2026-08-09 06:40:00,Aziza SPC
Pipi,+6288999600889,WhatsApp,2026-08-09 06:39:10,Bu iin mbak,di lobby bu iin,2026-08-09 06:40:00,Aziza SPC
Intan Amalia,+6281235054732,WhatsApp,2026-08-09 07:31:38,boleh ya,"Kakak bisa langsung jadwalkan konsultasi.
Kapan rencana acara dan jumlah pesanan kakak? 😊",2026-08-09 07:32:13,Bachtiar SPC
Ghery Permata,+628195555952,WhatsApp,2026-08-08 22:02:43,besok janjian jam 11 di mercure,Siap kak,2026-08-08 22:03:05,Rahman Al Firdausi
Ig User,+628111222333,Instagram,2026-08-08 20:00:00,halo,hai,2026-08-08 20:01:00,Aziza SPC
`;
    const c = await upload('chats', 'chat-pasangan.csv', Buffer.from(csv));
    expect(c.body.mapping).toMatchObject({
      bodyIn: 'isi pesan inbound',
      timeIn: 'timestamp inbound',
      bodyOut: 'isi pesan outbound',
      timeOut: 'timestamp outbound',
      phone: 'nomor telepon',
      name: 'nama pelanggan',
      sales: 'nama sales / user',
      channel: 'kanal',
    });
    expect(c.body.mapping.body).toBeUndefined();
    expect(c.body.mapping.timestamp).toBeUndefined();
    const r = await commit(c.body.id, c.body.mapping);
    expect(r.status).toBe(200);
    // Pipi: 2 masuk + 1 balasan (balasan yang sama di 2 baris hanya disimpan sekali); Intan 2; Ghery 2; Instagram dilewati
    expect(r.body).toMatchObject({ created: 7, conversations: 3, otherChannel: 2 });
    const [pipi] = await t.ctx.db.select().from(contacts).where(eq(contacts.waPhone, '6288999600889'));
    expect(pipi!.name).toBe('Pipi');
    const [conv] = await t.ctx.db.select().from(conversations).where(eq(conversations.contactId, pipi!.id));
    const msgs = await t.ctx.db.select().from(messages).where(eq(messages.conversationId, conv!.id));
    expect(msgs.filter((m) => m.direction === 'out')).toHaveLength(1);
    const team = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: admin.cookie } });
    const aziza = JSON.parse(team.body).find((u: any) => u.name === 'Aziza Nur');
    expect(msgs.find((m) => m.direction === 'out')!.userId).toBe(aziza.id); // "Aziza SPC" → Aziza Nur
    expect(conv!.lastMessagePreview).toBe('di lobby bu iin');
    expect((await t.ctx.db.select().from(contacts).where(eq(contacts.waPhone, '628111222333')))).toHaveLength(0);
  });

  it('wajib ada kolom nomor atau contact_id', async () => {
    const c = await upload('chats', 'x.csv', Buffer.from('body,timestamp,direction\nhalo,2026-04-04 10:00:00,inbound\n'));
    expect((await commit(c.body.id, c.body.mapping)).status).toBe(400);
  });
});
