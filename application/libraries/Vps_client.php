<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/**
 * Website -> server VPS (Node.js). Dipakai untuk kirim WhatsApp,
 * menjalankan job manual, dan cek status server.
 */
class Vps_client
{
    protected $url;
    protected $key;

    public function __construct()
    {
        $CI =& get_instance();
        $this->url = $CI->config->item('vps_url');
        $this->key = $CI->config->item('vps_api_key');
    }

    public function get($path) { return $this->request('GET', $path); }

    public function post($path, array $body = array()) { return $this->request('POST', $path, $body); }

    /** @return array ['ok'=>bool, 'status'=>int, 'data'=>mixed, 'error'=>string|null] */
    protected function request($method, $path, $body = NULL)
    {
        $ch = curl_init($this->url . $path);
        $headers = array('X-API-Key: ' . $this->key, 'Accept: application/json');
        if ($body !== NULL) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        curl_setopt_array($ch, array(
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => TRUE,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 20,
        ));
        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw === FALSE) {
            return array('ok' => FALSE, 'status' => 0, 'data' => NULL, 'error' => 'Server VPS tidak terjangkau: ' . $err);
        }
        $data = json_decode($raw, TRUE);
        $ok = $status >= 200 && $status < 300;
        return array('ok' => $ok, 'status' => $status, 'data' => $data, 'error' => $ok ? NULL : ($data['error'] ?? "HTTP $status"));
    }
}
