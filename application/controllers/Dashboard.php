<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Dashboard extends MY_Controller
{
    public function index()
    {
        $own = $this->own_scope();
        $scope = function ($col) use ($own) {
            if ($own) $this->db->where($col, $own);
        };
        $monthStart = date('Y-m-01');

        $scope('l.owner_id');
        $openLeads = $this->db->from('leads l')->join('stages s', 's.id = l.stage_id')->where('s.kind', 'open')->count_all_results();

        $scope('l.owner_id');
        $won = $this->db->select('COUNT(*) n, COALESCE(SUM(l.deal_value),0) total', FALSE)->from('leads l')
            ->join('stages s', 's.id = l.stage_id')->where('s.kind', 'won')->where('l.closed_at >=', $monthStart)
            ->get()->row_array();

        $scope('l.owner_id');
        $newLeads = $this->db->from('leads l')->where('l.created_at >=', $monthStart)->count_all_results();

        $scope('cv.assignee_id');
        $waiting = $this->db->from('conversations cv')->where('cv.awaiting_reply_since IS NOT NULL', NULL, FALSE)->count_all_results();

        $tasks = $this->db->where('user_id', $this->user['id'])->where('done_at IS NULL', NULL, FALSE)
            ->where('due_at <=', date('Y-m-d 23:59:59'))->order_by('due_at')->limit(10)->get('tasks')->result_array();

        $scope('l.owner_id');
        $byStage = $this->db->select('p.name pipeline, s.name stage, COUNT(l.id) n', FALSE)->from('stages s')
            ->join('pipelines p', 'p.id = s.pipeline_id')->join('leads l', 'l.stage_id = s.id', 'left')
            ->group_by('s.id')->order_by('p.sort_order, s.sort_order')->get()->result_array();

        $lastJobs = $this->db->order_by('id', 'DESC')->limit(5)->get('job_runs')->result_array();

        $this->render('dashboard/index', compact('openLeads', 'won', 'newLeads', 'waiting', 'tasks', 'byStage', 'lastJobs') + array('title' => 'Dashboard'));
    }
}
