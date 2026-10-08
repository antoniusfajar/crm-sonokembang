<h1 class="h4 mb-3">Inbox WhatsApp</h1>
<div class="row g-3">
  <div class="col-md-4"><div class="list-group" style="max-height:70vh;overflow-y:auto">
    <?php foreach ($list as $c): ?>
      <a href="<?= site_url('inbox/index/' . $c['id']) ?>" class="list-group-item list-group-item-action <?= $active && $active['id'] == $c['id'] ? 'active' : '' ?>">
        <div class="d-flex justify-content-between">
          <strong><?= e($c['contact_name'] ?: $c['wa_phone']) ?></strong>
          <?php if ($c['unread_count']): ?><span class="badge bg-danger"><?= $c['unread_count'] ?></span><?php endif; ?>
        </div>
        <div class="small text-truncate"><?= e($c['last_message_preview']) ?></div>
        <div class="small opacity-75"><?= tgl($c['last_message_at'], TRUE) ?>
          <?php if ($c['sla_level'] >= 2): ?><span class="badge bg-danger">SLA lewat</span><?php elseif ($c['sla_level'] == 1): ?><span class="badge bg-warning text-dark">Menunggu</span><?php endif; ?></div>
      </a>
    <?php endforeach; if (!$list): ?><div class="text-muted p-3">Belum ada percakapan. Pesan masuk dari WhatsApp akan muncul di sini (lewat server VPS).</div><?php endif; ?>
  </div></div>
  <div class="col-md-8">
    <?php if ($active): ?>
      <div class="card">
        <div class="card-header"><strong><?= e($active['contact_name'] ?: '-') ?></strong> · <?= e($active['wa_phone']) ?></div>
        <div class="chat p-3" id="chat">
          <?php foreach ($messages as $m): ?>
            <div class="bubble <?= e($m['direction']) ?>"><?= e($m['body']) ?>
              <div class="small text-muted text-end"><?= $m['sender_type'] === 'user' ? e($m['user_name']) . ' · ' : '' ?><?= date('H:i', strtotime($m['created_at'])) ?>
                <?= $m['direction'] === 'out' ? e($m['status']) : '' ?></div></div>
          <?php endforeach; ?>
        </div>
        <?= form_open('inbox/send/' . $active['id'], array('class' => 'card-footer d-flex gap-2')) ?>
          <textarea name="body" class="form-control" rows="2" placeholder="Tulis balasan..." required></textarea>
          <button class="btn btn-danger"><i class="bi bi-send"></i></button>
        <?= form_close() ?>
      </div>
      <script>const c = document.getElementById('chat'); c.scrollTop = c.scrollHeight;
        setTimeout(() => location.reload(), 20000); // segarkan tiap 20 detik</script>
    <?php else: ?>
      <div class="text-muted">Pilih percakapan.</div>
    <?php endif; ?>
  </div>
</div>
