import { desc, eq } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { reports } from '../db/schema.js';
import { marketingView, openPipeline, resolvePeriod, salesView, summary, type Period, type PeriodKey, type Scope } from './analytics.js';
import { rupiahShort } from './insights.js';
import { getSetting } from './settings.js';
import type { AiSettings } from '../ai/service.js';

// Laporan AI (Fase 2 §3): script menghitung semua angka → AI menulis ringkasan, temuan,
// rekomendasi → pengguna cek pratinjau → unduh PDF/PPTX atau kirim terjadwal.

export type ReportType = 'exec' | 'sales' | 'team' | 'mkt' | 'rep';
export type Audience = 'dir' | 'spv' | 'tim';

export const REPORT_TYPES: Record<ReportType, { title: string; desc: string; available: boolean }> = {
  exec: { title: 'Ringkasan direksi', desc: 'Satu halaman untuk rapat bulanan: angka utama + 3 keputusan', available: true },
  sales: { title: 'Penjualan & pipeline', desc: 'Lead masuk, konversi per tahap, closing, omzet vs target', available: true },
  team: { title: 'Kinerja tim sales', desc: 'Kecepatan respons, follow-up, closing per sales', available: true },
  mkt: { title: 'Marketing & sumber lead', desc: 'Sumber lead terbaik, konversi & omzet per sumber', available: true },
  rep: { title: 'Reputasi & media sosial', desc: 'Ulasan Google, balasan, kompetitor, performa IG/TikTok/Facebook', available: true },
};

export const AUDIENCES: Record<Audience, { label: string; style: string }> = {
  dir: { label: 'Direksi', style: 'Singkat, fokus angka & keputusan. Kalimat pendek, tanpa istilah teknis.' },
  spv: { label: 'SPV', style: 'Detail per sales & tindakan coaching yang konkret.' },
  tim: { label: 'Tim', style: 'Bahasa sederhana dan menyemangati, fokus target & apresiasi, tanpa menyalahkan orang.' },
};

export const REPORT_PERIODS: [PeriodKey, string][] = [
  ['this_week', 'Minggu ini'],
  ['last_week', 'Minggu lalu'],
  ['this_month', 'Bulan ini'],
  ['last_month', 'Bulan lalu'],
  ['this_quarter', 'Kuartal ini'],
  ['last_quarter', 'Kuartal lalu'],
];

export interface Kpi {
  label: string;
  value: string;
  note: string;
  tone: 'good' | 'bad' | 'neutral';
}
export interface ReportData {
  kpis: Kpi[];
  chart: { title: string; unit: string; bars: { label: string; value: number }[] };
  table: { title: string; head: string[]; rows: string[][] } | null;
  facts: Record<string, unknown>;
  model?: string | null;
  aiError?: string | null;
}
export interface Narrative {
  summary: string;
  findings: string[];
  recommendations: string[];
}

const pctTxt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
const n = (v: number) => v.toLocaleString('id-ID');
const delta = (now: number, prev: number) => {
  if (!prev) return now ? 'baru' : 'sama';
  const d = Math.round(((now - prev) / prev) * 100);
  return `${d > 0 ? '+' : ''}${d}% vs periode lalu`;
};
const tone = (good: boolean | null): Kpi['tone'] => (good === null ? 'neutral' : good ? 'good' : 'bad');
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

