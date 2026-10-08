<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Customers extends MY_Controller
{
    public function index()
    {
        $q = trim((string) $this->input->get('q'));
        $this->db->select('c.*, u.name owner_name,
                (SELECT COUNT(*) FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.contact_id = c.id AND s.kind = "won") orders,
                (SELECT COALESCE(SUM(l.deal_value),0) FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.contact_id = c.id AND s.kind = "won") total', FALSE)
            ->from('contacts c')->join('users u', 'u.id = c.owner_id', 'left');
        if ($own = $this->own_scope()) $this->db->where('c.owner_id', $own);
        if ($q !== '') $this->db->group_start()->like('c.name', $q)->or_like('c.wa_phone', $q)->or_like('c.company', $q)->group_end();
        $rows = $this->db->order_by('c.last_message_at', 'DESC')->limit(200)->get()->result_array();
        $this->render('customers/index', array('title' => 'Pelanggan', 'rows' => $rows, 'q' => $q));
    }
}
