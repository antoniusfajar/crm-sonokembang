import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import pptxgenImport from 'pptxgenjs';
import type { Ctx } from '../context.js';
import type { reports } from '../db/schema.js';
import { AUDIENCES, type Audience, type Narrative, type ReportData } from './reports.js';
import { getSetting } from './settings.js';
import { wibDateTimeLabel as dateTime } from '../lib/time.js';

type Report = typeof reports.$inferSelect;

const C = { rose: '#db6262', red: '#c6040d', dark: '#201c1a', body: '#3d3733', muted: '#857a72', line: '#ebe3dc', cream: '#fbf5ef', good: '#46701a', bad: '#c6040d' };

interface Brand {
  name: string;
  logoFile: string | null;
}

export async function brand(ctx: Ctx): Promise<Brand> {
  const biz = await getSetting<{ name: string; logoPath?: string | null }>(ctx.db, 'business_profile');
  const f = biz.logoPath ? path.join(path.resolve(ctx.config.UPLOAD_DIR), path.basename(biz.logoPath)) : null;
  return { name: biz.name, logoFile: f && fs.existsSync(f) ? f : null };
}

export function reportFileName(r: Report, ext: 'pdf' | 'pptx') {
  const slug = `${r.title} ${r.periodLabel}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}.${ext}`;
}

const metaLine = (r: Report) => `${r.periodLabel} · untuk ${AUDIENCES[r.audience as Audience]?.label ?? r.audience}`;
const sourceLine = (r: Report) => {
  const d = r.data as unknown as ReportData;
  return `Dibuat otomatis oleh CRM · ${dateTime(r.createdAt)} WIB · angka dari data sistem, narasi ${r.aiUsed ? `oleh AI${d.model ? ` (${d.model})` : ''}, sudah bisa diedit` : 'ditulis sistem'}`;
};

// Font standar PDF (WinAnsi) tidak punya semua karakter Unicode — ganti yang umum, buang sisanya (mis. emoji).
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function pdfSafe(s: string): string {
  return s
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/≈/g, '~')
    .replace(/[↑▲]/g, '+')
    .replace(/[↓▼]/g, '-')
    .replace(/[  ]/g, ' ')
    .replace(/./gu, (ch) => (ch.charCodeAt(0) <= 0xff || WINANSI_EXTRA.includes(ch) ? ch : ''));
}

// ---------------------------------------------------------------- PDF

