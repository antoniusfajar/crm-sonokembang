export const ROLES = ['sales', 'marketing', 'spv', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  sales: 'Sales',
  marketing: 'Marketing',
  spv: 'SPV Sales',
  admin: 'Admin',
};

// Urutan & pengelompokan sama dengan sidebar prototype v16.
export const MENU_GROUPS: { group: string; items: { key: string; label: string; phase: 1 | 2 | 3 }[] }[] = [
  {
    group: 'Kerja harian',
    items: [
      { key: 'dashboard', label: 'Dashboard', phase: 1 },
      { key: 'inbox', label: 'Conversation', phase: 1 },
      { key: 'tugas', label: 'Tugas Hari Ini', phase: 1 },
      { key: 'pipeline', label: 'Leads & Pipeline', phase: 1 },
      { key: 'kontak', label: 'Kontak', phase: 1 },
      { key: 'pelanggan', label: 'Pelanggan', phase: 1 },
    ],
  },
  {
    group: 'Pemasaran',
    items: [
      { key: 'ads', label: 'Meta Ads', phase: 1 },
      { key: 'sosmed', label: 'Media Sosial', phase: 1 },
      { key: 'website', label: 'Website', phase: 1 },
      { key: 'reputasi', label: 'Reputasi', phase: 1 },
      { key: 'broadcast', label: 'Broadcast', phase: 1 },
      { key: 'widget', label: 'Livechat Widget', phase: 1 },
      { key: 'formmgmt', label: 'Form Management', phase: 1 },
    ],
  },
  {
    group: 'Sistem',
    items: [
      { key: 'reports', label: 'Reports', phase: 1 },
      { key: 'ai', label: 'AI & Otomasi', phase: 1 },
      { key: 'notif', label: 'Notifikasi & SLA', phase: 1 },
      { key: 'proposal', label: 'Template', phase: 1 },
      { key: 'setting', label: 'Pengaturan', phase: 1 },
    ],
  },
];

export const ALL_MENUS = MENU_GROUPS.flatMap((g) => g.items.map((i) => i.key));
const MKT = ['ads', 'sosmed', 'website', 'reputasi', 'broadcast', 'widget', 'formmgmt'];

// Bawaan dari prototype v16 (HIDE0). Admin bisa mengubahnya di Pengaturan › Peran & akses.
const DEFAULT_HIDDEN: Record<Role, string[]> = {
  sales: [...MKT, 'ai', 'setting', 'proposal', 'dashboard', 'reports'],
  marketing: ['inbox', 'tugas', 'pipeline', 'ai', 'notif', 'proposal', 'setting'],
  spv: [...MKT, 'setting'],
  admin: [],
};

export function defaultMenus(role: Role): Record<string, boolean> {
  return Object.fromEntries(ALL_MENUS.map((k) => [k, !DEFAULT_HIDDEN[role].includes(k)]));
}

export const DEFAULT_SCOPE: Record<Role, 'own' | 'all'> = { sales: 'own', marketing: 'all', spv: 'all', admin: 'all' };

export function canOpen(role: Role, menus: Record<string, boolean> | undefined, key: string): boolean {
  // Pengaturan untuk Admin selalu aktif supaya tidak ada yang terkunci di luar.
  if (role === 'admin' && key === 'setting') return true;
  if (menus && key in menus) return !!menus[key];
  return !DEFAULT_HIDDEN[role].includes(key);
}
