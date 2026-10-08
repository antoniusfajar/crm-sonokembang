// Nilai bawaan diambil dari prototype v16. Semua bisa diubah lewat menu Pengaturan.

export const DEFAULT_PIPELINES: {
  name: string;
  color: string;
  targetShare: number;
  eventTypes: string[];
  stages: [name: string, probability: number, slaDays: number, kind: 'open' | 'won' | 'lost', requirements: string[]][];
}[] = [
  {
    name: 'Wedding',
    color: '#db6262',
    targetShare: 60,
    eventTypes: ['wedding', 'pernikahan', 'resepsi', 'lamaran', 'akad', 'ngunduh mantu'],
    stages: [
      ['Lead Baru', 10, 1, 'open', []],
      ['Perkenalan & Brosur', 20, 2, 'open', []],
      ['Follow Up', 35, 3, 'open', []],
      ['Proposal', 55, 5, 'open', ['source_known', 'proposal_sent']],
      ['Closing (DP masuk)', 90, 7, 'won', ['dp_proof']],
      ['Event Selesai', 100, 0, 'won', []],
      ['Lost', 0, 0, 'lost', ['lost_reason']],
    ],
  },
  {
    name: 'Non Wedding',
    color: '#46701a',
    targetShare: 31,
    eventTypes: ['gathering', 'kantor', 'ulang tahun', 'syukuran', 'aqiqah', 'wisuda', 'seminar', 'ceremony', 'kantin'],
    stages: [
      ['Lead Baru', 10, 1, 'open', []],
      ['Perkenalan & Brosur', 20, 1, 'open', []],
      ['Follow Up', 35, 2, 'open', []],
      ['Proposal', 60, 3, 'open', ['source_known', 'proposal_sent']],
      ['Closing (DP masuk)', 90, 3, 'won', ['dp_proof']],
      ['Event Selesai', 100, 0, 'won', []],
      ['Lost', 0, 0, 'lost', ['lost_reason']],
    ],
  },
  {
    name: 'Retail',
    color: '#c8861f',
    targetShare: 9,
    eventTypes: ['nasi box', 'snack box', 'tumpeng', 'retail'],
    stages: [
      ['Lead Baru', 15, 1, 'open', []],
      ['Kirim Katalog', 35, 1, 'open', []],
      ['Order Dikonfirmasi', 80, 1, 'won', ['dp_proof']],
      ['Lunas', 95, 1, 'won', []],
      ['Terkirim', 100, 0, 'won', []],
      ['Lost', 0, 0, 'lost', ['lost_reason']],
    ],
  },
];

export const STAGE_REQUIREMENTS: Record<string, string> = {
  lost_reason: 'Alasan Lost/Abandoned wajib dipilih',
  dp_proof: 'Bukti transfer DP wajib diunggah',
  source_known: 'Sumber lead tidak boleh "Tidak diketahui"',
  proposal_sent: 'Proposal sudah terkirim',
};

export const DEFAULT_SOURCES = [
  { name: 'IG / Meta Ads', channel: 'Instagram Ads', refCode: 'IGADS', howRecorded: 'Iklan click-to-WhatsApp membawa id iklan & campaign ke pesan pertama', offline: false },
  { name: 'Website', channel: 'Website', refCode: 'WEB', howRecorded: 'Tombol WA per halaman + form kontak (UTM disimpan)', offline: false },
  { name: 'Instagram organik', channel: 'Instagram', refCode: 'IGBIO', howRecorded: 'Link bio khusus, terpisah dari link iklan', offline: false },
  { name: 'Pameran', channel: 'Pameran', refCode: 'EXPO', howRecorded: 'QR di booth mengarah ke link WA bertanda nama pameran', offline: false },
  { name: 'Broadcast', channel: 'WhatsApp', refCode: 'BC', howRecorded: 'Balasan dari broadcast WhatsApp', offline: false },
  { name: 'Referral', channel: 'Referral', refCode: null, howRecorded: 'Diisi manual oleh sales', offline: true },
  { name: 'Vendor WO', channel: 'Vendor', refCode: null, howRecorded: 'Dipilih manual oleh sales; nama vendor wajib diisi', offline: true },
  { name: 'Vendor Neo', channel: 'Vendor', refCode: null, howRecorded: 'Dipilih manual oleh sales', offline: true },
  { name: 'Telepon / datang ke kantor', channel: 'Offline', refCode: null, howRecorded: 'Diisi manual oleh sales yang menerima', offline: true },
];

export const LOST_REASONS = {
  Lost: ['Harga di atas budget', 'Tanggal penuh', 'Pilih kompetitor', 'Acara dibatalkan', 'Menu tidak sesuai'],
  Abandoned: ['Tidak ada kabar 3x follow-up', 'Nomor tidak aktif', 'Salah sasaran / bukan calon pembeli', 'Minta berhenti dihubungi (opt-out)'],
};

