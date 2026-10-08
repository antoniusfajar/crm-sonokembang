# Gap Analysis — Prototype v16 vs kode `src/`

Tanggal: 7 Okt 2026 · Status: **disetujui** (hosting VPS, Direktur → Admin, KPI & laporan sumber digabung ke Dashboard, koneksi Meta menyusul saat migrasi).

## Status pengerjaan (update 7 Okt 2026)

| Prioritas | Status |
|---|---|
| P0 Fondasi | ✅ Selesai — login, 4 peran + hak akses per menu + cakupan data, Users, Profil bisnis + logo, log login & audit, Docker + HTTPS + backup |
| P1-A WhatsApp & Conversation | ✅ Selesai dengan **mode simulasi**, termasuk Profil bisnis WA (1.3). Adapter Meta Cloud API sudah ditulis (kirim teks/template/dokumen, profil bisnis, verifikasi tanda tangan webhook) tapi **belum diuji ke Meta asli** — diuji saat migrasi. Foto profil & nama tampilan tetap diubah di WhatsApp Manager. |
| P1-B Lead, pipeline & kontak | ✅ Selesai, termasuk aturan distribusi khusus per jenis acara (1.16) |
| P1-C AI | ✅ Selesai. Adapter Claude memakai SDK resmi; adapter Gemini & OpenAI ditulis tapi **belum diuji dengan key asli**. Belum ada API key yang dipasang, jadi balasan AI asli belum dicoba. |
| P1-D Tugas, SLA, Import, mobile | ✅ Selesai, termasuk kanal notifikasi (1.29): push di web app + email ringkasan harian & eskalasi (SMTP). Sesuai keputusan, notifikasi WA/grup tidak dipakai; push native menyusul bersama aplikasi mobile di fase terakhir. Push belum diuji di perangkat sungguhan. |
| P2 Analitik & laporan | ✅ Selesai — lihat rincian di bawah. Sinkron Ecount (2.8) tidak dibuat: API Ecount tidak bisa mengeluarkan data, jadi ekstraksi tetap manual. |
| P3 Pemasaran | ✅ Selesai di kode, semua menu aktif — rincian di bawah. Koneksi ke Meta/Google/TikTok asli **belum diuji** (butuh akun & aplikasi developer Sonokembang); semua jalur sudah diuji dengan data tiruan. |
| Audit ulang vs prototype v16 | ✅ 7 bug diperbaiki; nama lead otomatis `[pipeline]_[nama depan]_[tgl acara]_[lokasi]` + nama pemesan; Perkiraan DP (bulan); hasil test food terstruktur; pengingat janji follow-up 30 menit sebelumnya; status kontak otomatis dari siklus lead; template WA terisi otomatis dari data CRM; impor riwayat chat CRM lama (CSV/Excel). Sisa temuan tingkat sedang & kosmetik dicicil setelah live. |
| P4 | Belum dikerjakan |

Rincian P2:

| No | Status |
|---|---|
| 2.1 Dashboard | ✅ Ringkasan / Sales / Marketing, filter pipeline & periode. Periode berjalan dibanding hari yang sama di periode lalu (mis. 1–7 Okt vs 1–7 Sep). Tab Marketing kini berisi biaya & biaya per lead untuk iklan dan broadcast, plus kartu Meta Ads, Media sosial, Website, dan Reputasi. |
| 2.2 Kinerja per sales | ✅ Leaderboard (peluang, closing, omzet vs target, konversi, respons, SLA, follow-up) + funnel + alasan Lost di tab Sales Dashboard dan laporan "Kinerja tim sales". |
| 2.3 Target omzet & KPI | ✅ Pengaturan › Target omzet: target tim & per sales per bulan, realisasi, bagi rata, salin bulan lalu, porsi per pipeline, Target KPI. Omzet = **nilai total order** yang diisi saat konfirmasi DP (bisa dikoreksi di detail lead). |
| 2.4 Pelanggan & repeat order | ✅ Basis pelanggan otomatis dari lead closing, status Aktif/Dorman, repeat rate, peluang repeat order (siklus tahunan, anniversary, dorman bernilai tinggi, korporat diam) + buat tugas sekali klik, ekspor CSV (nomor HP hanya Admin). Segmen pelanggan bisa langsung dipakai di Broadcast. |
| 2.5 Skor lead | ✅ Kartu Kalibrasi skor (Pengaturan › SLA & jam kerja): closing rate per rentang skor + saran ambang Hot/Warm. |
| 2.6 Reports | ✅ Kelima jenis, termasuk Reputasi & sosmed. Angka oleh script, narasi oleh AI (model "pintar") dengan cadangan narasi script; pratinjau bisa diedit; unduh PDF & PPTX 5 slide; jadwal bulanan/mingguan diatur di Pengaturan › Pengiriman laporan → notifikasi + push + email berlampiran; riwayat. Sesuai keputusan, tidak dikirim lewat WA. |
| 2.7 Ringkasan mingguan | ✅ Kartu di Dashboard: poin dihitung script, tombol "Rangkum dengan AI" (disimpan, tidak bayar dua kali). Data website tampil di menu Website dan kartu Dashboard. |
| 2.8 Sinkron Ecount | ➖ Tidak dibuat. API Ecount ada tapi tidak bisa mengeluarkan data, jadi ekstraksi tetap manual. Omzet diambil dari nilai order di CRM. |
| 2.9 Log & biaya AI | ✅ Sudah dari Fase 1 (menu AI & Otomasi), laporan & ringkasan mingguan ikut tercatat. |

