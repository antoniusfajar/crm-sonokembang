<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($title) ?> · CRM Sonokembang</title>
<link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
<link rel="icon" href="<?= asset('img/favicon.png') ?>" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="<?= asset('img/favicon.png') ?>">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
<link href="<?= asset('css/app.css') ?>" rel="stylesheet">
</head>
<body>
<?php $seg = $this->uri->segment(1) ?: 'dashboard'; ?>
<div class="d-md-flex">
  <nav class="sidebar p-3">
    <a href="<?= site_url('dashboard') ?>" class="sidebar-logo mb-3 text-center">
      <img src="<?= asset('img/bops.png') ?>" alt="Sonokembang Catering">
    </a>
    <?php
    $menu = array('dashboard' => array('speedometer2', 'Dashboard'), 'inbox' => array('chat-dots', 'Inbox'),
        'leads' => array('kanban', 'Lead'), 'customers' => array('people', 'Pelanggan'), 'tasks' => array('check2-square', 'Tugas'));
    if (in_array($user['role'], array('admin', 'spv'), TRUE)) $menu['server'] = array('hdd-network', 'Server VPS');
    foreach ($menu as $k => $m): ?>
      <a href="<?= site_url($k) ?>" class="<?= $seg === $k ? 'active' : '' ?>"><i class="bi bi-<?= $m[0] ?> me-2"></i><?= $m[1] ?></a>
    <?php endforeach; ?>
    <hr class="text-secondary">
    <a href="<?= site_url('tasks/notifications') ?>"><i class="bi bi-bell me-2"></i>Notifikasi
      <?php if ($unread): ?><span class="badge bg-danger"><?= $unread ?></span><?php endif; ?></a>
    <a href="<?= site_url('logout') ?>"><i class="bi bi-box-arrow-right me-2"></i>Keluar</a>
    <div class="small text-secondary mt-3"><?= e($user['name']) ?> · <?= e($user['role']) ?></div>
  </nav>
  <main class="flex-grow-1 p-3 p-md-4">
    <?= flash_html() ?>
