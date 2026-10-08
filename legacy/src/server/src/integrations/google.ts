import { callJson, form, PlatformError } from './http.js';
import type { AccountOption, AppCreds, Cred, SyncOutput, SyncedReview } from './types.js';

// Google OAuth (satu login untuk Business Profile, GA4, Search Console). Token akses ±1 jam,
// diperbarui otomatis memakai refresh token — tidak perlu login ulang berkala.

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

export function googleAuthorizeUrl(app: AppCreds, redirectUri: string, state: string) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${form({ client_id: app.id, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })}`;
}

export async function googleExchangeCode(app: AppCreds, redirectUri: string, code: string): Promise<Cred> {
  const r = await callJson<{ access_token: string; refresh_token?: string; expires_in: number }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ code, client_id: app.id, client_secret: app.secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!r.refresh_token) throw new PlatformError('Google tidak memberi refresh token. Cabut akses CRM di myaccount.google.com › Keamanan, lalu hubungkan ulang.');
  return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000 };
}

/** Token akses yang masih berlaku (diperbarui otomatis bila tinggal < 2 menit). */
export async function googleFresh(app: AppCreds, cred: Cred): Promise<{ cred: Cred; changed: boolean }> {
  if (cred.expiresAt && cred.expiresAt - Date.now() > 120_000) return { cred, changed: false };
  if (!cred.refreshToken) throw new PlatformError('Refresh token Google tidak ada — hubungkan ulang', 401, true);
  const r = await callJson<{ access_token: string; expires_in: number }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: app.id, client_secret: app.secret, refresh_token: cred.refreshToken, grant_type: 'refresh_token' }),
  });
  return { cred: { ...cred, accessToken: r.access_token, expiresAt: Date.now() + r.expires_in * 1000 }, changed: true };
}

const auth = (c: Cred) => ({ Authorization: `Bearer ${c.accessToken}` });

export async function googleDiscover(cred: Cred): Promise<AccountOption[]> {
  const out: AccountOption[] = [];
  const errors: string[] = [];
  // GA4
  try {
    const r = await callJson<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[] }>('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { headers: auth(cred) });
    for (const a of r.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.push({ provider: 'ga4', accountId: p.property, name: p.displayName, type: `Property GA4 · ${a.displayName}`, cred });
  } catch (e) {
    errors.push(`GA4: ${(e as Error).message}`);
  }
  // Search Console
  try {
    const r = await callJson<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>('https://www.googleapis.com/webmasters/v3/sites', { headers: auth(cred) });
    for (const s of r.siteEntry ?? []) if (s.permissionLevel !== 'siteUnverifiedUser') out.push({ provider: 'gsc', accountId: s.siteUrl, name: s.siteUrl.replace(/^sc-domain:/, ''), type: s.siteUrl.startsWith('sc-domain:') ? 'Domain' : 'URL prefix', cred });
  } catch (e) {
    errors.push(`Search Console: ${(e as Error).message}`);
  }
  // Business Profile
  try {
    const acc = await callJson<{ accounts?: { name: string; accountName: string }[] }>('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: auth(cred) });
    for (const a of acc.accounts ?? []) {
      const locs = await callJson<{ locations?: { name: string; title: string; storefrontAddress?: { locality?: string } }[] }>(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`,
        { headers: auth(cred) },
      );
      for (const l of locs.locations ?? []) out.push({ provider: 'gbp', accountId: `${a.name}/${l.name}`, name: l.title, type: `Lokasi${l.storefrontAddress?.locality ? ` · ${l.storefrontAddress.locality}` : ''}`, cred });
    }
  } catch (e) {
    errors.push(`Business Profile: ${(e as Error).message}`);
  }
  if (!out.length) throw new PlatformError(`Tidak ada akun Google yang bisa dipakai. ${errors.join(' · ')}`);
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** Business Profile: ulasan (API v4) + performa profil harian. accountId = "accounts/x/locations/y". */
export async function syncGbp(cred: Cred, accountId: string): Promise<SyncOutput> {
  const reviews: SyncedReview[] = [];
  let pageToken: string | undefined;
  let official: { avg: number; total: number } | null = null;
  do {
    const r: { averageRating?: number; totalReviewCount?: number; reviews?: { reviewId: string; reviewer?: { displayName?: string }; starRating: string; comment?: string; createTime: string; reviewReply?: { comment: string; updateTime: string } }[]; nextPageToken?: string } = await callJson(
      `https://mybusiness.googleapis.com/v4/${accountId}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`,
      { headers: auth(cred) },
    );
    for (const x of r.reviews ?? []) {
      reviews.push({
        externalId: x.reviewId,
        author: x.reviewer?.displayName ?? 'Pengguna Google',
        rating: STAR[x.starRating] ?? 0,
        // Ulasan yang diterjemahkan Google berisi "(Translated by Google)" — ambil teks aslinya.
        text: (x.comment ?? '').split('\n\n(Original)\n').pop()!.replace(/^\(Translated by Google\)\s*/, ''),
        reviewedAt: new Date(x.createTime),
        replyText: x.reviewReply?.comment ?? null,
        repliedAt: x.reviewReply ? new Date(x.reviewReply.updateTime) : null,
      });
    }
    if (!official && r.totalReviewCount !== undefined) official = { avg: r.averageRating ?? 0, total: r.totalReviewCount };
    pageToken = r.nextPageToken;
    // Batas pengaman saja; rating & jumlah total diambil dari angka resmi Google di bawah.
  } while (pageToken && reviews.length < 5000);

  const metrics: SyncOutput['metrics'] = [];
  if (official) {
    const today = ymd(new Date());
    metrics.push({ metric: 'rating_avg', dim: '', day: today, value: official.avg }, { metric: 'review_total', dim: '', day: today, value: official.total });
  }
  const location = accountId.split('/').slice(2).join('/');
  try {
    const end = new Date();
    const start = new Date(Date.now() - 30 * 86_400_000);
    const d = (x: Date) => ({ year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() });
    const q = new URLSearchParams();
    for (const m of ['BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS']) q.append('dailyMetrics', m);
    const s = d(start);
    const e = d(end);
    q.set('dailyRange.startDate.year', String(s.year));
    q.set('dailyRange.startDate.month', String(s.month));
    q.set('dailyRange.startDate.day', String(s.day));
    q.set('dailyRange.endDate.year', String(e.year));
    q.set('dailyRange.endDate.month', String(e.month));
    q.set('dailyRange.endDate.day', String(e.day));
    const r = await callJson<{ multiDailyMetricTimeSeries?: { dailyMetricTimeSeries: { dailyMetric: string; timeSeries: { datedValues?: { date: { year: number; month: number; day: number }; value?: string }[] } }[] }[] }>(
      `https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries?${q}`,
      { headers: auth(cred) },
    );
    for (const block of r.multiDailyMetricTimeSeries ?? []) {
      for (const series of block.dailyMetricTimeSeries) {
        for (const v of series.timeSeries.datedValues ?? []) {
          const day = `${v.date.year}-${String(v.date.month).padStart(2, '0')}-${String(v.date.day).padStart(2, '0')}`;
          metrics.push({ metric: series.dailyMetric.toLowerCase(), dim: '', day, value: Number(v.value ?? 0) });
        }
      }
    }
  } catch {
    // performa profil opsional
  }
  return { metrics, reviews, note: `${reviews.length} ulasan` };
}

