<?php $v = function ($k) use ($lead) { return e(set_value($k, $lead[$k] ?? '')); }; ?>
<h1 class="h4 mb-3"><?= e($title) ?></h1>
<?= validation_errors('<div class="alert alert-danger py-2">', '</div>') ?>
<?= form_open('', array('class' => 'card card-body')) ?>
<div class="row g-3">
  <?php if (!$lead): ?>
  <div class="col-md-6"><label class="form-label">Nomor WA *</label><input name="wa_phone" class="form-control" value="<?= $v('wa_phone') ?>" placeholder="08xxxxxxxxxx"></div>
  <div class="col-md-6"><label class="form-label">Nama kontak (profil WA)</label><input name="contact_name" class="form-control" value="<?= $v('contact_name') ?>"></div>
  <?php else: ?>
  <div class="col-12 text-muted">Kontak: <?= e($lead['contact_name']) ?> · <?= e($lead['wa_phone']) ?></div>
  <?php endif; ?>
  <div class="col-md-4"><label class="form-label">Pipeline *</label>
    <select name="pipeline_id" id="pipeline" class="form-select">
      <?php foreach ($pipelines as $p): ?><option value="<?= $p['id'] ?>" <?= $v('pipeline_id') == $p['id'] ? 'selected' : '' ?>><?= e($p['name']) ?></option><?php endforeach; ?>
    </select></div>
  <div class="col-md-4"><label class="form-label">Tahap</label>
    <select name="stage_id" id="stage" class="form-select">
      <?php foreach ($stages as $s): ?><option value="<?= $s['id'] ?>" data-p="<?= $s['pipeline_id'] ?>" <?= $v('stage_id') == $s['id'] ? 'selected' : '' ?>><?= e($s['name']) ?></option><?php endforeach; ?>
    </select></div>
  <div class="col-md-4"><label class="form-label">Sales</label>
    <select name="owner_id" class="form-select"><option value="">(saya)</option>
      <?php foreach ($users as $u): ?><option value="<?= $u['id'] ?>" <?= $v('owner_id') == $u['id'] ? 'selected' : '' ?>><?= e($u['name']) ?></option><?php endforeach; ?>
    </select></div>
  <div class="col-md-4"><label class="form-label">Nama pemesan</label><input name="customer_name" class="form-control" value="<?= $v('customer_name') ?>"></div>
  <div class="col-md-4"><label class="form-label">Jenis acara</label><input name="event_type" class="form-control" value="<?= $v('event_type') ?>" placeholder="Wedding, Syukuran, ..."></div>
  <div class="col-md-4"><label class="form-label">Tanggal acara</label><input type="date" name="event_date" class="form-control" value="<?= $v('event_date') ?>"></div>
  <div class="col-md-4"><label class="form-label">Lokasi</label><input name="location" class="form-control" value="<?= $v('location') ?>"></div>
  <div class="col-md-2"><label class="form-label">Pax</label><input type="number" name="pax" class="form-control" value="<?= $v('pax') ?>"></div>
  <div class="col-md-3"><label class="form-label">Budget (Rp)</label><input type="number" name="budget" class="form-control" value="<?= $v('budget') ?>"></div>
  <div class="col-md-3"><label class="form-label">Sumber</label>
    <select name="source_id" class="form-select"><option value="">-</option>
      <?php foreach ($sources as $s): ?><option value="<?= $s['id'] ?>" <?= $v('source_id') == $s['id'] ? 'selected' : '' ?>><?= e($s['name']) ?></option><?php endforeach; ?>
    </select></div>
  <?php if ($lead): ?>
  <div class="col-md-4"><label class="form-label">Nilai deal (Rp)</label><input type="number" name="deal_value" class="form-control" value="<?= $v('deal_value') ?>"></div>
  <div class="col-md-8"><label class="form-label">Alasan batal</label><input name="lost_reason" class="form-control" value="<?= $v('lost_reason') ?>"></div>
  <?php endif; ?>
</div>
<div class="mt-3"><button class="btn btn-danger">Simpan</button>
  <a href="<?= site_url($lead ? 'leads/view/' . $lead['id'] : 'leads') ?>" class="btn btn-link">Batal</a></div>
<?= form_close() ?>
<script>
// Tampilkan hanya tahap milik pipeline terpilih
const pSel = document.getElementById('pipeline'), sSel = document.getElementById('stage');
function syncStages() {
  let firstVisible = null;
  [...sSel.options].forEach(o => { o.hidden = o.dataset.p !== pSel.value; if (!o.hidden && !firstVisible) firstVisible = o; });
  if (sSel.selectedOptions[0]?.hidden && firstVisible) firstVisible.selected = true;
}
pSel.addEventListener('change', syncStages); syncStages();
</script>
