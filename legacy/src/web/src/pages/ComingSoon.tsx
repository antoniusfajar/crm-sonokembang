import { Layout } from '../components/Layout';
import { MENU_META } from '../nav';
import { useMe } from '../auth';

const NOTES: Record<string, string> = {
  dashboard: 'Ringkasan, Sales, dan Marketing (termasuk KPI & laporan sumber lead yang sudah digabung). Angka diambil dari data chat & pipeline yang sekarang sudah terkumpul.',
  pelanggan: 'Basis pelanggan dibuat otomatis saat closing, plus peluang repeat order. Data pelanggan sudah mulai terisi dari tahap Closing.',
  reports: 'Laporan AI dalam PDF & Slides: angka dari sistem, narasi ditulis AI. Bisa dijadwalkan.',
  ads: 'Butuh koneksi Meta Business (Marketing API).',
  sosmed: 'Butuh koneksi Instagram & TikTok.',
  website: 'Butuh koneksi Google Analytics 4 & Search Console.',
  reputasi: 'Butuh koneksi Google Business Profile.',
  broadcast: 'Dikerjakan setelah WhatsApp Cloud API tersambung (template resmi Meta).',
  widget: 'Widget website yang mengarahkan ke hotline WA yang sama.',
  formmgmt: 'Form website yang langsung jadi lead.',
};

export function ComingSoon({ menuKey }: { menuKey: string }) {
  const me = useMe();
  const m = MENU_META[menuKey]!;
  const phase = me.menus.flatMap((g) => g.items).find((i) => i.key === menuKey)?.phase ?? 2;
  return (
    <Layout>
      <div className="card" style={{ maxWidth: 640 }}>
        <span className="pill warm">Fase {phase}</span>
        <h2 style={{ font: '700 22px/1.3 var(--font-display)', margin: '12px 0 8px' }}>{m.title} menyusul</h2>
        <p className="muted" style={{ margin: 0 }}>
          {NOTES[menuKey] ?? 'Menu ini dijadwalkan setelah Fase 1 live.'}
        </p>
      </div>
    </Layout>
  );
}