Rincian P3:

| No | Status |
|---|---|
| 3.1 Integrasi platform | ✅ Pengaturan › Integrasi: Meta Ads, Instagram, Facebook Page, TikTok, Google Business Profile, GA4, Search Console, pemantau website. Login resmi (OAuth) atau tempel token System User Meta; token disimpan terenkripsi; status sinkron, tombol sinkron, putuskan; peringatan 14 hari sebelum izin habis; bila izin dicabut Admin dapat notifikasi. Aplikasi developer (App ID/Client ID) diisi sekali di halaman yang sama. |
| 3.2 Meta Ads | ✅ Kampanye & belanja dari API (tiap 3 jam) atau diisi manual per bulan selama belum terhubung. Lead click-to-WhatsApp dicocokkan lewat id iklan di pesan pertama → biaya per lead, rata-rata skor, closing, biaya per closing, ROAS. Id iklan tak dikenal bisa dimasukkan ke kampanye. |
| 3.3 Broadcast | ✅ Segmen (preset + filter), estimasi penerima & biaya, jadwal, batas frekuensi per kontak, template WA, pengiriman bertahap, status terkirim/dibaca/gagal, balasan otomatis jadi lead (sumber Broadcast), STOP = berhenti berlangganan, duplikat & batalkan. Mode simulasi sampai WABA pindah. |
| 3.4 Reputasi | ✅ Ulasan Google (sinkron tiap jam, atau tambah/impor CSV manual), draf balasan AI dengan pagar harga, balasan otomatis tertunda untuk ★4–5, notifikasi SPV untuk ★≤3, ringkasan ulasan AI, analisa SWOT kompetitor (maks. 3), permintaan ulasan otomatis H+1/H+2/hari-H lewat template WA. |
| 3.5 Media sosial | ✅ Statistik IG/TikTok/FB per hari & per platform, posting teratas, kalender jadwal posting (WIB). IG & FB terbit otomatis lewat API; TikTok dan akun yang belum terhubung jadi pengingat posting manual. |
| 3.6 Website | ✅ Status hidup/mati (cek tiap 5 menit dari server), pengunjung & sumber trafik (GA4), halaman teratas, kata kunci (Search Console), lead website & konversi dari CRM, peringatan otomatis. |
| 3.7 Livechat Widget | ✅ Launcher, warna, sapaan, form pra-chat, jam layanan, domain yang diizinkan, kode embed satu baris; pengunjung diarahkan ke WhatsApp hotline dan tercatat sebagai lead WEB. |
| 3.8 Form Management | ✅ Form builder (field, wajib, pemetaan ke field lead), halaman form publik + QR, kode embed, anti-spam, otomasi setelah submit (lead + skor + tugas 15 menit + template WA), statistik & ekspor CSV. |

Detail cara deploy: `docs/DEPLOY.md`.

Acuan:
- `prototype/crm-prototype-v16.html` — acuan tampilan (23 layar, 14 tab Pengaturan, 4 peran)
- `docs/CRM-Sonokembang-AI-Fase2.md` — spesifikasi AI Fase 2
- `docs/PRD.md` — teks prototype versi awal

