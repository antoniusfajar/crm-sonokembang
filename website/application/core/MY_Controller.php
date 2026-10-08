<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Controller halaman yang wajib login. */
class MY_Controller extends CI_Controller
{
    protected $user;

    public function __construct()
    {
        parent::__construct();
        $this->user = $this->session->userdata('user');
        if (!$this->user) {
            redirect('login');
        }
    }

    protected function require_role(array $roles)
    {
        if (!in_array($this->user['role'], $roles, TRUE)) {
            show_error('Anda tidak punya akses ke halaman ini.', 403);
        }
    }

    /** Sales hanya melihat data miliknya; spv/admin/marketing melihat semua. */
    protected function own_scope()
    {
        return $this->user['role'] === 'sales' ? (int) $this->user['id'] : NULL;
    }

    protected function render($view, array $data = array())
    {
        $data['user'] = $this->user;
        $data['title'] = $data['title'] ?? 'CRM';
        $data['unread'] = $this->db->where('user_id', $this->user['id'])->where('read_at IS NULL', NULL, FALSE)
            ->count_all_results('notifications');
        $this->load->view('layout/header', $data);
        $this->load->view($view, $data);
        $this->load->view('layout/footer', $data);
    }
}

/** Controller JSON untuk server VPS; diamankan header X-API-Key. */
class Api_Controller extends CI_Controller
{
    public function __construct()
    {
        parent::__construct();
        $key = (string) $this->config->item('vps_api_key');
        $given = (string) $this->input->get_request_header('X-API-Key', TRUE);
        if ($key === '' || !hash_equals($key, $given)) {
            $this->json(array('error' => 'unauthorized'), 401);
            $this->output->_display();
            exit;
        }
    }

    protected function body()
    {
        $b = json_decode($this->input->raw_input_stream, TRUE);
        return is_array($b) ? $b : array();
    }

    protected function json($data, $status = 200)
    {
        $this->output->set_status_header($status)->set_content_type('application/json')
            ->set_output(json_encode($data));
    }
}
