import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Loading, Modal, Seg, Stat, useToast } from '../components/ui';
import { Columns, Legend, SERIES } from '../components/charts';
import { date, relative } from '../format';

const PL: Record<string, { label: string; short: string; color: string }> = {
  instagram: { label: 'Instagram', short: 'IG', color: SERIES.rose },
  tiktok: { label: 'TikTok', short: 'TT', color: SERIES.olive },
  facebook: { label: 'Facebook', short: 'FB', color: SERIES.gold },
};
const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('id-ID'));
const trend = (a: number, b: number) => (b ? `${a >= b ? '↑' : '↓'} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs periode lalu` : 'periode lalu: —');

export function SocialPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'plan' ? 'plan' : 'stat';
  return (
    <Layout flush>
      <div className="tabs">
        <button className={tab === 'stat' ? 'on' : ''} onClick={() => setParams({})}>
          Statistik
        </button>
        <button className={tab === 'plan' ? 'on' : ''} onClick={() => setParams({ tab: 'plan' })}>
          Jadwal posting
        </button>
        <span className="spacer" />
        {me.user.role === 'admin' && (
          <Link className="btn ghost sm" style={{ alignSelf: 'center', marginRight: 8 }} to="/pengaturan/integrasi">
            Kelola integrasi
          </Link>
        )}
      </div>
      <div className="content">{tab === 'stat' ? <Stats /> : <Planner />}</div>
    </Layout>
  );
}

