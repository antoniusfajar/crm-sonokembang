<#
  Auto commit + push ke GitHub setiap ada file yang berubah.
  Jalankan dari folder project:   powershell -ExecutionPolicy Bypass -File scripts\auto-push.ps1
  Hentikan dengan Ctrl+C.
  Opsi: -Interval 60   (cek tiap 60 detik, default 30)
        -Branch main   (branch tujuan, default branch aktif)
#>
param(
  [int]$Interval = 30,
  [string]$Branch = ''
)

Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not $Branch) { $Branch = (git rev-parse --abbrev-ref HEAD).Trim() }
Write-Host "Auto-push aktif -> origin/$Branch (cek tiap $Interval detik). Ctrl+C untuk berhenti." -ForegroundColor Green

while ($true) {
  $changes = git status --porcelain
  if ($changes) {
    $files = ($changes | Measure-Object).Count
    $msg = "auto: $files file berubah $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    git add -A
    git commit -m $msg | Out-Null
    git pull --rebase origin $Branch 2>$null | Out-Null
    git push origin $Branch
    if ($LASTEXITCODE -eq 0) { Write-Host "[$(Get-Date -Format HH:mm:ss)] pushed: $msg" -ForegroundColor Cyan }
    else { Write-Host "[$(Get-Date -Format HH:mm:ss)] push GAGAL - cek koneksi / konflik" -ForegroundColor Red }
  }
  Start-Sleep -Seconds $Interval
}
