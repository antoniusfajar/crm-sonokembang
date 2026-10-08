import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Loading, useToast } from '../components/ui';
import { TaskModal } from './LeadDetail';
import { date, time } from '../format';

const KIND_PILL: Record<string, string> = { 'Follow-up': 'olive', Proposal: 'warm', 'Test food': 'hot', Review: 'cold', 'Tagih DP': 'hot' };

export function TasksPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [range, setRange] = useState<'today' | 'overdue' | 'tomorrow' | 'week' | 'done'>('today');
  const [userId, setUserId] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const { data: users } = useQuery<any[]>({ queryKey: ['users-options'], queryFn: () => api.get('/api/users/options'), enabled: me.user.scope === 'all' });
  const { data: rules } = useQuery<any[]>({ queryKey: ['setting', 'reminder_rules'], queryFn: () => api.get('/api/settings/reminder_rules').catch(() => []) });
  const { data, isLoading } = useQuery<any>({ queryKey: ['tasks', range, userId], queryFn: () => api.get('/api/tasks' + qs({ range, userId })) });
  const toggle = async (t: any) => {
    try {
      await api.patch(`/api/tasks/${t.id}`, { done: !t.doneAt });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const s = data?.summary;
  const label = { today: 'Hari ini', overdue: 'Terlambat', tomorrow: 'Besok', week: 'Minggu ini', done: 'Selesai' } as const;
  return (
    <Layout>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div>
          <div className="eyebrow">{date(new Date())} · {users?.find((u) => u.id === userId)?.name ?? me.user.name}</div>
          <div className="bold" style={{ fontSize: 16, color: 'var(--text-heading)' }}>
            Jadwal hari ini {s ? `· ${s.done} dari ${s.total} selesai${s.late ? ` · ${s.late} terlambat` : ''}` : ''}
          </div>
        </div>
        <span className="spacer" />
        {me.user.scope === 'all' && (
          <select className="input sm" style={{ width: 170 }} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Tugas saya</option>
            {users
              ?.filter((u) => u.role === 'sales' || u.role === 'spv')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        )}
        <button className="btn primary sm" onClick={() => setNewOpen(true)}>
          ＋ Tugas
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
        <Card>
          <div className="row wrap" style={{ marginBottom: 12 }}>
            {(Object.keys(label) as (keyof typeof label)[]).map((k) => (
              <button key={k} className={`chip${range === k ? ' on' : ''}`} onClick={() => setRange(k)}>
                {label[k]}
              </button>
            ))}
          </div>
          <div className="hint" style={{ marginBottom: 8 }}>
            Tugas dibuat otomatis dari aturan pengingat, atau ditambah manual saat sales janji menghubungi customer di tanggal tertentu.
          </div>
          {isLoading && <Loading />}
          {data && !data.rows.length && <Empty>Tidak ada tugas di rentang ini. 🎉</Empty>}
          {data?.rows.map((t: any) => (
            <div key={t.id} className="row" style={{ padding: '11px 0', borderTop: '1px solid var(--border-subtle)', opacity: t.doneAt ? 0.55 : 1, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={!!t.doneAt} onChange={() => toggle(t)} style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--olive-600)' }} aria-label="Selesai" />
              <span className="small bold" style={{ width: 56, flex: 'none', color: t.late ? 'var(--red-700)' : undefined }}>
                {range === 'today' || range === 'overdue' ? time(t.dueAt) : date(t.dueAt, false)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="small" style={{ textDecoration: t.doneAt ? 'line-through' : 'none' }}>
                  {t.title}
                </div>
                {t.lead && (
                  <div className="xs muted">
                    <Link to={`/leads/${t.lead.id}`}>{t.lead.code}</Link> · {t.lead.name}
                    {t.conversationId && (
                      <>
                        {' · '}
                        <Link to={`/inbox/${t.conversationId}`}>Buka chat</Link>
                      </>
                    )}
                  </div>
                )}
              </div>
              <span className={`pill ${KIND_PILL[t.kind] ?? ''}`}>{t.kind}</span>
              {t.auto && <span className="pill outline" title="Dibuat aturan pengingat">⚡</span>}
              <span className="xs" style={{ width: 82, textAlign: 'right', color: t.doneAt ? 'var(--olive-700)' : t.late ? 'var(--red-700)' : 'var(--text-muted)' }}>
                {t.doneAt ? 'Selesai' : t.late ? 'Terlambat' : 'Belum'}
              </span>
            </div>
          ))}
        </Card>
        <Card title="Aturan pengingat otomatis" sub="Sales tidak perlu mengingat sendiri — tugas muncul dari kejadian di chat.">
          {(rules ?? []).map((r: any) => (
            <div key={r.key} style={{ padding: '9px 0', borderTop: '1px solid var(--border-subtle)', opacity: r.on ? 1 : 0.5 }}>
              <div className="small bold">{r.trigger}</div>
              <div className="xs muted">{r.action}</div>
            </div>
          ))}
        </Card>
      </div>
      {newOpen && <TaskModal onClose={() => setNewOpen(false)} />}
    </Layout>
  );
}
