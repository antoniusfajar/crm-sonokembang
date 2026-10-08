<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Lead_model extends CI_Model
{
    public function base()
    {
        return $this->db->select('l.*, c.name AS contact_name, c.wa_phone, s.name AS stage_name, s.kind AS stage_kind,
                p.name AS pipeline_name, p.color AS pipeline_color, u.name AS owner_name')
            ->from('leads l')
            ->join('contacts c', 'c.id = l.contact_id')
            ->join('stages s', 's.id = l.stage_id')
            ->join('pipelines p', 'p.id = l.pipeline_id')
            ->join('users u', 'u.id = l.owner_id', 'left');
    }

    public function list_filtered(array $f, $ownerId = NULL)
    {
        $this->base();
        if ($ownerId) $this->db->where('l.owner_id', $ownerId);
        if (!empty($f['pipeline_id'])) $this->db->where('l.pipeline_id', (int) $f['pipeline_id']);
        if (!empty($f['temperature'])) $this->db->where('l.temperature', $f['temperature']);
        if (!empty($f['q'])) {
            $this->db->group_start()->like('l.name', $f['q'])->or_like('c.name', $f['q'])
                ->or_like('c.wa_phone', $f['q'])->or_like('l.customer_name', $f['q'])->group_end();
        }
        return $this->db->order_by('l.last_activity_at', 'DESC')->limit(200)->get()->result_array();
    }

    public function find($id)
    {
        return $this->base()->where('l.id', (int) $id)->get()->row_array();
    }

    public function first_stage($pipelineId)
    {
        return $this->db->where('pipeline_id', $pipelineId)->order_by('sort_order')->limit(1)->get('stages')->row_array();
    }

    /** Nama lead otomatis: [pipeline]_[nama depan]_[tgl acara]_[lokasi] */
    public function build_name(array $lead, $pipelineName, $contactName)
    {
        $first = strtok(trim(($lead['customer_name'] ?? '') ?: ($contactName ?: 'Tanpa nama')), ' ');
        $parts = array($pipelineName, $first);
        if (!empty($lead['event_date'])) $parts[] = date('dMy', strtotime($lead['event_date']));
        if (!empty($lead['location'])) $parts[] = $lead['location'];
        return implode('_', $parts);
    }

    /** Skor lead dari kelengkapan data (script, bukan AI). */
    public function score(array $l)
    {
        $s = 0;
        if (!empty($l['event_date'])) $s += 20;
        if (!empty($l['pax'])) $s += $l['pax'] >= 300 ? 25 : 15;
        if (!empty($l['budget'])) $s += 20;
        if (!empty($l['location'])) $s += 10;
        if (!empty($l['event_type'])) $s += 10;
        return array($s, $s >= 60 ? 'Hot' : ($s >= 30 ? 'Warm' : 'Cold'));
    }

    public function save(array $data, $id = NULL, $userId = NULL)
    {
        $p = $this->db->get_where('pipelines', array('id' => $data['pipeline_id']))->row_array();
        $c = $this->db->get_where('contacts', array('id' => $data['contact_id']))->row_array();
        $data['name'] = $this->build_name($data, $p['name'], $c['name']);
        list($data['score'], $data['temperature']) = $this->score($data);
        $data['last_activity_at'] = date('Y-m-d H:i:s');

        if ($id) {
            $old = $this->db->get_where('leads', array('id' => $id))->row_array();
            if ((int) $old['stage_id'] !== (int) $data['stage_id']) {
                $st = $this->db->get_where('stages', array('id' => $data['stage_id']))->row_array();
                $data['stage_changed_at'] = date('Y-m-d H:i:s');
                $data['closed_at'] = $st['kind'] === 'open' ? NULL : date('Y-m-d H:i:s');
                $this->activity($id, $userId, 'stage_change', 'Pindah tahap ke ' . $st['name']);
            }
            $this->db->update('leads', $data, array('id' => $id));
            return $id;
        }
        $this->db->insert('leads', $data);
        $id = $this->db->insert_id();
        $this->activity($id, $userId, 'lead_created', 'Lead dibuat');
        return $id;
    }

    public function activity($leadId, $userId, $type, $title, $note = NULL)
    {
        $this->db->insert('activities', array(
            'lead_id' => $leadId, 'user_id' => $userId, 'type' => $type, 'title' => $title, 'note' => $note,
        ));
    }
}
