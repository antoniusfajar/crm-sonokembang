<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Tasks extends MY_Controller
{
    public function index()
    {
        $show = $this->input->get('show') === 'done' ? 'done' : 'open';
        $this->db->select('t.*, l.name lead_name')->from('tasks t')->join('leads l', 'l.id = t.lead_id', 'left')
            ->where('t.user_id', $this->user['id']);
        $this->db->where($show === 'done' ? 't.done_at IS NOT NULL' : 't.done_at IS NULL', NULL, FALSE);
        $rows = $this->db->order_by('t.due_at', $show === 'done' ? 'DESC' : 'ASC')->limit(200)->get()->result_array();
        $this->render('tasks/index', array('title' => 'Tugas', 'rows' => $rows, 'show' => $show));
    }

    public function store()
    {
        $this->form_validation->set_rules('title', 'Judul', 'required|trim|max_length[200]');
        $this->form_validation->set_rules('due_at', 'Jatuh tempo', 'required');
        if ($this->form_validation->run()) {
            $leadId = (int) $this->input->post('lead_id');
            $this->db->insert('tasks', array(
                'user_id' => $this->user['id'],
                'lead_id' => $leadId ?: NULL,
                'title' => $this->input->post('title'),
                'kind' => $this->input->post('kind') ?: 'Follow-up',
                'due_at' => date('Y-m-d H:i:s', strtotime($this->input->post('due_at'))),
            ));
            $this->session->set_flashdata('success', 'Tugas ditambahkan.');
        } else {
            $this->session->set_flashdata('error', strip_tags(validation_errors()));
        }
        redirect($this->input->post('back') ?: 'tasks');
    }

    public function done($id)
    {
        $this->db->update('tasks', array('done_at' => date('Y-m-d H:i:s')), array('id' => (int) $id, 'user_id' => $this->user['id']));
        redirect('tasks');
    }

    public function notifications()
    {
        $rows = $this->db->where('user_id', $this->user['id'])->order_by('id', 'DESC')->limit(50)->get('notifications')->result_array();
        $this->db->update('notifications', array('read_at' => date('Y-m-d H:i:s')), array('user_id' => $this->user['id'], 'read_at' => NULL));
        $this->render('tasks/notifications', array('title' => 'Notifikasi', 'rows' => $rows));
    }
}
