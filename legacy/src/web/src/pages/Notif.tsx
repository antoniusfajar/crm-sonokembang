import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { isRole, useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Loading, Modal, Stat, Switch, useToast } from '../components/ui';
import { usePush } from '../push';
import { dateTime, minutesSince, relative } from '../format';

const KIND: Record<string, [string, string]> = { sla: ['SLA', 'hot'], lead: ['Lead baru', 'olive'], ai: ['AI', 'warm'], tugas: ['Tugas', ''], sistem: ['Sistem', 'cold'] };

export function NotifPage() {
  const me = useMe();
  const { data, isLoading } = useQuery<any>({ queryKey: ['notif-team'], queryFn: () => api.get('/api/notifications/team'), refetchInterval: 30_000 });
  const { data: sla } = useQuery<any>({ queryKey: ['setting', 'sla'], queryFn: () => api.get('/api/settings/sla') });
  const { data: wh } = useQuery<any>({ queryKey: ['setting', 'working_hours'], queryFn: () => api.get('/api/settings/working_hours') });
  if (isLoading || !data) return <Layout><Loading /></Layout>;
  return (
    <Layout>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat k="Lewat SLA hari ini" v={data.stats.slaToday} s="notifikasi SLA terkirim" />
        <Stat k="Menunggu balasan sales" v={data.stats.waitingNow} s="setelah serah terima AI" />
        <Stat k="Notifikasi minggu ini" v={data.stats.sentWeek} s={`${data.stats.readPct}% dibuka`} />
        <Stat k="Jam kerja" v={wh ? `${wh.start}–${wh.end}` : '—'} s="di luar jam, SLA mulai pukul buka" />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)' }}>
        <div className="stack">
          <Card title="Menunggu balasan sales" sub="Urut dari yang paling lama menunggu.">
            {!data.waiting.length && <Empty>Semua customer sudah dibalas. 👍</Empty>}
            {data.waiting.map((w: any) => (
              <div key={w.id} className="row" style={{ padding: '9px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <span className={`pill ${w.level >= 2 ? 'red' : w.level === 1 ? 'hot' : 'outline'}`}>Lv {w.level}</span>
                <Link to={`/inbox/${w.id}`} className="bold small">
                  {w.name ?? w.phone}
                </Link>
                <span className="xs muted">{w.owner ?? 'tanpa PIC'}</span>
                <span className="spacer" />
                <span className="small">{minutesSince(w.since)} mnt</span>
              </div>
            ))}
          </Card>
          <Card title="Notifikasi terbaru" sub={isRole(me, 'spv', 'admin') ? 'Tampilan SPV — seluruh tim, 7 hari terakhir' : '7 hari terakhir'}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Jenis</th>
                    <th>Kejadian</th>
                    <th>Penerima</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.feed.map((n: any) => (
                    <tr key={n.id}>
                      <td className="xs muted nowrap">{relative(n.at)}</td>
                      <td>
                        <span className={`pill ${KIND[n.kind]?.[1] ?? ''}`}>{KIND[n.kind]?.[0] ?? n.kind}</span>
                      </td>
                      <td className="small">{n.link ? <Link to={n.link}>{n.text}</Link> : n.text}</td>
                      <td className="small">{n.to}</td>
                      <td className="xs" style={{ color: n.readAt ? 'var(--text-muted)' : 'var(--red-700)' }}>
                        {n.readAt ? 'Dibuka' : 'Belum dibuka'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.feed.length && <Empty>Belum ada notifikasi.</Empty>}
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card title="Tangga eskalasi" sub={`Berlaku pada jam kerja ${wh?.start ?? '08:00'}–${wh?.end ?? '20:00'}. Di luar jam, AI tetap menjawab dan hitungan SLA mulai saat jam buka.`}>
            {sla?.levels.map((l: any, i: number) => (
              <div key={i} className="row" style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)', alignItems: 'flex-start' }}>
                <span className="avatar" style={{ background: ['var(--gold-100)', 'var(--rose-100)', 'var(--charcoal-900)'][i] ?? 'var(--cream-200)', color: ['var(--gold-600)', 'var(--red-700)', '#fff'][i] ?? 'inherit' }}>{i + 1}</span>
                <div>
                  <div className="small bold">
                    Level {i + 1} · {l.minutes >= 60 ? `${l.minutes / 60} jam` : `${l.minutes} menit`}
                  </div>
                  <div className="xs muted">{l.label}</div>
                </div>
              </div>
            ))}
            {isRole(me, 'admin') && (
              <Link className="small" to="/pengaturan/kpi">
                Ubah batas SLA →
              </Link>
            )}
          </Card>
          <ChannelsCard />
          <div className="hint">Diperbarui {dateTime(new Date())}</div>
        </div>
      </div>
    </Layout>
  );
}

function ChannelsCard() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const push = usePush();
  const isAdmin = me.user.role === 'admin';
  const { data } = useQuery<any>({ queryKey: ['notif-channels'], queryFn: () => api.get('/api/notif-channels') });
  const [v, setV] = useState<any>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => data && setV(structuredClone(data.settings)), [data]);
  if (!data || !v) return <Card title="Kanal notifikasi"><Loading /></Card>;
  const st = data.status;
  const save = async () => {
    try {
      await api.put('/api/notif-channels', { push: v.push, email: { ...v.email, minSlaLevel: Number(v.email.minSlaLevel) } });
      toast('Kanal notifikasi disimpan');
      qc.invalidateQueries({ queryKey: ['notif-channels'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const act = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      toast(ok);
      qc.invalidateQueries({ queryKey: ['notif-channels'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const row = (title: string, desc: React.ReactNode, on: boolean, set: (on: boolean) => void, extra?: React.ReactNode) => (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="small bold">{title}</div>
          <div className="xs muted">{desc}</div>
        </div>
        <Switch on={on} disabled={!isAdmin} onChange={set} />
      </div>
      {extra}
    </div>
  );
  return (
    <Card title="Kanal notifikasi" actions={isAdmin && <button className="btn primary sm" onClick={save}>Simpan</button>}>
      <div className="small" style={{ paddingBottom: 8 }}>✓ Di aplikasi (lonceng + daftar ini), real-time</div>
      {row(
        'Push ke HP / laptop',
        <>Semua notifikasi untuk penerimanya. {st.pushDevices} perangkat terdaftar.</>,
        v.push.on,
        (on) => setV({ ...v, push: { on } }),
        <div className="row wrap" style={{ marginTop: 8 }}>
          {push.state === 'on' ? (
            <>
              <span className="pill olive">Aktif di perangkat ini</span>
              <button className="btn sm" onClick={() => act(() => api.post('/api/push/test'), 'Notifikasi tes dikirim')}>Kirim tes</button>
              <button className="btn sm" onClick={() => act(push.disable, 'Notifikasi dimatikan di perangkat ini')}>Matikan</button>
            </>
          ) : push.state === 'off' ? (
            <button className="btn sm olive" onClick={() => act(push.enable, 'Notifikasi aktif di perangkat ini')}>Aktifkan di perangkat ini</button>
          ) : push.state === 'denied' ? (
            <span className="xs" style={{ color: 'var(--red-700)' }}>Izin notifikasi diblokir di browser ini.</span>
          ) : push.state === 'unsupported' ? (
            <span className="xs muted">Browser ini belum mendukung notifikasi. Pakai Chrome atau Edge terbaru.</span>
          ) : null}
        </div>,
      )}
      {row(
        'Email eskalasi SLA',
        <>
          Ke SPV/Admin mulai level{' '}
          <select className="input sm" style={{ width: 56, display: 'inline-block', padding: '2px 6px' }} disabled={!isAdmin} value={v.email.minSlaLevel} onChange={(e) => setV({ ...v, email: { ...v.email, minSlaLevel: e.target.value } })}>
            {[1, 2, 3].map((n) => <option key={n}>{n}</option>)}
          </select>
          {!st.smtpConfigured && <div style={{ color: 'var(--red-700)' }}>SMTP belum diatur di server — email belum bisa dikirim.</div>}
        </>,
        v.email.escalationOn,
        (on) => setV({ ...v, email: { ...v.email, escalationOn: on } }),
      )}
      {row(
        'Email ringkasan harian',
        <>
          Jam{' '}
          <input className="input sm" type="time" style={{ width: 96, display: 'inline-block', padding: '2px 6px' }} disabled={!isAdmin} value={v.email.digestTime} onChange={(e) => setV({ ...v, email: { ...v.email, digestTime: e.target.value } })} /> WIB ke{' '}
          <select className="input sm" style={{ width: 120, display: 'inline-block', padding: '2px 6px' }} disabled={!isAdmin} value={v.email.digestTo} onChange={(e) => setV({ ...v, email: { ...v.email, digestTo: e.target.value } })}>
            <option value="admin">Admin</option>
            <option value="admin_spv">Admin + SPV</option>
          </select>
          {st.lastDigest && <div>Terakhir terkirim: {st.lastDigest}</div>}
        </>,
        v.email.digestOn,
        (on) => setV({ ...v, email: { ...v.email, digestOn: on } }),
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={async () => setPreview((await api.get('/api/notif-channels/digest-preview')).text)}>Lihat isi ringkasan</button>
          {isAdmin && st.smtpConfigured && (
            <>
              <button className="btn sm" onClick={() => act(() => api.post('/api/notif-channels/test-email'), `Email tes dikirim ke ${me.user.email}`)}>Tes email</button>
              <button className="btn sm" onClick={() => act(() => api.post('/api/notif-channels/digest-now'), 'Ringkasan dikirim')}>Kirim ringkasan sekarang</button>
            </>
          )}
        </div>,
      )}
      <div className="xs muted" style={{ paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>Push native di HP menyusul bersama aplikasi mobile (fase terakhir).</div>
      {preview && (
        <Modal title="Isi ringkasan harian (hari ini)" onClose={() => setPreview(null)}>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{preview}</pre>
        </Modal>
      )}
    </Card>
  );
}

