// Pemanggil HTTP untuk API platform (bisa diganti di test supaya tidak memanggil internet).

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let impl: FetchLike = (url, init) => fetch(url, init);

/** Test: ganti pemanggil HTTP. Kembalikan fungsi untuk memulihkan. */
export function setHttp(f: FetchLike) {
  const prev = impl;
  impl = f;
  return () => {
    impl = prev;
  };
}

export class PlatformError extends Error {
  constructor(
    message: string,
    public status = 0,
    /** true = izin/token tidak berlaku lagi → Admin perlu login ulang */
    public authExpired = false,
  ) {
    super(message);
  }
}

export async function callJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await impl(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new PlatformError(`Tidak bisa menghubungi ${new URL(url).host}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.error_description ?? body?.error?.status ?? body?.message ?? `HTTP ${res.status}`;
    const expired = res.status === 401 || body?.error?.code === 190 || /invalid_grant|expired|revoked/i.test(String(msg));
    throw new PlatformError(String(msg).slice(0, 300), res.status, expired);
  }
  return body as T;
}

export const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
