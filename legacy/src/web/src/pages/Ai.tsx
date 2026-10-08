import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { isRole, useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Loading, Stat, TempPill, useToast } from '../components/ui';
import { dateTime, minutesSince, relative, rupiah } from '../format';

export function AiPage() {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ['ai-overview'], queryFn: () => api.get('/api/ai/overview'), refetchInterval: 30_000 });
  const { data: users } = useQuery<any[]>({ queryKey: ['users-options'], queryFn: () => api.get('/api/users/options') });
  if (isLoading || !data) return <Layout><Loading /></Layout>;
  const claim = async (cid: string) => {
    try {
      await api.post(`/api/conversations/${cid}/claim`);
      qc.invalidateQueries({ queryKey: ['ai-overview'] });
      nav(`/inbox/${cid}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const assign = async (cid: string, userId: string) => {
    try {
      await api.post(`/api/conversations/${cid}/assign`, { userId });
      toast('Ditugaskan');
      qc.invalidateQueries({ queryKey: ['ai-overview'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const pct = data.stats.budgetIdr ? Math.round((data.stats.spendIdr / data.stats.budgetIdr) * 100) : 0;
  return (
    <Layout>
      {(!data.enabled || !data.keyReady) && (
        <div className="banner" style={{ marginBottom: 16 }}>
          {!data.enabled ? 'AI sedang dimatikan.' : 'API key AI belum dipasang.'} Semua chat baru langsung diteruskan ke sales.{' '}
          {isRole(me, 'admin') && <Link to="/pengaturan/aimodel">Atur di Pengaturan › Model AI & API key →</Link>}
        </div>
      )}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat k="Menunggu serah terima" v={data.queue.length} s="belum diambil sales" />
        <Stat k="Masih dipegang AI" v={data.stats.aiHandling} s="percakapan aktif" />
        <Stat k="Panggilan AI bulan ini" v={data.stats.calls.toLocaleString('id-ID')} s={`${data.stats.failed} gagal · ${data.provider} · ${data.models.chat}`} />
        <Stat k="Biaya AI bulan ini" v={rupiah(data.stats.spendIdr)} s={data.stats.budgetIdr ? `${pct}% dari pagu ${rupiah(data.stats.budgetIdr)}` : 'tanpa pagu'} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(280px, 1fr)' }}>
        <Card
          title={`Antrean serah terima · ${data.queue.length} menunggu`}
          sub="Masuk otomatis saat AI selesai mengumpulkan data kualifikasi, atau saat customer menyentuh topik harga/diskon/ketersediaan. Hitungan target respons sales mulai dari detik serah terima."
        >
          {!data.queue.length && <Empty>Tidak ada antrean. Semua serah terima sudah diambil sales.</Empty>}
          {data.queue.map((h: any) => (
            <div key={h.conversationId} style={{ padding: '12px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <div className="row wrap">
                <b>{h.name}</b>
                {h.lead && <TempPill t={h.lead.temperature} score={h.lead.score} />}
                <span className="xs muted">→ {h.owner ?? 'belum ada PIC'}</span>
                <span className="spacer" />
                {h.awaitingSince && <span className={`pill ${minutesSince(h.awaitingSince) > 45 ? 'red' : 'hot'}`}>⏱ {minutesSince(h.awaitingSince)} mnt</span>}
                <span className="xs muted">{relative(h.handoffAt)}</span>
              </div>
              <div className="small" style={{ margin: '4px 0' }}>
                <b>Alasan:</b> {h.reason}
              </div>
              {h.summary && <div className="xs muted" style={{ whiteSpace: 'pre-wrap' }}>{h.summary}</div>}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm primary" onClick={() => claim(h.conversationId)}>
                  Ambil
                </button>
                <Link className="btn sm" to={`/inbox/${h.conversationId}`}>
                  Lihat chat
                </Link>
                {isRole(me, 'spv', 'admin') && (
                  <select className="input sm" style={{ width: 160 }} value="" onChange={(e) => e.target.value && assign(h.conversationId, e.target.value)}>
                    <option value="">Tugaskan ke…</option>
                    {users
                      ?.filter((u) => u.role === 'sales' || u.role === 'spv')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            </div>
          ))}
        </Card>
        <div className="stack">
          <Card title="Pagar pengaman AI">
            <div className="label" style={{ color: 'var(--olive-700)' }}>
              Boleh
            </div>
            {data.allow.map((t: string) => (
              <div key={t} className="small">
                · {t}
              </div>
            ))}
            <div className="label" style={{ color: 'var(--red-700)', marginTop: 10 }}>
              Tidak boleh
            </div>
            {data.deny.map((t: string) => (
              <div key={t} className="small">
                · {t}
              </div>
            ))}
            {isRole(me, 'admin') && (
              <Link className="small" to="/pengaturan/ai" style={{ display: 'block', marginTop: 10 }}>
                Ubah di Pengaturan › Prompt & pagar AI →
              </Link>
            )}
          </Card>
          <Card title="Log pagar pengaman" sub="Balasan AI yang ditahan & alasannya. Dipakai untuk mengoreksi prompt.">
            {!data.logs.length && <Empty>Belum ada balasan yang ditahan.</Empty>}
            {data.logs.map((lg: any) => (
              <div key={lg.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <div className="row">
                  <span className="pill warm">Lapis {lg.layer}</span>
                  <span className="xs muted">{dateTime(lg.at)}</span>
                  <span className="spacer" />
                  {lg.conversationId && (
                    <Link className="xs" to={`/inbox/${lg.conversationId}`}>
                      chat
                    </Link>
                  )}
                </div>
                <div className="small bold" style={{ marginTop: 4 }}>
                  {lg.reason}
                </div>
                <div className="xs muted ellipsis">{lg.text}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Layout>
  );
}
