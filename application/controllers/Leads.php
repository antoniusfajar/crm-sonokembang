<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Leads extends MY_Controller
{
    public function __construct()
    {
        parent::__construct();
        $this->load->model(array('Lead_model', 'Contact_model'));
    }

    public function index()
    {
        $f = array(
            'q' => trim((string) $this->input->get('q')),
            'pipeline_id' => $this->input->get('pipeline_id'),
            'temperature' => $this->input->get('temperature'),
        );
        $this->render('leads/index', array(
            'title' => 'Lead',
            'f' => $f,
            'leads' => $this->Lead_model->list_filtered($f, $this->own_scope()),
            'pipelines' => $this->db->order_by('sort_order')->get_where('pipelines', array('active' => 1))->result_array(),
        ));
    }

    public function create() { $this->form(); }

    public function edit($id) { $this->form((int) $id); }

    public function view($id)
    {
        $lead = $this->load_lead($id);
        $this->render('leads/view', array(
            'title' => 'Lead L-' . $lead['id'],
            'lead' => $lead,
            'activities' => $this->db->select('a.*, u.name user_name')->from('activities a')->join('users u', 'u.id = a.user_id', 'left')
                ->where('a.lead_id', $lead['id'])->order_by('a.at', 'DESC')->get()->result_array(),
        ));
    }

    public function note($id)
    {
        $lead = $this->load_lead($id);
        $note = trim((string) $this->input->post('note'));
        if ($note !== '') $this->Lead_model->activity($lead['id'], $this->user['id'], 'note', 'Catatan', $note);
        redirect('leads/view/' . $lead['id']);
    }

    private function form($id = NULL)
    {
        $lead = $id ? $this->load_lead($id) : array();
        $this->form_validation->set_rules('wa_phone', 'Nomor WA', $id ? 'trim' : 'required|trim|min_length[9]');
        $this->form_validation->set_rules('pipeline_id', 'Pipeline', 'required|integer');
        $this->form_validation->set_rules('pax', 'Pax', 'trim|integer');
        $this->form_validation->set_rules('budget', 'Budget', 'trim|integer');

        if ($this->input->method() === 'post' && $this->form_validation->run()) {
            $in = $this->input->post();
            $pipelineId = (int) $in['pipeline_id'];
            $stageId = (int) ($in['stage_id'] ?? 0);
            $stage = $this->db->get_where('stages', array('id' => $stageId, 'pipeline_id' => $pipelineId))->row_array();
            if (!$stage) $stage = $this->Lead_model->first_stage($pipelineId);

            $contactId = $id ? (int) $lead['contact_id'] : $this->Contact_model->upsert_by_phone($in['wa_phone'], $in['contact_name'] ?: NULL);
            $data = array(
                'contact_id' => $contactId,
                'pipeline_id' => $pipelineId,
                'stage_id' => (int) $stage['id'],
                'owner_id' => $in['owner_id'] !== '' ? (int) $in['owner_id'] : $this->user['id'],
                'source_id' => $in['source_id'] !== '' ? (int) $in['source_id'] : NULL,
                'customer_name' => $in['customer_name'] ?: NULL,
                'event_type' => $in['event_type'] ?: NULL,
                'event_date' => $in['event_date'] ?: NULL,
                'location' => $in['location'] ?: NULL,
                'pax' => $in['pax'] !== '' ? (int) $in['pax'] : NULL,
                'budget' => $in['budget'] !== '' ? (int) $in['budget'] : NULL,
                'deal_value' => ($in['deal_value'] ?? '') !== '' ? (int) $in['deal_value'] : NULL,
                'lost_reason' => $in['lost_reason'] ?? NULL,
            );
            $newId = $this->Lead_model->save($data, $id, $this->user['id']);
            $this->session->set_flashdata('success', 'Lead disimpan.');
            redirect('leads/view/' . $newId);
        }

        $this->render('leads/form', array(
            'title' => $id ? 'Ubah lead' : 'Lead baru',
            'lead' => $lead,
            'pipelines' => $this->db->order_by('sort_order')->get('pipelines')->result_array(),
            'stages' => $this->db->order_by('pipeline_id, sort_order')->get('stages')->result_array(),
            'sources' => $this->db->get_where('lead_sources', array('active' => 1))->result_array(),
            'users' => $this->db->select('id, name')->where('status', 'aktif')->get('users')->result_array(),
        ));
    }

    private function load_lead($id)
    {
        $lead = $this->Lead_model->find($id);
        if (!$lead) show_404();
        if (($own = $this->own_scope()) && (int) $lead['owner_id'] !== $own) show_error('Lead ini milik sales lain.', 403);
        return $lead;
    }
}
