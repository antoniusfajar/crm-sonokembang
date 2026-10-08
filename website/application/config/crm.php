<?php
defined('BASEPATH') OR exit('No direct script access allowed');

// Penghubung website <-> server VPS (Node.js)
$config['vps_api_key'] = getenv('VPS_API_KEY') ?: '';
$config['vps_url'] = rtrim(getenv('VPS_URL') ?: 'http://127.0.0.1:4000', '/');