export function renderReportPdf(r: Report, b: Brand): Promise<Buffer> {
  const d = r.data as unknown as ReportData;
  const nar = r.narrative as Narrative;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `${r.title} — ${r.periodLabel}`, Author: b.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 96;
    const X = 48;
    const t = (s: string) => pdfSafe(s);
    const ensure = (h: number) => {
      if (doc.y + h > doc.page.height - 64) doc.addPage();
    };
    const label = (s: string) => {
      ensure(40);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.red).text(t(s.toUpperCase()), X, doc.y, { characterSpacing: 0.6 });
      doc.moveDown(0.4);
    };

    // Kop
    doc.rect(0, 0, doc.page.width, 6).fill(C.red);
    let left = X;
    if (b.logoFile) {
      try {
        doc.image(b.logoFile, X, 30, { fit: [48, 48] });
        left = X + 60;
      } catch {
        // logo tidak terbaca → kop tanpa logo
      }
    }
    doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(t(b.name), left, 34);
    doc.font('Times-Bold').fontSize(20).fillColor(C.dark).text(t(r.title), left, 47);
    doc.font('Helvetica').fontSize(10).fillColor(C.muted).text(t(metaLine(r)), left, doc.y + 2);
    doc.y = Math.max(doc.y, 86) + 14;
    doc.moveTo(X, doc.y).lineTo(X + W, doc.y).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.moveDown(1);

    // Ringkasan
    label(r.aiUsed ? 'Ringkasan eksekutif · ditulis AI' : 'Ringkasan eksekutif');
    doc.font('Helvetica').fontSize(11).fillColor(C.body).text(t(nar.summary), X, doc.y, { width: W, lineGap: 3 });
    doc.moveDown(1.2);

    // 4 angka utama
    ensure(80);
    const gap = 10;
    const bw = (W - gap * 3) / 4;
    const top = doc.y;
    d.kpis.slice(0, 4).forEach((k, i) => {
      const x = X + i * (bw + gap);
      doc.roundedRect(x, top, bw, 66, 6).fillAndStroke(C.cream, C.line);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.muted).text(t(k.label.toUpperCase()), x + 10, top + 10, { width: bw - 20, characterSpacing: 0.4 });
      doc.font('Helvetica-Bold').fontSize(15).fillColor(C.dark).text(t(k.value), x + 10, top + 24, { width: bw - 20, lineBreak: false, ellipsis: true });
      doc.font('Helvetica').fontSize(8).fillColor(k.tone === 'good' ? C.good : k.tone === 'bad' ? C.bad : C.muted).text(t(k.note), x + 10, top + 46, { width: bw - 20, lineBreak: false, ellipsis: true });
    });
    doc.y = top + 66 + 22;

    // Grafik batang horizontal
    if (d.chart.bars.length) {
      label(d.chart.title);
      const max = Math.max(1, ...d.chart.bars.map((x) => x.value));
      const lw = 130;
      const vw = 60;
      for (const bar of d.chart.bars) {
        ensure(20);
        const y = doc.y;
        doc.font('Helvetica').fontSize(9.5).fillColor(C.body).text(t(bar.label), X, y + 1, { width: lw - 8, lineBreak: false, ellipsis: true });
        const tw = W - lw - vw;
        doc.roundedRect(X + lw, y + 2, tw, 9, 4.5).fill(C.line);
        if (bar.value > 0) doc.roundedRect(X + lw, y + 2, Math.max(9, (bar.value / max) * tw), 9, 4.5).fill(C.rose);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.dark).text(t(bar.value.toLocaleString('id-ID')), X + lw + tw, y + 1, { width: vw, align: 'right' });
        doc.y = y + 18;
      }
      doc.moveDown(1);
    }

    // Temuan & rekomendasi
    const list = (title: string, items: string[], mark: (i: number) => string) => {
      label(title);
      items.forEach((it, i) => {
        ensure(30);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.rose).text(mark(i), X, y, { width: 16 });
        doc.font('Helvetica').fontSize(10.5).fillColor(C.body).text(t(it), X + 18, y, { width: W - 18, lineGap: 2 });
        doc.moveDown(0.5);
      });
      doc.moveDown(0.8);
    };
    list('Temuan', nar.findings, () => '•');
    list('Rekomendasi', nar.recommendations, (i) => `${i + 1}.`);

    // Tabel rincian
    if (d.table && d.table.rows.length) {
      label(d.table.title);
      const cols = d.table.head.length;
      const first = Math.min(160, W * 0.3);
      const cw = (W - first) / Math.max(1, cols - 1);
      const colX = (i: number) => (i === 0 ? X : X + first + (i - 1) * cw);
      const colW = (i: number) => (i === 0 ? first : cw);
      const row = (cells: string[], head: boolean) => {
        if (doc.y + 22 > doc.page.height - 64) {
          doc.addPage();
          if (!head) row(d.table!.head, true); // ulangi judul kolom di halaman baru
        }
        const y = doc.y;
        cells.forEach((c, i) => {
          doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 7.5 : 9).fillColor(head ? C.muted : C.body).text(t(head ? c.toUpperCase() : c), colX(i) + 2, y + 5, { width: colW(i) - 4, align: i === 0 ? 'left' : 'right', lineBreak: false, ellipsis: true });
        });
        doc.moveTo(X, y + 20).lineTo(X + W, y + 20).lineWidth(0.5).strokeColor(C.line).stroke();
        doc.y = y + 21;
      };
      row(d.table.head, true);
      for (const r2 of d.table.rows) row(r2, false);
      doc.moveDown(1);
    }

    // Kaki halaman
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(t(`${sourceLine(r)} · halaman ${i + 1} dari ${range.count}`), X, doc.page.height - 36, { width: W, align: 'center', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

// ---------------------------------------------------------------- PPTX (5 slide 16:9)

const hex = (c: string) => c.replace('#', '').toUpperCase();

// pptxgenjs memakai tipe gaya CommonJS; saat runtime ESM ekspor default-nya langsung kelasnya.
const PptxGenJS = ((pptxgenImport as unknown as { default?: unknown }).default ?? pptxgenImport) as typeof pptxgenImport.default;
type Slide = ReturnType<InstanceType<typeof PptxGenJS>['addSlide']>;

export async function renderReportPptx(r: Report, b: Brand): Promise<Buffer> {
  const d = r.data as unknown as ReportData;
  const nar = r.narrative as Narrative;
  const P = new PptxGenJS();
  P.layout = 'LAYOUT_WIDE'; // 13,33 × 7,5 inci
  P.author = b.name;
  P.title = `${r.title} — ${r.periodLabel}`;
  const font = 'Calibri';
  const footer = (s: Slide, n: number) => {
    s.addText(`${b.name} · ${r.title} · ${r.periodLabel}`, { x: 0.6, y: 7.0, w: 9, h: 0.3, fontFace: font, fontSize: 9, color: hex(C.muted) });
    s.addText(String(n), { x: 12.2, y: 7.0, w: 0.6, h: 0.3, fontFace: font, fontSize: 9, color: hex(C.muted), align: 'right' });
  };
  const head = (s: Slide, kicker: string, title: string) => {
    s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: hex(C.rose) }, line: { color: hex(C.rose) } });
    s.addText(kicker.toUpperCase(), { x: 0.6, y: 0.45, w: 12, h: 0.35, fontFace: font, fontSize: 12, bold: true, color: hex(C.red), charSpacing: 2 });
    s.addText(title, { x: 0.6, y: 0.8, w: 12, h: 0.8, fontFace: 'Georgia', fontSize: 30, bold: true, color: hex(C.dark) });
  };

  // 1. Judul
  const s1 = P.addSlide();
  s1.background = { color: '7A1F1C' };
  s1.addShape('rect', { x: 0, y: 5.6, w: 13.33, h: 1.9, fill: { color: hex(C.rose) }, line: { color: hex(C.rose) } });
  if (b.logoFile) s1.addImage({ path: b.logoFile, x: 0.8, y: 0.7, w: 1.1, h: 1.1, sizing: { type: 'contain', w: 1.1, h: 1.1 } });
  s1.addText(b.name.toUpperCase(), { x: 0.8, y: 2.0, w: 11, h: 0.4, fontFace: font, fontSize: 14, bold: true, color: 'F6D9D6', charSpacing: 3 });
  s1.addText(r.title, { x: 0.8, y: 2.5, w: 11.5, h: 1.2, fontFace: 'Georgia', fontSize: 44, bold: true, color: 'FFFFFF' });
  s1.addText(metaLine(r), { x: 0.8, y: 3.8, w: 11, h: 0.5, fontFace: font, fontSize: 20, color: 'FFFFFF' });
  s1.addText(sourceLine(r), { x: 0.8, y: 6.3, w: 11.8, h: 0.5, fontFace: font, fontSize: 11, color: 'FFFFFF' });

  // 2. Ringkasan
  const s2 = P.addSlide();
  head(s2, r.aiUsed ? 'Ringkasan · ditulis AI' : 'Ringkasan', 'Inti periode ini');
  s2.addText(nar.summary, { x: 0.6, y: 1.9, w: 12.1, h: 4.6, fontFace: font, fontSize: 22, color: hex(C.body), valign: 'top', paraSpaceAfter: 8 });
  footer(s2, 2);

  // 3. Angka utama + grafik
  const s3 = P.addSlide();
  head(s3, 'Angka utama', `${d.kpis.length} angka yang perlu diingat`);
  d.kpis.slice(0, 4).forEach((k, i) => {
    const x = 0.6 + i * 3.1;
    s3.addShape('roundRect', { x, y: 1.8, w: 2.9, h: 1.6, fill: { color: 'FBF5EF' }, line: { color: hex(C.line) }, rectRadius: 0.08 });
    s3.addText(k.label.toUpperCase(), { x: x + 0.2, y: 1.9, w: 2.6, h: 0.35, fontFace: font, fontSize: 10, bold: true, color: hex(C.muted) });
    s3.addText(k.value, { x: x + 0.2, y: 2.25, w: 2.6, h: 0.65, fontFace: font, fontSize: 26, bold: true, color: hex(C.dark), fit: 'shrink' });
    s3.addText(k.note, { x: x + 0.2, y: 2.9, w: 2.6, h: 0.35, fontFace: font, fontSize: 11, color: hex(k.tone === 'good' ? C.good : k.tone === 'bad' ? C.bad : C.muted) });
  });
  if (d.chart.bars.length) {
    s3.addText(d.chart.title, { x: 0.6, y: 3.65, w: 12, h: 0.35, fontFace: font, fontSize: 13, bold: true, color: hex(C.dark) });
    // Grafik batang horizontal menggambar kategori pertama di bawah → dibalik agar urutannya sama dengan PDF.
    const bars = [...d.chart.bars].reverse();
    s3.addChart('bar', [{ name: d.chart.title, labels: bars.map((x) => x.label), values: bars.map((x) => x.value) }], {
      x: 0.6,
      y: 4.0,
      w: 12.1,
      h: 2.9,
      barDir: 'bar',
      chartColors: [hex(C.rose)],
      catAxisLabelFontSize: 11,
      catAxisLabelFontFace: font,
      valAxisHidden: true,
      valGridLine: { style: 'none' },
      showValue: true,
      dataLabelFontSize: 10,
      dataLabelFormatCode: '#,##0.#',
      barGapWidthPct: 60,
    });
  }
  footer(s3, 3);

  // 4. Temuan
  const s4 = P.addSlide();
  head(s4, 'Temuan', 'Apa yang terjadi');
  s4.addText(
    nar.findings.map((f) => ({ text: f, options: { bullet: { code: '25CF' }, paraSpaceAfter: 14 } })),
    { x: 0.6, y: 1.9, w: 12.1, h: 4.8, fontFace: font, fontSize: 20, color: hex(C.body), valign: 'top' },
  );
  footer(s4, 4);

  // 5. Rekomendasi
  const s5 = P.addSlide();
  head(s5, 'Rekomendasi', 'Keputusan yang diusulkan');
  s5.addText(
    nar.recommendations.map((f) => ({ text: f, options: { bullet: { type: 'number' }, paraSpaceAfter: 14 } })),
    { x: 0.6, y: 1.9, w: 12.1, h: 4.8, fontFace: font, fontSize: 20, color: hex(C.body), valign: 'top' },
  );
  footer(s5, 5);

  return (await P.write({ outputType: 'nodebuffer' })) as Buffer;
}
