<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/**
 * Endpoint yang dipanggil server VPS (header X-API-Key wajib).
 * Server VPS juga bisa langsung baca/tulis MySQL; endpoint ini untuk logika
 * yang hidup di PHP (mis. pembuatan lead otomatis dengan skor & nama).
 */
class Api extends Api_Controller
{
    public function ping()
    {
        $this->json(array('ok' => TRUE, 'app' => 'crm-website', 'time' => date('c')));
    }

    /** Pesan WA pertama dari kontak baru -> buat lead otomatis. Body: {contactId, sourceRef?} */
    public function auto_lead()
    {
        $b = $this->body();
        $contactId = (int) ($b['contactId'] ?? 0);
        $contact = $this->db->get_where('contacts', array('id' => $contactId))->row_array();
        if (!$contact) return $this->json(array('error' => 'kontak tidak ditemukan'), 404);

        $exists = $this->db->from('leads l')->join('stages s', 's.id = l.stage_id')
            ->where('l.contact_id', $contactId)->where('s.kind', 'open')->count_all_results();
        if ($exists) return $this->json(array('ok' => TRUE, 'created' => FALSE));

        $this->load->model('Lead_model');
        $pipeline = $this->db->order_by('sort_order')->limit(1)->get_where('pipelines', array('active' => 1))->row_array();
        $stage = $this->Lead_model->first_stage($pipeline['id']);
        $sourceId = NULL;
        if (!empty($b['sourceRef'])) {
            $sourceId = $this->db->select('id')->get_where('lead_sources', array('ref_code' => $b['sourceRef']))->row('id');
        }
        $id = $this->Lead_model->save(array(
            'contact_id' => $contactId,
            'pipeline_id' => $pipeline['id'],
            'stage_id' => $stage['id'],
            'owner_id' => $contact['owner_id'],
            'source_id' => $sourceId,
        ));
        $this->json(array('ok' => TRUE, 'created' => TRUE, 'leadId' => (int) $id));
    }
}
