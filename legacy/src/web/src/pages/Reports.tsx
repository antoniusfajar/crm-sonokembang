import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { isRole, useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Loading, Modal, Seg, Switch, useToast } from '../components/ui';
import { SERIES } from '../components/charts';
import { dateTime } from '../format';

interface Meta {
  types: { key: string; title: string; desc: string; available: boolean }[];
  audiences: { key: string; label: string; style: string }[];
  periods: { key: string; label: string }[];
  aiAvailable: boolean;
  smartModel: string;
}
interface Narrative {
  summary: string;
  findings: string[];
  recommendations: string[];
}
interface Report {
  id: string;
  type: string;
  title: string;
  periodLabel: string;
  audience: string;
  format: 'pdf' | 'pptx';
  aiUsed: boolean;
  createdBy: string | null;
  createdAt: string;
  narrative: Narrative;
  data: {
    kpis: { label: string; value: string; note: string; tone: 'good' | 'bad' | 'neutral' }[];
    chart: { title: string; bars: { label: string; value: number }[] };
    table: { title: string; head: string[]; rows: string[][] } | null;
    model?: string | null;
    aiError?: string | null;
  };
}

const AUD_LABEL: Record<string, string> = { dir: 'Direksi', spv: 'SPV', tim: 'Tim' };
const STEPS = ['Menghitung angka dari data CRM', 'Membandingkan dengan periode lalu', 'AI menulis ringkasan & temuan', 'Menyusun pratinjau'];

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'new' | 'hist'>('new');
  const openId = params.get('id');
  useEffect(() => {
    if (openId) setTab('new');
  }, [openId]);
  return (
    <Layout flush>
      <div className="tabs">
        <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>
          Buat laporan
        </button>
        <button className={tab === 'hist' ? 'on' : ''} onClick={() => setTab('hist')}>
          Riwayat &amp; terjadwal
        </button>
        <span className="spacer" />
        <span className="xs muted" style={{ alignSelf: 'center', paddingRight: 8 }}>
          Angka dihitung sistem · narasi &amp; rekomendasi ditulis AI
        </span>
      </div>
      <div className="content">
        {tab === 'new' ? (
          <NewReport openId={openId} onOpened={(id) => setParams(id ? { id } : {}, { replace: true })} />
        ) : (
          <History
            onOpen={(id) => {
              setParams({ id });
              setTab('new');
            }}
          />
        )}
      </div>
    </Layout>
  );
}

