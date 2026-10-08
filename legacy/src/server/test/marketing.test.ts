import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { adCampaigns, integrations, leads, metricDaily, notifications, pipelines, postSchedules, socialPosts, stages } from '../src/db/schema.js';
import { handleInbound } from '../src/services/messaging.js';
import { moveStage } from '../src/services/leads.js';
import { runPostSchedules } from '../src/services/marketing.js';
import { wibDateString } from '../src/lib/time.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
const api = async (method: string, url: string, payload?: unknown) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: admin.cookie } });
  return { status: r.statusCode, body: r.body && r.headers['content-type']?.toString().includes('json') ? JSON.parse(r.body) : r.body };
};
const today = wibDateString(new Date());

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('Meta Ads: biaya dari Meta/manual, lead & closing dari CRM', () => {
  it('lead click-to-WA terhubung ke kampanye lewat id iklan; CPL, biaya/closing, ROAS', async () => {
    const c = await api('POST', '/api/ads/campaigns', { name: 'Wedding Expo Okt', objective: 'Pesan' });
    expect(c.status).toBe(200);
    await api('PUT', `/api/ads/campaigns/${c.body.id}/spend`, { month: today.slice(0, 7), amount: 600_000 });
    // dua chat dari iklan dengan id iklan AD-1, satu tanpa kampanye dikenal (AD-9)
    for (const [phone, ad] of [['628700000001', 'AD-1'], ['628700000002', 'AD-1'], ['628700000003', 'AD-9']] as const) {
      await handleInbound(t.ctx, { type: 'message', from: phone, waMessageId: `ad.${phone}`, timestamp: new Date(), kind: 'text', text: 'Halo mau tanya paket wedding', referral: { sourceId: ad, sourceType: 'ad', ctwaClid: 'x' } });
    }
    let v = await api('GET', '/api/ads?days=30');
    expect(v.body.kpi).toMatchObject({ spend: 600_000, leads: 3, cpl: 200_000 });
    expect(v.body.unknownAdIds.sort()).toEqual(['AD-1', 'AD-9']);
    await api('POST', `/api/ads/campaigns/${c.body.id}/ad-ids`, { adId: 'AD-1' });
    // satu lead closing senilai 30 jt
    const [l] = await t.ctx.db.select().from(leads).limit(1);
    const won = (await t.ctx.db.select().from(stages).where(eq(stages.pipelineId, l!.pipelineId))).find((s) => s.kind === 'won')!;
    await moveStage(t.ctx, l!.id, { stageId: won.id, dealValue: 30_000_000 }, null, { skipRequirements: ['dp_proof', 'source_known', 'proposal_sent'] });
    v = await api('GET', '/api/ads?days=30');
    const camp = v.body.campaigns.find((x: any) => x.id === c.body.id);
    expect(camp).toMatchObject({ spend: 600_000, leads: 2, cpl: 300_000, manual: true });
    expect(v.body.kpi.roas).toBe(50); // 30 jt / 600 rb
    expect(v.body.unknownAdIds).toEqual(['AD-9']);
    // biaya iklan muncul di Dashboard › Marketing per sumber
    const mk = await api('GET', '/api/analytics/marketing?period=this_month');
    expect(mk.body.sources.find((s: any) => s.name === 'IG / Meta Ads')).toMatchObject({ cost: 600_000, costPerLead: 200_000 });
  });
});

describe('Media sosial', () => {
  it('statistik per platform & posting teratas; jadwal posting → pengingat manual bila akun belum terhubung', async () => {
    await t.ctx.db.insert(socialPosts).values([
      { provider: 'instagram', externalId: 'p1', caption: 'Menu wedding baru', publishedAt: new Date(), likes: 300, comments: 20, shares: 5, views: 4000, impressions: 4000, reach: 3000 },
      { provider: 'tiktok', externalId: 'v1', caption: 'Behind the scene dapur', publishedAt: new Date(), likes: 900, comments: 40, shares: 70, views: 15000 },
    ]);
    const s = await api('GET', '/api/social?days=7');
    expect(s.body.kpi).toMatchObject({ posts: 2, likes: 1200, impressions: 19000 });
    expect(s.body.top[0].caption).toBe('Behind the scene dapur');
    const p = await api('POST', '/api/social/schedule', { caption: 'Promo syukuran', platforms: ['instagram', 'tiktok'], scheduledAt: new Date(Date.now() - 1000).toISOString() });
    expect(p.status).toBe(200);
    expect(await runPostSchedules(t.ctx)).toBe(1);
    const [row] = await t.ctx.db.select().from(postSchedules).where(eq(postSchedules.id, p.body.id));
    expect(row!.status).toBe('manual');
    const n = await t.ctx.db.select().from(notifications);
    expect(n.some((x) => x.text.startsWith('Waktunya posting manual'))).toBe(true);
    expect((await api('POST', '/api/social/schedule', { caption: 'x', platforms: ['myspace'], scheduledAt: new Date().toISOString() })).status).toBe(400);
    expect((await api('POST', '/api/social/schedule', { caption: 'x', platforms: ['instagram'], scheduledAt: new Date(Date.now() - 3_600_000).toISOString() })).status).toBe(400);
  });

  it('gambar posting hanya bisa dibuka publik bila dipakai jadwal', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/api/public/media/dp-123.jpg' });
    expect(r.statusCode).toBe(404);
  });
});

describe('Website', () => {
  it('pengunjung GA4, kata kunci, status website, lead dari website', async () => {
    await t.ctx.db.insert(metricDaily).values([
      { provider: 'ga4', metric: 'users', dim: '', day: today, value: 120 },
      { provider: 'ga4', metric: 'sessions', dim: '', day: today, value: 150 },
      { provider: 'ga4', metric: 'sessions_by_channel', dim: 'Organic Search', day: today, value: 90 },
      { provider: 'ga4', metric: 'pageviews_by_page', dim: '/paket-wedding', day: today, value: 300 },
      { provider: 'gsc', metric: 'query_clicks', dim: 'catering malang', day: today, value: 40 },
      { provider: 'gsc', metric: 'query_position', dim: 'catering malang', day: today, value: 3.2 },
    ]);
    await t.ctx.db.insert(integrations).values({ provider: 'uptime', accountId: 'https://contoh.test/', accountName: 'contoh.test', meta: { uptime: { up: false, downSince: new Date().toISOString(), fails: 2 } } });
    const w = await api('GET', '/api/website?days=7');
    expect(w.body.kpi).toMatchObject({ users: 120, sessions: 150 });
    expect(w.body.channels[0]).toEqual({ channel: 'Organic Search', sessions: 90 });
    expect(w.body.keywords[0]).toMatchObject({ query: 'catering malang', clicks: 40, position: 3.2 });
    expect(w.body.alerts.some((a: any) => a.level === 'bad' && a.text.includes('contoh.test'))).toBe(true);
  });
});
