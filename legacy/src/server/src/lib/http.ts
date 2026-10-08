export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const forbidden = (m = 'Anda tidak punya akses ke fitur ini') => new HttpError(403, m);
export const notFound = (m = 'Data tidak ditemukan') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
