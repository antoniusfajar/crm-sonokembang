import PDFDocument from 'pdfkit';
import type { Lead } from './leads.js';

export interface ProposalVars {
  customerName: string;
  salesName: string;
  businessName: string;
  /** Path absolut file logo (PNG/JPG), opsional */
  logoFile?: string | null;
  businessTagline?: string;
  pricePerPax: number;
  discountPct: number;
  bankAccounts?: { bank: string; number: string; holder: string }[];
}

const rupiah = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const tanggalIndo = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${BULAN[(m ?? 1) - 1]} ${y}`;
};

export function fillProposalText(text: string, lead: Pick<Lead, 'eventType' | 'eventDate' | 'eventDateText' | 'location' | 'pax'>, v: ProposalVars): string {
  const price = v.discountPct > 0 ? `${rupiah(v.pricePerPax * (1 - v.discountPct / 100))} (harga normal ${rupiah(v.pricePerPax)}, diskon ${v.discountPct}%)` : rupiah(v.pricePerPax);
  const rek = (v.bankAccounts ?? []).filter((b) => b.number).map((b) => `${b.bank} ${b.number} a.n. ${b.holder}`).join('; ');
  return text
    .replaceAll('[nama_customer]', v.customerName)
    .replaceAll('[jenis_acara]', lead.eventType ?? '-')
    .replaceAll('[tanggal]', lead.eventDate ? tanggalIndo(lead.eventDate) : (lead.eventDateText ?? '-'))
    .replaceAll('[lokasi]', lead.location ?? '-')
    .replaceAll('[pax]', lead.pax ? lead.pax.toLocaleString('id-ID') : '-')
    .replaceAll('[harga_per_pax]', price)
    .replaceAll('[nama_sales]', v.salesName)
    .replaceAll('[no_rekening]', rek || '-');
}

export function renderProposalPdf(
  sections: { title: string; body: string }[],
  lead: Pick<Lead, 'eventType' | 'eventDate' | 'eventDateText' | 'location' | 'pax'> & { code: string },
  v: ProposalVars,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Proposal ${v.businessName} — ${v.customerName}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 8).fill('#c6040d');
    let left = 56;
    if (v.logoFile) {
      try {
        doc.image(v.logoFile, 56, 40, { fit: [64, 64] });
        left = 132;
      } catch {
        // logo rusak/tidak terbaca → proposal tetap dibuat tanpa logo
      }
    }
    doc.fillColor('#201c1a').font('Times-Bold').fontSize(22).text('Proposal Catering', left, 48);
    doc.font('Helvetica').fontSize(10).fillColor('#6b625c').text(`${v.businessName}${v.businessTagline ? ' · ' + v.businessTagline : ''}`);
    doc.text(`No. ${lead.code} · ${tanggalIndo(new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10))}`);
    doc.x = 56;
    if (doc.y < 112) doc.y = 112;
    doc.moveDown(1.2);
    for (const s of sections) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#c6040d').text(s.title.toUpperCase(), { characterSpacing: 0.5 });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(11).fillColor('#3d3733').text(fillProposalText(s.body, lead, v), { lineGap: 3 });
      doc.moveDown(0.9);
    }
    doc.fontSize(8).fillColor('#a49a92').text('Penawaran ini berlaku 14 hari sejak tanggal dibuat. Harga dapat berubah sesuai penyesuaian menu.', 56, doc.page.height - 70, { align: 'center' });
    doc.end();
  });
}