## Kondisi kode saat ini

**`src/` masih kosong.** Belum ada backend, database, login, atau satu layar pun. Jadi semua menu, tab, dan fitur di bawah ini statusnya **belum ada**. Dokumen ini fungsinya sebagai urutan kerja, bukan daftar perbaikan.

> Catatan soal `docs/PRD.md`: file ini adalah teks hasil ekspor prototype versi awal, bukan PRD lengkap (belum ada tujuan bisnis, user story, atau kriteria selesai). Ke depan sebaiknya dibuat PRD yang proper.

## Peta menu prototype v16

| Grup | Menu | Tab di dalamnya |
|---|---|---|
| Kerja harian | Dashboard | Ringkasan · Sales · Marketing |
| | Conversation (inbox WA) | — (filter, panel lead, snippet, template) |
| | Tugas Hari Ini | — |
| | Leads & Pipeline | Kanban · Tabel |
| | Detail lead | — |
| | Kontak | Semua + per tipe kontak |
| | Pelanggan | — |
| Pemasaran | Meta Ads | — |
| | Media Sosial | Statistik · Jadwal posting |
| | Website | — |
| | Reputasi | Ringkasan · Ulasan · Kompetitor · Pengaturan |
| | Broadcast | Riwayat · Detail · Buat broadcast |
| | Livechat Widget | — |
| | Form Management | — |
| Sistem | Reports | Buat laporan · Riwayat & terjadwal |
| | AI & Otomasi | — |
| | Notifikasi & SLA | — |
| | Template | Proposal · Snippet |
| | Pengaturan | Profil bisnis · Peran & akses · Users · Pipeline · Target omzet · Definisi KPI · Sumber lead & link WA · Prompt & pagar AI · Model AI & API key · Distribusi lead · Custom field · WhatsApp (Nomor & koneksi · Profil bisnis WA · Template pesan) · Integrasi · Import data |
| | Mobile (preview) | — |

Peran: **Sales** (data milik sendiri), **Marketing** (menu pemasaran), **SPV Sales** (semua chat & lead tim), **Admin** (semua).

---

## Daftar yang belum ada, urut prioritas

### P0 — Fondasi (wajib sebelum fitur apa pun)

| # | Item | Keterangan |
|---|---|---|
| 0.1 | **Keputusan hosting** | Masih terbuka: VPS vs Web Hosting Premium (Hostinger). Ini pemblokir utama. |
| 0.2 | Struktur proyek & stack | Backend + frontend + database + job runner, dijalankan di Docker |
| 0.3 | Skema database | Kontak (kunci = nomor WA), lead, pipeline/tahap, pesan, aktivitas, tugas, pengguna, peran, pengaturan, log audit |
| 0.4 | Login | Email + kata sandi, aktivitas login dicatat (waktu, perangkat, IP) |
| 0.5 | Peran & hak akses | 4 peran, menu bisa dinyalakan/dimatikan per peran, cakupan data "milik sendiri / semua" (Pengaturan › Peran & akses) |
| 0.6 | Users | Undang, ubah peran, status cuti/nonaktif, pindahkan lead sebelum nonaktif (Pengaturan › Users) |
| 0.7 | Profil bisnis | Logo, cabang, rekening DP. Dipakai di proposal & snippet (Pengaturan › Profil bisnis) |
| 0.8 | Log audit, backup, HTTPS, monitoring | Tidak terlihat di prototype, tapi wajib untuk live |

### P1 — Fase 1 inti (target live pertengahan Des)

**A. WhatsApp & Conversation**

| # | Item | Keterangan |
|---|---|---|
| 1.1 | Koneksi WhatsApp Cloud API | Webhook terima pesan, kirim pesan, status terkirim/dibaca (Pengaturan › WhatsApp › Nomor & koneksi) |
| 1.2 | Template pesan WA | Sinkron template resmi Meta, wajib untuk chat di luar jendela 24 jam (tab Template pesan) |
| 1.3 | Profil bisnis WA | Edit nama tampilan, kategori, bio, lalu kirim ke Meta (tab Profil bisnis WA) |
| 1.4 | Conversation (inbox bersama) | Daftar chat, filter multi-pilih (status/sales/sumber/"masih ditangani AI"), pencarian, real-time |
| 1.5 | Panel lead di inbox | Tandai sebagai lead / bukan lead, skor & rinciannya, tahap, tombol Kirim proposal / Closing / Test food / Lost |
| 1.6 | Jendela 24 jam | Hitung mundur, kunci balasan bebas di luar jendela |
| 1.7 | Snippet & Template | Sisipkan pakai `/shortcut`, folder, hitungan pemakaian (Template › Snippet) |
| 1.8 | Catatan internal | Hanya terlihat tim |

