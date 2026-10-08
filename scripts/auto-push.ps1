<#
  Sinkron otomatis dua arah dengan GitHub (untuk kerja berdua):
   - tarik perubahan orang lain (pull --rebase)
   - commit + push perubahan sendiri
  Jalankan dari folder project:   powershell -ExecutionPolicy Bypass -File scripts\auto-push.ps1
  Hentikan dengan Ctrl+C.   Opsi: -Interval 60 (detik, default 30)
#>
param(
  [int]$Interval = 30,
  [string]$Branch = ''
)

Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not $Branch) { $Branch = (git rev-parse --abbrev-ref HEAD).Trim() }
$who = (git config user.name)
Write-Host "Sinkron aktif ($who) <-> origin/$Branch tiap $Interval detik. Ctrl+C untuk berhenti." -ForegroundColor Green

function Stamp { Get-Date -Format HH:mm:ss }

while ($true) {
  # 1. Commit perubahan sendiri dulu supaya rebase aman
  if (git status --porcelain) {
    $files = (git status --porcelain | Measure-Object).Count
    git add -A
    git commit -q -m "auto($who): $files file $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  }

  # 2. Tarik perubahan orang lain
  git fetch -q origin $Branch
  $behind = [int](git rev-list --count "HEAD..origin/$Branch")
  if ($behind -gt 0) {
    git pull -q --rebase origin $Branch
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[$(Stamp)] KONFLIK dengan perubahan orang lain - sinkron dihentikan." -ForegroundColor Red
      Write-Host "Minta Claude: 'selesaikan konflik git', atau batalkan dengan: git rebase --abort" -ForegroundColor Yellow
      break
    }
    Write-Host "[$(Stamp)] ditarik $behind commit dari GitHub" -ForegroundColor Cyan
  }

  # 3. Kirim commit sendiri
  $ahead = [int](git rev-list --count "origin/$Branch..HEAD")
  if ($ahead -gt 0) {
    git push -q origin $Branch
    if ($LASTEXITCODE -eq 0) { Write-Host "[$(Stamp)] dikirim $ahead commit" -ForegroundColor Cyan }
    else { Write-Host "[$(Stamp)] push GAGAL - dicoba lagi berikutnya" -ForegroundColor Red }
  }

  Start-Sleep -Seconds $Interval
}
