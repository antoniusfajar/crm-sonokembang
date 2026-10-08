<h1 class="h4 mb-3">Dashboard</h1>
<div class="row g-3 mb-4">
  <?php foreach (array(
      array('Lead aktif', $openLeads, 'kanban'),
      array('Lead baru bulan ini', $newLeads, 'person-plus'),
      array('Closing bulan ini', $won['n'] . ' · ' . rupiah($won['total']), 'trophy'),
      array('Chat menunggu balasan', $waiting, 'hourglass-split'),
  ) as $c): ?>
  <div class="col-6 col-lg-3"><div class="card h-100"><div class="card-body">
    <div class="text-muted small"><i class="bi bi-<?= $c[2] ?>"></i> <?= $c[0] ?></div>
    <div class="fs-4 fw-semibold"><?= e($c[1]) ?></div>
  </div></div></div>
  <?php endforeach; ?>
</div>
<div class="row g-3">
  <div class="col-lg-6"><div class="card"><div class="card-header">Tugas hari ini</div>
    <ul class="list-group list-group-flush">
      <?php foreach ($tasks as $t): ?>
        <li class="list-group-item d-flex justify-content-between">
          <span><?= e($t['title']) ?></span>
          <span class="small <?= strtotime($t['due_at']) < time() ? 'text-danger' : 'text-muted' ?>"><?= tgl($t['due_at'], TRUE) ?></span>
        </li>
      <?php endforeach; if (!$tasks): ?><li class="list-group-item text-muted">Tidak ada tugas.</li><?php endif; ?>
    </ul></div></div>
  <div class="col-lg-6"><div class="card"><div class="card-header">Lead per tahap</div>
    <table class="table table-sm mb-0"><tbody>
      <?php foreach ($byStage as $s): ?>
        <tr><td class="text-muted"><?= e($s['pipeline']) ?></td><td><?= e($s['stage']) ?></td><td class="text-end"><?= (int) $s['n'] ?></td></tr>
      <?php endforeach; ?>
    </tbody></table></div></div>
  <div class="col-12"><div class="card"><div class="card-header">Job server VPS terakhir</div>
    <table class="table table-sm mb-0"><tbody>
      <?php foreach ($lastJobs as $j): ?>
        <tr><td><?= e($j['job']) ?></td><td><?= $j['ok'] ? '<span class="text-success">OK</span>' : '<span class="text-danger">Gagal</span>' ?></td>
          <td class="text-muted small"><?= e($j['info']) ?></td><td class="text-end small"><?= tgl($j['finished_at'], TRUE) ?></td></tr>
      <?php endforeach; if (!$lastJobs): ?><tr><td class="text-muted">Belum ada — pastikan server VPS berjalan.</td></tr><?php endif; ?>
    </tbody></table></div></div>
</div>
