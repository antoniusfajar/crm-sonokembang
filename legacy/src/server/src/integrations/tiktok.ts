import { callJson, form } from './http.js';
import type { AccountOption, AppCreds, Cred, SyncOutput } from './types.js';

// TikTok Login Kit + Display API. Token akses 24 jam, refresh token 365 hari (diperbarui otomatis).
// Posting otomatis (Content Posting API) butuh audit aplikasi oleh TikTok → sementara jadwal posting
// TikTok menjadi pengingat untuk posting manual.

export const TIKTOK_SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'];

export function tiktokAuthorizeUrl(app: AppCreds, redirectUri: string, state: string) {
  return `https://www.tiktok.com/v2/auth/authorize/?${form({ client_key: app.id, scope: TIKTOK_SCOPES.join(','), response_type: 'code', redirect_uri: redirectUri, state })}`;
}

type TokenRes = { access_token: string; refresh_token: string; expires_in: number; open_id: string };

export async function tiktokExchangeCode(app: AppCreds, redirectUri: string, code: string): Promise<Cred & { openId: string }> {
  const r = await callJson<TokenRes>('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: app.id, client_secret: app.secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
  });
  return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000, openId: r.open_id };
}

export async function tiktokFresh(app: AppCreds, cred: Cred): Promise<{ cred: Cred; changed: boolean }> {
  if (cred.expiresAt && cred.expiresAt - Date.now() > 300_000) return { cred, changed: false };
  const r = await callJson<TokenRes>('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: app.id, client_secret: app.secret, grant_type: 'refresh_token', refresh_token: cred.refreshToken ?? '' }),
  });
  return { cred: { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000 }, changed: true };
}

export async function tiktokDiscover(cred: Cred & { openId?: string }): Promise<AccountOption[]> {
  const r = await callJson<{ data: { user: { open_id: string; display_name: string; username?: string } } }>('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', {
    headers: { Authorization: `Bearer ${cred.accessToken}` },
  });
  const u = r.data.user;
  return [{ provider: 'tiktok', accountId: u.open_id, name: u.username ? `@${u.username}` : u.display_name, type: 'Business', cred: { accessToken: cred.accessToken, refreshToken: cred.refreshToken, expiresAt: cred.expiresAt } }];
}

export async function syncTiktok(cred: Cred): Promise<SyncOutput> {
  const h = { Authorization: `Bearer ${cred.accessToken}`, 'Content-Type': 'application/json' };
  const user = await callJson<{ data: { user: { follower_count?: number; likes_count?: number; video_count?: number } } }>('https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count', { headers: h });
  const posts: NonNullable<SyncOutput['posts']> = [];
  let cursor: number | undefined;
  for (let i = 0; i < 5; i++) {
    const r: { data: { videos: { id: string; title?: string; video_description?: string; create_time: number; like_count?: number; comment_count?: number; share_count?: number; view_count?: number; share_url?: string }[]; cursor: number; has_more: boolean } } = await callJson(
      'https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,like_count,comment_count,share_count,view_count,share_url',
      { method: 'POST', headers: h, body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) },
    );
    for (const v of r.data.videos) {
      posts.push({ externalId: v.id, caption: v.video_description ?? v.title ?? '', mediaType: 'VIDEO', permalink: v.share_url ?? null, publishedAt: new Date(v.create_time * 1000), likes: v.like_count ?? 0, comments: v.comment_count ?? 0, shares: v.share_count ?? 0, saves: 0, views: v.view_count ?? 0, impressions: v.view_count ?? 0, reach: 0 });
    }
    if (!r.data.has_more) break;
    cursor = r.data.cursor;
  }
  const today = new Date().toISOString().slice(0, 10);
  const u = user.data.user;
  return {
    metrics: u.follower_count !== undefined ? [{ metric: 'followers', dim: '', day: today, value: u.follower_count }] : [],
    posts,
    note: `${posts.length} video · ${u.follower_count ?? '?'} pengikut`,
  };
}
