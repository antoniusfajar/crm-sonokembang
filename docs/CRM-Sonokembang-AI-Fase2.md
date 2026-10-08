# CRM Sonokembang — Spesifikasi AI Fase 2

Versi: 7 Okt 2026 · Status: draf untuk disetujui · Prototipe: artifact "CRM Sonokembang — Prototype" (v16)

## 1. Prinsip

1. **Script dulu, AI belakangan.** AI hanya dipakai untuk memahami atau menulis bahasa manusia yang bebas (chat, ulasan, narasi). Semua yang bisa ditulis sebagai aturan "kalau X maka Y" dikerjakan script.
2. **Angka selalu dari sistem.** AI tidak pernah menghitung angka laporan, hanya menuliskan narasinya.
3. **AI tidak pernah menyebut harga final, memberi diskon, atau menjanjikan tanggal tersedia.** Pagar pengaman berlapis: script dulu, baru AI.
4. **Bisa ganti penyedia AI tanpa coding ulang.** Semua panggilan AI lewat satu lapisan (adapter), dan API key dipasang lewat menu.

## 2. Daftar fitur AI & pembagian AI vs script

| No | Fitur | Jenis | Bagian script | Bagian AI |
|---|---|---|---|---|
| 1 | AI Responder (balas chat pertama) | **AI** | Jam kerja, pemicu, log | Memahami chat bebas & membalas |
| 2 | Isi data kualifikasi dari chat | **AI** | Validasi format (tanggal, angka) | Ubah kalimat bebas → field lead |
| 3 | Skor lead Hot/Warm/Cold | Script | Rumus poin (input dari no. 2) | — |
| 4 | Serah terima ke sales | Campuran | Pemicu: data lengkap / kata kunci / jam | Ringkasan untuk sales (opsional) |
| 5 | Pagar pengaman | Campuran | Lapis 1: kata terlarang, angka Rp | Lapis 2: kalimat yang lolos lapis 1 |
| 6 | Jawab pertanyaan umum (FAQ) | Campuran | Cocokkan kata kunci FAQ | Hanya bila FAQ tidak cocok |
| 7 | Saran template proposal | Script | Tabel jenis acara → template | — |
| 8 | Ringkasan lead untuk sales | Script | Data kualifikasi + 3 chat terakhir | — |
| 9 | Balas ulasan Google | **AI** | Notifikasi SPV untuk ≤3★, tunda 30 mnt | Menulis balasan (semua bintang, otomatis) |
| 10 | Ringkasan ulasan | **AI** | Hitung rating & sentimen | Rangkum pujian & keluhan |
| 11 | Analisa kompetitor | **AI** | Ambil rating & jumlah ulasan | Kekuatan & kelemahan |
| 12 | Ringkasan mingguan dashboard | Campuran | Semua angka | Narasi 3–4 kalimat (opsional) |
| 13 | Catatan website | Campuran | Ambang batas (kecepatan, posisi, checkout) | Saran perbaikan (opsional) |
| 14 | Log tindakan AI | Script | Catat kejadian | — |
| 15 | Pemantauan biaya AI | Script | Hitung dari pemakaian token | — |
| 16 | **Laporan AI (PDF & Slides)** — baru | Campuran | Semua angka, grafik, file PDF/PPTX | Ringkasan eksekutif, temuan, rekomendasi |

**Usulan tambahan:** draf balasan untuk sales (AI), penilaian kualitas chat sales (campuran: kecepatan oleh script, nada oleh AI dari sampel mingguan), pengingat lead dingin H+3 (script, draf pesannya oleh AI), ringkasan alasan Lost (script).

## 3. Fitur baru: Menu Reports (laporan AI)

- **Lokasi:** Sistem › Reports. Akses: Admin, SPV, Marketing (Sales tidak).
- **Jenis laporan:** Penjualan & pipeline, Kinerja tim sales, Marketing & sumber lead, Reputasi & media sosial, Ringkasan direksi.
- **Pilihan:** periode (minggu ini, bulan ini, bulan lalu, kuartal), untuk siapa (Direksi / SPV / Tim; gaya bahasa menyesuaikan), catatan khusus untuk AI.
- **Format:**
  - PDF 2–3 halaman: ringkasan eksekutif, 4 angka utama, grafik, temuan, rekomendasi.
  - Slides 5 halaman 16:9, unduh .pptx: judul, ringkasan, angka utama, temuan, rekomendasi.
