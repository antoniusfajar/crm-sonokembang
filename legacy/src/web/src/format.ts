const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const toWib = (d: Date) => new Date(d.getTime() + 7 * 3600_000);

export const rupiah = (n?: number | null) => (n === null || n === undefined ? '—' : 'Rp ' + Math.round(n).toLocaleString('id-ID'));
export const rupiahShort = (n?: number | null) => {
  if (!n) return '—';
  if (n >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (n >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (n >= 1e3) return `Rp ${Math.round(n / 1e3)}rb`;
  return `Rp ${n}`;
};
export function time(d?: string | Date | null) {
  if (!d) return '';
  const w = toWib(new Date(d));
  return `${String(w.getUTCHours()).padStart(2, '0')}.${String(w.getUTCMinutes()).padStart(2, '0')}`;
}
export function date(d?: string | Date | null, withYear = true) {
  if (!d) return '—';
  const w = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00Z') : toWib(new Date(d));
  return `${w.getUTCDate()} ${BULAN[w.getUTCMonth()]}${withYear ? ' ' + w.getUTCFullYear() : ''}`;
}
export const dateTime = (d?: string | Date | null) => (d ? `${date(d)}, ${time(d)}` : '—');
/** "09.24", "Kemarin", "3 hari" — gaya daftar chat di prototype. */
export function relative(d?: string | Date | null) {
  if (!d) return '';
  const now = toWib(new Date());
  const w = toWib(new Date(d));
  const dayDiff = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate())) / 86_400_000);
  if (dayDiff <= 0) return time(d);
  if (dayDiff === 1) return 'Kemarin';
  if (dayDiff < 7) return `${dayDiff} hari`;
  return date(d, false);
}
export const minutesSince = (d?: string | Date | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60_000)) : 0);
export const initials = (n?: string | null) =>
  (n ?? '?')
    .replace(/^(Ibu|Bapak|Bpk|Mas|Mbak|PT|CV)\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '?';
export const todayIso = () => toWib(new Date()).toISOString().slice(0, 10);
/** Nilai untuk <input type="datetime-local"> dalam WIB. */
export const toLocalInput = (d: Date) => toWib(d).toISOString().slice(0, 16);
export const fromLocalInput = (s: string) => new Date(s + ':00+07:00');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
/** "2026-11" → "Nov 2026" */
export const monthLabel = (ym?: string | null) => (ym && /^\d{4}-\d{2}/.test(ym) ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '—');
