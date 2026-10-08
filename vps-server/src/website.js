import { config } from './config.js';

/** Perintah dari VPS ke website CI3 (endpoint /api/*, diamankan X-API-Key). */
export async function callWebsite(path, body) {
  if (!config.websiteUrl) throw new Error('WEBSITE_URL belum diisi');
  const res = await fetch(`${config.websiteUrl}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Website ${path}: HTTP ${res.status} ${data.error ?? ''}`);
  return data;
}
