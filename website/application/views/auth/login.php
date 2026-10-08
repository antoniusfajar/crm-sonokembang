<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Masuk · CRM Sonokembang</title>
<link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
<link rel="icon" href="<?= asset('img/favicon.png') ?>" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="<?= asset('img/favicon.png') ?>">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="<?= asset('css/app.css') ?>" rel="stylesheet">
</head>
<body class="bg-light d-flex align-items-center" style="min-height:100vh">
<div class="container" style="max-width:380px">
  <div class="card shadow-sm">
    <div class="card-body p-4">
      <img src="<?= asset('img/bops.png') ?>" alt="Sonokembang Catering" class="d-block mx-auto mb-3" style="max-width:220px;width:100%">
      <h1 class="h6 text-center text-muted mb-3">Masuk ke CRM</h1>
      <?php if ($error): ?><div class="alert alert-danger py-2"><?= e($error) ?></div><?php endif; ?>
      <?= form_open('login') ?>
        <div class="mb-3"><label class="form-label">Email</label>
          <input type="email" name="email" class="form-control" required autofocus value="<?= e($this->input->post('email')) ?>"></div>
        <div class="mb-3"><label class="form-label">Password</label>
          <input type="password" name="password" class="form-control" required></div>
        <button class="btn btn-danger w-100">Masuk</button>
      <?= form_close() ?>
    </div>
  </div>
</div>
</body>
</html>
