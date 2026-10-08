<div class="d-flex justify-content-between align-items-center mb-3">
  <h1 class="h4 mb-0">Tugas</h1>
  <div class="btn-group btn-group-sm">
    <a href="?show=open" class="btn btn-outline-secondary <?= $show === 'open' ? 'active' : '' ?>">Belum selesai</a>
    <a href="?show=done" class="btn btn-outline-secondary <?= $show === 'done' ? 'active' : '' ?>">Selesai</a>
  </div>
</div>
<?= form_open('tasks/store', array('class' => 'card card-body mb-3 d-flex flex-md-row gap-2')) ?>
  <input name="title" class="form-control form-control-sm" placeholder="Tugas baru" required>
  <input type="datetime-local" name="due_at" class="form-control form-control-sm" style="max-width:220px" required>
  <button class="btn btn-sm btn-danger">Tambah</button>
<?= form_close() ?>
<div class="card"><ul class="list-group list-group-flush">
  <?php foreach ($rows as $t): ?>
    <li class="list-group-item d-flex justify-content-between align-items-center">
      <div><?= e($t['title']) ?> <?= $t['auto'] ? '<span class="badge bg-secondary">otomatis</span>' : '' ?>
        <?php if ($t['lead_id']): ?><a class="small" href="<?= site_url('leads/view/' . $t['lead_id']) ?>"><?= e($t['lead_name']) ?></a><?php endif; ?>
        <div class="small <?= !$t['done_at'] && strtotime($t['due_at']) < time() ? 'text-danger' : 'text-muted' ?>"><?= e($t['kind']) ?> · <?= tgl($t['due_at'], TRUE) ?></div></div>
      <?php if (!$t['done_at']): ?><a href="<?= site_url('tasks/done/' . $t['id']) ?>" class="btn btn-sm btn-outline-success"><i class="bi bi-check"></i></a><?php endif; ?>
    </li>
  <?php endforeach; if (!$rows): ?><li class="list-group-item text-muted">Kosong.</li><?php endif; ?>
</ul></div>