**B. Lead, pipeline & kontak**

| # | Item | Keterangan |
|---|---|---|
| 1.9 | Leads & Pipeline | Kanban + Tabel, multi pipeline (Wedding / Non Wedding / Retail), filter, atur kolom tabel, label ⚡ Otomatis / ✎ Manual |
| 1.10 | Aturan pindah tahap | Lost/Abandoned wajib alasan, Closing wajib bukti DP |
| 1.11 | Detail lead | Data kualifikasi, aktivitas otomatis dari chat, skor, nilai potensi, test food, unggah bukti DP |
| 1.12 | Pengaturan Pipeline | Tahap, % peluang, SLA per tahap, syarat wajib pindah |
| 1.13 | Kontak | Satu nomor = satu kontak, tipe kontak, atur kolom, ekspor CSV |
| 1.14 | Custom field | Tambah field, wajib/opsional, boleh diisi AI, tampil di tabel |
| 1.15 | Sumber lead & link WA | Link WA per kanal, QR pameran, data click-to-WA. Sumber "Tidak diketahui" wajib dikoreksi sebelum Proposal |
| 1.16 | Distribusi lead | Round-robin berbobot, aturan per channel, sales cuti dikecualikan, assignee ditetapkan saat pesan pertama |
| 1.17 | Template proposal | Variabel otomatis, `[harga_per_pax]` wajib diisi sales, kirim PDF via WA, tercatat sebagai aktivitas |

**C. AI (urutan sesuai dokumen Fase 2 §6, langkah 1–2)**

| # | Item | Keterangan |
|---|---|---|
| 1.18 | Adapter AI | Satu lapisan untuk Anthropic / Google / OpenAI, bisa ganti penyedia tanpa coding |
| 1.19 | Model AI & API key | Key terenkripsi di server, hanya 4 karakter terakhir yang tampil, uji koneksi, model per tugas, batas biaya (notifikasi 80%, berhenti 100%), samarkan nomor HP & alamat, log 90 hari, penyedia cadangan, audit log (Pengaturan › Model AI & API key) |
| 1.20 | Pagar pengaman lapis 1 (script) | Kata terlarang & angka Rp dicek sebelum balasan terkirim |
| 1.21 | AI Responder | Balas chat pertama sesuai jam kerja |
| 1.22 | Isi data kualifikasi dari chat | Kalimat bebas → field lead, divalidasi script |
| 1.23 | Serah terima ke sales | Pemicu: data lengkap / kata kunci harga-diskon-tanggal / jam. Ringkasan lead dibuat script |
| 1.24 | Pagar pengaman lapis 2 (AI) | Cek kalimat yang lolos lapis 1 |
| 1.25 | FAQ | Cocokkan kata kunci dulu, AI hanya bila tidak cocok |
| 1.26 | Prompt & pagar AI | Prompt bisa diubah tanpa deploy, versi tersimpan & bisa dikembalikan, uji di sandbox |
| 1.27 | Layar AI & Otomasi | Antrean serah terima (Ambil / Tugaskan), log pagar pengaman, biaya AI bulan ini |

**D. Kerja harian & pengawasan**

| # | Item | Keterangan |
|---|---|---|
| 1.28 | Tugas Hari Ini | Tugas otomatis dari aturan pengingat + manual, terlambat, target pribadi |
| 1.29 | Notifikasi & SLA | Tangga eskalasi (jam kerja 08.00–20.00), kanal notifikasi, daftar notifikasi |
| 1.30 | Import data | Migrasi dari CRM lama (kontak, pipeline, snippet) dengan langkah cek dulu sebelum ditimpa |
| 1.31 | Tampilan mobile | Responsif untuk sales: inbox, detail lead, tugas, ubah tahap + DP, notifikasi |

