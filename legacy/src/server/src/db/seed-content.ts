// Isi awal template proposal & snippet, disalin dari prototype v16. Bisa diubah di menu Template.

export const DEFAULT_PROPOSAL_TEMPLATES: { name: string; segment: string; sections: { title: string; body: string }[] }[] = [
  {
    "name": "Wedding · Buffet + Gubuk",
    "segment": "Wedding",
    "sections": [
      {
        "title": "Pembuka",
        "body": "Yth. [nama_customer],\nTerima kasih telah mempercayakan hari bahagia Anda kepada Sonokembang Catering. Berikut penawaran yang kami siapkan khusus untuk acara Anda."
      },
      {
        "title": "Detail acara",
        "body": "Acara: [jenis_acara]\nTanggal: [tanggal]\nLokasi: [lokasi]\nJumlah tamu: [pax] pax"
      },
      {
        "title": "Paket & menu",
        "body": "Paket Gold — buffet 6 menu utama + 3 gubuk pilihan (soto, bakso, zuppa soup), dessert & minuman. Termasuk peralatan saji, pramusaji, dan dekor meja buffet."
      },
      {
        "title": "Harga & pembayaran",
        "body": "Harga per pax: [harga_per_pax]\nDP 30% untuk mengunci tanggal, pelunasan H-7. Test food gratis untuk 4 orang."
      },
      {
        "title": "Penutup",
        "body": "Kami siap mendiskusikan penyesuaian menu sesuai keinginan keluarga.\n\nHormat kami,\n[nama_sales] — Sonokembang Catering Malang"
      }
    ]
  },
  {
    "name": "Wisuda · Nasi Box Premium",
    "segment": "Institusi",
    "sections": [
      {
        "title": "Pembuka",
        "body": "Yth. [nama_customer],\nTerima kasih atas kepercayaannya. Berikut penawaran nasi box premium untuk acara wisuda."
      },
      {
        "title": "Detail pesanan",
        "body": "Acara: [jenis_acara]\nTanggal: [tanggal]\nLokasi pengiriman: [lokasi]\nJumlah: [pax] box"
      },
      {
        "title": "Pilihan menu",
        "body": "Pilihan A: ayam bakar madu, sayur, sambal, buah, air mineral.\nPilihan B: empal suwir, perkedel, sambal goreng, buah, air mineral."
      },
      {
        "title": "Harga & pembayaran",
        "body": "Harga per box: [harga_per_pax]\nDP 50%, pelunasan saat barang diterima. Pengiriman tepat waktu sesuai jadwal acara."
      }
    ]
  },
  {
    "name": "Korporat · Nasi Kotak Harian",
    "segment": "B2B / Kantin",
    "sections": [
      {
        "title": "Pembuka",
        "body": "Kepada Yth. [nama_customer],\nBerikut penawaran layanan katering harian untuk karyawan."
      },
      {
        "title": "Lingkup layanan",
        "body": "Mulai: [tanggal]\nLokasi: [lokasi]\nVolume: [pax]\nMenu rotasi 2 minggu, standar HACCP."
      },
      {
        "title": "Harga & termin",
        "body": "Harga per porsi: [harga_per_pax]\nTagihan bulanan, termin 14 hari. Kontrak minimal 3 bulan."
      },
      {
        "title": "Penutup",
        "body": "Hormat kami,\n[nama_sales] — Sonokembang Catering"
      }
    ]
  },
  {
    "name": "Syukuran & Aqiqah · Tumpeng",
    "segment": "Tradisional",
    "sections": [
      {
        "title": "Pembuka",
        "body": "Yth. [nama_customer],\nTerima kasih telah menghubungi Sonokembang. Berikut penawaran untuk acara syukuran keluarga."
      },
      {
        "title": "Detail acara",
        "body": "Acara: [jenis_acara]\nTanggal: [tanggal]\nLokasi: [lokasi]\nJumlah tamu: [pax] orang"
      },
      {
        "title": "Paket",
        "body": "Tumpeng nasi kuning lengkap + snack box 3 item. Kambing aqiqah sesuai syariat (opsional)."
      },
      {
        "title": "Harga",
        "body": "Harga per pax: [harga_per_pax]\nDP 30%, pelunasan H-3."
      }
    ]
  },
  {
    "name": "Gathering · Coffee Break",
    "segment": "Event kantor",
    "sections": [
      {
        "title": "Pembuka",
        "body": "Yth. [nama_customer],\nBerikut penawaran coffee break untuk acara kantor Anda."
      },
      {
        "title": "Detail acara",
        "body": "Acara: [jenis_acara]\nTanggal: [tanggal]\nLokasi: [lokasi]\nPeserta: [pax] orang"
      },
      {
        "title": "Paket",
        "body": "2x coffee break (3 snack + kopi/teh) dan 1x makan siang buffet."
      },
      {
        "title": "Harga",
        "body": "Harga per pax: [harga_per_pax]\nInvoice ke perusahaan, termin 14 hari."
      }
    ]
  }
];

