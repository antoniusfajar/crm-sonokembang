<h1 class="h4 mb-3">Pelanggan</h1>
<form class="mb-3" method="get"><input name="q" class="form-control form-control-sm" style="max-width:360px" placeholder="Cari nama / nomor / perusahaan" value="<?= e($q) ?>"></form>
<div class="card"><div class="table-responsive">
<table class="table table-sm mb-0 align-middle">
  <thead><tr><th>Nama</th><th>Nomor WA</th><th>Tipe</th><th>Perusahaan</th><th class="text-end">Order</th><th class="text-end">Total omzet</th><th>Sales</th><th>Chat terakhir</th></tr></thead>
  <tbody>
  <?php foreach ($rows as $r): ?>
    <tr><td><?= e($r['name'] ?: '-') ?></td><td><?= e($r['wa_phone']) ?></td><td><?= e($r['contact_type']) ?></td><td><?= e($r['company']) ?></td>
      <td class="text-end"><?= (int) $r['orders'] ?><?= $r['orders'] > 1 ? ' <span class="badge bg-success">repeat</span>' : '' ?></td>
      <td class="text-end"><?= rupiah($r['total']) ?></td><td><?= e($r['owner_name']) ?></td><td><?= tgl($r['last_message_at'], TRUE) ?></td></tr>
  <?php endforeach; if (!$rows): ?><tr><td colspan="8" class="text-muted p-3">Belum ada kontak.</td></tr><?php endif; ?>
  </tbody>
</table></div></div>
