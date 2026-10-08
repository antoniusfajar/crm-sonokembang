// Menu key (sama dengan server) → path, ikon, judul halaman. Urutan mengikuti prototype v16.
export const MENU_META: Record<string, { path: string; icon: string; eyebrow: string; title: string }> = {
  dashboard: { path: '/dashboard', icon: '▤', eyebrow: 'Analitik · Sales & marketing', title: 'Dashboard' },
  inbox: { path: '/inbox', icon: '◈', eyebrow: 'Kerja harian · Chat & lead', title: 'Conversation' },
  tugas: { path: '/tugas', icon: '✓', eyebrow: 'Kerja harian · Sales', title: 'Tugas & jadwal follow-up' },
  pipeline: { path: '/leads', icon: '◫', eyebrow: 'Kerja harian · Lead & pipeline', title: 'Leads & pipeline' },
  kontak: { path: '/kontak', icon: '☏', eyebrow: 'Kerja harian · Basis data', title: 'Kontak' },
  pelanggan: { path: '/pelanggan', icon: '◍', eyebrow: 'Kerja harian · Basis data', title: 'Pelanggan & repeat order' },
  ads: { path: '/ads', icon: '◎', eyebrow: 'Pemasaran · Meta', title: 'Meta Ads' },
  sosmed: { path: '/sosmed', icon: '✦', eyebrow: 'Pemasaran · Media sosial', title: 'Media sosial' },
  website: { path: '/website', icon: '◰', eyebrow: 'Pemasaran · Website', title: 'Website' },
  reputasi: { path: '/reputasi', icon: '★', eyebrow: 'Pemasaran · Google Business', title: 'Reputasi & ulasan' },
  broadcast: { path: '/broadcast', icon: '⊕', eyebrow: 'Pemasaran · WhatsApp', title: 'Broadcast' },
  widget: { path: '/widget', icon: '⊡', eyebrow: 'Pemasaran · Website', title: 'Livechat widget' },
  formmgmt: { path: '/form', icon: '▥', eyebrow: 'Pemasaran · Website', title: 'Form management' },
  reports: { path: '/reports', icon: '▤', eyebrow: 'Sistem · Laporan', title: 'Reports & laporan AI' },
  ai: { path: '/ai', icon: '✷', eyebrow: 'Sistem · AI Responder', title: 'AI & otomasi' },
  notif: { path: '/notif', icon: '◬', eyebrow: 'Sistem · Pengawasan', title: 'Notifikasi & eskalasi SLA' },
  proposal: { path: '/template', icon: '▧', eyebrow: 'Sistem · Sales', title: 'Template proposal & snippet' },
  setting: { path: '/pengaturan', icon: '⌗', eyebrow: 'Pengaturan', title: 'Pengaturan sistem' },
};

export const PHASE_LABEL: Record<number, string> = { 2: 'Fase 2', 3: 'Fase 3' };

export function landingPath(menuKeys: string[], role: string): string {
  const pref = role === 'sales' ? ['tugas', 'inbox'] : role === 'marketing' ? ['kontak'] : role === 'admin' ? ['dashboard', 'inbox'] : ['inbox', 'tugas'];
  const k = pref.find((p) => menuKeys.includes(p)) ?? menuKeys[0];
  return k ? MENU_META[k]!.path : '/akun';
}

export function menuForPath(pathname: string): string | undefined {
  if (pathname.startsWith('/leads/')) return 'pipeline';
  return Object.entries(MENU_META).find(([, m]) => pathname === m.path || pathname.startsWith(m.path + '/'))?.[0];
}