export const DEFAULT_SNIPPETS: { name: string; folder: string; shortcut: string; body: string }[] = [
  {
    "name": "Perkenalan Awal",
    "folder": "Sapaan",
    "shortcut": "/halo",
    "body": "Hai kak {{contact.name}} 👋\nTerima kasih sudah menghubungi Sonokembang Catering Malang. Saya {{sales.name}}, siap bantu kebutuhan acara kakak.\nBoleh diinfokan jenis acara, tanggal, dan perkiraan jumlah tamunya?"
  },
  {
    "name": "Kelengkapan Info",
    "folder": "Sapaan",
    "shortcut": "/info",
    "body": "Mohon diinformasikan kebutuhannya ya kak:\n1. Jenis acara\n2. Tanggal & jam\n3. Lokasi acara\n4. Jumlah tamu (pax)\n5. Perkiraan budget per pax"
  },
  {
    "name": "Format Order",
    "folder": "Order",
    "shortcut": "/format",
    "body": "📌 Mohon diisi format order berikut:\nNama pemesan:\nNo. HP:\nTanggal & jam acara:\nAlamat lengkap:\nMenu yang dipilih:\nJumlah pax:\nCatatan khusus:"
  },
  {
    "name": "No Rek",
    "folder": "Order",
    "shortcut": "/rek",
    "body": "Pembayaran DP 30% dapat ditransfer ke:\n1. Bank Mandiri — [no_rekening] a.n. [nama_rekening]\n2. BCA — [no_rekening] a.n. [nama_rekening]\nMohon kirim bukti transfer di chat ini ya kak 🙏"
  },
  {
    "name": "Kirim Katalog Retail",
    "folder": "Order",
    "shortcut": "/katalog",
    "body": "Hai kak, berikut katalog nasi box, snack box & tumpeng kami 👇\n[link_katalog]\nPemesanan minimal H-2 ya kak."
  },
  {
    "name": "Lokasi_Surabaya",
    "folder": "Lokasi cabang",
    "shortcut": "/sby",
    "body": "Kak {{contact.name}} saat ini Anda terhubung dengan *Hotline Sonokembang Malang*. Untuk acara di Surabaya, tim cabang Surabaya akan menghubungi kakak."
  },
  {
    "name": "Lokasi_Semarang_Jogja",
    "folder": "Lokasi cabang",
    "shortcut": "/smg",
    "body": "Kak {{contact.name}} saat ini Anda terhubung dengan *Hotline Sonokembang Malang*. Untuk acara di Semarang/Jogja, tim cabang kami akan menghubungi kakak."
  },
  {
    "name": "Lokasi_Jakarta",
    "folder": "Lokasi cabang",
    "shortcut": "/jkt",
    "body": "Kak {{contact.name}} saat ini Anda terhubung dengan *Hotline Sonokembang Malang*. Untuk acara di Jakarta, tim cabang kami akan menghubungi kakak."
  },
  {
    "name": "Lokasi_Banjarmasin",
    "folder": "Lokasi cabang",
    "shortcut": "/bjm",
    "body": "Kak {{contact.name}} saat ini Anda terhubung dengan *Hotline Sonokembang Malang*. Untuk acara di Banjarmasin, tim Sonokembang Banjarmasin akan menghubungi kakak."
  },
  {
    "name": "CAFE TALK JANUARI 2026",
    "folder": "Promo",
    "shortcut": "/cafetalk",
    "body": "Siap nikah tapi masih bingung soal catering? ☕💍\nYuk ikut Cafe Talk Sonokembang — ngobrol santai soal menu, budget & test food. Daftar di sini: [link_daftar]"
  },
  {
    "name": "Google Review",
    "folder": "Lainnya",
    "shortcut": "/review",
    "body": "Untuk membantu kami terus meningkatkan pelayanan, mohon kesediaan kakak memberi ulasan di Google ya 🙏\n[link_review]"
  },
  {
    "name": "Loker",
    "folder": "Lainnya",
    "shortcut": "/loker",
    "body": "Hi Kak, terima kasih atas minatnya bergabung. Info lowongan terbaru ada di [link_loker]."
  },
  {
    "name": "Sponsorship",
    "folder": "Lainnya",
    "shortcut": "/sponsor",
    "body": "Hi Kak, untuk pengajuan sponsorship mohon kirim proposal ke email kami: [email_bisnis]."
  },
  {
    "name": "Supplier",
    "folder": "Lainnya",
    "shortcut": "/supplier",
    "body": "Hi Kak, untuk penawaran supplier silakan kirim company profile & daftar harga ke [email_procurement]."
  }
];
