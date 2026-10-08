<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($title) ?> · CRM Sonokembang</title>
<link rel="icon" href="<?= base_url('assets/img/bops.png') ?>" type="image/png">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
<style>
  :root { --brand: #db6262; }
  body { background: #f6f7f9; }
  .sidebar { width: 220px; min-height: 100vh; background: #1f2937; }
  .sidebar a { color: #cbd5e1; text-decoration: none; display: block; padding: .55rem 1rem; border-radius: .4rem; }
  .sidebar a.active, .sidebar a:hover { background: var(--brand); color: #fff; }
  .chat { height: 60vh; overflow-y: auto; background: #efeae2; }
  .bubble { max-width: 70%; padding: .5rem .75rem; border-radius: .6rem; margin: .25rem 0; white-space: pre-wrap; }
  .bubble.in { background: #fff; }
  .bubble.out { background: #d9fdd3; margin-left: auto; }
  .bubble.system { background: #fff3cd; margin: .25rem auto; font-size: .85rem; }
  @media (max-width: 768px) { .sidebar { width: 100%; min-height: auto; } }
</style>
</head>
<body>
<?php $seg = $this->uri->segment(1) ?: 'dashboard'; ?>
<div class="d-md-flex">
  <nav class="sidebar p-3">
    <a href="<?= site_url('dashboard') ?>" class="bg-white rounded mb-3 p-2 text-center">
      <img src="<?= base_url('assets/img/bops.png') ?>" alt="Sonokembang Catering" style="max-width:100%;height:56px;object-fit:contain">
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
