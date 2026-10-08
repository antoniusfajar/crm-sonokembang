export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 401 && !url.includes('/auth/login')) {
    window.dispatchEvent(new Event('crm:unauthorized'));
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `Error ${res.status}`, (data as any)?.details);
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  async blob(url: string, body: unknown): Promise<Blob> {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as any).error ?? 'Gagal');
    return res.blob();
  },
};

export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
