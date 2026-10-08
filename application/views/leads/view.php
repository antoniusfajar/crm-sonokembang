<div class="d-flex justify-content-between align-items-center mb-3">
  <h1 class="h4 mb-0">L-<?= $lead['id'] ?> · <?= e($lead['name']) ?></h1>
  <a href="<?= site_url('leads/edit/' . $lead['id']) ?>" class="btn btn-outline-secondary btn-sm"><i class="bi bi-pencil"></i> Ubah</a>
</div>
<div class="row g-3">
  <div class="col-lg-5"><div class="card card-body">
    <dl class="row mb-0 small">
      <?php foreach (array(
          'Kontak' => $lead['contact_name'] . ' · ' . $lead['wa_phone'],
          'Pemesan' => $lead['customer_name'],
          'Pipeline / tahap' => $lead['pipeline_name'] . ' › ' . $lead['stage_name'],
          'Acara' => $lead['event_type'],
          'Tanggal' => tgl($lead['event_date']),
          'Lokasi' => $lead['location'],
          'Pax' => $lead['pax'],
          'Budget' => rupiah($lead['budget']),
          'Nilai deal' => rupiah($lead['deal_value']),
          'Sales' => $lead['owner_name'],
      ) as $k => $val): ?>
        <dt class="col-5 text-muted fw-normal"><?= $k ?></dt><dd class="col-7"><?= e($val ?: '-') ?></dd>
      <?php endforeach; ?>
      <dt class="col-5 text-muted fw-normal">Skor</dt><dd class="col-7"><?= temp_badge($lead['temperature']) ?> <?= $lead['score'] ?></dd>
    </dl>
  </div>
  <div class="card card-body mt-3">
    <h2 class="h6">Tambah tugas follow-up</h2>
    <?= form_open('tasks/store') ?>
      <input type="hidden" name="lead_id" value="<?= $lead['id'] ?>">
      <input type="hidden" name="back" value="leads/view/<?= $lead['id'] ?>">
      <input name="title" class="form-control form-control-sm mb-2" placeholder="Telepon ulang, kirim proposal, ..." required>
      <div class="d-flex gap-2"><input type="datetime-local" name="due_at" class="form-control form-control-sm" required>
        <button class="btn btn-sm btn-danger">Tambah</button></div>
    <?= form_close() ?>
  </div></div>
  <div class="col-lg-7"><div class="card card-body">
    <h2 class="h6">Aktivitas</h2>
    <?= form_open('leads/note/' . $lead['id'], array('class' => 'd-flex gap-2 mb-3')) ?>
      <input name="note" class="form-control form-control-sm" placeholder="Tulis catatan..."><button class="btn btn-sm btn-outline-secondary">Simpan</button>
    <?= form_close() ?>
    <ul class="list-unstyled small mb-0">
      <?php foreach ($activities as $a): ?>
        <li class="border-bottom py-2"><strong><?= e($a['title']) ?></strong>
          <span class="text-muted">· <?= e($a['user_name'] ?: 'Sistem') ?> · <?= tgl($a['at'], TRUE) ?></span>
          <?php if ($a['note']): ?><div><?= nl2br(e($a['note'])) ?></div><?php endif; ?></li>
      <?php endforeach; ?>
    </ul>
  </div></div>
</div>
