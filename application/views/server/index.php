<h1 class="h4 mb-3">Server VPS</h1>
<div class="card card-body mb-3">
  <?php if ($health['ok']): $h = $health['data']; ?>
    <div class="text-success fw-semibold mb-2"><i class="bi bi-check-circle"></i> Server VPS terhubung</div>
    <div class="small text-muted mb-3">Uptime <?= (int) ($h['uptimeSec'] / 60) ?> menit · WA mode <?= e($h['waMode']) ?> · DB <?= $h['db'] ? 'OK' : 'GAGAL' ?></div>
    <table class="table table-sm"><thead><tr><th>Job</th><th>Jadwal (cron)</th><th>Terakhir</th><th></th></tr></thead><tbody>
      <?php foreach ($h['jobs'] as $j): ?>
        <tr><td><?= e($j['name']) ?><div class="small text-muted"><?= e($j['description']) ?></div></td>
          <td><code><?= e($j['schedule']) ?></code></td>
          <td class="small"><?= $j['lastRun'] ? tgl($j['lastRun'], TRUE) : '-' ?></td>
          <td><a class="btn btn-sm btn-outline-secondary" href="<?= site_url('server/run/' . rawurlencode($j['name'])) ?>">Jalankan</a></td></tr>
      <?php endforeach; ?>
    </tbody></table>
  <?php else: ?>
    <div class="text-danger"><i class="bi bi-x-circle"></i> <?= e($health['error']) ?></div>
    <div class="small text-muted">Periksa VPS_URL & VPS_API_KEY di .env website dan pastikan <code>pm2 status</code> di VPS menunjukkan crm-vps online.</div>
  <?php endif; ?>
</div>
<div class="card"><div class="card-header">Riwayat job</div>
<table class="table table-sm mb-0"><tbody>
  <?php foreach ($runs as $r): ?>
    <tr><td><?= e($r['job']) ?></td><td><?= $r['ok'] ? '<span class="text-success">OK</span>' : '<span class="text-danger">Gagal</span>' ?></td>
      <td class="small text-muted"><?= e($r['info']) ?></td><td class="small text-end"><?= tgl($r['started_at'], TRUE) ?></td></tr>
  <?php endforeach; ?>
</tbody></table></div>
