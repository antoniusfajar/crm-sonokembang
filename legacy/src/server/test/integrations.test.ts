import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { setup, login } from './helpers.js';
import { adCampaigns, integrations, metricDaily, notifications, reviews, socialPosts } from '../src/db/schema.js';
import { setHttp } from '../src/integrations/http.js';
import { persistSync, runDueSyncs, syncOne } from '../src/integrations/service.js';

let t: Awaited<ReturnType<typeof setup>>;
let admin: { cookie: string };
const api = async (method: string, url: string, payload?: unknown) => {
  const r = await t.app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: admin.cookie } });
  return { status: r.statusCode, body: r.body && r.headers['content-type']?.toString().includes('json') ? JSON.parse(r.body) : r.body, headers: r.headers };
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const calls: string[] = [];
let gaExpired = false;

beforeAll(async () => {
  t = await setup();
  admin = await login(t.app, 'admin@test.local', 'adminpass123');
  setHttp(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const u = new URL(url);
    const p = u.pathname;
    // ---- Meta
    if (p.endsWith('/me/adaccounts')) return json({ data: [{ id: 'act_1', name: 'Ad account Sonokembang', account_status: 1, currency: 'IDR' }] });
    if (p.endsWith('/me/accounts')) return json({ data: [{ id: 'page1', name: 'Sonokembang Catering', access_token: 'PAGE_TOKEN', instagram_business_account: { id: 'ig1', username: 'sonokembangcateringmlg' } }] });
    if (p.endsWith('/act_1/campaigns')) return json({ data: [{ id: 'c1', name: 'Wedding Expo', objective: 'MESSAGES', effective_status: 'ACTIVE' }] });
    if (p.endsWith('/act_1/ads')) return json({ data: [{ id: 'ad9', campaign_id: 'c1' }] });
    if (p.endsWith('/act_1/insights'))
      return json({ data: [{ campaign_id: 'c1', date_start: '2026-10-01', spend: '150000', impressions: '9000', clicks: '210', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12' }] }] });
    if (p.endsWith('/ig1') && u.searchParams.get('fields')?.includes('followers')) return json({ followers_count: 5400, media_count: 300 });
    if (p.endsWith('/ig1/media')) return json({ data: [{ id: 'm1', caption: 'Menu wedding', media_type: 'IMAGE', permalink: 'https://instagram.com/p/x', timestamp: '2026-10-05T03:00:00+0000', like_count: 120, comments_count: 8 }] });
    if (p.endsWith('/m1/insights')) return json({ data: [{ name: 'reach', values: [{ value: 3000 }] }, { name: 'views', values: [{ value: 4100 }] }, { name: 'saved', values: [{ value: 30 }] }, { name: 'shares', values: [{ value: 12 }] }] });
    if (p.endsWith('/ig1/insights')) return json({ data: [{ name: 'reach', values: [{ value: 800, end_time: '2026-10-05T07:00:00+0000' }] }] });
    // ---- Google
    if (u.host === 'oauth2.googleapis.com') return json({ access_token: 'GA', refresh_token: 'GR', expires_in: 3600 });
    if (u.host === 'analyticsadmin.googleapis.com') return json({ accountSummaries: [{ displayName: 'Sonokembang', propertySummaries: [{ property: 'properties/77', displayName: 'sonokembangmalang.com' }] }] });
    if (p === '/webmasters/v3/sites') return json({ siteEntry: [{ siteUrl: 'sc-domain:sonokembangmalang.com', permissionLevel: 'siteOwner' }] });
    if (u.host === 'mybusinessaccountmanagement.googleapis.com') return json({ accounts: [{ name: 'accounts/1', accountName: 'Sonokembang' }] });
    if (u.host === 'mybusinessbusinessinformation.googleapis.com') return json({ locations: [{ name: 'locations/9', title: 'Sonokembang Catering Malang', storefrontAddress: { locality: 'Malang' } }] });
    if (u.host === 'mybusiness.googleapis.com' && p.endsWith('/reviews'))
      return json({
        averageRating: 4.6,
        totalReviewCount: 726,
        reviews: [
          { reviewId: 'r1', reviewer: { displayName: 'Bu Ratna' }, starRating: 'FIVE', comment: 'Masakannya enak, tepat waktu', createTime: '2026-10-04T02:00:00Z' },
          { reviewId: 'r2', reviewer: { displayName: 'Pak Budi' }, starRating: 'TWO', comment: 'Admin WA lambat', createTime: '2026-10-03T02:00:00Z', reviewReply: { comment: 'Mohon maaf pak', updateTime: '2026-10-03T05:00:00Z' } },
        ],
      });
    if (u.host === 'businessprofileperformance.googleapis.com') return json({ multiDailyMetricTimeSeries: [] });
    if (u.host === 'analyticsdata.googleapis.com') {
      if (gaExpired) return json({ error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } }, 401);
      const dims = JSON.parse(String(init?.body)).dimensions.length;
      if (dims === 2) return json({ rows: [{ dimensionValues: [{ value: '20261005' }, { value: 'Organic Search' }], metricValues: [{ value: '120' }] }] });
      return json({ rows: [{ dimensionValues: [{ value: '20261005' }], metricValues: [{ value: '210' }, { value: '260' }, { value: '700' }, { value: '95' }] }] });
    }
    return json({ error: { message: `tidak ada tiruan untuk ${url}` } }, 404);
  });
});
afterAll(async () => {
  await t.app.close();
  await t.pool.end();
});

describe('integrasi platform', () => {
  it('Meta: tempel token → pilih akun → sinkron iklan & Instagram; token tidak pernah dikirim ke browser', async () => {
    const g = await api('POST', '/api/integrations/meta/token', { token: 'EAAG-system-user-token-1234567890' });
    expect(g.status).toBe(200);
    const acc = await api('GET', `/api/integrations/grants/${g.body.state}`);
    expect(acc.body.accounts.map((a: any) => a.provider).sort()).toEqual(['facebook', 'instagram', 'meta_ads']);
    expect(JSON.stringify(acc.body)).not.toContain('PAGE_TOKEN');
    const c = await api('POST', `/api/integrations/grants/${g.body.state}/connect`, { picks: [{ provider: 'meta_ads', accountId: 'act_1' }, { provider: 'instagram', accountId: 'ig1' }] });
    expect(c.body.connected).toBe(2);

    const [ads] = await t.ctx.db.select().from(integrations).where(eq(integrations.provider, 'meta_ads'));
    expect(ads!.credEnc).not.toContain('EAAG');
    expect((await syncOne(t.ctx, ads!)).ok).toBe(true);
    const [camp] = await t.ctx.db.select().from(adCampaigns).where(eq(adCampaigns.externalId, 'c1'));
    expect(camp).toMatchObject({ name: 'Wedding Expo', adIds: ['ad9'] });
    const spend = await t.ctx.db.select().from(metricDaily).where(eq(metricDaily.metric, 'spend'));
    expect(spend[0]).toMatchObject({ provider: 'meta_ads', dim: 'c1', day: '2026-10-01', value: 150000 });

    const [ig] = await t.ctx.db.select().from(integrations).where(eq(integrations.provider, 'instagram'));
    await syncOne(t.ctx, ig!);
    // Instagram memakai token Page, bukan token user.
    expect(calls.some((x) => x.includes('/ig1/media') && x.includes('PAGE_TOKEN'))).toBe(true);
    const [post] = await t.ctx.db.select().from(socialPosts).where(eq(socialPosts.externalId, 'm1'));
    expect(post).toMatchObject({ provider: 'instagram', likes: 120, reach: 3000, saves: 30 });

    const list = await api('GET', '/api/integrations');
    expect(list.body.accounts).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toMatch(/credEnc|EAAG|PAGE_TOKEN/);
  });

  it('Google: OAuth → callback → pilih lokasi → ulasan masuk', async () => {
    expect((await api('POST', '/api/integrations/oauth/google/start')).status).toBe(400); // belum ada Client ID
    expect((await api('PUT', '/api/integrations/apps/google', { id: 'cid.apps.googleusercontent.com', secret: 'gsecret-123456' })).status).toBe(200);
    const apps = await api('GET', '/api/integrations/apps');
    expect(apps.body.google).toMatchObject({ id: 'cid.apps.googleusercontent.com', redirectUri: 'http://localhost:3000/api/integrations/oauth/google/callback' });
    expect(JSON.stringify(apps.body)).not.toContain('gsecret');
    const s = await api('POST', '/api/integrations/oauth/google/start');
    expect(s.body.url).toContain('access_type=offline');
    const state = new URL(s.body.url).searchParams.get('state')!;
    const cb = await t.app.inject({ method: 'GET', url: `/api/integrations/oauth/google/callback?state=${state}&code=abc` });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(`/pengaturan/integrasi?grant=${state}`);
    const acc = await api('GET', `/api/integrations/grants/${state}`);
    expect(acc.body.accounts.map((a: any) => a.provider).sort()).toEqual(['ga4', 'gbp', 'gsc']);
    await api('POST', `/api/integrations/grants/${state}/connect`, { picks: [{ provider: 'gbp', accountId: 'accounts/1/locations/9' }, { provider: 'ga4', accountId: 'properties/77' }] });
    const [gbp] = await t.ctx.db.select().from(integrations).where(eq(integrations.provider, 'gbp'));
    await syncOne(t.ctx, gbp!);
    const rv = await t.ctx.db.select().from(reviews);
    expect(rv.find((r) => r.externalId === 'r1')).toMatchObject({ rating: 5, author: 'Bu Ratna', replyStatus: 'none' });
    expect(rv.find((r) => r.externalId === 'r2')).toMatchObject({ rating: 2, replyStatus: 'sent', replyText: 'Mohon maaf pak' });
    // state sekali pakai
    expect((await api('GET', `/api/integrations/grants/${state}`)).status).toBe(404);
  });

  it('token ditolak → status perlu login ulang + notifikasi Admin', async () => {
    const [ga] = await t.ctx.db.select().from(integrations).where(eq(integrations.provider, 'ga4'));
    const first = await syncOne(t.ctx, ga!);
    expect(first).toMatchObject({ ok: true });
    gaExpired = true;
    const r = await syncOne(t.ctx, (await t.ctx.db.select().from(integrations).where(eq(integrations.id, ga!.id)))[0]!);
    expect(r.ok).toBe(false);
    const [after] = await t.ctx.db.select().from(integrations).where(eq(integrations.id, ga!.id));
    expect(after!.status).toBe('error');
    const n = await t.ctx.db.select().from(notifications);
    expect(n.some((x) => x.text.includes('perlu login ulang'))).toBe(true);
  });

  it('pemantau website: hidup → mati (2x gagal) → notifikasi', async () => {
    let up = true;
    const srv = http.createServer((_req, res) => {
      res.statusCode = up ? 200 : 503;
      res.end('ok');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as any).port;
    const c = await api('POST', '/api/integrations/uptime', { url: `http://127.0.0.1:${port}/` });
    expect(c.status).toBe(200);
    const get = async () => (await t.ctx.db.select().from(integrations).where(eq(integrations.id, c.body.id)))[0]!;
    await syncOne(t.ctx, await get());
    expect(((await get()).meta as any).uptime.up).toBe(true);
    up = false;
    await syncOne(t.ctx, await get());
    expect(((await get()).meta as any).uptime.up).toBe(true); // satu kali gagal belum dianggap mati
    await syncOne(t.ctx, await get());
    expect(((await get()).meta as any).uptime.up).toBe(false);
    const n = await t.ctx.db.select().from(notifications);
    expect(n.some((x) => x.text.includes('tidak bisa dibuka'))).toBe(true);
    const checks = await t.ctx.db.select().from(metricDaily).where(eq(metricDaily.provider, 'uptime'));
    // 3 cek manual + 1 cek awal yang otomatis jalan saat website ditambahkan
    expect(checks.find((m) => m.metric === 'checks')!.value).toBeGreaterThanOrEqual(3);
    srv.close();
  });

  it('worker hanya menyinkron yang sudah waktunya', async () => {
    expect(await runDueSyncs(t.ctx)).toBe(0); // semua baru saja disinkron
    const later = new Date(Date.now() + 7 * 3600_000);
    expect(await runDueSyncs(t.ctx, later)).toBeGreaterThan(0);
  });
});

describe('sinkron bersamaan', () => {
  it('dua sinkron Google sekaligus tidak gagal & ulasan tidak dobel', async () => {
    const { reviews: rv } = await import('../src/db/schema.js');
    await t.ctx.db.delete(rv);
    const [gbp] = await t.ctx.db.select().from(integrations).where(eq(integrations.provider, 'gbp'));
    const res = await Promise.all([syncOne(t.ctx, gbp!), syncOne(t.ctx, gbp!), syncOne(t.ctx, gbp!)]);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(await t.ctx.db.select().from(rv)).toHaveLength(2);
    // Rating & jumlah total memakai angka resmi Google, bukan hanya ulasan yang tersimpan.
    const sum = await api('GET', '/api/reputation/summary?days=30');
    expect(sum.body.kpi).toMatchObject({ totalAvg: 4.6, total: 726 });
  });

  it('dua properti GA4 tidak saling menimpa angka harian', async () => {
    await persistSync(t.ctx, 'ga4', 'prop-a', { metrics: [{ metric: 'users', dim: '', day: '2026-09-01', value: 10 }], note: '' });
    await persistSync(t.ctx, 'ga4', 'prop-b', { metrics: [{ metric: 'users', dim: '', day: '2026-09-01', value: 5 }], note: '' });
    await persistSync(t.ctx, 'ga4', 'prop-a', { metrics: [{ metric: 'users', dim: '', day: '2026-09-01', value: 12 }], note: '' });
    const rows = (await t.ctx.db.select().from(metricDaily).where(eq(metricDaily.day, '2026-09-01'))).filter((r) => r.provider === 'ga4' && r.metric === 'users');
    expect(rows.map((r) => [r.account, r.value]).sort()).toEqual([['prop-a', 12], ['prop-b', 5]]);
  });
});
