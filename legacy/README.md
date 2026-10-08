# CRM Sonokembang

Sales & Marketing CRM untuk Sonokembang Catering Malang: inbox WhatsApp bersama, AI responder dengan pagar pengaman, lead & pipeline, tugas follow-up, eskalasi SLA, dashboard, basis pelanggan & repeat order, laporan AI (PDF/PPTX), serta pemasaran: Meta Ads, broadcast WA, reputasi Google, media sosial, website, livechat widget, dan form.

**Status:** Fase 1 (Lead, Chat & AI), Fase 2 (Dashboard, target omzet, Pelanggan, Reports), dan Fase 3 (Pemasaran & integrasi) siap dipasang di VPS — rincian di [GAP-ANALYSIS](docs/GAP-ANALYSIS-v16.md). WhatsApp berjalan dalam **mode simulasi** sampai nomor WABA dipindah dari CRM lama ([cara menyambungkan](docs/DEPLOY.md#7-menyambungkan-whatsapp-cloud-api-saat-migrasi-dari-crm-lama)). Akun Meta/Google/TikTok disambungkan dari menu Pengaturan › Integrasi ([panduan](docs/DEPLOY.md#setelah-live-fase-3-pemasaran--integrasi)).

## Isi repo

```
docs/
  PRD.md                          teks prototype versi awal
  CRM-Sonokembang-AI-Fase2.md     spesifikasi AI Fase 2
  GAP-ANALYSIS-v16.md             daftar fitur per prioritas + status
  DEPLOY.md                       panduan deploy ke VPS
prototype/crm-prototype-v16.html  acuan tampilan
src/server/                       API (Node.js, Fastify, PostgreSQL, Drizzle)
src/web/                          Tampilan (React, Vite)
deploy/Caddyfile                  HTTPS otomatis
docker-compose.yml, Dockerfile    deploy
scripts/backup.sh, restore.sh     backup harian
```

## Arsitektur singkat

- **Satu proses Node.js**: API + worker latar belakang (balasan AI, SLA tiap menit, pengingat tiap 15 menit, laporan terjadwal, sinkron platform, broadcast, jadwal posting, balasan ulasan). Cukup untuk satu VPS dan tim ±200 orang.
- **PostgreSQL**: semua data, plus antrian job (tanpa Redis).
- **WhatsApp**: satu antarmuka (`src/server/src/whatsapp/`) dengan dua mesin: `simulator` dan `meta` (WhatsApp Cloud API). Ganti lewat `WA_MODE`.
- **AI** (`src/server/src/ai/`): adapter Anthropic / Google / OpenAI. API key dipasang lewat menu, disimpan terenkripsi. Ada batas biaya bulanan, penyedia cadangan, dan penyamaran nomor HP/email/alamat sebelum dikirim ke AI.
- **Prinsip "script dulu, AI belakangan"**: skor lead, FAQ, deteksi topik harga, pagar lapis 1, ringkasan serah terima, pengingat, dan SLA semuanya script. AI hanya membalas chat bebas, mengisi data dari kalimat, dan memeriksa ulang balasan (pagar lapis 2).
- **Angka laporan selalu dari script** (`src/server/src/services/analytics.ts`); AI hanya menulis narasi laporan & ringkasan mingguan, dengan narasi cadangan dari script bila AI mati.
- **File laporan** dibuat saat diunduh: PDF (pdfkit) dan PPTX 5 slide (pptxgenjs), jadi hasil edit narasi selalu ikut.
- **Integrasi** (`src/server/src/integrations/`): Meta Graph API, Google (Business Profile, GA4, Search Console), TikTok. Token terenkripsi, diperbarui otomatis bila bisa; sinkron berkala ke tabel metrik harian. Selama belum terhubung, belanja iklan & ulasan bisa diisi manual.
- **Halaman publik**: `/f/<slug>` (form), `/widget.js` (livechat widget untuk website), `/api/public/*`.
- **Real-time**: inbox diperbarui lewat Server-Sent Events.

## Perintah

```bash
npm install
npm run dev          # pengembangan (API :3000, web :5173)
npm test             # test otomatis (unit + integrasi API)
npm run typecheck
npm run build
docker compose up -d --build   # production
```
