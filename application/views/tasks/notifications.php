<h1 class="h4 mb-3">Notifikasi</h1>
<div class="card"><ul class="list-group list-group-flush">
  <?php foreach ($rows as $n): ?>
    <li class="list-group-item <?= $n['read_at'] ? '' : 'fw-semibold' ?>">
      <?php if ($n['link']): ?><a href="<?= site_url($n['link']) ?>"><?= e($n['title']) ?></a><?php else: ?><?= e($n['title']) ?><?php endif; ?>
      <div class="small text-muted"><?= e($n['type']) ?> · <?= tgl($n['created_at'], TRUE) ?></div>
    </li>
  <?php endforeach; if (!$rows): ?><li class="list-group-item text-muted">Belum ada notifikasi.</li><?php endif; ?>
</ul></div>