function Stats() {
  const [days, setDays] = useState('7');
  const [sel, setSel] = useState<string[]>(['instagram', 'tiktok', 'facebook']);
  const { data } = useQuery<any>({ queryKey: ['social', days, sel.join(',')], queryFn: () => api.get('/api/social' + qs({ days, platforms: sel.join(',') })) });
  if (!data) return <Loading />;
  const k = data.kpi;
  const shown = Object.keys(PL).filter((p) => sel.includes(p));
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="xs muted">Akun</span>
        {Object.entries(PL).map(([p, v]) => {
          const c = data.perPlatform.find((x: any) => x.provider === p)?.connected;
          return (
            <button key={p} className={`chip${sel.includes(p) ? ' on' : ''}`} onClick={() => setSel(sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p])} title={c ? `${c.name} · sinkron ${c.lastSyncAt ? relative(c.lastSyncAt) : 'menunggu'}` : 'Belum terhubung'}>
              {v.label}
              {!c && ' · belum terhubung'}
            </button>
          );
        })}
        <span className="spacer" />
        <Seg value={days} options={[['7', '7 hari'], ['30', '30 hari'], ['90', '90 hari']]} onChange={setDays} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Stat k="Posting" v={n(k.posts)} s={trend(k.posts, k.prev.posts)} />
        <Stat k="Impressions" v={n(k.impressions)} s={trend(k.impressions, k.prev.impressions)} />
        <Stat k="Likes" v={n(k.likes)} s={trend(k.likes, k.prev.likes)} />
        <Stat k="Komentar" v={n(k.comments)} s={trend(k.comments, k.prev.comments)} />
        <Stat k="Share" v={n(k.shares)} s={trend(k.shares, k.prev.shares)} />
      </div>
      {!k.posts && !k.prev.posts ? (
        <Empty>Belum ada data posting. Hubungkan Instagram, TikTok, atau Facebook di Pengaturan › Integrasi — data ditarik tiap 6 jam.</Empty>
      ) : (
        <>
          <Card title="Impressions per hari" sub="Dari posting yang terbit di hari itu, per platform" actions={<Legend items={shown.map((p) => ({ name: PL[p]!.label, color: PL[p]!.color }))} />}>
            <Columns
              data={data.daily.map((d: any) => ({ label: `${Number(d.day.slice(8))}/${Number(d.day.slice(5, 7))}`, values: Object.keys(PL).map((_, i) => d.values[i]).filter((_: any, i: number) => sel.includes(Object.keys(PL)[i]!)) }))}
              series={shown.map((p) => ({ name: PL[p]!.label, color: PL[p]!.color }))}
              height={200}
            />
          </Card>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 1fr)', alignItems: 'start' }}>
            <Card title="Performa per platform">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Platform</th>
                      <th style={{ textAlign: 'right' }}>Pengikut</th>
                      <th style={{ textAlign: 'right' }}>Posting</th>
                      <th style={{ textAlign: 'right' }}>Likes</th>
                      <th style={{ textAlign: 'right' }}>Komentar</th>
                      <th style={{ textAlign: 'right' }}>Share</th>
                      <th style={{ textAlign: 'right' }}>Impressions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perPlatform.map((p: any) => (
                      <tr key={p.provider}>
                        <td>
                          <b>{PL[p.provider]?.label}</b>
                          <div className="xs muted">{p.connected ? p.connected.name : 'belum terhubung'}</div>
                        </td>
                        <td className="tnum" style={{ textAlign: 'right' }}>{n(p.followers)}</td>
                        <td className="tnum" style={{ textAlign: 'right' }}>{n(p.posts)}</td>
                        <td className="tnum" style={{ textAlign: 'right' }}>{n(p.likes)}</td>
                        <td className="tnum" style={{ textAlign: 'right' }}>{n(p.comments)}</td>
                        <td className="tnum" style={{ textAlign: 'right' }}>{n(p.shares)}</td>
                        <td className="tnum" style={{ textAlign: 'right' }}>
                          {n(p.impressions)}
                          {p.impressionsPrev ? <div className="xs muted">{trend(p.impressions, p.impressionsPrev).split(' vs')[0]}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Posting teratas" sub="Urut likes · 5 teratas">
              {!data.top.length ? (
                <Empty>—</Empty>
              ) : (
                data.top.map((p: any, i: number) => (
                  <div key={i} className="row" style={{ gap: 8, padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
                    <span className="pf-badge" style={{ background: PL[p.provider]?.color }}>{PL[p.provider]?.short}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="small ellipsis" title={p.caption}>{p.caption || '(tanpa caption)'}</div>
                      <div className="xs muted">
                        ♥ {n(p.likes)} · 💬 {n(p.comments)} · ↗ {n(p.shares)} · {date(p.publishedAt)}
                      </div>
                    </div>
                    {p.permalink && (
                      <a className="btn ghost sm" href={p.permalink} target="_blank" rel="noreferrer">
                        Lihat
                      </a>
                    )}
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const ST: Record<string, [string, string]> = { scheduled: ['Terjadwal', 'warm'], published: ['Terbit', 'olive'], partial: ['Sebagian', 'warm'], failed: ['Gagal', 'hot'], manual: ['Posting manual', 'cold'], cancelled: ['Batal', ''] };

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Jadwal selalu dibaca & ditulis dalam WIB, apa pun zona waktu perangkat.
const wib = (iso: string | Date) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString();
const wibYmd = (iso: string | Date) => wib(iso).slice(0, 10);
const wibHm = (iso: string | Date) => wib(iso).slice(11, 16);
/** Jam bawaan: 10.00, atau jam bulat berikutnya bila hari ini sudah lewat 10.00 WIB. */
const defaultTime = (date: string) => {
  if (date !== wibYmd(new Date())) return '10:00';
  const h = Number(wibHm(new Date()).slice(0, 2)) + 1;
  return h <= 10 ? '10:00' : h > 23 ? '23:30' : `${String(h).padStart(2, '0')}:00`;
};
const blank = (date: string) => ({ caption: '', platforms: ['instagram'], date, time: defaultTime(date), mediaName: null });

function Planner() {
  const qc = useQueryClient();
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [edit, setEdit] = useState<any>(null);
  const from = ymd(week);
  const to = ymd(new Date(week.getTime() + 6 * 86_400_000));
  const { data } = useQuery<any[]>({ queryKey: ['schedule', from], queryFn: () => api.get('/api/social/schedule' + qs({ from, to })) });
  const { data: integ } = useQuery<any>({ queryKey: ['integrations'], queryFn: () => api.get('/api/integrations') });
  const connected = new Set((integ?.accounts ?? []).filter((a: any) => a.status === 'connected').map((a: any) => a.provider));
  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * 86_400_000));
  const counts = (data ?? []).reduce((a: Record<string, number>, p) => ({ ...a, [p.status]: (a[p.status] ?? 0) + 1 }), {});
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn ghost sm" onClick={() => setWeek(new Date(week.getTime() - 7 * 86_400_000))}>
          ‹
        </button>
        <b className="small">
          {date(from)} – {date(to)}
        </b>
        <button className="btn ghost sm" onClick={() => setWeek(new Date(week.getTime() + 7 * 86_400_000))}>
          ›
        </button>
        <button className="btn ghost sm" onClick={() => setWeek(mondayOf(new Date()))}>
          Minggu ini
        </button>
        <span className="spacer" />
        {Object.entries(counts).map(([s, c]) => (
          <span key={s} className={`pill ${ST[s]?.[1] ?? ''}`}>
            {ST[s]?.[0] ?? s} · {c as number}
          </span>
        ))}
        <button className="btn primary sm" onClick={() => setEdit(blank(wibYmd(new Date())))}>
          + Buat posting
        </button>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <div className="week-grid">
          {days.map((d, i) => {
            const items = data.filter((p) => wibYmd(p.scheduledAt) === ymd(d));
            return (
              <div key={i} className="week-col">
                <div className="row" style={{ gap: 6 }}>
                  <b className="small">{DAYS[i]}</b>
                  <span className="xs muted">{d.getDate()}</span>
                  <span className="spacer" />
                  <button className="btn ghost sm" title="Buat posting di hari ini" onClick={() => setEdit(blank(ymd(d)))}>
                    +
                  </button>
                </div>
                {items.length ? (
                  items.map((p) => (
                    <button key={p.id} className="post-chip" onClick={() => setEdit({ ...p, date: wibYmd(p.scheduledAt), time: wibHm(p.scheduledAt) })}>
                      <span className="row" style={{ gap: 4 }}>
                        <span className="xs bold">{wibHm(p.scheduledAt)}</span>
                        {p.platforms.map((pl: string) => (
                          <span key={pl} className="mini-badge" style={{ background: PL[pl]?.color }}>
                            {PL[pl]?.short}
                          </span>
                        ))}
                      </span>
                      <span className="xs ellipsis" style={{ display: 'block' }}>
                        {p.caption}
                      </span>
                      <span className={`pill ${ST[p.status]?.[1] ?? ''}`} style={{ marginTop: 4 }}>
                        {ST[p.status]?.[0] ?? p.status}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="xs muted" style={{ padding: '8px 0' }}>
                    Belum ada posting
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Card title="Cara kerja penjadwalan">
        <div className="small" style={{ display: 'grid', gap: 6 }}>
          <div>· Instagram & Facebook terbit otomatis pada jam yang dijadwalkan lewat API resmi (butuh akun terhubung; Instagram wajib pakai gambar).</div>
          <div>· TikTok, dan platform yang belum terhubung, menjadi <b>pengingat posting manual</b>: tim Marketing dapat notifikasi tepat waktu, lalu tandai "Sudah diposting".</div>
          <div>· Status <b>Gagal</b> berarti platform menolak (mis. ukuran gambar salah atau token kedaluwarsa) — tim dapat notifikasi dan bisa menjadwalkan ulang.</div>
          <div className="muted">Terhubung sekarang: {[...connected].filter((p) => (p as string) in PL).map((p) => PL[p as string]!.label).join(', ') || 'belum ada'}.</div>
        </div>
      </Card>
      {edit && <PostModal init={edit} onClose={() => setEdit(null)} onDone={() => qc.invalidateQueries({ queryKey: ['schedule'] })} />}
    </div>
  );
}

function PostModal({ init, onClose, onDone }: { init: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    setBusy(true);
    try {
      const r = await api.post<{ name: string }>('/api/social/media', fd);
      setV({ ...v, mediaName: r.name });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const body = { caption: v.caption, platforms: v.platforms, scheduledAt: new Date(`${v.date}T${v.time}:00+07:00`).toISOString(), mediaName: v.mediaName ?? null };
    try {
      if (v.id) await api.put(`/api/social/schedule/${v.id}`, body);
      else await api.post('/api/social/schedule', body);
      toast('Posting dijadwalkan');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const setStatus = async (status: 'published' | 'cancelled') => {
    await api.post(`/api/social/schedule/${v.id}/status`, { status });
    onDone();
    onClose();
  };
  const toggle = (p: string) => setV({ ...v, platforms: v.platforms.includes(p) ? v.platforms.filter((x: string) => x !== p) : [...v.platforms, p] });
  return (
    <Modal
      title={v.id ? 'Ubah posting' : 'Buat posting'}
      onClose={onClose}
      footer={
        <>
          {v.id && v.status === 'manual' && (
            <button className="btn" onClick={() => setStatus('published')}>
              Sudah diposting
            </button>
          )}
          {v.id && v.status === 'scheduled' && (
            <button className="btn ghost" onClick={() => setStatus('cancelled')}>
              Batalkan
            </button>
          )}
          <button className="btn primary" disabled={busy || !v.caption.trim() || !v.platforms.length} onClick={save}>
            {v.id ? 'Simpan & jadwalkan ulang' : 'Jadwalkan'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {Object.entries(PL).map(([p, x]) => (
            <button key={p} className={`chip${v.platforms.includes(p) ? ' on' : ''}`} onClick={() => toggle(p)}>
              {x.label}
            </button>
          ))}
        </div>
        <Field label="Caption">
          <textarea className="input" rows={5} maxLength={2200} value={v.caption} onChange={(e) => setV({ ...v, caption: e.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label="Tanggal">
            <input className="input" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          <Field label="Jam (WIB)">
            <input className="input" type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />
          </Field>
        </div>
        <Field label="Gambar (JPG/PNG)" hint={v.platforms.includes('instagram') ? 'Wajib untuk Instagram.' : 'Opsional.'}>
          <input className="input" type="file" accept="image/jpeg,image/png" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {v.mediaName && <span className="xs muted">Terunggah: {v.mediaName}</span>}
        </Field>
        {v.results && Object.keys(v.results).length > 0 && (
          <div className="tile xs">
            {Object.entries(v.results).map(([p, r]: any) => (
              <div key={p}>
                <b>{PL[p]?.label}</b>: {r.ok ? 'terbit' : r.error}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
