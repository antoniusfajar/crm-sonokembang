# CRM Sonokembang — aturan untuk Claude

Repo ini diedit oleh lebih dari satu orang, masing-masing lewat Claude Code di komputernya sendiri.
Setiap push ke `main` langsung live (GitHub Action → hosting & VPS dalam ±1 menit).

## Wajib setiap sesi

1. **Sebelum mengubah file apa pun**: `git pull --rebase origin main`. Jika ada perubahan lokal yang belum di-commit, commit dulu, lalu pull.
2. **Setelah satu perubahan selesai dan dicek**: commit dengan pesan jelas (bahasa Indonesia), `git pull --rebase origin main`, lalu `git push origin main`.
3. Jangan push kode yang belum selesai/rusak — langsung tayang ke pengguna.
4. **Konflik rebase**: baca kedua versi, gabungkan maksud keduanya (jangan buang perubahan orang lain), lalu `git rebase --continue`. Jika ragu, `git rebase --abort` dan tanya pengguna.
5. Jangan `git push --force` ke `main`. Jangan ubah riwayat yang sudah di-push.
6. Setelah push, cek deploy: `gh run list --workflow split-branches.yml --limit 1` — `split`, `deploy-website`, `deploy-vps` harus success.

## Struktur

- `website/` — CodeIgniter 3 + MySQL (Premium Web Hosting, https://crm.sonokembangmalang.tech). Branch hasil: `website`.
- `vps-server/` — Node.js cron/webhook (VPS 187.77.116.15, folder `/opt/SK-Crm`, PM2 `crm-vps`, https://api.sonokembangmalang.tech). Branch hasil: `server-vps`.
- `legacy/` — kode lama (Node/React/Postgres), hanya acuan. Jangan diedit.
- Branch `website` dan `server-vps` dibuat otomatis — **jangan diedit langsung**.

## Konvensi

- PHP harus jalan di PHP 8.0 (versi di hosting). Tidak ada PHP di laptop — tulis hati-hati; backslash di string PHP sering rusak bila file dibuat lewat heredoc shell, pakai tool Write/Edit.
- CSS di `website/assets/css/app.css`. File di `assets/` dipanggil lewat `asset('...')` (ada versi otomatis, tidak perlu clear cache).
- Perubahan database: tambah file SQL baru di `website/database/` (mis. `002_xxx.sql`) dan beri tahu pengguna untuk menjalankannya di phpMyAdmin. Jangan ubah `schema.sql` yang sudah diimpor.
- Rahasia (`.env`, password, API key) tidak pernah masuk git.
- Jangan edit file langsung di hosting/VPS — deploy otomatis akan gagal.