export const CONTACT_TYPES = ['Calon pelanggan', 'Pelanggan', 'Vendor / WO', 'Supplier', 'Bukan prospek', 'Lainnya'];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  business_profile: {
    name: 'Sonokembang Catering Malang',
    tagline: 'Catering wedding, event & kantin karyawan',
    address: '',
    email: '',
    website: 'sonokembangcateringmalang.com',
    hotline: '',
    logoPath: null,
    branches: [{ name: 'Malang (pusat)', hotline: '', snippet: '/halo', active: true }],
    bankAccounts: [{ bank: 'Bank Mandiri', number: '', holder: '' }, { bank: 'BCA', number: '', holder: '' }],
  },
  working_hours: { start: '08:00', end: '20:00', days: [1, 2, 3, 4, 5, 6, 0] },
  sla: {
    levels: [
      { minutes: 15, action: 'notify_owner', label: 'Push ke sales pemilik lead' },
      { minutes: 45, action: 'notify_spv', label: 'Notifikasi SPV + lead ditandai merah di inbox' },
      { minutes: 120, action: 'reassign', label: 'Notifikasi Admin + lead dialihkan otomatis' },
    ],
  },
  distribution: {
    method: 'weighted', // weighted | round_robin | manual
    rules: { sticky: true, skipLeave: true, cap: true, capCount: 60, escalate: true },
    specialRules: [],
  },
  reminder_rules: [
    { key: 'brochure_followup', trigger: 'Brosur terkirim', action: 'Tugas follow-up otomatis H+1 pukul 10.00', on: true },
    { key: 'no_reply_3d', trigger: '3 hari tanpa balasan', action: 'Pengingat kedua + skor lead −5', on: true },
    { key: 'proposal_followup', trigger: 'Proposal terkirim', action: 'Tugas follow-up H+2 bila belum ada respons', on: true },
    { key: 'idle_7d', trigger: '7 hari tanpa aktivitas', action: 'Usul tandai Abandoned — alasan tetap wajib', on: true },
    { key: 'task_due_soon', trigger: 'Janji follow-up mendekati waktunya', action: 'Notifikasi + push ke sales 30 menit sebelumnya', on: true },
  ],
  score_rules: {
    hot: 70,
    warm: 40,
    // poin per data kualifikasi yang terisi. Rumus masih draft, dikalibrasi setelah 1–2 bulan data.
    points: {
      eventType: 15,
      eventDate: 15,
      location: 10,
      pax: 15,
      budget: 15,
      paxLarge: 10, // pax ≥ 300
      budgetLarge: 10, // budget ≥ Rp 50 jt
      dateSoon: 10, // acara ≤ 90 hari lagi
    },
    potensi: { besar: 50_000_000, sedang: 15_000_000 },
  },
  ai: {
    enabled: true,
    provider: 'anthropic',
    fallbackProvider: null,
    models: { chat: 'claude-haiku-4-5', smart: 'claude-sonnet-5' },
    monthlyBudgetIdr: 500_000,
    maskPii: true,
    logRetentionDays: 90,
    usdToIdr: 16_500,
    // kunci API disimpan terpisah di setting "ai_keys" (terenkripsi)
  },
  ai_keys: {},
  guardrails: {
    allow: ['Menyapa & memperkenalkan diri', 'Mengirim brosur & daftar paket', 'Menanyakan jenis acara, tanggal, lokasi, pax', 'Menjawab FAQ dari bahan resmi', 'Menyerahkan percakapan ke sales'],
    deny: ['Menyebut harga final', 'Menjanjikan ketersediaan tanggal', 'Memberi diskon', 'Membuat komitmen atas nama Sonokembang'],
    // Lapis 1: kata/frasa yang langsung menahan balasan AI
    blockedPhrases: ['diskon', 'potongan harga', 'harga final', 'harga nett', 'gratis', 'pasti tersedia', 'tanggal masih kosong', 'tanggal tersedia', 'kami jamin', 'dijamin', 'promo khusus'],
    blockRupiah: true,
    // Pesan customer yang memicu serah terima segera
    handoffKeywords: ['harga', 'berapa', 'diskon', 'potongan', 'promo', 'tersedia', 'available', 'kosong', 'booking', 'dp', 'nego', 'pricelist', 'price list'],
    handoffWhenFieldsFilled: 4,
    handoffWhenScoreAtLeast: 70,
    stopAfterFollowups: 3,
    // Dikirim (oleh script, bukan AI) saat balasan AI ditahan atau customer bertanya harga/diskon/tanggal.
    holdMessage: 'Baik kak, untuk pertanyaan tersebut akan langsung dibantu tim sales kami ya 🙏 Mohon ditunggu sebentar.',
    layer2: true,
  },
  faq: [
    { keywords: ['alamat', 'lokasi kantor', 'dimana'], answer: 'Kantor & dapur kami ada di Malang. Tim sales kami akan kirimkan titik lokasinya ya.' },
    { keywords: ['test food', 'tes makanan', 'cicip'], answer: 'Bisa, kami menyediakan sesi test food. Jadwalnya akan diatur bersama tim sales kami.' },
    { keywords: ['halal'], answer: 'Seluruh menu Sonokembang Catering diolah dengan bahan halal.' },
  ],
  wa_profile: {
    about: 'Catering wedding, event & kantin karyawan · Malang',
    description: 'Sonokembang Catering Malang melayani catering pernikahan, acara kantor, gathering, syukuran, ulang tahun, dan kantin karyawan.',
    address: '',
    email: '',
    websites: ['https://sonokembangcateringmalang.com', ''],
    vertical: 'EVENT_PLAN',
    syncedAt: null,
  },
  notif_channels: {
    push: { on: true },
    email: { digestOn: true, digestTime: '20:00', digestTo: 'admin', escalationOn: true, minSlaLevel: 2 },
  },
  lost_reasons: LOST_REASONS,
  contact_types: CONTACT_TYPES,
  approval: { discountNeedsSpvAbove: 5 },
  // Batas KPI untuk warna di dashboard (Pengaturan › Target omzet › Target KPI)
  kpi_targets: { responseMinutes: 15, responseIdeal: 5, followUpPct: 85, closingRatePct: 15 },
  // Cache narasi AI ringkasan mingguan (bukan pengaturan yang bisa diubah dari UI)
  weekly_summary_cache: {},
  // App ID / Client ID platform (secret terenkripsi) — Pengaturan › Integrasi
  integration_apps: {},
  // Broadcast: biaya per pesan marketing (tagihan Meta), batas frekuensi per kontak, kecepatan kirim per menit
  broadcast: { costPerMsg: 480, frequencyDays: 7, perTick: 200 },
  // Reputasi Google: balasan AI otomatis + permintaan ulasan setelah acara
  reputation: {
    autoReply: true,
    notifyLow: true,
    delayMinutes: 30,
    hotlineOnNegative: true,
    request: { on: false, timing: 'h1', template: 'minta_ulasan_google', link: '', cooldownDays: 90 },
  },
  reputation_ai: {},
  // Livechat widget website → diarahkan ke hotline WhatsApp (isi hotline di Profil bisnis)
  widget: {
    enabled: false,
    position: 'right',
    color: '#db6262',
    launcher: 'bubble',
    label: 'Chat kami',
    greeting: 'Halo! Mau tanya paket catering untuk acara apa?',
    showGreeting: true,
    badge: true,
    prechat: true,
    askEvent: true,
    askDate: true,
    eventOptions: ['Wedding', 'Lamaran', 'Acara kantor / gathering', 'Ulang tahun', 'Syukuran', 'Wisuda', 'Kantin karyawan'],
    hoursNote: 'Jam operasional 08.00–20.00 WIB · di luar jam dijawab AI',
    allowedDomains: [],
  },
};

