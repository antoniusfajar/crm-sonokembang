<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/**
 * Inbox WhatsApp bersama. Pesan masuk ditulis oleh server VPS (webhook WA);
 * pesan keluar dikirim lewat server VPS (Vps_client).
 */
class Inbox extends MY_Controller
{
    public function index($conversationId = NULL)
    {
        $this->db->select('cv.*, c.name contact_name, c.wa_phone, u.name assignee_name')->from('conversations cv')
            ->join('contacts c', 'c.id = cv.contact_id')->join('users u', 'u.id = cv.assignee_id', 'left');
        if ($own = $this->own_scope()) $this->db->where('cv.assignee_id', $own);
        $list = $this->db->order_by('cv.last_message_at', 'DESC')->limit(100)->get()->result_array();

        $active = NULL;
        $messages = array();
        if ($conversationId) {
            $active = $this->load_conv($conversationId);
            $messages = $this->db->select('m.*, u.name user_name')->from('messages m')->join('users u', 'u.id = m.user_id', 'left')
                ->where('m.conversation_id', $active['id'])->order_by('m.id', 'ASC')->limit(300)->get()->result_array();
            $this->db->update('conversations', array('unread_count' => 0), array('id' => $active['id']));
        }
        $this->render('inbox/index', compact('list', 'active', 'messages') + array('title' => 'Inbox'));
    }

    public function send($conversationId)
    {
        $cv = $this->load_conv($conversationId);
        $body = trim((string) $this->input->post('body'));
        if ($body === '') redirect('inbox/index/' . $cv['id']);

        $this->load->library('vps_client');
        $res = $this->vps_client->post('/wa/send', array(
            'conversationId' => (int) $cv['id'],
            'body' => $body,
            'userId' => (int) $this->user['id'],
        ));
        if (!$res['ok']) $this->session->set_flashdata('error', 'Gagal kirim: ' . $res['error']);
        redirect('inbox/index/' . $cv['id']);
    }

    private function load_conv($id)
    {
        $cv = $this->db->select('cv.*, c.name contact_name, c.wa_phone')->from('conversations cv')
            ->join('contacts c', 'c.id = cv.contact_id')->where('cv.id', (int) $id)->get()->row_array();
        if (!$cv) show_404();
        if (($own = $this->own_scope()) && (int) $cv['assignee_id'] !== $own) show_error('Percakapan ini milik sales lain.', 403);
        return $cv;
    }
}