- **Alur:** script menghitung angka → AI menulis narasi → pengguna cek pratinjau → unduh atau kirim.
- **Terjadwal:** contohnya Ringkasan direksi setiap tanggal 1 jam 07.00 dikirim ke email & WA Direktur.
- **Riwayat:** semua laporan tersimpan dan bisa diunduh ulang.
- **Biaya:** sekitar Rp1.000 per laporan (Claude Sonnet).

## 4. Menu Model AI & API key

- **Lokasi:** Pengaturan › Model AI & API key. Hanya Admin.
- **Isi menu:**
  - Pilih penyedia (Anthropic / Google / OpenAI), tempel API key, lalu klik **Simpan & uji koneksi**.
  - Model per tugas: model hemat untuk chat, model pintar untuk laporan & analisa.
  - Batas biaya per bulan, dengan notifikasi di 80%. Di 100%, AI berhenti dan chat langsung ke sales; CRM tetap jalan.
  - Pengaman: sembunyikan nomor HP & alamat sebelum dikirim ke AI, log 90 hari, cadangan penyedia kedua.
- **Aturan keamanan (wajib saat dibangun):**
  - Key disimpan terenkripsi di server (bukan di browser, bukan di kode).
  - Setelah disimpan, key tidak pernah ditampilkan lagi; yang terlihat hanya 4 karakter terakhir.
  - Semua panggilan AI terjadi di server, sehingga key tidak pernah sampai ke HP atau laptop pengguna.
  - Setiap perubahan key tercatat di log audit.

## 5. Rekomendasi model

| Tugas | Model utama | Alternatif hemat |
|---|---|---|
| Chat, ekstraksi data, pagar lapis 2, balas ulasan | Claude Haiku 4.5 ($1 / $5 per 1 juta token) | Gemini 3.1 Flash-Lite ($0,25 / $1,5) |
| Laporan, ringkasan ulasan, analisa kompetitor | Claude Sonnet 5 ($2 / $10) | Gemini 3.8 Flash ($0,75 / $3,75, harga promo s/d 31 Des 2026) |

**Perkiraan biaya per bulan** (±500 nomor WA baru, ±15 balasan AI per percakapan, dengan prompt caching):

| Paket | Perkiraan biaya |
|---|---|
| Paket Claude (Haiku + Sonnet) | ±Rp430rb |
| Paket Gemini (Flash-Lite + Flash) | ±Rp120–240rb, tergantung chat pakai Flash-Lite atau Flash |

Harga dari pihak ketiga per 6 Okt 2026. Cek ulang di halaman harga resmi sebelum anggaran final.

**Uji sebelum memutuskan:** jalankan 50 chat asli (dianonimkan) di kedua model. Nilai 3 hal:
- Bahasa natural atau tidak.
- Patuh pagar pengaman (tidak menyebut harga).
- Akurat mengisi data kualifikasi.

Pilih yang lulus dengan biaya terendah.

## 6. Urutan pengerjaan

1. Adapter AI + menu Model AI & API key + pagar lapis 1 (script).
2. AI Responder (1) + isi data dari chat (2) + serah terima (4) + pagar lapis 2 (5).
3. Skor lead (3) setelah 1–2 bulan data.
4. Reputasi (9–11), Reports (16), ringkasan & catatan (12–13).
5. Usulan tambahan sesuai kebutuhan.

## 7. Keputusan yang masih terbuka

- Penyedia AI utama: Claude atau Gemini? Diputuskan setelah uji 50 chat.
- Batas biaya AI per bulan. Usulan Rp500rb, di dalam anggaran CRM ±Rp1 jt/bulan.
- Penerima laporan terjadwal dan salurannya (email / WA).
