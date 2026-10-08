<?php
/**
 * Front controller CodeIgniter 3 — CRM Sonokembang.
 * Folder system/ diambil dari composer (vendor/codeigniter/framework/system).
 */

// --- Muat .env sederhana ---
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
        list($k, $v) = array_map('trim', explode('=', $line, 2));
        $v = trim($v, "\"'");
        putenv("$k=$v");
        $_ENV[$k] = $v;
    }
}

define('ENVIRONMENT', getenv('CI_ENV') ?: 'development');

switch (ENVIRONMENT) {
    case 'development':
        error_reporting(-1);
        ini_set('display_errors', 1);
        break;
    default:
        ini_set('display_errors', 0);
        error_reporting(E_ALL & ~E_NOTICE & ~E_DEPRECATED & ~E_STRICT & ~E_USER_NOTICE & ~E_USER_DEPRECATED);
}

$system_path = __DIR__ . '/vendor/codeigniter/framework/system';
$application_folder = __DIR__ . '/application';
$view_folder = $application_folder . '/views';

if (!is_dir($system_path)) {
    header('HTTP/1.1 503 Service Unavailable.', true, 503);
    exit('Folder system CodeIgniter belum ada. Jalankan: composer install');
}

define('SELF', pathinfo(__FILE__, PATHINFO_BASENAME));
define('BASEPATH', rtrim(str_replace('\', '/', realpath($system_path)), '/') . '/');
define('FCPATH', __DIR__ . DIRECTORY_SEPARATOR);
define('SYSDIR', basename(BASEPATH));
define('APPPATH', rtrim(str_replace('\', '/', realpath($application_folder)), '/') . '/');
define('VIEWPATH', rtrim(str_replace('\', '/', realpath($view_folder)), '/') . '/');

require_once BASEPATH . 'core/CodeIgniter.php';
