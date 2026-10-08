import { callJson, form, PlatformError } from './http.js';
import type { AccountOption, AppCreds, Cred, SyncOutput } from './types.js';

// Meta Graph API: Meta Ads, Instagram (Professional), Facebook Page.
// Jalur yang disarankan untuk bisnis: token System User dari Business Manager (tidak kedaluwarsa),
// ditempel di Pengaturan › Integrasi. Login OAuth juga tersedia (token ±60 hari).

const V = 'v23.0';
const G = `https://graph.facebook.com/${V}`;
export const META_SCOPES = ['ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_manage_insights', 'instagram_content_publish'];

export function metaAuthorizeUrl(app: AppCreds, redirectUri: string, state: string) {
  return `https://www.facebook.com/${V}/dialog/oauth?${form({ client_id: app.id, redirect_uri: redirectUri, state, scope: META_SCOPES.join(','), response_type: 'code' })}`;
}

export async function metaExchangeCode(app: AppCreds, redirectUri: string, code: string): Promise<Cred> {
  const short = await callJson<{ access_token: string }>(`${G}/oauth/access_token?${form({ client_id: app.id, client_secret: app.secret, redirect_uri: redirectUri, code })}`);
  return metaLongLived(app, short.access_token);
}

/** Tukar token pendek → token panjang (±60 hari). */
export async function metaLongLived(app: AppCreds, token: string): Promise<Cred> {
  const r = await callJson<{ access_token: string; expires_in?: number }>(
    `${G}/oauth/access_token?${form({ grant_type: 'fb_exchange_token', client_id: app.id, client_secret: app.secret, fb_exchange_token: token })}`,
  );
  return { accessToken: r.access_token, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : null };
}

/** Masa berlaku token (null = tidak kedaluwarsa, mis. System User). */
export async function metaTokenExpiry(token: string, app: AppCreds | null): Promise<number | null> {
  if (!app) return null;
  try {
    const r = await callJson<{ data: { expires_at?: number; is_valid: boolean } }>(`${G}/debug_token?${form({ input_token: token, access_token: `${app.id}|${app.secret}` })}`);
    if (!r.data.is_valid) throw new PlatformError('Token Meta tidak berlaku', 401, true);
    return r.data.expires_at ? r.data.expires_at * 1000 : null;
  } catch (e) {
    if (e instanceof PlatformError && e.authExpired) throw e;
    return null;
  }
}

async function paged<T>(url: string, max = 500): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  while (next && out.length < max) {
    const r: { data: T[]; paging?: { next?: string } } = await callJson(next);
    out.push(...r.data);
    next = r.paging?.next;
  }
  return out;
}

/** Akun yang bisa dipilih dari satu token: ad account, Facebook Page, dan Instagram yang terhubung ke Page. */
export async function metaDiscover(cred: Cred): Promise<AccountOption[]> {
  const t = cred.accessToken;
  const out: AccountOption[] = [];
  const ads = await paged<{ id: string; name: string; account_status: number; currency?: string }>(`${G}/me/adaccounts?${form({ fields: 'id,name,account_status,currency', access_token: t, limit: '100' })}`).catch(() => []);
  for (const a of ads) out.push({ provider: 'meta_ads', accountId: a.id, name: a.name, type: `Ad account${a.currency ? ` · ${a.currency}` : ''}`, cred });
  const pages = await paged<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }>(
    `${G}/me/accounts?${form({ fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: t, limit: '100' })}`,
  ).catch(() => []);
  for (const p of pages) {
    // Token Page dari token user jangka panjang tidak kedaluwarsa.
    const pageCred: Cred = { accessToken: p.access_token, expiresAt: cred.expiresAt ?? null };
    out.push({ provider: 'facebook', accountId: p.id, name: p.name, type: 'Page', cred: pageCred });
    if (p.instagram_business_account) {
      out.push({ provider: 'instagram', accountId: p.instagram_business_account.id, name: p.instagram_business_account.username ? `@${p.instagram_business_account.username}` : p.name, type: 'Professional', cred: pageCred, meta: { pageId: p.id } });
    }
  }
  if (!out.length) throw new PlatformError('Token tidak punya akses ke ad account, Page, maupun Instagram. Cek izin di Business Manager.');
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Meta Ads: kampanye + angka harian per kampanye 30 hari terakhir. */
export async function syncMetaAds(cred: Cred, accountId: string, days = 30): Promise<SyncOutput> {
  const t = cred.accessToken;
  const campaigns = await paged<{ id: string; name: string; objective?: string; effective_status?: string }>(
    `${G}/${accountId}/campaigns?${form({ fields: 'id,name,objective,effective_status', access_token: t, limit: '200' })}`,
  );
  const ads = await paged<{ id: string; campaign_id: string }>(`${G}/${accountId}/ads?${form({ fields: 'id,campaign_id', access_token: t, limit: '500' })}`, 2000);
  const since = ymd(new Date(Date.now() - days * 86_400_000));
  const until = ymd(new Date());
  const rows = await paged<{ campaign_id: string; date_start: string; spend?: string; impressions?: string; clicks?: string; actions?: { action_type: string; value: string }[] }>(
    `${G}/${accountId}/insights?${form({ level: 'campaign', time_increment: '1', time_range: JSON.stringify({ since, until }), fields: 'campaign_id,spend,impressions,clicks,actions', access_token: t, limit: '500' })}`,
    5000,
  );
  const metrics: SyncOutput['metrics'] = [];
  for (const r of rows) {
    const conv = r.actions?.find((a) => a.action_type === 'onsite_conversion.messaging_conversation_started_7d')?.value;
    metrics.push({ metric: 'spend', dim: r.campaign_id, day: r.date_start, value: Number(r.spend ?? 0) });
    metrics.push({ metric: 'impressions', dim: r.campaign_id, day: r.date_start, value: Number(r.impressions ?? 0) });
    metrics.push({ metric: 'clicks', dim: r.campaign_id, day: r.date_start, value: Number(r.clicks ?? 0) });
    if (conv) metrics.push({ metric: 'wa_chats', dim: r.campaign_id, day: r.date_start, value: Number(conv) });
  }
  return {
    metrics,
    campaigns: campaigns.map((c) => ({ externalId: c.id, name: c.name, objective: c.objective ?? null, status: c.effective_status ?? 'ACTIVE', adIds: ads.filter((a) => a.campaign_id === c.id).map((a) => a.id) })),
    note: `${campaigns.length} kampanye · ${rows.length} baris angka harian`,
  };
}

