# CRM Sonokembang

Project dipisah menjadi dua bagian yang memakai **satu database MySQL** (dikelola lewat phpMyAdmin):

```
website/      1. Website CRM — CodeIgniter 3 + MySQL        → branch GitHub: website
vps-server/   2. Server VPS — Node.js (cron, webhook WA)    → branch GitHub: server-vps
legacy/       kode lama (Node/Fastify + React + PostgreSQL), referensi saat porting fitur
docs/         PRD, spesifikasi, gap analysis
scripts/      auto-push ke GitHub & skrip deploy
```

## Dua server

| | Premium Web Hosting | VPS |
|---|---|---|
| Isi | `website/` (CI3) + **database MySQL** (phpMyAdmin) | `vps-server/` (Node.js + PM2 + Caddy) |
| Alamat | `https://crm.sonokembangmalang.tech` | `https://api.sonokembangmalang.tech` |
| Branch GitHub | `website` | `server-vps` |

```
 Browser ─► crm.sonokembangmalang.tech  (hosting: CI3 + MySQL)
               │   ▲  /api/* (X-API-Key)            ▲ Remote MySQL :3306
     kirim WA, │   │  buat lead otomatis, ping       │ (hanya IP VPS)
   cek status, ▼   │                                 │
            api.sonokembangmalang.tech  (VPS: Node, cron) ◄── webhook WhatsApp (Meta)
```

- **Website → VPS** (HTTPS): kirim WA (`POST /wa/send`), status (`GET /health`), jalankan job manual (`POST /jobs/<nama>/run`) — menu **Server VPS**.
- **VPS → Website** (HTTPS): buat lead otomatis (`POST /api/auto_lead`), cek website hidup (`GET /api/ping`).
- **VPS → MySQL hosting** (Remote MySQL): simpan pesan masuk, SLA, tugas, notifikasi, broadcast, riwayat job.
- Diamankan **kunci yang sama**: `VPS_API_KEY` di `website/.env` dan `vps-server/.env`. Zona waktu DB dipaksa `+07:00` di kedua sisi (MySQL hosting biasanya UTC).

### DNS (di pengelola domain sonokembangmalang.tech)

| Tipe | Nama | Isi |
|---|---|---|
| A | `crm` | IP Premium Web Hosting (lihat hPanel) — atau ikuti petunjuk hPanel saat menambah subdomain |
| A | `api` | `187.77.116.15` (VPS) |

---

## 1. Website di Premium Web Hosting

Fitur saat ini: login, dashboard, inbox WhatsApp, lead (buat/ubah/pindah tahap, skor & nama otomatis, catatan, aktivitas), pelanggan & repeat order, tugas, notifikasi, menu Server VPS.

1. **Subdomain**: hPanel › *Domains* › *Subdomains* › buat `crm` (folder mis. `public_html/crm`). Aktifkan SSL di hPanel › *Security* › *SSL*.
2. **Database**: hPanel › *Databases* › *MySQL Databases* › buat database + user (nama jadi `u143987767_CRM`).
   Buka **phpMyAdmin** › pilih database › *Import* › `website/database/schema.sql` › *Go*.
3. **Izinkan VPS mengakses database**: hPanel › *Databases* › *Remote MySQL* › tambah IP VPS **`187.77.116.15`** + pilih database tadi. Catat *hostname* MySQL di halaman itu (mis. `srv612.hstgr.io`) → dipakai di `vps-server/.env`.
4. **Kode** (otomatis dari GitHub): hPanel › *Advanced* › *Git* › repository `https://github.com/<user>/<repo>.git`, branch **`website`**, folder `public_html/crm` › *Create*. Aktifkan **Auto Deployment** dan salin *Webhook URL*-nya ke GitHub › repo › *Settings* › *Webhooks* › *Add webhook* — setiap branch `website` berubah, hosting langsung tarik kode baru.
   (Repo private: tambahkan *SSH key* dari halaman Git hPanel ke GitHub › *Settings* › *Deploy keys*.)
5. **Composer & .env** (sekali): hPanel › *Advanced* › *SSH Access* › aktifkan, lalu:
   ```bash
   cd ~/domains/sonokembangmalang.tech/public_html/crm
   composer install --no-dev
   cp .env.example .env && nano .env     # DB_HOST=localhost, DB_*, VPS_URL, VPS_API_KEY, ENCRYPTION_KEY
   ```
   Folder `vendor/` dan `.env` tidak ikut git, jadi tidak tertimpa auto deployment. Jalankan `composer install` lagi hanya bila `composer.json` berubah.
6. Login `admin@sonokembang.local` / `admin123` → **segera ganti password**.

Untuk coba di laptop: XAMPP/Laragon, folder `website` di `htdocs`, `BASE_URL=http://localhost/website/`, `CI_ENV=development`.

---

## 2. Server VPS (Node.js)