### P2 — Fase 2: analitik & laporan

| # | Item | Keterangan |
|---|---|---|
| 2.1 | Dashboard | Tab Ringkasan (konversi per pipeline, omzet vs target, peluang aktif), Sales (funnel, peluang mandek >14 hari, leaderboard), Marketing (sumber → closing → omzet, insight sosmed, iklan & broadcast) |
| 2.2 | Kinerja per sales | Peringkat tim, rincian per orang, funnel, alasan Lost, catatan coaching |
| 2.3 | Target omzet & Definisi KPI | Target per sales/periode, batas warna & pemicu SLA, definisi KPI dari event nyata |
| 2.4 | Pelanggan & repeat order | Basis pelanggan otomatis saat closing, peluang repeat order |
| 2.5 | Skor lead | Rumus poin dari data kualifikasi. Dikalibrasi setelah 1–2 bulan data (Fase 2 §6 langkah 3) |
| 2.6 | Reports (laporan AI) | Lima jenis laporan, periode, untuk siapa, PDF 2–3 hal + PPTX 5 slide, jadwal (mis. tanggal 1 jam 07.00 ke email & WA), riwayat. Akses Admin/SPV/Marketing |
| 2.7 | Ringkasan mingguan & catatan website | Narasi AI opsional, angka dari script (Fase 2 fitur 12–13) |
| 2.8 | Sinkron Ecount | Omzet vs target dari Ecount, sinkron harian |
| 2.9 | Log tindakan AI & pemantauan biaya | Fase 2 fitur 14–15 (sebagian sudah masuk di 1.27) |

### P3 — Pemasaran

| # | Item | Keterangan |
|---|---|---|
| 3.1 | Integrasi platform | Hubungkan/putuskan akun, masa berlaku izin, status sinkron (Pengaturan › Integrasi). Prasyarat untuk 3.2–3.6 |
| 3.2 | Meta Ads | Kampanye, belanja, biaya/lead, closing dari CRM, kualitas lead |
| 3.3 | Broadcast | Buat (segmen, jadwal, template, estimasi biaya), riwayat, detail & balasan, duplikat, batalkan |
| 3.4 | Reputasi (Google Business) | Ulasan, balas pakai AI, ringkasan ulasan AI, analisa kompetitor (maks. 3), permintaan ulasan otomatis H+1 (Fase 2 fitur 9–11) |
| 3.5 | Media Sosial | Statistik IG/TikTok + jadwal posting otomatis |
| 3.6 | Website | Pengunjung, sumber trafik, halaman teratas, kata kunci Search Console |
| 3.7 | Livechat Widget | Konfigurasi launcher, form pra-chat, kode embed, arahkan ke hotline WA |
| 3.8 | Form Management | Daftar form, susunan field, pemetaan ke field lead, otomasi setelah submit |

### P4 — Usulan tambahan (Fase 2 §2, sesuai kebutuhan)

Draf balasan untuk sales, penilaian kualitas chat sales, pengingat lead dingin H+3, ringkasan alasan Lost.

---

## Hal yang perlu diputuskan sebelum mulai

1. **Hosting**: VPS atau Web Hosting Premium. P0 tidak bisa dimulai sebelum ini jelas.
2. **Peran "Direktur" vs "Admin"**: tab *Prompt & pagar AI* masih berlabel "HANYA DIREKTUR", padahal di v16 peran Direktur sudah diganti Admin. Perlu dikonfirmasi siapa yang boleh mengubah prompt.
3. **Layar KPI & Laporan sumber lead**: masih ada di kode prototype, tapi tidak muncul di menu v16 (isinya tampaknya pindah ke Dashboard). Perlu dikonfirmasi apakah tetap dibuat sebagai layar sendiri.
4. **Penyedia AI utama** (Claude vs Gemini): diputuskan setelah uji 50 chat (Fase 2 §7). Adapter tetap dibangun di awal, jadi keputusan ini tidak memblokir.
5. **Batas biaya AI per bulan**: usulan Rp500rb.
6. **Penerima laporan terjadwal** dan salurannya (email / WA).
7. **Akses API untuk P3**: Meta Ads, Google Business Profile, GA4/Search Console, TikTok, Ecount. Masing-masing perlu akun & izin terpisah.
