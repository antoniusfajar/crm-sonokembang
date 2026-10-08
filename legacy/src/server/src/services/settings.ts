import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { settings } from '../db/schema.js';
import { DEFAULT_SETTINGS } from './defaults.js';

export async function getSetting<T = any>(db: DB, key: string): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  const def = DEFAULT_SETTINGS[key];
  if (!row) return structuredClone(def) as T;
  // Gabungkan dengan bawaan agar field baru tetap punya nilai.
  if (def && typeof def === 'object' && !Array.isArray(def) && row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
    return { ...(def as object), ...(row.value as object) } as T;
  }
  // Daftar berkunci (mis. reminder_rules): aturan baru dari versi berikutnya ikut muncul.
  if (Array.isArray(def) && Array.isArray(row.value) && def.every((d: any) => d && typeof d.key === 'string')) {
    const have = new Set((row.value as any[]).map((x) => x?.key));
    return [...(row.value as any[]), ...structuredClone(def).filter((d: any) => !have.has(d.key))] as T;
  }
  return row.value as T;
}

export async function setSetting(db: DB, key: string, value: unknown, userId?: string | null) {
  await db
    .insert(settings)
    .values({ key, value: value as any, updatedBy: userId ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as any, updatedBy: userId ?? null, updatedAt: new Date() } });
}
