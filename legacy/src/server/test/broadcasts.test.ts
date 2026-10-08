import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { broadcastRecipients, broadcasts, contacts, leads, leadSources, messages, pipelines, stages, waTemplates } from '../src/db/schema.js';
import { createLead, moveStage } from '../src/services/leads.js';
import { handleInbound, handleStatus } from '../src/services/messaging.js';
import { runBroadcasts } from '../src/services/broadcasts.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
const api = async (method: string, url: string, payload?: unknown) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: admin.cookie } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const ids: Record<string, string> = {};
let n = 0;
const inbound = (phone: string, text: string) => handleInbound(t.ctx, { type: 'message', from: phone, waMessageId: `in.${++n}`, timestamp: new Date(), kind: 'text', text });

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
  await t.ctx.db.insert(waTemplates).values({ name: 'promo_menu', language: 'id', category: 'MARKETING', body: 'Halo {{1}}, ada menu baru dari Sonokembang! Balas MENU untuk katalog.', status: 'LOCAL' });
  const [wedding] = await t.ctx.db.select().from(pipelines).where(eq(pipelines.name, 'Wedding'));
  const won = (await t.ctx.db.select().from(stages).where(eq(stages.pipelineId, wedding!.id))).find((s) => s.kind === 'won')!;
  const mk = async (key: string, phone: string, name: string, extra: Partial<typeof contacts.$inferInsert> = {}) => {
    const [c] = await t.ctx.db.insert(contacts).values({ waPhone: phone, name, ...extra }).returning();
    ids[key] = c!.id;
    return c!;
  };
  const a = await mk('corp', '628111000001', 'Ratna Dewi', { segment: 'Korporat' });
  const l = await createLead(t.ctx, { contactId: a.id, ownerId: null, origin: 'manual', pipelineId: wedding!.id });
  await moveStage(t.ctx, l.id, { stageId: won.id, dealValue: 50_000_000 }, null, { skipRequirements: ['dp_proof', 'source_known', 'proposal_sent'] });
  const b = await mk('hot', '628111000002', 'Budi Santoso');
  const lb = await createLead(t.ctx, { contactId: b.id, ownerId: null, origin: 'manual', pipelineId: wedding!.id, eventType: 'Wedding' });
  await t.ctx.db.update(leads).set({ temperature: 'Hot', eventType: 'Wedding' }).where(eq(leads.id, lb.id));
  await mk('stop', '628111000003', 'Sudah Stop', { optOutAt: new Date() });
  await mk('supplier', '628111000004', 'Pemasok Sayur', { contactType: 'Supplier' });
  await mk('plain', '628111000005', 'Citra');
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('broadcast WhatsApp', () => {
  it('estimasi: supplier tidak ikut, opt-out dikecualikan, preset segmen', async () => {
    const all = await api('POST', '/api/broadcasts/estimate', { segment: {} });
    expect(all.body).toMatchObject({ matched: 4, eligible: 3, optOut: 1, recent: 0, cost: 3 * 480 });
    const corp = await api('POST', '/api/broadcasts/estimate', { segment: { contactTypes: ['Pelanggan'], segments: ['Korporat', 'Institusi'] } });
    expect(corp.body.eligible).toBe(1);
    const hot = await api('POST', '/api/broadcasts/estimate', { segment: { leadState: 'open', temperatures: ['Hot', 'Warm'], eventTypeContains: 'wedding' } });
    expect(hot.body).toMatchObject({ eligible: 1, sample: ['Budi Santoso'] });
  });

  it('kirim terjadwal: template dengan nama depan, masuk ke percakapan, status dibaca', async () => {
    const c = await api('POST', '/api/broadcasts', { name: 'Menu baru Oktober', segment: {}, templateName: 'promo_menu', templateLanguage: 'id', params: ['{nama}'], scheduledAt: new Date(Date.now() - 1000).toISOString() });
    expect(c.status).toBe(200);
    ids.b1 = c.body.id;
    expect(await runBroadcasts(t.ctx)).toBe(3);
    const rec = await t.ctx.db.select().from(broadcastRecipients).where(eq(broadcastRecipients.broadcastId, ids.b1));
    expect(rec.filter((r) => r.status === 'sent')).toHaveLength(3);
    expect(rec.find((r) => r.contactId === ids.stop)).toMatchObject({ status: 'skipped' });
    expect(t.wa.sent.some((s) => s.to === '628111000001' && s.body === 'promo_menu(Ratna)')).toBe(true);
    const [msg] = await t.ctx.db.select().from(messages).where(eq(messages.templateName, 'promo_menu')).limit(1);
    expect(msg!.body).toMatch(/^Halo \w+, ada menu baru/);
    const [b] = await t.ctx.db.select().from(broadcasts).where(eq(broadcasts.id, ids.b1));
    expect(b!.status).toBe('done');
    const r1 = rec.find((r) => r.contactId === ids.corp)!;
    await handleStatus(t.ctx, { type: 'status', waMessageId: r1.waMessageId!, status: 'read' });
    const [after] = await t.ctx.db.select().from(broadcastRecipients).where(eq(broadcastRecipients.id, r1.id));
    expect(after!.status).toBe('read');
  });

  it('balasan pelanggan lama → lead baru bersumber Broadcast; STOP → berhenti berlangganan', async () => {
    const r = await inbound('628111000001', 'Boleh kirim katalognya?');
    expect(r!.lead).toBeTruthy();
    const [bcSrc] = await t.ctx.db.select().from(leadSources).where(eq(leadSources.refCode, 'BC'));
    expect(r!.lead!.sourceId).toBe(bcSrc!.id);
    expect(r!.lead!.originNote).toContain('Menu baru Oktober');
    const [rec] = await t.ctx.db.select().from(broadcastRecipients).where(and(eq(broadcastRecipients.broadcastId, ids.b1), eq(broadcastRecipients.contactId, ids.corp)));
    expect(rec).toMatchObject({ leadId: r!.lead!.id, replyText: 'Boleh kirim katalognya?' });

    const s = await inbound('628111000005', 'STOP');
    expect(s!.lead).toBeNull();
    const [c] = await t.ctx.db.select().from(contacts).where(eq(contacts.id, ids.plain));
    expect(c!.optOutAt).toBeTruthy();

    const d = await api('GET', `/api/broadcasts/${ids.b1}`);
    expect(d.body.stats).toMatchObject({ total: 4, sent: 3, skipped: 1, replied: 2, leads: 1 });
    expect(d.body.replies.find((x: any) => x.text === 'STOP').stop).toBe(true);
    expect(d.body.preview).toContain('Halo Ratna');
  });

  it('batas frekuensi mingguan & batalkan jadwal', async () => {
    const again = await api('POST', '/api/broadcasts', { name: 'Ulang', segment: {}, templateName: 'promo_menu', params: ['{nama}'], scheduledAt: new Date().toISOString() });
    expect(again.status).toBe(400); // semua penerima baru saja dikirimi
    await t.ctx.db.update(contacts).set({ lastBroadcastAt: new Date(Date.now() - 8 * 86_400_000) });
    const later = await api('POST', '/api/broadcasts', { name: 'Promo Desember', segment: {}, templateName: 'promo_menu', params: ['{nama}'], scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(later.status).toBe(200);
    expect(await runBroadcasts(t.ctx)).toBe(0); // belum waktunya
    expect((await api('POST', `/api/broadcasts/${later.body.id}/cancel`)).status).toBe(200);
    expect((await api('POST', `/api/broadcasts/${ids.b1}/cancel`)).status).toBe(400);
    const list = await api('GET', '/api/broadcasts');
    expect(list.body.totals).toMatchObject({ broadcasts: 2, sent: 3, leads: 1 });
  });
});