/** Hitung semua angka laporan + narasi cadangan (dipakai bila AI mati/gagal). */
export async function buildReportData(ctx: Ctx, type: ReportType, p: Period, s: Scope): Promise<{ data: ReportData; fallback: Narrative }> {
  const [sum, sales, mkt, open] = await Promise.all([summary(ctx, p, s), salesView(ctx, p, s), marketingView(ctx, p, s), openPipeline(ctx, s)]);
  const k = sum.kpi;
  const kpiCfg = await getSetting<{ responseMinutes: number; followUpPct: number; closingRatePct: number }>(ctx.db, 'kpi_targets');
  const lb = sales.leaderboard.filter((r) => r.leads || r.closings || r.active);
  const topLost = sales.lost.slice(0, 3);
  const srcRanked = mkt.sources.filter((x) => x.name !== 'Tanpa sumber');
  const bestConv = srcRanked.filter((x) => x.leads >= 5 && x.conversion !== null).sort((a, b) => b.conversion! - a.conversion!)[0];
  const biggestDrop = sales.funnel.filter((f) => f.dropPct !== null).sort((a, b) => b.dropPct! - a.dropPct!)[0];
  const slow = lb.filter((r) => r.responseAvg !== null && r.responseAvg > kpiCfg.responseMinutes);
  const staleN = sales.stale.reduce((a, x) => a + x.n, 0);
  const staleV = sales.stale.reduce((a, x) => a + x.value, 0);
  const noSource = mkt.sources.find((x) => x.name === 'Tanpa sumber');

  const facts = {
    periode: sum.period,
    kpi: k,
    targetKpi: kpiCfg,
    perPipeline: sum.pipelines.map((x) => ({ nama: x.name, peluang: x.created, closing: x.won, lost: x.lost, konversi: x.conversion, omzet: x.omzet, target: x.target, pencapaian: x.targetPct })),
    peluangTerbuka: open,
    peluangMandek14Hari: { jumlah: staleN, nilai: staleV },
    funnel: sales.funnel,
    alasanLost: topLost,
    sales: lb.map((r) => ({ nama: r.name, peran: r.role, peluang: r.leads, closing: r.closings, omzet: r.omzet, target: r.target, pencapaian: r.targetPct, konversi: r.conversion, responsMenit: r.responseAvg, slaPct: r.slaPct, followUpPct: r.followUpPct })),
    sumber: mkt.sources.slice(0, 8).map((x) => ({ nama: x.name, lead: x.leads, porsi: x.share, closing: x.closings, konversi: x.conversion, omzet: x.omzet })),
  };

  const omzetLine = `Omzet ${rupiahShort(k.omzet)}${k.target ? ` (${pctTxt(k.targetPct)} dari target ${rupiahShort(k.target)})` : ''} dari ${k.closings} closing`;
  const respLine = k.responseAvg !== null ? `respons sales rata-rata ${k.responseAvg} menit (batas ${k.responseTarget} menit)` : 'belum ada data respons sales';
  const findingsCommon = [
    biggestDrop && biggestDrop.dropPct! > 0 ? `Kebocoran terbesar di tahap ${biggestDrop.name}: ${biggestDrop.dropPct}% gugur dari tahap sebelumnya.` : null,
    topLost[0] ? `Alasan kalah terbanyak: ${topLost[0].reason} (${pctTxt(topLost[0].pct)} dari lead yang ditutup).` : null,
    slow.length ? `Respons ${slow.map((r) => `${r.name} ${r.responseAvg} mnt`).join(', ')} melewati batas ${kpiCfg.responseMinutes} menit.` : null,
    staleN ? `${n(staleN)} peluang tidak disentuh > 14 hari, nilainya ${rupiahShort(staleV)}.` : null,
  ].filter(Boolean) as string[];
  const recsCommon = [
    slow.length ? 'Aktifkan eskalasi SLA ke SPV dan cek beban chat sales yang lambat.' : null,
    staleN ? 'Minta tim membersihkan peluang mandek: follow-up ulang atau tandai Lost dengan alasannya.' : null,
    topLost[0]?.reason.toLowerCase().includes('harga') ? 'Siapkan paket dengan harga per pax lebih ringan untuk segmen budget.' : null,
    biggestDrop?.name.toLowerCase().includes('proposal') ? 'Kirim proposal paling lambat H+5 untuk lead Hot & Warm.' : null,
    'Pantau angka ini lagi di laporan berikutnya untuk melihat dampak tindakan.',
  ].filter(Boolean) as string[];

  let data: ReportData;
  let fallback: Narrative;
  switch (type) {
    case 'rep': {
      const { reviews: rv, competitors: cp } = await import('../db/schema.js');
      const { and: a2, gte: g2, lt: l2 } = await import('drizzle-orm');
      const { socialView } = await import('./marketing.js');
      const inP = await ctx.db.select().from(rv).where(a2(g2(rv.reviewedAt, p.start), l2(rv.reviewedAt, p.end)));
      const allR = await ctx.db.select({ rating: rv.rating }).from(rv);
      const comps = await ctx.db.select().from(cp);
      const avgR = (xs: { rating: number }[]) => (xs.length ? Math.round((xs.reduce((x, y) => x + y.rating, 0) / xs.length) * 10) / 10 : null);
      const soc = await socialView(ctx, { from: p.startDate, to: p.endDate });
      const unreplied = inP.filter((r) => r.replyStatus !== 'sent');
      const low = inP.filter((r) => r.rating <= 3);
      const label = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' } as Record<string, string>;
      data = {
        kpis: [
          { label: 'Rating periode ini', value: avgR(inP) === null ? '—' : String(avgR(inP)).replace('.', ','), note: `total ${String(avgR(allR) ?? '—').replace('.', ',')} dari ${n(allR.length)} ulasan`, tone: tone(avgR(inP) === null ? null : avgR(inP)! >= 4.5) },
          { label: 'Ulasan baru', value: n(inP.length), note: `${low.length} ulasan ≤3★`, tone: tone(low.length === 0) },
          { label: 'Belum dibalas', value: n(unreplied.length), note: unreplied.length ? 'perlu dibalas' : 'semua sudah dibalas', tone: tone(unreplied.length === 0) },
          { label: 'Impressions sosmed', value: n(soc.kpi.impressions), note: delta(soc.kpi.impressions, soc.kpi.prev.impressions), tone: tone(soc.kpi.impressions >= soc.kpi.prev.impressions) },
        ],
        chart: { title: 'Impressions per platform', unit: '', bars: soc.perPlatform.filter((x) => x.posts || x.connected).map((x) => ({ label: label[x.provider] ?? x.provider, value: x.impressions })) },
        table: {
          title: 'Performa per platform',
          head: ['Platform', 'Posting', 'Likes', 'Komentar', 'Share', 'Impressions'],
          rows: soc.perPlatform.map((x) => [label[x.provider] ?? x.provider, n(x.posts), n(x.likes), n(x.comments), n(x.shares), n(x.impressions)]),
        },
        facts: {
          periode: sum.period,
          ulasan: { jumlah: inP.length, rataRata: avgR(inP), totalRataRata: avgR(allR), totalUlasan: allR.length, rendah: low.map((r) => ({ bintang: r.rating, teks: r.text.slice(0, 200) })).slice(0, 10), belumDibalas: unreplied.length },
          kompetitor: comps.map((c) => ({ nama: c.name, rating: c.rating, ulasan: c.reviewCount, kelemahan: c.analysis?.weaknesses ?? [] })),
          sosmed: soc.perPlatform.map((x) => ({ platform: x.provider, posting: x.posts, likes: x.likes, komentar: x.comments, share: x.shares, impressions: x.impressions, impressionsSebelumnya: x.impressionsPrev, pengikut: x.followers })),
          postingTeratas: soc.top.map((t) => ({ platform: t.provider, caption: t.caption.slice(0, 100), likes: t.likes })),
        },
      };
      const best = comps.filter((c) => c.rating !== null).sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0))[0];
      fallback = {
        summary: `${sum.period.label}: ${n(inP.length)} ulasan Google baru${avgR(inP) !== null ? ` dengan rata-rata ${String(avgR(inP)).replace('.', ',')}★` : ''}; rating keseluruhan ${String(avgR(allR) ?? '—').replace('.', ',')} dari ${n(allR.length)} ulasan. Media sosial: ${n(soc.kpi.posts)} posting, ${n(soc.kpi.impressions)} impressions (${delta(soc.kpi.impressions, soc.kpi.prev.impressions)}).`,
        findings: [
          ...(low.length ? [`${low.length} ulasan ≤3★ di periode ini — baca keluhannya di menu Reputasi.`] : ['Tidak ada ulasan ≤3★ di periode ini.']),
          ...(unreplied.length ? [`${unreplied.length} ulasan belum dibalas.`] : []),
          ...(best && avgR(allR) !== null && (best.rating ?? 0) > avgR(allR)! ? [`Rating ${best.name} (${String(best.rating).replace('.', ',')}) lebih tinggi dari kita.`] : []),
          ...(soc.top[0] ? [`Posting terbaik: "${soc.top[0].caption.slice(0, 60)}…" (${n(soc.top[0].likes)} likes).`] : []),
        ].slice(0, 3),
        recommendations: [
          ...(unreplied.length ? ['Balas semua ulasan yang tersisa (AI bisa membuat draf).'] : []),
          'Aktifkan permintaan ulasan otomatis H+1 setelah acara untuk menambah jumlah ulasan.',
          ...(soc.top[0] ? ['Buat lebih banyak konten serupa posting terbaik periode ini.'] : ['Jadwalkan minimal 3 posting per minggu di menu Media Sosial.']),
        ].slice(0, 3),
      };
      break;
    }
    case 'exec':
      data = {
        kpis: [
          { label: 'Omzet', value: rupiahShort(k.omzet), note: k.target ? `${pctTxt(k.targetPct)} dari target` : delta(k.omzet, k.omzetPrev), tone: tone(k.target ? (k.targetPct ?? 0) >= 100 : k.omzet >= k.omzetPrev) },
          { label: 'Peluang baru', value: n(k.created), note: delta(k.created, k.createdPrev), tone: tone(k.created >= k.createdPrev) },
          { label: 'Closing', value: n(k.closings), note: `konversi ${pctTxt(k.conversion)}`, tone: tone(k.conversion === null ? null : k.conversion >= kpiCfg.closingRatePct) },
          { label: 'Respons sales', value: k.responseAvg !== null ? `${k.responseAvg} mnt` : '—', note: `batas ${k.responseTarget} mnt`, tone: tone(k.responseAvg === null ? null : k.responseAvg <= k.responseTarget) },
        ],
        chart: { title: 'Omzet per pipeline (Rp jt)', unit: 'jt', bars: sum.pipelines.map((x) => ({ label: x.name, value: Math.round(x.omzet / 100_000) / 10 })) },
        table: null,
        facts,
      };
      fallback = {
        summary: `${sum.period.label}: ${omzetLine}, dengan ${n(k.created)} peluang baru (${delta(k.created, k.createdPrev)}) dan konversi ${pctTxt(k.conversion)}. ${respLine.charAt(0).toUpperCase() + respLine.slice(1)}.`,
        findings: findingsCommon.slice(0, 3),
        recommendations: recsCommon.slice(0, 3),
      };
      break;
    case 'sales':
      data = {
        kpis: [
          { label: 'Peluang baru', value: n(k.created), note: delta(k.created, k.createdPrev), tone: tone(k.created >= k.createdPrev) },
          { label: 'Proposal terkirim', value: n(lb.reduce((a, r) => a + r.proposals, 0)), note: 'dalam periode', tone: 'neutral' },
          { label: 'Closing', value: n(k.closings), note: delta(k.closings, k.closingsPrev), tone: tone(k.closings >= k.closingsPrev) },
          { label: 'Nilai pipeline terbuka', value: rupiahShort(open.value), note: `${n(open.n)} peluang aktif`, tone: 'neutral' },
        ],
        chart: { title: 'Peluang per tahap (funnel)', unit: 'lead', bars: sales.funnel.map((f) => ({ label: f.name, value: f.n })) },
        table: topLost.length ? { title: 'Alasan kalah (Lost / Abandoned)', head: ['Alasan', 'Jumlah', 'Porsi'], rows: sales.lost.slice(0, 6).map((l) => [l.reason, n(l.n), pctTxt(l.pct)]) } : null,
        facts,
      };
      fallback = {
        summary: `${sum.period.label}: ${n(k.created)} peluang baru, ${n(k.closings)} closing (konversi ${pctTxt(k.conversion)}). ${omzetLine}. Saat ini ada ${n(open.n)} peluang aktif senilai ${rupiahShort(open.value)}.`,
        findings: findingsCommon.slice(0, 3),
        recommendations: recsCommon.slice(0, 3),
      };
      break;
    case 'team': {
      const sla = avg(lb.map((r) => r.slaPct));
      const fu = avg(lb.map((r) => r.followUpPct));
      const top = [...lb].sort((a, b) => b.closings - a.closings || b.omzet - a.omzet)[0];
      data = {
        kpis: [
          { label: 'Respons rata-rata', value: k.responseAvg !== null ? `${k.responseAvg} mnt` : '—', note: `batas ${k.responseTarget} mnt`, tone: tone(k.responseAvg === null ? null : k.responseAvg <= k.responseTarget) },
          { label: 'SLA terpenuhi', value: pctTxt(sla), note: `dibalas ≤ ${sales.slaLevel1} mnt`, tone: tone(sla === null ? null : sla >= 80) },
          { label: 'Follow-up terlaksana', value: pctTxt(fu), note: `target ${kpiCfg.followUpPct}%`, tone: tone(fu === null ? null : fu >= kpiCfg.followUpPct) },
          { label: 'Closing tim', value: n(k.closings), note: `konversi ${pctTxt(k.conversion)}`, tone: tone(k.conversion === null ? null : k.conversion >= kpiCfg.closingRatePct) },
        ],
        chart: { title: 'Closing per sales', unit: 'closing', bars: lb.map((r) => ({ label: r.name, value: r.closings })) },
        table: {
          title: 'Rincian per sales',
          head: ['Sales', 'Peluang', 'Closing', 'Omzet', 'vs target', 'Respons', 'SLA', 'Follow-up'],
          rows: lb.map((r) => [r.name, n(r.leads), n(r.closings), rupiahShort(r.omzet), pctTxt(r.targetPct), r.responseAvg !== null ? `${r.responseAvg} mnt` : '—', pctTxt(r.slaPct), pctTxt(r.followUpPct)]),
        },
        facts,
      };
      fallback = {
        summary: `${sum.period.label}: tim mencatat ${n(k.closings)} closing dengan omzet ${rupiahShort(k.omzet)}${k.target ? ` (${pctTxt(k.targetPct)} dari target ${rupiahShort(k.target)})` : ''}. ${top ? `${top.name} memimpin dengan ${top.closings} closing.` : ''} ${respLine.charAt(0).toUpperCase() + respLine.slice(1)}.`.replace(/\s+/g, ' ').trim(),
        findings: [
          ...(slow.length ? [`Respons ${slow.map((r) => `${r.name} ${r.responseAvg} mnt`).join(', ')} melewati batas.`] : []),
          ...(fu !== null && fu < kpiCfg.followUpPct ? [`Follow-up terlaksana ${pctTxt(fu)}, di bawah target ${kpiCfg.followUpPct}%.`] : []),
          ...lb.filter((r) => r.targetPct !== null && r.targetPct >= 100).map((r) => `${r.name} sudah melewati target (${pctTxt(r.targetPct)}).`),
          ...findingsCommon,
        ].slice(0, 3),
        recommendations: [
          ...(slow.length ? [`Sesi coaching SPV untuk ${slow.map((r) => r.name).join(' & ')} soal kecepatan respons.`] : []),
          'Bagikan cara kerja sales dengan konversi tertinggi di rapat tim.',
          ...recsCommon,
        ].slice(0, 3),
      };
      break;
    }
    case 'mkt': {
      const top = srcRanked[0];
      // Biaya hanya ada untuk kanal berbayar yang tercatat (iklan Meta & broadcast).
      const paid = mkt.sources.filter((x) => x.cost);
      const paidCost = paid.reduce((a, x) => a + (x.cost ?? 0), 0);
      const paidLeads = paid.reduce((a, x) => a + x.leads, 0);
      const cheapest = paid.filter((x) => x.costPerLead).sort((a, b) => a.costPerLead! - b.costPerLead!)[0];
      const costLine = paidCost ? `Biaya iklan & broadcast ${rupiahShort(paidCost)}${paidLeads ? `, rata-rata ${rupiahShort(Math.round(paidCost / paidLeads))} per lead` : ''}.` : 'Belum ada biaya iklan atau broadcast yang tercatat.';
      data = {
        kpis: [
          { label: 'Peluang baru', value: n(k.created), note: delta(k.created, k.createdPrev), tone: tone(k.created >= k.createdPrev) },
          { label: 'Sumber terbanyak', value: top ? top.name : '—', note: top ? `${n(top.leads)} lead · ${pctTxt(top.share)}` : '', tone: 'neutral' },
          { label: 'Konversi terbaik', value: bestConv ? bestConv.name : '—', note: bestConv ? `${pctTxt(bestConv.conversion)} jadi closing` : 'min. 5 lead', tone: 'good' },
          { label: 'Lead tanpa sumber', value: pctTxt(noSource?.share ?? 0), note: 'idealnya di bawah 10%', tone: tone((noSource?.share ?? 0) <= 10) },
        ],
        chart: { title: 'Peluang per sumber', unit: 'lead', bars: mkt.sources.slice(0, 8).map((x) => ({ label: x.name, value: x.leads })) },
        table: {
          title: 'Sumber lead',
          head: ['Sumber', 'Lead', 'Porsi', 'Closing', 'Konversi', 'Biaya/lead', 'Omzet'],
          rows: mkt.sources.slice(0, 10).map((x) => [x.name, n(x.leads), pctTxt(x.share), n(x.closings), pctTxt(x.conversion), x.costPerLead ? rupiahShort(x.costPerLead) : '—', rupiahShort(x.omzet)]),
        },
        facts,
      };
      fallback = {
        summary: `${sum.period.label}: ${n(k.created)} peluang baru (${delta(k.created, k.createdPrev)}). ${top ? `${top.name} menyumbang lead terbanyak (${pctTxt(top.share)}).` : ''} ${bestConv ? `Konversi terbaik dari ${bestConv.name} (${pctTxt(bestConv.conversion)}).` : ''} ${costLine}`.replace(/\s+/g, ' ').trim(),
        findings: [
          ...(top ? [`${top.name} memberi ${n(top.leads)} lead, konversinya ${pctTxt(top.conversion)}.`] : []),
          ...(bestConv && bestConv !== top ? [`${bestConv.name} lebih sedikit lead tapi konversinya ${pctTxt(bestConv.conversion)}.`] : []),
          ...((noSource?.share ?? 0) > 10 ? [`${pctTxt(noSource!.share)} lead belum tercatat sumbernya — laporan jadi kurang akurat.`] : []),
          ...findingsCommon,
        ].slice(0, 3),
        recommendations: [
          ...(bestConv ? [`Perbesar porsi ${bestConv.name} karena konversinya paling tinggi.`] : []),
          ...((noSource?.share ?? 0) > 10 ? ['Pakai link WA bertanda sumber di setiap iklan & bio agar sumber terisi otomatis.'] : []),
          ...(paidCost
            ? cheapest
              ? [`Kanal berbayar termurah per lead: ${cheapest.name} (${rupiahShort(cheapest.costPerLead!)}). Bandingkan juga dengan kualitas & closing-nya.`]
              : []
            : ['Hubungkan Meta Ads atau isi belanja iklan manual di menu Meta Ads agar biaya per lead terhitung.']),
          ...recsCommon,
        ].slice(0, 3),
      };
      break;
    }
  }
  return { data, fallback };
}

