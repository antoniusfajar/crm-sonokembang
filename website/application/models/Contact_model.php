<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Contact_model extends CI_Model
{
    /** Cari kontak berdasarkan nomor WA; buat baru bila belum ada. */
    public function upsert_by_phone($phone, $name = NULL)
    {
        $phone = normalize_phone($phone);
        $c = $this->db->get_where('contacts', array('wa_phone' => $phone))->row_array();
        if ($c) {
            if ($name && !$c['name']) $this->db->update('contacts', array('name' => $name), array('id' => $c['id']));
            return (int) $c['id'];
        }
        $this->db->insert('contacts', array('wa_phone' => $phone, 'name' => $name));
        return (int) $this->db->insert_id();
    }

    public function conversation_for($contactId)
    {
        $cv = $this->db->get_where('conversations', array('contact_id' => $contactId, 'channel' => 'whatsapp'))->row_array();
        if ($cv) return (int) $cv['id'];
        $owner = $this->db->select('owner_id')->get_where('contacts', array('id' => $contactId))->row('owner_id');
        $this->db->insert('conversations', array('contact_id' => $contactId, 'assignee_id' => $owner));
        return (int) $this->db->insert_id();
    }
}
