import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Loading, Stat, useToast } from '../components/ui';
import { HBars, SERIES } from '../components/charts';
import { usePipelines } from '../components/LeadActions';
import { dateTime, rupiah, rupiahShort, todayIso } from '../format';

interface Segment {
  contactTypes?: string[];
  segments?: string[];
  leadState?: 'any' | 'open' | 'won' | 'lost' | 'none';
  temperatures?: string[];
  pipelineId?: string | null;
  eventTypeContains?: string | null;
  lastOrderOlderThanDays?: number | null;
  createdWithinDays?: number | null;
  repeatOpportunity?: string | null;
}
interface Meta {
  presets: { key: string; label: string; segment: Segment }[];
  repeatPresets: { key: string; label: string; segment: Segment }[];
  templates: { name: string; language: string; category: string; status: string; body: string; usable: boolean }[];
  settings: { costPerMsg: number; frequencyDays: number; perTick: number };
  waMode: 'simulator' | 'meta';
}
interface Stats {
  total: number;
  sent: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
  leads: number;
  closings: number;
}

const STATUS: Record<string, [string, string]> = {
  scheduled: ['Terjadwal', 'warm'],
  sending: ['Mengirim…', 'warm'],
  done: ['Selesai', 'olive'],
  cancelled: ['Dibatalkan', 'cold'],
  failed: ['Gagal', 'hot'],
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function BroadcastPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('id') ? 'detail' : params.get('new') !== null ? 'new' : 'list';
  return (
    <Layout>
      {view === 'list' && <BroadcastList onOpen={(id) => setParams({ id })} onNew={() => setParams({ new: '' })} />}
      {view === 'detail' && <BroadcastDetail id={params.get('id')!} onBack={() => setParams({})} onDuplicate={(id) => setParams({ new: '', from: id })} />}
      {view === 'new' && <BroadcastNew fromId={params.get('from')} initialPreset={params.get('preset')} onBack={() => setParams({})} onCreated={(id) => setParams({ id })} />}
    </Layout>
  );
}

