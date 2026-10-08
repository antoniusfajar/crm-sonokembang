<div class="d-flex justify-content-between align-items-center mb-3">
  <h1 class="h4 mb-0">Lead</h1>
  <a href="<?= site_url('leads/create') ?>" class="btn btn-danger btn-sm"><i class="bi bi-plus"></i> Lead baru</a>
</div>
<form class="row g-2 mb-3" method="get">
  <div class="col-md-5"><input name="q" class="form-control form-control-sm" placeholder="Cari nama / nomor WA" value="<?= e($f['q']) ?>"></div>
  <div class="col-md-3"><select name="pipeline_id" class="form-select form-select-sm"><option value="">Semua pipeline</option>
    <?php foreach ($pipelines as $p): ?><option value="<?= $p['id'] ?>" <?= $f['pipeline_id'] == $p['id'] ? 'selected' : '' ?>><?= e($p['name']) ?></option><?php endforeach; ?>
  </select></div>
  <div class="col-md-2"><select name="temperature" class="form-select form-select-sm"><option value="">Semua suhu</option>
    <?php foreach (array('Hot', 'Warm', 'Cold') as $t): ?><option <?= $f['temperature'] === $t ? 'selected' : '' ?>><?= $t ?></option><?php endforeach; ?>
  </select></div>
  <div class="col-md-2"><button class="btn btn-outline-secondary btn-sm w-100">Filter</button></div>
</form>
<div class="card"><div class="table-responsive">
<table class="table table-hover table-sm mb-0 align-middle">
  <thead><tr><th>Kode</th><th>Nama lead</th><th>Kontak</th><th>Tahap</th><th>Suhu</th><th>Acara</th><th>Pax</th><th>Sales</th></tr></thead>
  <tbody>
  <?php foreach ($leads as $l): ?>
    <tr onclick="location='<?= site_url('leads/view/' . $l['id']) ?>'" style="cursor:pointer">
      <td>L-<?= $l['id'] ?></td>
      <td><?= e($l['name']) ?></td>
      <td><?= e($l['contact_name'] ?: $l['wa_phone']) ?></td>
      <td><span class="badge" style="background:<?= e($l['pipeline_color']) ?>"><?= e($l['stage_name']) ?></span></td>
      <td><?= temp_badge($l['temperature']) ?> <small class="text-muted"><?= $l['score'] ?></small></td>
      <td><?= tgl($l['event_date']) ?></td>
      <td><?= e($l['pax']) ?></td>
      <td><?= e($l['owner_name']) ?></td>
    </tr>
  <?php endforeach; if (!$leads): ?><tr><td colspan="8" class="text-muted p-3">Belum ada lead.</td></tr><?php endif; ?>
  </tbody>
</table></div></div>
