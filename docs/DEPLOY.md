# Panduan Deploy CRM Sonokembang ke VPS

Untuk tim IT. Target: VPS Hostinger (Ubuntu 22.04/24.04), minimal **RAM 2 GB**, idealnya 4 GB.

Semua jalan di Docker: database PostgreSQL, aplikasi CRM, dan Caddy (HTTPS otomatis). Satu perintah untuk menyalakan, satu perintah untuk update.

---

## 1. Siapkan VPS (sekali saja)

```bash
# Login ke VPS sebagai root, lalu:
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh          # pasang Docker + compose plugin
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
timedatectl set-timezone Asia/Jakarta
```

## 2. Domain

Buat subdomain, misalnya `crm.sonokembangcateringmalang.com`. Di pengelola DNS (hPanel Hostinger → Domains → DNS), tambahkan:

| Type | Name | Points to |
|---|---|---|
| A | crm | IP VPS |

Tunggu sampai `ping crm.sonokembangcateringmalang.com` mengarah ke IP VPS.

## 3. Ambil kode & isi konfigurasi

```bash
git clone https://github.com/syafrieno-collab/sk-crm.git /opt/sk-crm
cd /opt/sk-crm
cp .env.example .env
nano .env
```

Isi minimal:

| Variabel | Cara mengisi |
|---|---|
| `DOMAIN` | `crm.sonokembangcateringmalang.com` |
| `DB_PASSWORD` | `openssl rand -base64 24` |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` — **simpan juga di password manager**. Kalau hilang, API key AI harus dipasang ulang. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Akun Admin pertama. Kosongkan `ADMIN_PASSWORD` kalau ingin dibuatkan acak (lihat log). |
| `WA_MODE` | Biarkan `simulator` sampai migrasi WhatsApp (lihat bagian 7). |

### Email (disarankan)

Untuk ringkasan harian (20.00 WIB ke Admin), email eskalasi SLA, dan laporan terjadwal (PDF/PPTX sebagai lampiran). Paling mudah memakai email hosting Hostinger yang sudah ada:

1. hPanel → Emails → buat akun, mis. `crm@sonokembangcateringmalang.com`.
2. Isi di `.env`: `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER=crm@...`, `SMTP_PASS=<kata sandi email>`, `SMTP_FROM=CRM Sonokembang <crm@...>`.
3. Setelah aplikasi jalan: **Notifikasi & SLA › Kanal notifikasi › Tes email**.

Tanpa SMTP, CRM tetap jalan; hanya email yang tidak terkirim.

## 4. Nyalakan

```bash
docker compose up -d --build
docker compose logs -f app      # tunggu "Akun Admin pertama", lalu Ctrl+C
```

Buka `https://crm.sonokembangcateringmalang.com`. Sertifikat HTTPS dibuat otomatis oleh Caddy (butuh port 80 & 443 terbuka dan DNS sudah benar).

Migrasi database jalan otomatis setiap aplikasi start.

## 5. Setelah login pertama (oleh Admin)

1. **Pengaturan › Profil bisnis**: nama, alamat, rekening DP.
2. **Pengaturan › Users**: undang SPV, Sales, Marketing. Kata sandi sementara muncul sekali; sampaikan langsung ke orangnya.
3. **Pengaturan › Distribusi lead**: atur bobot tiap sales.
4. **Pengaturan › Model AI & API key**: pasang API key (Anthropic / Google / OpenAI). Key diuji dulu, lalu disimpan terenkripsi. Tetapkan batas biaya per bulan.
5. **Pengaturan › Prompt & pagar AI**: cek prompt, kata terlarang, FAQ. Coba di **Uji di chat sandbox**.
6. **Pengaturan › Sumber lead & link WA**: buat link WA per kanal (bio IG, website, QR pameran).
7. Coba alur penuh dengan tombol **Simulasi chat masuk** di Conversation.
8. **Notifikasi & SLA › Kanal notifikasi**: atur push dan email.
9. Minta setiap sales membuka CRM (Chrome/Edge) → **Akun saya › Aktifkan notifikasi**. Push native di HP menyusul bersama aplikasi mobile di fase terakhir.

## 6. Update versi baru

```bash
cd /opt/sk-crm
git pull
docker compose up -d --build
```

## 7. Menyambungkan WhatsApp Cloud API (saat migrasi dari CRM lama)

