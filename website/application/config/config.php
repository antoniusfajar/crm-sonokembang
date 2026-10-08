<?php
defined('BASEPATH') OR exit('No direct script access allowed');

$config['base_url'] = getenv('BASE_URL') ?: 'http://localhost/crm/';
$config['index_page'] = '';
$config['uri_protocol'] = 'REQUEST_URI';
$config['url_suffix'] = '';
$config['language'] = 'english';
$config['charset'] = 'UTF-8';
$config['enable_hooks'] = TRUE;
$config['subclass_prefix'] = 'MY_';
$config['composer_autoload'] = FCPATH . 'vendor/autoload.php';
$config['permitted_uri_chars'] = 'a-z 0-9~%.:_\-';
$config['enable_query_strings'] = FALSE;
$config['controller_trigger'] = 'c';
$config['function_trigger'] = 'm';
$config['directory_trigger'] = 'd';
$config['allow_get_array'] = TRUE;
$config['log_threshold'] = 1;
$config['log_path'] = '';
$config['log_file_extension'] = '';
$config['log_file_permissions'] = 0644;
$config['log_date_format'] = 'Y-m-d H:i:s';
$config['error_views_path'] = '';
$config['cache_path'] = '';
$config['cache_query_string'] = FALSE;
$config['encryption_key'] = getenv('ENCRYPTION_KEY') ?: '';

$config['sess_driver'] = 'database';
$config['sess_cookie_name'] = 'crm_session';
$config['sess_expiration'] = 60 * 60 * 12;
$config['sess_save_path'] = 'ci_sessions';
$config['sess_match_ip'] = FALSE;
$config['sess_time_to_update'] = 300;
$config['sess_regenerate_destroy'] = FALSE;

$config['cookie_prefix'] = '';
$config['cookie_domain'] = '';
$config['cookie_path'] = '/';
$config['cookie_secure'] = strpos($config['base_url'], 'https://') === 0;
$config['cookie_httponly'] = TRUE;

$config['standardize_newlines'] = FALSE;
$config['global_xss_filtering'] = FALSE;

// CSRF aktif untuk form web; endpoint /api (dipanggil VPS) dikecualikan & diamankan API key
$config['csrf_protection'] = TRUE;
$config['csrf_token_name'] = 'csrf_token';
$config['csrf_cookie_name'] = 'csrf_cookie';
$config['csrf_expire'] = 7200;
$config['csrf_regenerate'] = FALSE;
$config['csrf_exclude_uris'] = array('api/.*');

$config['compress_output'] = FALSE;
$config['time_reference'] = 'local';
$config['rewrite_short_tags'] = FALSE;
$config['proxy_ips'] = '';

date_default_timezone_set('Asia/Jakarta');
