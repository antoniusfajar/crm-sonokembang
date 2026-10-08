<?php
defined('BASEPATH') OR exit('No direct script access allowed');

// MySQL hosting biasanya UTC; samakan zona waktu sesi DB dengan PHP & server VPS
$hook['post_controller_constructor'][] = function () {
    $CI =& get_instance();
    if (isset($CI->db)) $CI->db->query("SET time_zone = '+07:00'");
};
