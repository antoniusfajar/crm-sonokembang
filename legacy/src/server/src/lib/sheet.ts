import { readSheet } from 'read-excel-file/node';
import { parseCsv } from './csv.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** Sel Excel → teks. Tanggal Excel tidak punya zona waktu: dibaca sebagai jam dinding (WIB). */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Serial tanggal Excel berupa pecahan hari; bulatkan ke detik terdekat (09:04:59.999 → 09:05:00).
    const d = new Date(Math.round(v.getTime() / 1000) * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  return String(v);
}

/** Baca CSV (koma/titik koma) atau Excel (.xlsx, sheet pertama) menjadi tabel teks. */
export async function readTable(buf: Buffer, filename: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(filename) || buf.subarray(0, 2).toString('latin1') === 'PK') {
    const rows = await readSheet(buf);
    return rows.map((r) => r.map(cellText));
  }
  return parseCsv(buf.toString('utf8'));
}
