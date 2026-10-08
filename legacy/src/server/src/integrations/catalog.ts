// Daftar platform yang bisa dihubungkan (sumber kebenaran untuk tampilan Pengaturan › Integrasi).

export type ProviderId = 'meta_ads' | 'instagram' | 'facebook' | 'tiktok' | 'gbp' | 'ga4' | 'gsc' | 'uptime';
export type AuthFamily = 'meta' | 'google' | 'tiktok' | 'none';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  short: string;
  category: 'ads' | 'sosmed' | 'web' | 'reputasi';
  auth: AuthFamily;
  requirements: string[];
  scope: string;
  /** Interval sinkron otomatis (menit). */
  syncEvery: number;
  /** Token kedaluwarsa & perlu login ulang (Meta user token ±60 hari, TikTok). */
  expires: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  meta_ads: {
    id: 'meta_ads', label: 'Meta Ads', short: 'Ads', category: 'ads', auth: 'meta', syncEvery: 180, expires: true,
    requirements: ['Akses Advertiser ke ad account di Business Manager'],
    scope: 'baca performa iklan & biaya (ads_read)',
  },
  instagram: {
    id: 'instagram', label: 'Instagram', short: 'IG', category: 'sosmed', auth: 'meta', syncEvery: 360, expires: true,
    requirements: ['Akun Instagram tipe Professional (Business/Creator)', 'Terhubung ke Facebook Page milik Sonokembang', 'Login sebagai admin Page'],
    scope: 'baca insight, terbitkan konten',
  },
  facebook: {
    id: 'facebook', label: 'Facebook Page', short: 'FB', category: 'sosmed', auth: 'meta', syncEvery: 360, expires: true,
    requirements: ['Facebook Page Sonokembang', 'Login sebagai admin Page (bukan editor)'],
    scope: 'baca insight Page, terbitkan posting',
  },
  tiktok: {
    id: 'tiktok', label: 'TikTok', short: 'TT', category: 'sosmed', auth: 'tiktok', syncEvery: 360, expires: true,
    requirements: ['Akun TikTok Business', 'Login sebagai pemilik akun'],
    scope: 'baca statistik video & profil (posting otomatis butuh audit TikTok — sementara jadi pengingat posting manual)',
  },
  gbp: {
    id: 'gbp', label: 'Google Business Profile', short: 'GB', category: 'reputasi', auth: 'google', syncEvery: 60, expires: false,
    requirements: ['Profil Google Bisnis sudah terverifikasi', 'Login Google sebagai pemilik/pengelola', 'Akses Business Profile API disetujui Google'],
    scope: 'baca & balas ulasan, baca performa profil',
  },
  ga4: {
    id: 'ga4', label: 'Google Analytics 4', short: 'GA', category: 'web', auth: 'google', syncEvery: 360, expires: false,
    requirements: ['Property Google Analytics 4 untuk website', 'Akses minimal Viewer'],
    scope: 'baca laporan pengunjung & sumber trafik',
  },
  gsc: {
    id: 'gsc', label: 'Google Search Console', short: 'SC', category: 'web', auth: 'google', syncEvery: 720, expires: false,
    requirements: ['Domain terverifikasi di Search Console'],
    scope: 'baca kata kunci & performa pencarian',
  },
  uptime: {
    id: 'uptime', label: 'Pemantau website', short: 'UP', category: 'web', auth: 'none', syncEvery: 5, expires: false,
    requirements: ['Alamat website yang bisa dibuka publik'],
    scope: 'cek website hidup/mati tiap 5 menit dari server CRM',
  },
};

export const FAMILY_PROVIDERS: Record<Exclude<AuthFamily, 'none'>, ProviderId[]> = {
  meta: ['meta_ads', 'instagram', 'facebook'],
  google: ['gbp', 'ga4', 'gsc'],
  tiktok: ['tiktok'],
};