| Job | Jadwal | Fungsi |
|---|---|---|
| `sla` | tiap menit | chat belum dibalas > 15 mnt → notifikasi sales; > 60 mnt → eskalasi SPV |
| `task-due` | tiap menit | notifikasi tugas yang jatuh tempo 15 menit lagi |
| `stale-leads` | tiap 15 mnt (08–20) | tugas follow-up otomatis untuk lead diam 3 hari |
| `broadcast` | tiap menit | kirim broadcast WA terjadwal, 50 penerima/menit, lewati yang STOP |
| `website-ping` | tiap 5 mnt | cek website bisa dihubungi |
| `cleanup` | 02:00 | hapus sesi & log lama |

Batas waktu SLA/pengingat diatur di tabel `settings` (`sla`, `reminder`). Tambah job baru: entri baru di [`vps-server/src/jobs/index.js`](vps-server/src/jobs/index.js).

### Pasang di VPS (Ubuntu)

```bash
# Node 20, PM2, Caddy (HTTPS otomatis)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git caddy
sudo npm i -g pm2

git clone -b server-vps git@github.com:antoniusfajar/crm-sonokembang.git /opt/SK-Crm
cd /opt/SK-Crm
cp .env.example .env && nano .env      # DB_HOST = hostname Remote MySQL hosting, VPS_API_KEY, WA_*
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup                 # otomatis jalan saat VPS reboot

sudo cp Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
sudo ufw allow 22,80,443/tcp && sudo ufw enable   # port 4000 TIDAK dibuka; lewat Caddy saja
```

Cek: `curl https://api.sonokembangmalang.tech/` → `{"app":"crm-vps-server","ok":true}`, lalu buka menu **Server VPS** di website — harus hijau "terhubung" dengan DB OK.

Perintah berguna: `pm2 logs crm-vps`, `pm2 restart crm-vps`, `npm run job -- sla`, update: `bash deploy.sh`.

**WhatsApp**: mulai dengan `WA_MODE=simulator`. Coba pesan masuk palsu dari VPS:
```bash
curl -X POST http://127.0.0.1:4000/wa/simulate-inbound -H "X-API-Key: <kunci>" -H "Content-Type: application/json" -d '{"phone":"081234567890","name":"Budi","body":"Halo [IG] mau tanya catering 300 pax"}'
```
Saat siap: `WA_MODE=meta`, isi `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, lalu di Meta Developer daftarkan webhook `https://api.sonokembangmalang.tech/webhook` dengan `WA_VERIFY_TOKEN`.

---

## 3. GitHub: 2 branch + auto push

Cara kerjanya: kamu cukup bekerja di **satu folder** (branch `main`). Setiap push ke `main`, GitHub Action [`split-branches.yml`](.github/workflows/split-branches.yml) otomatis memotong:

- isi `website/` → branch **`website`** (dipakai server web)
- isi `vps-server/` → branch **`server-vps`** (dipakai VPS)

### Setup sekali

1. Buat repo kosong di GitHub (tanpa README), mis. `crm-sonokembang`.
2. Di folder project ini:
   ```bash
   git init -b main
   git add -A
   git commit -m "Pisah website CI3 dan server VPS"
   git remote add origin https://github.com/<user>/crm-sonokembang.git
   git push -u origin main
   ```
3. Di GitHub › *Settings* › *Actions* › *General* › *Workflow permissions* › pilih **Read and write permissions**.
4. Tunggu tab *Actions* selesai → branch `website` dan `server-vps` muncul.

Login GitHub pertama kali akan muncul jendela browser (Git Credential Manager); setelah itu tersimpan.

### Push manual

```bash
git add -A
git commit -m "pesan perubahan"
git push
```

### Auto push setiap ada perubahan

Biarkan jendela terminal ini terbuka selama bekerja:

```bash
powershell -ExecutionPolicy Bypass -File scripts\auto-push.ps1
```

Tiap 30 detik skrip memeriksa file yang berubah → `commit` → `push` ke `main` → Action memperbarui branch `website` / `server-vps`. Ubah jarak cek dengan `-Interval 60`. (Git Bash/Linux: `bash scripts/auto-push.sh`.)

> Auto push membuat banyak commit kecil dan langsung mengirim apa pun yang tersimpan — pastikan `.env` tidak ikut (sudah ada di `.gitignore`).

### Update server setelah push

- **Hosting**: otomatis lewat Auto Deployment hPanel (webhook GitHub di langkah 1.4).
- **VPS**: `bash /opt/SK-Crm/deploy.sh`, atau otomatis tiap 5 menit dengan crontab VPS: `*/5 * * * * bash /opt/SK-Crm/deploy.sh >> /var/log/crm-deploy.log 2>&1`

---

## Belum di-port dari `legacy/`

AI responder & pagar pengaman, laporan PDF/PPTX & jadwal laporan, integrasi Meta Ads/Google/TikTok, reputasi Google, jadwal posting sosial media, form publik & livechat widget, impor chat lama, pengaturan peran/custom field dari menu. Tabel `job_runs` + pola job di `vps-server` sudah siap untuk menampung pekerjaan latar belakangnya.
