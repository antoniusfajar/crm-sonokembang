// Semua jam kerja & tanggal tugas dihitung dalam WIB.
export const WIB_OFFSET_MIN = 7 * 60;

export function toWib(d: Date): Date {
  return new Date(d.getTime() + WIB_OFFSET_MIN * 60_000);
}

/** Tanggal WIB (YYYY-MM-DD) dari sebuah waktu. */
export function wibDateString(d: Date): string {
  return toWib(d).toISOString().slice(0, 10);
}

/** Waktu UTC untuk tanggal WIB tertentu pada jam:menit WIB. */
export function wibAt(dateStr: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const base = new Date(`${dateStr}T00:00:00Z`).getTime();
  return new Date(base + ((h ?? 0) * 60 + (m ?? 0) - WIB_OFFSET_MIN) * 60_000);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export interface WorkingHours {
  start: string;
  end: string;
  days: number[];
}

export function isWorkingTime(d: Date, wh: WorkingHours): boolean {
  const w = toWib(d);
  if (!wh.days.includes(w.getUTCDay())) return false;
  const mins = w.getUTCHours() * 60 + w.getUTCMinutes();
  const [sh, sm] = wh.start.split(':').map(Number);
  const [eh, em] = wh.end.split(':').map(Number);
  return mins >= sh! * 60 + sm! && mins < eh! * 60 + em!;
}

/**
 * Menit kerja yang berlalu antara `from` dan `to` (di luar jam kerja tidak dihitung).
 * Dipakai untuk SLA: "Di luar jam, hitungan SLA mulai pukul 08.00".
 */
export function workingMinutesBetween(from: Date, to: Date, wh: WorkingHours): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = new Date(from.getTime());
  // Iterasi per hari agar tetap cepat untuk rentang panjang.
  for (let guard = 0; guard < 400 && cursor < to; guard++) {
    const day = wibDateString(cursor);
    const ws = wibAt(day, wh.start);
    const we = wibAt(day, wh.end);
    const dow = toWib(cursor).getUTCDay();
    if (wh.days.includes(dow)) {
      const s = Math.max(ws.getTime(), cursor.getTime());
      const e = Math.min(we.getTime(), to.getTime());
      if (e > s) total += (e - s) / 60_000;
    }
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = wibAt(next.toISOString().slice(0, 10), '00:00');
  }
  return Math.floor(total);
}

const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
/** "7 Okt 2026, 10.05" dalam WIB. */
export function wibDateTimeLabel(d: Date): string {
  const w = toWib(d);
  return `${w.getUTCDate()} ${BLN[w.getUTCMonth()]} ${w.getUTCFullYear()}, ${String(w.getUTCHours()).padStart(2, '0')}.${String(w.getUTCMinutes()).padStart(2, '0')}`;
}