export async function replyGbp(cred: Cred, accountId: string, reviewId: string, comment: string) {
  await callJson(`https://mybusiness.googleapis.com/v4/${accountId}/reviews/${reviewId}/reply`, {
    method: 'PUT',
    headers: { ...auth(cred), 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
}

type Ga4Row = { dimensionValues: { value: string }[]; metricValues: { value: string }[] };

async function ga4Report(cred: Cred, property: string, body: Record<string, unknown>) {
  const r = await callJson<{ rows?: Ga4Row[] }>(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: 'POST',
    headers: { ...auth(cred), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.rows ?? [];
}

const gaDate = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** GA4: pengunjung harian, per sumber trafik, per halaman (30 hari). */
export async function syncGa4(cred: Cred, property: string): Promise<SyncOutput> {
  const dateRanges = [{ startDate: '30daysAgo', endDate: 'today' }];
  const metrics: SyncOutput['metrics'] = [];
  const daily = await ga4Report(cred, property, { dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'averageSessionDuration' }] });
  for (const r of daily) {
    const day = gaDate(r.dimensionValues[0]!.value);
    ['users', 'sessions', 'pageviews', 'avg_session_sec'].forEach((m, i) => metrics.push({ metric: m, dim: '', day, value: Number(r.metricValues[i]?.value ?? 0) }));
  }
  const byChannel = await ga4Report(cred, property, { dateRanges, dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }] });
  for (const r of byChannel) metrics.push({ metric: 'sessions_by_channel', dim: r.dimensionValues[1]!.value, day: gaDate(r.dimensionValues[0]!.value), value: Number(r.metricValues[0]?.value ?? 0) });
  const byPage = await ga4Report(cred, property, { dateRanges, dimensions: [{ name: 'date' }, { name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], limit: 5000 });
  for (const r of byPage) metrics.push({ metric: 'pageviews_by_page', dim: r.dimensionValues[1]!.value.slice(0, 200), day: gaDate(r.dimensionValues[0]!.value), value: Number(r.metricValues[0]?.value ?? 0) });
  return { metrics, note: `${daily.length} hari data pengunjung` };
}

/** Search Console: klik & tayangan harian + kata kunci teratas (28 hari, data GSC terlambat ±2 hari). */
export async function syncGsc(cred: Cred, site: string): Promise<SyncOutput> {
  const end = ymd(new Date(Date.now() - 2 * 86_400_000));
  const start = ymd(new Date(Date.now() - 30 * 86_400_000));
  const q = async (dimensions: string[], rowLimit: number) =>
    (
      await callJson<{ rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] }>(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
        { method: 'POST', headers: { ...auth(cred), 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit }) },
      )
    ).rows ?? [];
  const metrics: SyncOutput['metrics'] = [];
  for (const r of await q(['date'], 100)) {
    metrics.push({ metric: 'clicks', dim: '', day: r.keys[0]!, value: r.clicks });
    metrics.push({ metric: 'impressions', dim: '', day: r.keys[0]!, value: r.impressions });
    metrics.push({ metric: 'position', dim: '', day: r.keys[0]!, value: Math.round(r.position * 10) / 10 });
  }
  // Kata kunci disimpan sebagai total 28 hari pada tanggal akhir periode.
  for (const r of await q(['query'], 50)) {
    metrics.push({ metric: 'query_clicks', dim: r.keys[0]!.slice(0, 200), day: end, value: r.clicks });
    metrics.push({ metric: 'query_impressions', dim: r.keys[0]!.slice(0, 200), day: end, value: r.impressions });
    metrics.push({ metric: 'query_position', dim: r.keys[0]!.slice(0, 200), day: end, value: Math.round(r.position * 10) / 10 });
  }
  return { metrics, note: 'kata kunci & klik pencarian' };
}
