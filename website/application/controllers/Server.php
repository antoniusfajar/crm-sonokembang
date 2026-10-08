<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Menu "Server": status server VPS, riwayat cron, dan tombol jalankan job manual (admin/spv). */
class Server extends MY_Controller
{
    public function __construct()
    {
        parent::__construct();
        $this->require_role(array('admin', 'spv'));
        $this->load->library('vps_client');
    }

    public function index()
    {
        $this->render('server/index', array(
            'title' => 'Server VPS',
            'health' => $this->vps_client->get('/health'),
            'runs' => $this->db->order_by('id', 'DESC')->limit(50)->get('job_runs')->result_array(),
        ));
    }

    public function run($job)
    {
        $res = $this->vps_client->post('/jobs/' . rawurlencode($job) . '/run');
        $this->session->set_flashdata($res['ok'] ? 'success' : 'error', $res['ok'] ? "Job $job dijalankan." : $res['error']);
        redirect('server');
    }
}