function NewReport({ openId, onOpened }: { openId: string | null; onOpened: (id: string | null) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: meta } = useQuery<Meta>({ queryKey: ['report-meta'], queryFn: () => api.get('/api/reports/meta') });
  const [type, setType] = useState('exec');
  const [period, setPeriod] = useState('last_month');
  const [aud, setAud] = useState('dir');
  const [fmt, setFmt] = useState<'pdf' | 'pptx'>('pdf');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const { data: report } = useQuery<Report>({ queryKey: ['report', openId], queryFn: () => api.get(`/api/reports/${openId}`), enabled: !!openId });

  const generate = async () => {
    setBusy(true);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600);
    try {
      const r = await api.post<Report>('/api/reports', { type, period, audience: aud, format: fmt, notes: notes || undefined });
      qc.setQueryData(['report', r.id], r);
      qc.invalidateQueries({ queryKey: ['reports'] });
      onOpened(r.id);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  };

  if (!meta) return <Loading />;
  const audNote = meta.audiences.find((a) => a.key === aud)?.style;
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', alignItems: 'start' }}>
      <Card title="Buat laporan dengan AI" sub="Pilih jenis, periode, dan format. AI menyusun ringkasan, temuan, dan rekomendasi dari data CRM.">
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div className="label" style={{ display: 'block', marginBottom: 6 }}>Jenis laporan</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {meta.types.map((t) => (
                <button key={t.key} className={`opt${type === t.key ? ' on' : ''}`} disabled={!t.available} onClick={() => setType(t.key)}>
                  <b>
                    {t.title}
                    {!t.available && <span className="pill warm" style={{ marginLeft: 6 }}>Fase 3</span>}
                  </b>
                  <span>{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label" style={{ display: 'block', marginBottom: 6 }}>Periode</div>
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {meta.periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="label" style={{ display: 'block', marginBottom: 6 }}>Untuk siapa</div>
            <Seg value={aud} options={meta.audiences.map((a) => [a.key, a.label] as [string, string])} onChange={setAud} />
            <div className="xs muted" style={{ marginTop: 6 }}>
              {audNote}
            </div>
          </div>
          <div>
            <div className="label" style={{ display: 'block', marginBottom: 6 }}>Format utama</div>
            <div className="grid grid-2" style={{ gap: 6 }}>
              {(
                [
                  ['pdf', 'PDF', 'Dokumen 2–3 halaman, siap cetak / kirim'],
                  ['pptx', 'Slides', '5 slide 16:9, unduh .pptx'],
                ] as const
              ).map(([k, t, d]) => (
                <button key={k} className={`opt${fmt === k ? ' on' : ''}`} onClick={() => setFmt(k)}>
                  <b>{t}</b>
                  <span>{d}</span>
                </button>
              ))}
            </div>
          </div>
          <Field label="Catatan untuk AI (opsional)">
            <textarea className="input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="mis. fokuskan ke penurunan lead wedding & ide perbaikannya" />
          </Field>
          <button className="btn primary" disabled={busy || !meta.types.find((t) => t.key === type)?.available} onClick={generate}>
            {busy ? 'Menyusun…' : report ? '✷ Buat laporan baru' : '✷ Buat laporan dengan AI'}
          </button>
          <div className="xs muted">
            {meta.aiAvailable ? `Narasi oleh ${meta.smartModel} · perkiraan ±Rp 1.000 per laporan · ±20 detik` : 'AI belum aktif / API key belum dipasang — laporan tetap dibuat dengan narasi dari sistem.'}
          </div>
        </div>
      </Card>

      <div>
        {busy ? (
          <Card>
            <b>{meta.aiAvailable ? 'AI sedang menyusun laporan…' : 'Menyusun laporan…'}</b>
            <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
              {STEPS.map((s, i) => (
                <span key={s} className="small" style={{ color: i <= step ? 'var(--text-heading)' : 'var(--text-muted)' }}>
                  {i < step ? '✓' : i === step ? '…' : '○'} {s}
                </span>
              ))}
            </div>
          </Card>
        ) : openId && !report ? (
          <Loading />
        ) : report ? (
          <Preview report={report} onRegen={generate} />
        ) : (
          <div className="card" style={{ minHeight: 360, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 28 }}>▤</div>
              <b>Pratinjau laporan muncul di sini</b>
              <div className="small muted" style={{ maxWidth: 360, marginTop: 6 }}>
                Pilih jenis laporan di kiri lalu klik Buat. Hasilnya bisa diedit sebelum diunduh sebagai PDF atau PowerPoint.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Preview({ report: r, onRegen }: { report: Report; onRegen: () => void }) {
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<'pdf' | 'pptx'>(r.format);
  const [edit, setEdit] = useState<Narrative | null>(null);
  useEffect(() => {
    setView(r.format);
    setEdit(null);
  }, [r.id, r.format]);
  const canEdit = me.user.role === 'admin' || r.createdBy === me.user.id;
  const save = async () => {
    if (!edit) return;
    const clean = { summary: edit.summary.trim(), findings: edit.findings.map((x) => x.trim()).filter(Boolean), recommendations: edit.recommendations.map((x) => x.trim()).filter(Boolean) };
    try {
      await api.patch(`/api/reports/${r.id}`, clean);
      qc.setQueryData(['report', r.id], { ...r, narrative: clean });
      setEdit(null);
      toast('Narasi disimpan — file unduhan ikut berubah');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const nar = r.narrative;
  const meta = `${r.periodLabel} · untuk ${AUD_LABEL[r.audience] ?? r.audience}`;
  const max = Math.max(1, ...r.data.chart.bars.map((b) => b.value));
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <b>{r.title}</b>
        <div className="xs muted">
          {meta} · {dateTime(r.createdAt)} · {r.aiUsed ? `narasi AI${r.data.model ? ` (${r.data.model})` : ''}` : 'narasi sistem'}
        </div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Seg value={view} options={[['pdf', 'Dokumen'], ['pptx', 'Slides']]} onChange={setView} />
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onRegen}>
          ↻ Buat ulang
        </button>
        {canEdit && !edit && (
          <button className="btn sm" onClick={() => setEdit(structuredClone(nar))}>
            ✎ Edit narasi
          </button>
        )}
        <a className="btn sm" href={`/api/reports/${r.id}/file.pdf`}>
          ⬇ PDF
        </a>
        <a className="btn primary sm" href={`/api/reports/${r.id}/file.pptx`}>
          ⬇ Slides (.pptx)
        </a>
      </div>
      {!r.aiUsed && r.data.aiError && <div className="banner">Narasi ditulis sistem dari angka. {r.data.aiError}</div>}

      {edit ? (
        <Card title="Edit narasi" sub="Angka tidak bisa diubah — hanya kalimatnya." actions={<div className="row" style={{ gap: 6 }}><button className="btn ghost sm" onClick={() => setEdit(null)}>Batal</button><button className="btn primary sm" onClick={save}>Simpan</button></div>}>
          <Field label="Ringkasan eksekutif">
            <textarea className="input" rows={4} value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} />
          </Field>
          {(['findings', 'recommendations'] as const).map((k) => (
            <Field key={k} label={k === 'findings' ? 'Temuan' : 'Rekomendasi'}>
              <div style={{ display: 'grid', gap: 6 }}>
                {edit[k].map((v, i) => (
                  <div key={i} className="row" style={{ gap: 6 }}>
                    <input className="input" value={v} onChange={(e) => setEdit({ ...edit, [k]: edit[k].map((x, j) => (j === i ? e.target.value : x)) })} />
                    <button className="btn ghost sm" onClick={() => setEdit({ ...edit, [k]: edit[k].filter((_, j) => j !== i) })} aria-label="Hapus">
                      ✕
                    </button>
                  </div>
                ))}
                {edit[k].length < 6 && (
                  <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setEdit({ ...edit, [k]: [...edit[k], ''] })}>
                    + Tambah
                  </button>
                )}
              </div>
            </Field>
          ))}
        </Card>
      ) : view === 'pdf' ? (
        <div className="report-doc">
          <div className="report-doc-head">
            <div className="xs muted">Sonokembang Catering</div>
            <div className="report-doc-title">{r.title}</div>
            <div className="small muted">{meta}</div>
          </div>
          <div className="report-label">{r.aiUsed ? 'Ringkasan eksekutif · ditulis AI' : 'Ringkasan eksekutif'}</div>
          <p style={{ margin: '0 0 16px', lineHeight: 1.6 }}>{nar.summary}</p>
          <div className="grid grid-4" style={{ gap: 10, marginBottom: 18 }}>
            {r.data.kpis.map((k) => (
              <div key={k.label} className="report-kpi">
                <div className="stat-k">{k.label}</div>
                <div className="report-kpi-v">{k.value}</div>
                <div className="xs" style={{ color: k.tone === 'good' ? 'var(--olive-700, #46701a)' : k.tone === 'bad' ? 'var(--red-700)' : 'var(--text-muted)' }}>
                  {k.note}
                </div>
              </div>
            ))}
          </div>
          {r.data.chart.bars.length > 0 && (
            <>
              <div className="report-label">{r.data.chart.title}</div>
              <div style={{ marginBottom: 18 }}>
                {r.data.chart.bars.map((b) => (
                  <div key={b.label} className="hbar-row" style={{ gridTemplateColumns: '150px minmax(0,1fr) 70px' }}>
                    <span className="small ellipsis">{b.label}</span>
                    <div className="hbar-track">
                      <span style={{ width: `${(b.value / max) * 100}%`, background: SERIES.rose }} />
                    </div>
                    <b className="small tnum" style={{ textAlign: 'right' }}>
                      {b.value.toLocaleString('id-ID')}
                    </b>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="grid grid-2" style={{ gap: 18 }}>
            <div>
              <div className="report-label">Temuan</div>
              {nar.findings.map((f, i) => (
                <div key={i} className="small" style={{ marginBottom: 6, lineHeight: 1.55 }}>
                  • {f}
                </div>
              ))}
            </div>
            <div>
              <div className="report-label">Rekomendasi</div>
              {nar.recommendations.map((f, i) => (
                <div key={i} className="small" style={{ marginBottom: 6, lineHeight: 1.55 }}>
                  {i + 1}. {f}
                </div>
              ))}
            </div>
          </div>
          {r.data.table && r.data.table.rows.length > 0 && (
            <>
              <div className="report-label" style={{ marginTop: 14 }}>
                {r.data.table.title}
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {r.data.table.head.map((h, i) => (
                        <th key={h} style={{ textAlign: i ? 'right' : 'left' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.table.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((c, j) => (
                          <td key={j} className={j ? 'tnum' : ''} style={{ textAlign: j ? 'right' : 'left' }}>
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-2" style={{ gap: 12 }}>
          {[
            { kicker: 'Sonokembang Catering', title: `${r.title} — ${r.periodLabel}`, lines: [`Untuk: ${AUD_LABEL[r.audience] ?? r.audience}`], cover: true },
            { kicker: 'Ringkasan', title: 'Inti periode ini', lines: [nar.summary] },
            { kicker: 'Angka utama', title: `${r.data.kpis.length} angka yang perlu diingat`, lines: r.data.kpis.map((k) => `${k.label}: ${k.value} (${k.note})`) },
            { kicker: 'Temuan', title: 'Apa yang terjadi', lines: nar.findings.map((f) => `• ${f}`) },
            { kicker: 'Rekomendasi', title: 'Keputusan yang diusulkan', lines: nar.recommendations.map((f, i) => `${i + 1}. ${f}`) },
          ].map((s, i) => (
            <div key={i}>
              <div className={`slide${s.cover ? ' cover' : ''}`}>
                <div className="slide-kicker">{s.kicker}</div>
                <div className="slide-title">{s.title}</div>
                {s.lines.map((l, j) => (
                  <div key={j} className="slide-line">
                    {l}
                  </div>
                ))}
              </div>
              <div className="xs muted" style={{ marginTop: 4 }}>
                Slide {i + 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: list } = useQuery<any[]>({ queryKey: ['reports'], queryFn: () => api.get('/api/reports') });
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <ReportSchedulesCard />
      <Card title="Riwayat laporan" sub="Semua laporan tersimpan dan bisa diunduh ulang. File dibuat dari narasi terbaru (termasuk hasil edit).">
        {!list ? (
          <Loading />
        ) : !list.length ? (
          <Empty>Belum ada laporan.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Laporan</th>
                  <th>Periode</th>
                  <th>Narasi</th>
                  <th>Oleh</th>
                  <th>Dibuat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
                    <td>
                      <b>{r.title}</b>
                      <div className="xs muted">untuk {AUD_LABEL[r.audience]}</div>
                    </td>
                    <td className="small">{r.periodLabel}</td>
                    <td>
                      <span className={`pill ${r.aiUsed ? 'ai' : ''}`}>{r.aiUsed ? 'AI' : 'Sistem'}</span>
                    </td>
                    <td className="small">{r.by}</td>
                    <td className="small muted nowrap">{dateTime(r.createdAt)}</td>
                    <td className="nowrap" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <a className="btn ghost sm" href={`/api/reports/${r.id}/file.pdf`}>
                        ⬇ PDF
                      </a>
                      <a className="btn ghost sm" href={`/api/reports/${r.id}/file.pptx`}>
                        ⬇ PPTX
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Daftar & pengaturan laporan terjadwal — dipakai di Reports dan Pengaturan › Pengiriman laporan. */
export function ReportSchedulesCard() {
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: sched } = useQuery<any[]>({ queryKey: ['report-schedules'], queryFn: () => api.get('/api/report-schedules') });
  const [form, setForm] = useState<any>(null);
  const manage = isRole(me, 'admin', 'spv');
  const refresh = () => qc.invalidateQueries({ queryKey: ['report-schedules'] });
  const toggle = async (s: any) => {
    try {
      await api.patch(`/api/report-schedules/${s.id}`, { active: !s.active });
      refresh();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const runNow = async (s: any) => {
    try {
      const r = await api.post<{ reportId: string; notified: number; emailed: number }>(`/api/report-schedules/${s.id}/run`);
      toast(`Laporan dibuat · ${r.notified} penerima diberi notifikasi${r.emailed ? ` · ${r.emailed} email terkirim` : ''}`);
      qc.invalidateQueries({ queryKey: ['reports'] });
      refresh();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async (s: any) => {
    if (!confirm(`Hapus jadwal "${s.title}"?`)) return;
    await api.del(`/api/report-schedules/${s.id}`);
    refresh();
  };
  return (
    <>
      <Card
        title="Laporan terjadwal"
        sub="Dibuat otomatis untuk periode yang baru selesai (bulanan → bulan lalu, mingguan → minggu lalu), lalu dikirim ke penerima: notifikasi + push di CRM, dan email berlampiran bila SMTP aktif."
        actions={
          manage && (
            <button className="btn sm" onClick={() => setForm({ type: 'exec', audience: 'dir', format: 'pdf', frequency: 'monthly', dayOfMonth: 1, dayOfWeek: 1, time: '07:00', recipientIds: [] })}>
              + Jadwal baru
            </button>
          )
        }
      >
        {!sched ? (
          <Loading />
        ) : !sched.length ? (
          <Empty>Belum ada jadwal. Contoh: Ringkasan direksi tiap tanggal 1 jam 07.00 ke Admin.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Laporan</th>
                  <th>Jadwal</th>
                  <th>Format</th>
                  <th>Dikirim ke</th>
                  <th>Terakhir</th>
                  <th>Aktif</th>
                  {manage && <th />}
                </tr>
              </thead>
              <tbody>
                {sched.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.title}</b>
                      <div className="xs muted">untuk {AUD_LABEL[s.audience]}</div>
                    </td>
                    <td className="small">{s.when}</td>
                    <td className="small">{s.format === 'pptx' ? 'Slides' : 'PDF'}</td>
                    <td className="small">{s.recipients.join(', ')}</td>
                    <td className="small muted">{s.lastRunAt ? dateTime(s.lastRunAt) : '—'}</td>
                    <td>
                      <Switch on={s.active} onChange={manage ? () => toggle(s) : undefined} disabled={!manage} />
                    </td>
                    {manage && (
                      <td className="nowrap" style={{ textAlign: 'right' }}>
                        <button className="btn ghost sm" onClick={() => runNow(s)}>
                          Kirim sekarang
                        </button>
                        <button className="btn ghost sm" onClick={() => setForm({ ...s })}>
                          Ubah
                        </button>
                        <button className="btn ghost sm" onClick={() => remove(s)}>
                          Hapus
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {form && <ScheduleModal init={form} onClose={() => setForm(null)} onSaved={refresh} />}
    </>
  );
}

function ScheduleModal({ init, onClose, onSaved }: { init: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: meta } = useQuery<Meta>({ queryKey: ['report-meta'], queryFn: () => api.get('/api/reports/meta') });
  const { data: people } = useQuery<{ id: string; name: string; role: string }[]>({ queryKey: ['user-options'], queryFn: () => api.get('/api/users/options') });
  const [v, setV] = useState(init);
  const save = async () => {
    const body = { type: v.type, audience: v.audience, format: v.format, frequency: v.frequency, dayOfMonth: Number(v.dayOfMonth), dayOfWeek: Number(v.dayOfWeek), time: v.time, recipientIds: v.recipientIds, active: v.active ?? true };
    try {
      if (init.id) await api.patch(`/api/report-schedules/${init.id}`, body);
      else await api.post('/api/report-schedules', body);
      toast('Jadwal disimpan');
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const toggleR = (id: string) => setV({ ...v, recipientIds: v.recipientIds.includes(id) ? v.recipientIds.filter((x: string) => x !== id) : [...v.recipientIds, id] });
  return (
    <Modal title={init.id ? 'Ubah jadwal laporan' : 'Jadwal laporan baru'} onClose={onClose} footer={<button className="btn primary" disabled={!v.recipientIds.length} onClick={save}>Simpan jadwal</button>}>
      {!meta || !people ? (
        <Loading />
      ) : (
        <div className="form-grid">
          <Field label="Jenis laporan" full>
            <select className="input" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
              {meta.types
                .filter((t) => t.available)
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Untuk siapa">
            <select className="input" value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })}>
              {meta.audiences.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Format lampiran">
            <select className="input" value={v.format} onChange={(e) => setV({ ...v, format: e.target.value })}>
              <option value="pdf">PDF</option>
              <option value="pptx">Slides (.pptx)</option>
            </select>
          </Field>
          <Field label="Frekuensi">
            <select className="input" value={v.frequency} onChange={(e) => setV({ ...v, frequency: e.target.value })}>
              <option value="monthly">Bulanan (isi: bulan lalu)</option>
              <option value="weekly">Mingguan (isi: minggu lalu)</option>
            </select>
          </Field>
          {v.frequency === 'monthly' ? (
            <Field label="Tanggal" hint="Bila bulan lebih pendek, dikirim di hari terakhir bulan itu.">
              <input className="input" type="number" min={1} max={31} value={v.dayOfMonth} onChange={(e) => setV({ ...v, dayOfMonth: e.target.value })} />
            </Field>
          ) : (
            <Field label="Hari">
              <select className="input" value={v.dayOfWeek} onChange={(e) => setV({ ...v, dayOfWeek: e.target.value })}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Jam (WIB)">
            <input className="input" type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />
          </Field>
          <div className="field full">
            <span>Penerima</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {people
                .filter((p) => p.role !== 'sales')
                .map((p) => (
                  <button key={p.id} className={`chip${v.recipientIds.includes(p.id) ? ' on' : ''}`} onClick={() => toggleR(p.id)}>
                    {p.name}
                  </button>
                ))}
            </div>
            <span className="hint">Penerima mendapat notifikasi &amp; push di CRM; email berlampiran bila SMTP sudah diatur.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
