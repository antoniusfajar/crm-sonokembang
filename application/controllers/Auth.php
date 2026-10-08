<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Auth extends CI_Controller
{
    public function login()
    {
        if ($this->session->userdata('user')) redirect('dashboard');
        $error = NULL;
        if ($this->input->method() === 'post') {
            $email = strtolower(trim((string) $this->input->post('email')));
            $pass = (string) $this->input->post('password');
            $u = $this->db->get_where('users', array('email' => $email))->row_array();
            if ($u && $u['status'] !== 'nonaktif' && $this->check($u, $pass)) {
                $this->session->sess_regenerate(TRUE);
                $this->session->set_userdata('user', array(
                    'id' => (int) $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'],
                ));
                $this->db->update('users', array('last_active_at' => date('Y-m-d H:i:s')), array('id' => $u['id']));
                redirect('dashboard');
            }
            $error = 'Email atau password salah.';
        }
        $this->load->view('auth/login', array('error' => $error));
    }

    public function logout()
    {
        $this->session->sess_destroy();
        redirect('login');
    }

    private function check(array $u, $pass)
    {
        $h = $u['password_hash'];
        // Password awal dari schema.sql: langsung diganti hash bcrypt setelah login pertama
        if (strpos($h, 'PLAIN:') === 0) {
            if (!hash_equals(substr($h, 6), $pass)) return FALSE;
            $this->db->update('users', array('password_hash' => password_hash($pass, PASSWORD_BCRYPT)), array('id' => $u['id']));
            return TRUE;
        }
        return password_verify($pass, $h);
    }
}