/** Instagram: postingan terbaru + insight per post + jangkauan harian akun. */
export async function syncInstagram(cred: Cred, igId: string): Promise<SyncOutput> {
  const t = cred.accessToken;
  const profile = await callJson<{ followers_count?: number; media_count?: number }>(`${G}/${igId}?${form({ fields: 'followers_count,media_count', access_token: t })}`);
  const media = await paged<{ id: string; caption?: string; media_type: string; permalink: string; timestamp: string; like_count?: number; comments_count?: number }>(
    `${G}/${igId}/media?${form({ fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count', access_token: t, limit: '50' })}`,
    100,
  );
  const posts: NonNullable<SyncOutput['posts']> = [];
  for (const m of media) {
    let ins: Record<string, number> = {};
    try {
      const r = await callJson<{ data: { name: string; values: { value: number }[] }[] }>(`${G}/${m.id}/insights?${form({ metric: 'reach,views,saved,shares', access_token: t })}`);
      ins = Object.fromEntries(r.data.map((d) => [d.name, d.values[0]?.value ?? 0]));
    } catch {
      // insight tidak tersedia untuk sebagian jenis media (mis. story lama) → angka dasar saja
    }
    posts.push({ externalId: m.id, caption: m.caption ?? '', mediaType: m.media_type, permalink: m.permalink, publishedAt: new Date(m.timestamp), likes: m.like_count ?? 0, comments: m.comments_count ?? 0, shares: ins.shares ?? 0, saves: ins.saved ?? 0, views: ins.views ?? 0, impressions: ins.views ?? 0, reach: ins.reach ?? 0 });
  }
  const metrics: SyncOutput['metrics'] = [];
  const today = ymd(new Date());
  if (profile.followers_count !== undefined) metrics.push({ metric: 'followers', dim: '', day: today, value: profile.followers_count });
  try {
    const since = Math.floor((Date.now() - 28 * 86_400_000) / 1000);
    const r = await callJson<{ data: { name: string; values: { value: number; end_time: string }[] }[] }>(
      `${G}/${igId}/insights?${form({ metric: 'reach', period: 'day', since: String(since), until: String(Math.floor(Date.now() / 1000)), access_token: t })}`,
    );
    for (const d of r.data) for (const v of d.values) metrics.push({ metric: d.name, dim: '', day: v.end_time.slice(0, 10), value: v.value });
  } catch {
    // insight akun butuh ≥100 pengikut; abaikan bila belum tersedia
  }
  return { metrics, posts, note: `${posts.length} posting · ${profile.followers_count ?? '?'} pengikut` };
}

export async function syncFacebook(cred: Cred, pageId: string): Promise<SyncOutput> {
  const t = cred.accessToken;
  const page = await callJson<{ followers_count?: number }>(`${G}/${pageId}?${form({ fields: 'followers_count', access_token: t })}`);
  const list = await paged<{ id: string; message?: string; permalink_url: string; created_time: string; shares?: { count: number }; reactions?: { summary: { total_count: number } }; comments?: { summary: { total_count: number } } }>(
    `${G}/${pageId}/posts?${form({ fields: 'id,message,permalink_url,created_time,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)', access_token: t, limit: '50' })}`,
    100,
  );
  return {
    metrics: page.followers_count !== undefined ? [{ metric: 'followers', dim: '', day: ymd(new Date()), value: page.followers_count }] : [],
    posts: list.map((p) => ({ externalId: p.id, caption: p.message ?? '', mediaType: 'POST', permalink: p.permalink_url, publishedAt: new Date(p.created_time), likes: p.reactions?.summary.total_count ?? 0, comments: p.comments?.summary.total_count ?? 0, shares: p.shares?.count ?? 0, saves: 0, views: 0, impressions: 0, reach: 0 })),
    note: `${list.length} posting`,
  };
}

/** Terbitkan foto + caption ke Instagram (butuh URL gambar yang bisa diakses publik). */
export async function publishInstagram(cred: Cred, igId: string, imageUrl: string, caption: string): Promise<string> {
  const c = await callJson<{ id: string }>(`${G}/${igId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ image_url: imageUrl, caption, access_token: cred.accessToken }) });
  const p = await callJson<{ id: string }>(`${G}/${igId}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ creation_id: c.id, access_token: cred.accessToken }) });
  return p.id;
}

export async function publishFacebook(cred: Cred, pageId: string, caption: string, imageUrl: string | null): Promise<string> {
  const body = imageUrl ? form({ url: imageUrl, caption, access_token: cred.accessToken }) : form({ message: caption, access_token: cred.accessToken });
  const r = await callJson<{ id: string; post_id?: string }>(`${G}/${pageId}/${imageUrl ? 'photos' : 'feed'}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  return r.post_id ?? r.id;
}
