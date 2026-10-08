<?php
defined('BASEPATH') OR exit('No direct script access allowed');

function e($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }

function rupiah($n) { return $n === null || $n === '' ? '-' : 'Rp ' . number_format((float) $n, 0, ',', '.'); }

function tgl($d, $withTime = FALSE)
{
    if (!$d) return '-';
    return date($withTime ? 'd M Y H:i' : 'd M Y', strtotime($d));
}

/** Normalisasi nomor HP ke format 62xxxxxxxx (digit saja). */
function normalize_phone($p)
{
    $d = preg_replace('/\D+/', '', (string) $p);
    if (strpos($d, '0') === 0) $d = '62' . substr($d, 1);
    elseif (strpos($d, '8') === 0) $d = '62' . $d;
    return $d;
}

function current_user()
{
    $CI =& get_instance();
    return $CI->session->userdata('user');
}

function flash_html()
{
    $CI =& get_instance();
    $out = '';
    foreach (array('success' => 'success', 'error' => 'danger') as $k => $cls) {
        if ($m = $CI->session->flashdata($k)) {
            $out .= '<div class="alert alert-' . $cls . ' py-2">' . e($m) . '</div>';
        }
    }
    return $out;
}

function temp_badge($t)
{
    $map = array('Hot' => 'danger', 'Warm' => 'warning', 'Cold' => 'secondary');
    return '<span class="badge bg-' . ($map[$t] ?? 'secondary') . '">' . e($t) . '</span>';
}

/**
 * URL file di folder assets/ + ?v=<waktu file diubah>.
 * Setiap kali file berubah, URL ikut berubah sehingga browser tidak memakai cache lama.
 */
function asset($path)
{
    $path = ltrim($path, '/');
    $file = FCPATH . 'assets/' . $path;
    $v = is_file($file) ? filemtime($file) : time();
    return base_url('assets/' . $path) . '?v=' . $v;
}