/** Draf template WhatsApp (status LOCAL). Ajukan ke Meta lewat WhatsApp Manager dengan isi yang sama, lalu sinkron. */
export const DEFAULT_WA_TEMPLATES = [
  { name: 'follow_up_umum', language: 'id', category: 'UTILITY', folder: 'Follow-up', body: 'Halo {{1}}, ini {{2}} dari Sonokembang Catering. Kami ingin menindaklanjuti rencana acara Anda. Ada yang bisa kami bantu?', varMap: ['customer.firstName', 'sender.firstName'] },
  { name: 'promo_menu_baru', language: 'id', category: 'MARKETING', folder: 'Broadcast', body: 'Halo {{1}}! Sonokembang Catering punya menu baru: {{2}}. Balas MENU untuk katalog lengkap, atau balas STOP bila tidak ingin menerima info promo.', varMap: ['customer.firstName', ''] },
  { name: 'penawaran_musiman', language: 'id', category: 'MARKETING', folder: 'Broadcast', body: 'Halo {{1}}, menjelang {{2}}, Sonokembang Catering membuka pemesanan lebih awal dengan harga spesial. Balas INFO untuk penawaran, atau STOP bila tidak ingin menerima info promo.', varMap: ['customer.firstName', ''] },
  { name: 'minta_ulasan_google', language: 'id', category: 'UTILITY', folder: 'Setelah acara', body: 'Halo {{1}}, terima kasih sudah mempercayakan acara Anda kepada Sonokembang Catering. Boleh minta waktunya 1 menit untuk memberi ulasan di Google? {{2}}', varMap: ['customer.firstName', 'review.link'] },
];