function BroadcastList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [range, setRange] = useState<'30' | '90' | 'year' | 'custom'>('90');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(todayIso());
  useEffect(() => {
    if (range === 'custom') return;
    const now = new Date();
    setFrom(range === 'year' ? `${now.getFullYear()}-01-01` : iso(new Date(Date.now() - Number(range) * 86_400_000)));
    // Termasuk broadcast terjadwal ke depan.
    setTo(iso(new Date(Date.now() + 365 * 86_400_000)));
  }, [range]);
  const { data } = useQuery<{ rows: any[]; totals: any }>({ queryKey: ['broadcasts', from, to], queryFn: () => api.get('/api/broadcasts' + qs({ from, to })) });
  const t = data?.totals;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {(
          [
            ['30', '30 hari'],
            ['90', '90 hari'],
            ['year', 'Tahun ini'],
            ['custom', 'Pilih tanggal'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`chip${range === k ? ' on' : ''}`} onClick={() => setRange(k)}>
            {l}
          </button>
        ))}
        {range === 'custom' && (
          <span className="row" style={{ gap: 6 }}>
            <input className="input sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />–
            <input className="input sm" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
        )}
        <span className="spacer" />
        <button className="btn primary sm" onClick={onNew}>
          ＋ Buat broadcast
        </button>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-4">
            <Stat k="Pesan terkirim" v={t.sent.toLocaleString('id-ID')} s={`${t.broadcasts} broadcast`} />
            <Stat k="Dibalas" v={pct(t.replied, t.sent)} s={`${t.replied.toLocaleString('id-ID')} balasan · dibaca ${pct(t.read, t.sent)}`} />
            <Stat k="Jadi lead" v={t.leads.toLocaleString('id-ID')} s={`${t.closings} closing`} />
            <Stat k="Biaya / lead" v={t.costPerLead ? rupiahShort(t.costPerLead) : '—'} s={`total ${rupiahShort(t.cost)} (tagihan Meta)`} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2.4fr)', alignItems: 'start' }}>
            <Card title="Funnel" sub="Semua broadcast di rentang ini">
              <HBars
                rows={[
                  { label: 'Terkirim', value: t.sent },
                  { label: 'Dibaca', value: t.read },
                  { label: 'Dibalas', value: t.replied },
                  { label: 'Jadi lead', value: t.leads },
                  { label: 'Closing', value: t.closings, color: SERIES.olive },
                ]}
                color={SERIES.rose}
                labelWidth={84}
              />
            </Card>
            <Card title="Riwayat broadcast" sub={`${data.rows.length} broadcast`}>
              {!data.rows.length ? (
                <Empty>Belum ada broadcast di rentang ini.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Broadcast</th>
                        <th>Tanggal</th>
                        <th style={{ textAlign: 'right' }}>Kirim</th>
                        <th style={{ textAlign: 'right' }}>Dibaca</th>
                        <th style={{ textAlign: 'right' }}>Dibalas</th>
                        <th style={{ textAlign: 'right' }}>Lead</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((b) => (
                        <tr key={b.id} className="click" onClick={() => onOpen(b.id)}>
                          <td>
                            <b>{b.name}</b>
                            <div className="xs muted">{b.segmentLabel}</div>
                          </td>
                          <td className="small nowrap">{dateTime(b.scheduledAt)}</td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {b.stats.sent || '—'}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {b.stats.sent ? pct(b.stats.read, b.stats.sent) : '—'}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {b.stats.sent ? pct(b.stats.replied, b.stats.sent) : '—'}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {b.stats.leads || '—'}
                          </td>
                          <td>
                            <span className={`pill ${STATUS[b.status]?.[1]}`}>{STATUS[b.status]?.[0]}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function BroadcastDetail({ id, onBack, onDuplicate }: { id: string; onBack: () => void; onDuplicate: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: b } = useQuery<any>({ queryKey: ['broadcast', id], queryFn: () => api.get(`/api/broadcasts/${id}`), refetchInterval: (q) => ((q.state.data as any)?.status === 'sending' ? 5000 : false) });
  if (!b) return <Loading />;
  const s: Stats = b.stats;
  const cancel = async () => {
    if (!confirm('Batalkan broadcast terjadwal ini?')) return;
    try {
      await api.post(`/api/broadcasts/${id}/cancel`);
      qc.invalidateQueries({ queryKey: ['broadcast', id] });
      qc.invalidateQueries({ queryKey: ['broadcasts'] });
      toast('Broadcast dibatalkan');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn ghost sm" onClick={onBack}>
          ← Riwayat
        </button>
        <span className={`pill ${STATUS[b.status]?.[1]}`}>{STATUS[b.status]?.[0]}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => onDuplicate(id)}>
          Duplikat jadi broadcast baru
        </button>
        {b.status === 'scheduled' && (
          <button className="btn ghost sm" onClick={cancel}>
            Batalkan jadwal
          </button>
        )}
      </div>
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>{b.name}</h2>
        <div className="small muted">
          {dateTime(b.scheduledAt)} · {b.segmentLabel} · template <b>{b.templateName}</b> · oleh {b.by}
        </div>
      </div>
      <div className="grid grid-4">
        {b.status === 'scheduled' ? (
          <>
            <Stat k="Estimasi penerima" v={b.estimate?.eligible ?? '—'} s={b.estimate ? `${b.estimate.optOut} opt-out · ${b.estimate.recent} baru dikirimi` : ''} />
            <Stat k="Estimasi biaya" v={b.estimate ? rupiahShort(b.estimate.cost) : '—'} s={`${rupiah(b.costPerMsg)} per pesan`} />
          </>
        ) : (
          <>
            <Stat k="Terkirim" v={s.sent} s={`${s.skipped} dilewati · ${s.failed} gagal`} />
            <Stat k="Dibaca" v={pct(s.read, s.sent)} s={`${s.read} kontak`} />
            <Stat k="Dibalas" v={pct(s.replied, s.sent)} s={`${s.replied} balasan`} />
            <Stat k="Lead / closing" v={`${s.leads} / ${s.closings}`} s={`biaya ${rupiahShort(s.sent * b.costPerMsg)}${s.leads ? ` · ${rupiahShort(Math.round((s.sent * b.costPerMsg) / s.leads))}/lead` : ''}`} />
          </>
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <Card title="Balasan & lead dari broadcast ini" sub="Klik untuk membuka chat. Balasan otomatis jadi percakapan dengan sumber Broadcast — AI tetap menyapa lebih dulu.">
          {!b.replies.length ? (
            <Empty>{b.status === 'scheduled' ? 'Belum terkirim.' : 'Belum ada balasan.'}</Empty>
          ) : (
            b.replies.map((r: any, i: number) => (
              <button key={i} className="list-row" onClick={() => r.conversationId && nav(`/inbox/${r.conversationId}`)}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b className="small">{r.name ?? r.phone}</b>
                  <span className="small muted ellipsis" style={{ display: 'block' }}>
                    "{r.text}"
                  </span>
                </span>
                {r.stop ? <span className="pill cold">STOP</span> : r.leadCode ? <span className="pill olive">{r.leadCode}</span> : null}
                <span className="xs muted nowrap">{dateTime(r.at)}</span>
              </button>
            ))
          )}
        </Card>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card title="Pesan terkirim">
            <div className="wa-bubble">{b.preview}</div>
          </Card>
          {b.failures.length > 0 && (
            <Card title="Tidak terkirim">
              {b.failures.map((f: any, i: number) => (
                <div key={i} className="small" style={{ padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <b>{f.name ?? '—'}</b> · <span className="muted">{f.reason ?? f.error}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const TYPES = ['Calon pelanggan', 'Pelanggan'];
const SEGS = ['Personal', 'Korporat', 'Institusi'];

function BroadcastNew({ fromId, initialPreset, onBack, onCreated }: { fromId: string | null; initialPreset: string | null; onBack: () => void; onCreated: (id: string) => void }) {
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: meta } = useQuery<Meta>({ queryKey: ['broadcast-meta'], queryFn: () => api.get('/api/broadcasts/meta') });
  const { data: src } = useQuery<any>({ queryKey: ['broadcast', fromId], queryFn: () => api.get(`/api/broadcasts/${fromId}`), enabled: !!fromId });
  const { data: pd } = usePipelines();
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<string>(initialPreset || 'hotwarm_wedding');
  const [seg, setSeg] = useState<Segment>({});
  const [tpl, setTpl] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!meta) return;
    if (src) {
      setName(`${src.name} (salinan)`);
      setPreset('custom');
      setSeg(src.segment);
      setTpl(`${src.templateName}|${src.templateLanguage}`);
      setParams(src.params);
    } else {
      const p = [...meta.presets, ...meta.repeatPresets].find((x) => x.key === preset);
      if (p) setSeg(p.segment);
      if (p && initialPreset && !name) setName(p.label);
      const first = meta.templates.find((t) => t.usable && t.category === 'MARKETING') ?? meta.templates.find((t) => t.usable);
      if (first && !tpl) setTpl(`${first.name}|${first.language}`);
    }
  }, [meta, src]);
  const template = meta?.templates.find((t) => `${t.name}|${t.language}` === tpl);
  const slots = useMemo(() => (template ? [...new Set([...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b) : []), [template]);
  useEffect(() => {
    setParams((p) => slots.map((_, i) => p[i] ?? (i === 0 ? '{nama}' : '')));
  }, [slots.length]);
  const segKey = JSON.stringify(seg);
  const { data: est } = useQuery<any>({ queryKey: ['broadcast-est', segKey], queryFn: () => api.post('/api/broadcasts/estimate', { segment: seg }), enabled: !!meta });
  if (!meta) return <Loading />;

  const pickPreset = (k: string) => {
    setPreset(k);
    const p = [...meta.presets, ...meta.repeatPresets].find((x) => x.key === k);
    if (p) setSeg(p.segment);
  };
  const toggle = (k: 'contactTypes' | 'segments' | 'temperatures', v: string) => {
    const cur = seg[k] ?? [];
    setPreset('custom');
    setSeg({ ...seg, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const preview = template ? template.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => (params[Number(n) - 1] || `{{${n}}}`).replace(/\{nama\}/gi, 'Ratna')) : '';
  const submit = async () => {
    const [tn, tl] = tpl.split('|');
    setBusy(true);
    try {
      const at = new Date(`${date}T${time}:00+07:00`);
      const r = await api.post<{ id: string }>('/api/broadcasts', { name, segment: seg, presetLabel: preset !== 'custom' ? [...meta.presets, ...meta.repeatPresets].find((p) => p.key === preset)?.label : undefined, templateName: tn, templateLanguage: tl, params, scheduledAt: at.toISOString() });
      qc.invalidateQueries({ queryKey: ['broadcasts'] });
      toast(at <= new Date() ? 'Broadcast mulai dikirim dalam ±1 menit' : 'Broadcast dijadwalkan');
      onCreated(r.id);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <button className="btn ghost sm" onClick={onBack}>
          ← Kembali ke riwayat
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(300px, 1fr)', alignItems: 'start' }}>
        <Card title="Buat broadcast" sub="Hanya template yang sudah disetujui Meta yang bisa dikirim ke kontak di luar jendela 24 jam.">
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Nama broadcast">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Menu baru coffee break" />
            </Field>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                Segmen penerima
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {meta.presets.map((p) => (
                  <button key={p.key} className={`chip${preset === p.key ? ' on' : ''}`} onClick={() => pickPreset(p.key)}>
                    {p.label}
                  </button>
                ))}
                <button className={`chip${preset === 'custom' ? ' on' : ''}`} onClick={() => setPreset('custom')}>
                  Atur sendiri
                </button>
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                <span className="xs muted">Peluang repeat order:</span>
                {meta.repeatPresets.map((p) => (
                  <button key={p.key} className={`chip${preset === p.key ? ' on' : ''}`} onClick={() => pickPreset(p.key)}>
                    {p.label.replace(/^Repeat: /, '')}
                  </button>
                ))}
              </div>
            </div>
            {preset === 'custom' && (
              <div className="tile" style={{ display: 'grid', gap: 10 }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className="xs muted" style={{ width: 90 }}>
                    Tipe kontak
                  </span>
                  {TYPES.map((x) => (
                    <button key={x} className={`chip${seg.contactTypes?.includes(x) ? ' on' : ''}`} onClick={() => toggle('contactTypes', x)}>
                      {x}
                    </button>
                  ))}
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className="xs muted" style={{ width: 90 }}>
                    Segmen
                  </span>
                  {SEGS.map((x) => (
                    <button key={x} className={`chip${seg.segments?.includes(x) ? ' on' : ''}`} onClick={() => toggle('segments', x)}>
                      {x}
                    </button>
                  ))}
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className="xs muted" style={{ width: 90 }}>
                    Status lead
                  </span>
                  <select className="input sm" style={{ width: 170 }} value={seg.leadState ?? 'any'} onChange={(e) => setSeg({ ...seg, leadState: e.target.value as any })}>
                    <option value="any">Semua</option>
                    <option value="open">Lead aktif</option>
                    <option value="won">Pernah closing</option>
                    <option value="lost">Lost / Abandoned</option>
                    <option value="none">Belum pernah jadi lead</option>
                  </select>
                  {['Hot', 'Warm', 'Cold'].map((x) => (
                    <button key={x} className={`chip${seg.temperatures?.includes(x) ? ' on' : ''}`} onClick={() => toggle('temperatures', x)}>
                      {x}
                    </button>
                  ))}
                </div>
                <div className="form-grid">
                  <Field label="Pipeline">
                    <select className="input sm" value={seg.pipelineId ?? ''} onChange={(e) => setSeg({ ...seg, pipelineId: e.target.value || null })}>
                      <option value="">Semua</option>
                      {pd?.pipelines.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Jenis acara mengandung">
                    <input className="input sm" value={seg.eventTypeContains ?? ''} onChange={(e) => setSeg({ ...seg, eventTypeContains: e.target.value || null })} placeholder="mis. wisuda" />
                  </Field>
                  <Field label="Tidak order lebih dari (hari)">
                    <input className="input sm" type="number" min={1} value={seg.lastOrderOlderThanDays ?? ''} onChange={(e) => setSeg({ ...seg, lastOrderOlderThanDays: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                  <Field label="Kontak baru dalam (hari)">
                    <input className="input sm" type="number" min={1} value={seg.createdWithinDays ?? ''} onChange={(e) => setSeg({ ...seg, createdWithinDays: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                </div>
              </div>
            )}
            <Field label="Template pesan" hint={meta.waMode === 'simulator' ? 'Mode simulasi: template lokal boleh dipakai untuk uji coba. Setelah tersambung ke Meta, hanya template berstatus APPROVED.' : 'Template baru diajukan di Pengaturan › WhatsApp › Template pesan.'}>
              <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value)}>
                <option value="">— pilih —</option>
                {meta.templates.map((t) => (
                  <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`} disabled={!t.usable}>
                    {t.name} · {t.category} · {t.status}
                  </option>
                ))}
              </select>
            </Field>
            {slots.map((n, i) => (
              <Field key={n} label={`Isi {{${n}}}`} hint={i === 0 ? 'Tulis {nama} untuk nama depan penerima.' : undefined}>
                <input className="input" value={params[i] ?? ''} onChange={(e) => setParams(params.map((p, j) => (j === i ? e.target.value : p)))} />
              </Field>
            ))}
            <div className="form-grid">
              <Field label="Tanggal kirim">
                <input className="input" type="date" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Jam (WIB)">
                <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <span className="small">
                Estimasi penerima <b>{est ? est.eligible.toLocaleString('id-ID') : '…'} kontak</b> · perkiraan biaya <b>{est ? rupiah(est.cost) : '…'}</b>
                {est && (est.optOut || est.recent) ? (
                  <span className="xs muted" style={{ display: 'block' }}>
                    {est.matched} cocok · {est.optOut} berhenti berlangganan · {est.recent} sudah dikirimi {meta.settings.frequencyDays} hari terakhir
                  </span>
                ) : null}
              </span>
              <span className="spacer" />
              <button className="btn primary" disabled={busy || name.trim().length < 3 || !template || !est?.eligible} onClick={submit}>
                {date === todayIso() && time <= new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 16) ? 'Kirim sekarang' : 'Jadwalkan'}
              </button>
            </div>
          </div>
        </Card>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card title="Pratinjau pesan">
            {template ? <div className="wa-bubble">{preview}</div> : <Empty>Pilih template.</Empty>}
            <div className="xs muted" style={{ marginTop: 8 }}>
              Balasan masuk otomatis menjadi percakapan di Conversation dengan sumber "Broadcast" — AI tetap menyapa lebih dulu.
            </div>
          </Card>
          <Card title="Aturan & kepatuhan">
            {[
              ['Di luar jendela 24 jam', 'Wajib template yang sudah disetujui Meta'],
              ['Opt-out', 'Balasan STOP otomatis menandai kontak — tidak dikirimi broadcast lagi'],
              ['Frekuensi maksimum', `1 broadcast per kontak per ${meta.settings.frequencyDays} hari`],
              ['Biaya', `${rupiah(meta.settings.costPerMsg)} per pesan marketing (tagihan Meta, di luar biaya AI)`],
              ['Supplier & bukan prospek', 'Tidak pernah ikut broadcast'],
            ].map(([k, v]) => (
              <div key={k} className="small" style={{ padding: '7px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <b>{k}</b>
                <div className="muted">{v}</div>
              </div>
            ))}
            {me.user.role === 'admin' && <BroadcastSettingsForm settings={meta.settings} />}
          </Card>
        </div>
      </div>
    </div>
  );
}

function BroadcastSettingsForm({ settings }: { settings: Meta['settings'] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState({ costPerMsg: String(settings.costPerMsg), frequencyDays: String(settings.frequencyDays) });
  const save = async () => {
    try {
      await api.put('/api/broadcasts/settings', { costPerMsg: Number(v.costPerMsg), frequencyDays: Number(v.frequencyDays), perTick: settings.perTick });
      qc.invalidateQueries({ queryKey: ['broadcast-meta'] });
      toast('Aturan broadcast disimpan');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="row wrap" style={{ gap: 8, marginTop: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
      <label className="xs">
        Rp/pesan <input className="input sm" style={{ width: 80 }} type="number" value={v.costPerMsg} onChange={(e) => setV({ ...v, costPerMsg: e.target.value })} />
      </label>
      <label className="xs">
        Jeda hari <input className="input sm" style={{ width: 60 }} type="number" value={v.frequencyDays} onChange={(e) => setV({ ...v, frequencyDays: e.target.value })} />
      </label>
      <button className="btn sm" onClick={save}>
        Simpan
      </button>
    </div>
  );
}
