import type { Ctx } from '../context.js';
import { addDays, wibDateString } from '../lib/time.js';
import { previousPeriod, resolvePeriod, salesView, summary, type Scope } from './analytics.js';
import { getSetting, setSetting } from './settings.js';

// Ringkasan mingguan dashboard (Fase 2 §tugas 12): semua angka dari script,
// AI (opsional) hanya merangkai ulang jadi 3–4 kalimat yang enak dibaca.

export interface Insight {
  icon: string;
  text: string;
  tone: 'good' | 'warn' | 'bad' | 'info';
}

export const rupiahShort = (n: number) =>
  n >= 1e9
    ? `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
    : n >= 1e6
      ? `Rp ${Math.round(n / 1e6).toLocaleString('id-ID')} jt`
      : n > 0
        ? `Rp ${Math.round(n / 1000).toLocaleString('id-ID')} rb`
        : 'Rp 0';

const change = (now: number, prev: number) => {
  if (!prev) return now ? 'belum ada pembanding minggu sebelumnya' : 'sama seperti minggu sebelumnya';
  const d = Math.round(((now - prev) / prev) * 100);
  return d === 0 ? 'sama seperti minggu sebelumnya' : `${d > 0 ? 'naik' : 'turun'} ${Math.abs(d)}% dari minggu sebelumnya (${prev.toLocaleString('id-ID')})`;
};

/** 7 hari terakhir (termasuk hari ini) vs 7 hari sebelumnya. */
export function rollingWeek(now = new Date()) {
  const to = wibDateString(now);
  const from = wibDateString(addDays(now, -6));
  const p = resolvePeriod('custom', now, { from, to });
  return { ...p, label: `7 hari terakhir (${from.slice(8)}/${from.slice(5, 7)}–${to.slice(8)}/${to.slice(5, 7)})` };
}

export async function weeklyFacts(ctx: Ctx, s: Scope, now = new Date()) {
  const week = rollingWeek(now);
  const month = resolvePeriod('this_month', now);
  const [w, m, sv] = await Promise.all([summary(ctx, week, s), summary(ctx, month, s), salesView(ctx, week, s)]);
  const [y, mo, d] = wibDateString(now).split('-').map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return {
    period: { label: week.label, start: week.startDate, end: week.endDate, prev: previousPeriod(week).startDate },
    week: w.kpi,
    month: { label: m.period.label, omzet: m.kpi.omzet, target: m.kpi.target, targetPct: m.kpi.targetPct, elapsedPct: Math.round((d / daysInMonth) * 100) },
    pipelines: m.pipelines.map((p) => ({ name: p.name, created: p.created, won: p.won, conversion: p.conversion, omzet: p.omzet })),
    stale: sv.stale.reduce((a, x) => ({ n: a.n + x.n, value: a.value + x.value }), { n: 0, value: 0 }),
    slowResponders: sv.leaderboard
      .filter((r) => r.responseAvg !== null && r.responseAvg > w.kpi.responseTarget)
      .map((r) => ({ name: r.name, responseAvg: r.responseAvg! }))
      .sort((a, b) => b.responseAvg - a.responseAvg),
    topSeller: sv.leaderboard.find((r) => r.closings > 0) ?? null,
  };
}

export type WeeklyFacts = Awaited<ReturnType<typeof weeklyFacts>>;

/** Poin ringkasan yang ditulis script — selalu ada walau AI mati. Maks 4, yang paling penting dulu. */
export function scriptInsights(f: WeeklyFacts): Insight[] {
  const out: Insight[] = [];
  const k = f.week;
  out.push({
    icon: '💬',
    tone: k.created >= k.createdPrev ? 'good' : 'warn',
    text: `${k.leadIn.toLocaleString('id-ID')} chat baru masuk, ${k.created.toLocaleString('id-ID')} jadi lead — ${change(k.created, k.createdPrev)}.`,
  });
  out.push({
    icon: '🤝',
    tone: k.closings >= k.closingsPrev ? 'good' : 'warn',
    text: k.closings
      ? `${k.closings} closing senilai ${rupiahShort(k.omzet)} (minggu sebelumnya ${k.closingsPrev} closing, ${rupiahShort(k.omzetPrev)}).`
      : `Belum ada closing dalam 7 hari terakhir (minggu sebelumnya ${k.closingsPrev}). Cek peluang di tahap Proposal & Negosiasi.`,
  });

  const warns: Insight[] = [];
  if (f.slowResponders.length) {
    const top = f.slowResponders.slice(0, 2);
    warns.push({
      icon: '⏱',
      tone: 'bad',
      text: `Respons ${top.map((x) => `${x.name} rata-rata ${x.responseAvg} menit`).join(', ')} — melewati batas ${k.responseTarget} menit. Cek beban chat & jam kerjanya sebelum menyimpulkan.`,
    });
  }
  if (f.month.target > 0 && f.month.targetPct !== null && f.month.targetPct + 10 < f.month.elapsedPct) {
    warns.push({
      icon: '🎯',
      tone: 'warn',
      text: `Omzet ${f.month.label} baru ${f.month.targetPct.toLocaleString('id-ID')}% dari target ${rupiahShort(f.month.target)}, padahal bulan sudah berjalan ${f.month.elapsedPct}%.`,
    });
  }
  if (f.stale.n >= 5) {
    warns.push({
      icon: '🧹',
      tone: 'warn',
      text: `${f.stale.n} peluang tidak disentuh lebih dari 14 hari (nilai ${rupiahShort(f.stale.value)}). Minta tim follow-up atau tandai Lost supaya pipeline bersih.`,
    });
  }
  const ranked = f.pipelines.filter((p) => p.created >= 5 && p.conversion !== null);
  const totalOmzet = f.pipelines.reduce((a, p) => a + p.omzet, 0);
  if (ranked.length >= 2) {
    const low = ranked.reduce((a, b) => (b.conversion! < a.conversion! ? b : a));
    const share = totalOmzet ? Math.round((low.omzet / totalOmzet) * 100) : 0;
    warns.push({
      icon: '📉',
      tone: 'info',
      text: `Konversi ${low.name} paling rendah bulan ini (${low.conversion!.toLocaleString('id-ID')}%)${share ? `, padahal menyumbang ${share}% omzet` : ''}. Naik sedikit saja sudah terasa ke omzet.`,
    });
  }
  return [...out, ...warns].slice(0, 4);
}

const AI_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { icon: { type: 'string' }, text: { type: 'string' } },
        required: ['icon', 'text'],
      },
    },
  },
  required: ['items'],
};

interface CacheEntry {
  items: Insight[];
  createdAt: string;
}

const cacheKey = (start: string, s: Scope) => `${start}|${s.pipelineId ?? 'all'}|${s.ownerIds?.join(',') ?? 'team'}`;

export async function cachedAiInsights(ctx: Ctx, f: WeeklyFacts, s: Scope): Promise<CacheEntry | null> {
  const cache = await getSetting<Record<string, CacheEntry>>(ctx.db, 'weekly_summary_cache');
  return cache?.[cacheKey(f.period.start, s)] ?? null;
}

/** Minta AI merangkai poin dari angka script. Hasil disimpan per periode & cakupan agar tidak bayar dua kali. */
export async function generateAiInsights(ctx: Ctx, f: WeeklyFacts, s: Scope): Promise<CacheEntry> {
  const r = await ctx.ai.complete('weekly_summary', 'smart', {
    system: [
      'Kamu analis penjualan untuk perusahaan catering. Tulis ringkasan mingguan untuk pemilik & SPV.',
      'Aturan: pakai HANYA angka dari data JSON, jangan menghitung atau mengarang angka baru.',
      'Tulis 3–4 poin, tiap poin 1–2 kalimat bahasa Indonesia yang ringan, langsung ke inti, tanpa basa-basi.',
      'Utamakan hal yang perlu ditindaklanjuti. Sebut nama orang hanya bila ada di data. Setiap poin diberi 1 emoji sebagai ikon.',
    ].join('\n'),
    messages: [{ role: 'user', content: JSON.stringify(f) }],
    maxTokens: 800,
    jsonSchema: AI_SCHEMA,
  });
  const json = r.json as { items?: { icon?: string; text?: string }[] } | undefined;
  const items = (json?.items ?? [])
    .filter((x) => typeof x?.text === 'string' && x.text.trim())
    .slice(0, 4)
    .map((x) => ({ icon: (x.icon ?? '•').slice(0, 4), text: x.text!.trim().slice(0, 400), tone: 'info' as const }));
  if (!items.length) throw new Error('Format jawaban AI tidak sesuai');
  const entry = { items, createdAt: new Date().toISOString() };
  const cache = await getSetting<Record<string, CacheEntry>>(ctx.db, 'weekly_summary_cache');
  // Simpan hanya entri 14 hari terakhir.
  const keep = wibDateString(addDays(new Date(), -14));
  const next = Object.fromEntries(Object.entries(cache ?? {}).filter(([key]) => key.slice(0, 10) >= keep));
  next[cacheKey(f.period.start, s)] = entry;
  await setSetting(ctx.db, 'weekly_summary_cache', next);
  return entry;
}