Lakukan saat siap memindah nomor hotline. Nomor yang sama; customer tidak perlu menyimpan nomor baru.

1. Meta Business Manager → WhatsApp Manager → catat **Phone number ID** dan **WhatsApp Business Account ID**.
2. Business Settings → System users → buat System User (Admin), beri aset App + WhatsApp Account, lalu **Generate token** dengan izin `whatsapp_business_messaging` dan `whatsapp_business_management`. Token ini permanen; simpan baik-baik.
3. developers.facebook.com → App → Settings → Basic → **App secret**.
4. Isi `.env`:
   ```
   WA_MODE=meta
   WA_PHONE_NUMBER_ID=...
   WA_BUSINESS_ACCOUNT_ID=...
   WA_ACCESS_TOKEN=...
   WA_APP_SECRET=...
   WA_VERIFY_TOKEN=<openssl rand -hex 16>
   ```
   Lalu `docker compose up -d`.
5. App Dashboard → WhatsApp → Configuration → Webhook:
   - Callback URL: `https://crm.sonokembangcateringmalang.com/api/webhooks/whatsapp`
   - Verify token: isi yang sama dengan `WA_VERIFY_TOKEN`
   - Subscribe field: **messages**
6. Lepas webhook dari CRM lama (satu nomor hanya bisa punya satu webhook aktif).
7. Di CRM: **Pengaturan › WhatsApp › Template pesan › Sinkron dari Meta** untuk menarik template resmi.
8. **Pengaturan › WhatsApp › Profil bisnis WA → Simpan ke Meta** untuk mengirim profil yang sudah disiapkan.
9. Kirim chat percobaan dari HP pribadi ke hotline. Chat harus muncul di Conversation dalam hitungan detik.

Setiap webhook diverifikasi tanda tangannya (`X-Hub-Signature-256`) memakai App secret; webhook palsu ditolak.

## 8. Backup

```bash
chmod +x scripts/*.sh
crontab -e
# tambahkan baris ini: backup tiap hari 02.15, simpan 14 hari
15 2 * * * cd /opt/sk-crm && ./scripts/backup.sh >> /var/log/skcrm-backup.log 2>&1
```

File ada di `/opt/sk-crm-backups`. **Salin rutin ke luar VPS** (Google Drive / storage lain). Backup yang hanya ada di VPS ikut hilang kalau VPS rusak.

Pulihkan: `./scripts/restore.sh /opt/sk-crm-backups/db-YYYYMMDD-HHMM.dump`

Uji restore minimal sebulan sekali di VPS/komputer lain.

## 9. Pemantauan

- `docker compose ps`: ketiga service harus `healthy` / `running`.
- `docker compose logs --tail 200 app`: error aplikasi.
- `https://<domain>/api/health` → `{"ok":true,...}`. Pasang di layanan pemantau gratis (mis. UptimeRobot) agar ada notifikasi saat CRM mati.

## 10. Keamanan

- Jangan commit `.env`. Simpan isinya di password manager.
- Login gagal 5x → dikunci 15 menit. Semua login tercatat (Pengaturan › Users › Log login).
- Nonaktifkan akun karyawan yang keluar **di hari terakhir kerja**; sesi langsung diputus.
- API key AI disimpan terenkripsi (AES-256-GCM) dan tidak pernah dikirim ke browser.
- Update OS VPS rutin: `apt update && apt upgrade -y`.

## Migrasi data dari CRM lama

Di **Pengaturan › Import data** (CSV atau Excel .xlsx), urutannya:

1. **Kontak** — petakan kolom `contact_id` ke "ID kontak CRM lama". File chat CRM lama hanya berisi `contact_id`, jadi langkah ini wajib sebelum impor chat.
2. **Lead / opportunity**.
3. **Riwayat chat** — satu baris = satu pesan (`message_id, conversation_id, contact_id, direction, body, timestamp, nama_sales`). Nama sales dicocokkan dengan nama pengguna CRM, jadi buat akun sales dulu. Impor ulang aman (pesan yang sama dilewati), dan pesan hasil impor tidak memicu AI, SLA, atau notifikasi. Maksimal 100.000 baris per file — pecah file bila lebih.

## Setelah live: Fase 2 (analitik & laporan)