const NARRATIVE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'recommendations'],
};

function cleanNarrative(x: unknown): Narrative | null {
  const o = x as Partial<Narrative> | null;
  if (!o || typeof o.summary !== 'string' || !o.summary.trim() || !Array.isArray(o.findings) || !Array.isArray(o.recommendations)) return null;
  const list = (a: unknown[]) => a.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim().slice(0, 400)).slice(0, 4);
  return { summary: o.summary.trim().slice(0, 1200), findings: list(o.findings), recommendations: list(o.recommendations) };
}

export async function writeNarrative(ctx: Ctx, type: ReportType, audience: Audience, data: ReportData, notes: string | null): Promise<{ narrative: Narrative; model: string }> {
  const biz = await getSetting<{ name: string }>(ctx.db, 'business_profile');
  const r = await ctx.ai.complete('report', 'smart', {
    system: [
      `Kamu analis bisnis untuk ${biz.name}, perusahaan catering (wedding, acara kantor, syukuran, kantin).`,
      `Tulis narasi laporan "${REPORT_TYPES[type].title}" dalam bahasa Indonesia untuk pembaca: ${AUDIENCES[audience].label}. Gaya: ${AUDIENCES[audience].style}`,
      'Aturan wajib:',
      '- Pakai HANYA angka yang ada di data JSON. Jangan menghitung ulang, jangan mengarang angka, persentase, atau nama baru.',
      '- summary: ringkasan eksekutif 2–4 kalimat.',
      '- findings: tepat 3 temuan, masing-masing 1 kalimat yang menyebut angka pendukung.',
      '- recommendations: tepat 3 rekomendasi tindakan yang konkret dan bisa dikerjakan bulan depan.',
      '- Angka rupiah tulis ringkas (mis. Rp 1,2 M atau Rp 350 jt).',
      notes ? `Catatan dari pengguna (prioritaskan bila relevan): ${notes.slice(0, 500)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    messages: [{ role: 'user', content: JSON.stringify({ kpis: data.kpis, grafik: data.chart, tabel: data.table, data: data.facts }) }],
    maxTokens: 1500,
    jsonSchema: NARRATIVE_SCHEMA,
  });
  const nar = cleanNarrative(r.json);
  if (!nar) throw new Error('Format jawaban AI tidak sesuai');
  return { narrative: nar, model: r.model };
}

export interface CreateReportInput {
  type: ReportType;
  period: PeriodKey;
  audience: Audience;
  format: 'pdf' | 'pptx';
  notes?: string | null;
  scope?: Scope;
  useAi?: boolean;
}

/** Hitung angka, minta narasi AI (cadangan: narasi script), simpan ke riwayat. */
export async function createReport(ctx: Ctx, input: CreateReportInput, userId: string | null, scheduleId: string | null = null, now = new Date()) {
  if (!REPORT_TYPES[input.type].available) throw new Error(`${REPORT_TYPES[input.type].title} belum tersedia`);
  const p = resolvePeriod(input.period, now);
  const { data, fallback } = await buildReportData(ctx, input.type, p, input.scope ?? {});
  let narrative = fallback;
  let aiUsed = false;
  if (input.useAi !== false) {
    const ai = await getSetting<AiSettings>(ctx.db, 'ai');
    if (ai.enabled) {
      try {
        const r = await writeNarrative(ctx, input.type, input.audience, data, input.notes ?? null);
        narrative = r.narrative;
        data.model = r.model;
        aiUsed = true;
      } catch (e) {
        data.aiError = (e as Error).message.slice(0, 300);
      }
    } else data.aiError = 'AI sedang dimatikan — narasi ditulis sistem dari angka.';
  }
  const [row] = await ctx.db
    .insert(reports)
    .values({
      type: input.type,
      title: REPORT_TYPES[input.type].title,
      periodLabel: p.label,
      periodStart: p.startDate,
      periodEnd: p.endDate,
      audience: input.audience,
      format: input.format,
      notes: input.notes ?? null,
      data: data as unknown as Record<string, unknown>,
      narrative,
      aiUsed,
      scheduleId,
      createdBy: userId,
    })
    .returning();
  return row!;
}

export async function listReports(ctx: Ctx, limit = 100) {
  return ctx.db.select().from(reports).orderBy(desc(reports.createdAt)).limit(limit);
}

export async function getReport(ctx: Ctx, id: string) {
  const [r] = await ctx.db.select().from(reports).where(eq(reports.id, id));
  return r ?? null;
}