1. **Pengaturan › Target omzet** — isi target tim & per sales tiap awal bulan (atau "Salin dari bulan lalu"). Porsi per pipeline diatur di Pengaturan › Pipeline.
2. Pastikan sales mengisi **Nilai total order** saat konfirmasi DP — angka inilah omzet di Dashboard & laporan.
3. **Pengaturan › Pengiriman laporan › + Jadwal baru** — mis. Ringkasan direksi tiap tanggal 1 jam 07.00 ke Admin. Penerima dapat notifikasi + push di CRM, dan email berlampiran bila SMTP diisi.
4. Setelah 1–2 bulan data: **Pengaturan › SLA & jam kerja › Kalibrasi skor** untuk menggeser ambang Hot/Warm.

Narasi laporan & ringkasan mingguan memakai model "pintar" di Pengaturan › Model AI. Tanpa API key, laporan tetap dibuat dengan narasi dari sistem.

## Setelah live: Fase 3 (pemasaran & integrasi)

Semua dilakukan Admin dari **Pengaturan › Integrasi**. Pastikan `PUBLIC_URL` di `.env` sudah alamat HTTPS asli (mis. `https://crm.sonokembang.com`), karena alamat balik (redirect URI) login dibentuk dari situ.

1. **Aplikasi developer** (sekali saja, oleh IT) — buka kartu *Aplikasi developer › Atur*. Setiap baris menampilkan Redirect URI yang harus disalin ke konsol platform:
   - **Meta**: developers.facebook.com › My Apps › app tipe *Business* › *Facebook Login for Business*. Redirect URI: `<PUBLIC_URL>/api/integrations/oauth/meta/callback`.
   - **Google**: console.cloud.google.com › APIs & Services › aktifkan *Google Analytics Admin API*, *Google Analytics Data API*, *Search Console API*, *My Business Account Management API*, *My Business Business Information API* (akses API ulasan perlu diajukan ke Google lebih dulu). Credentials › OAuth client ID (*Web application*) › redirect URI `<PUBLIC_URL>/api/integrations/oauth/google/callback`.
   - **TikTok**: developers.tiktok.com › Manage apps › *Login Kit* + *Display API*, redirect URI `<PUBLIC_URL>/api/integrations/oauth/tiktok/callback`.
2. **Meta (Ads, Instagram, Facebook Page)** — cara paling awet: Business Manager › Pengguna › *System user* › buat token (izin `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_manage_insights`, `instagram_content_publish`) lalu tempel di CRM. Token ini tidak kedaluwarsa. Alternatif: tombol *Login dengan Facebook* (token ±60 hari; Admin diingatkan 14 hari sebelum habis).
3. **Google** — tombol *Login dengan Google* memakai akun yang menjadi pemilik/pengelola Business Profile, properti GA4, dan Search Console. Pilih lokasi/properti yang ingin disambungkan.
4. **Pemantau website** — tambahkan alamat website; dicek tiap 5 menit dari server.
5. **Reputasi › Pengaturan** — isi *link minta ulasan* (Business Profile › Minta ulasan) dan aktifkan permintaan ulasan otomatis bila sudah siap. Template WA `minta_ulasan_google` harus disetujui Meta dulu.
6. **Livechat Widget** — isi teks & domain yang diizinkan, lalu tempel satu baris kode embed di website (sebelum `</body>`). Pengunjung diarahkan ke WhatsApp hotline dari Profil bisnis.
7. **Broadcast** — template WA (mis. `promo_menu_baru`) harus disetujui Meta. Atur biaya per pesan & batas frekuensi di halaman Broadcast. Selama WA masih mode simulasi, broadcast hanya tercatat, tidak benar-benar terkirim.
8. **Sebelum Meta Ads terhubung** — buka Meta Ads › *+ Kampanye manual* dan isi belanja per bulan agar biaya per lead sudah terhitung.

**Ecount**: API Ecount tidak bisa mengeluarkan data, jadi tidak ada sinkron otomatis. Omzet di CRM diambil dari *Nilai total order* yang diisi sales saat DP.

## Pengembangan lokal (untuk developer)

```bash
npm install
# PostgreSQL lokal: user/password/db = skcrm
npm run db:seed -w src/server -- --demo     # migrasi + data contoh
npm run db:seed -w src/server -- --demo --history   # + riwayat 12 bulan untuk mencoba Dashboard, Pelanggan & Reports
npm run dev                                  # API :3000, web :5173
npm test                                     # butuh DB skcrm_test
```

Akun demo: `dewi@sonokembang.local` / `sonokembang123` (Sales), `rahman@sonokembang.local` (SPV).
