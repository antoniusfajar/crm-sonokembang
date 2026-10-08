import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../api';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Loading, Switch, useToast } from '../components/ui';
import { dateTime, relative } from '../format';

interface FormField {
  key: string;
  label: string;
  type: 'text' | 'phone' | 'email' | 'number' | 'date' | 'select' | 'textarea';
  required: boolean;
  options?: string[];
  mapTo: string | null;
}
interface FormRow {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'draft' | 'archived';
  purpose: 'lead' | 'other';
  fields: FormField[];
  sourceId: string | null;
  sourceName?: string | null;
  settings: { title?: string; intro?: string; thankYou?: string; submitLabel?: string; notifyUserIds?: string[]; createTask?: boolean; waTemplate?: string | null; destination?: string };
  stats?: { submissions: number; leads: number; closings: number; last: string | null };
  updatedAt: string;
}

const TYPES: [FormField['type'], string][] = [
  ['text', 'Teks'],
  ['phone', 'Telepon / WA'],
  ['email', 'Email'],
  ['number', 'Angka'],
  ['date', 'Tanggal'],
  ['select', 'Pilihan'],
  ['textarea', 'Teks panjang'],
];
const keyOf = (label: string, taken: string[]) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'field';
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base}_${i}`;
  return k;
};

export function FormsPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  return <Layout>{id ? <FormEditor id={id} onBack={() => setParams({})} /> : <FormList onOpen={(x) => setParams({ id: x })} />}</Layout>;
}

function FormList({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<{ rows: FormRow[]; publicBase: string }>({ queryKey: ['forms'], queryFn: () => api.get('/api/forms') });
  const create = async (body: unknown) => {
    try {
      const f = await api.post<FormRow>('/api/forms', body);
      qc.invalidateQueries({ queryKey: ['forms'] });
      onOpen(f.id);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const toggle = async (f: FormRow) => {
    try {
      await api.put(`/api/forms/${f.id}`, { ...f, status: f.status === 'active' ? 'draft' : 'active' });
      qc.invalidateQueries({ queryKey: ['forms'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  if (!data) return <Loading />;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card
        title={`Daftar form · ${data.rows.length}`}
        sub='Hanya form bertujuan "Jadikan lead" yang ikut dihitung di KPI dan laporan sumber. Nomor WhatsApp jadi kunci — kiriman dari nomor yang masih punya lead terbuka digabung ke lead itu.'
        actions={
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => create({ preset: 'consultation' })}>
              Contoh: Form Konsultasi
            </button>
            <button
              className="btn primary sm"
              onClick={() =>
                create({ name: `Form baru ${new Date().toLocaleDateString('id-ID')}`, purpose: 'lead', fields: [{ key: 'nama', label: 'Nama', type: 'text', required: true, mapTo: 'name' }, { key: 'wa', label: 'Nomor WhatsApp', type: 'phone', required: true, mapTo: 'phone' }] })
              }
            >
              ＋ Buat form baru
            </button>
          </div>
        }
      >
        {!data.rows.length ? (
          <Empty>Belum ada form. Mulai dari "Contoh: Form Konsultasi" — tinggal diaktifkan dan dipasang di website.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Form</th>
                  <th>Aktif</th>
                  <th style={{ textAlign: 'right' }}>Kiriman</th>
                  <th style={{ textAlign: 'right' }}>Jadi lead</th>
                  <th style={{ textAlign: 'right' }}>Closing</th>
                  <th>Terakhir</th>
                  <th>Tujuan data</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <b>{f.name}</b>
                      <div className="xs muted mono">/f/{f.slug}</div>
                    </td>
                    <td>
                      <Switch on={f.status === 'active'} onChange={() => toggle(f)} />
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {f.stats?.submissions ?? 0}
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {f.purpose === 'lead' ? `${f.stats?.leads ?? 0}${f.stats?.submissions ? ` · ${Math.round(((f.stats?.leads ?? 0) / f.stats.submissions) * 100)}%` : ''}` : '—'}
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {f.purpose === 'lead' ? (f.stats?.closings ?? 0) : '—'}
                    </td>
                    <td className="small muted">{f.stats?.last ? relative(f.stats.last) : '—'}</td>
                    <td className="small">{f.purpose === 'lead' ? `Lead baru${f.sourceName ? ` · sumber ${f.sourceName}` : ' · sumber Website'}${f.settings.waTemplate ? ' + WA otomatis' : ''}` : (f.settings.destination || 'Tidak dibuat lead')}</td>
                    <td>
                      <button className="btn ghost sm" onClick={() => onOpen(f.id)}>
                        Edit
                      </button>
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

function FormEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<FormRow & { submissions: any[] }>({ queryKey: ['form', id], queryFn: () => api.get(`/api/forms/${id}`) });
  const { data: list } = useQuery<{ rows: FormRow[]; publicBase: string; mapTargets: [string, string][] }>({ queryKey: ['forms'], queryFn: () => api.get('/api/forms') });
  const { data: sources } = useQuery<any[]>({ queryKey: ['sources'], queryFn: () => api.get('/api/sources') });
  const { data: templates } = useQuery<any[]>({ queryKey: ['wa-templates'], queryFn: () => api.get('/api/wa-templates') });
  const { data: people } = useQuery<any[]>({ queryKey: ['forms-users'], queryFn: () => api.get('/api/forms-meta/users') });
  const [f, setF] = useState<FormRow | null>(null);
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (data) setF(structuredClone(data));
  }, [data]);
  const url = f && list ? `${list.publicBase}/f/${f.slug}` : '';
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [url]);
  if (!f || !data || !list || !sources || !templates || !people) return <Loading />;

  const setField = (i: number, patch: Partial<FormField>) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, d: number) => {
    const arr = [...f.fields];
    const [x] = arr.splice(i, 1);
    arr.splice(i + d, 0, x!);
    setF({ ...f, fields: arr });
  };
  const save = async () => {
    try {
      const saved = await api.put<FormRow>(`/api/forms/${id}`, { name: f.name, slug: f.slug, status: f.status, purpose: f.purpose, fields: f.fields, sourceId: f.sourceId, settings: f.settings });
      setF({ ...f, slug: saved.slug });
      qc.invalidateQueries({ queryKey: ['forms'] });
      qc.invalidateQueries({ queryKey: ['form', id] });
      toast('Form disimpan');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async () => {
    if (!confirm(`Hapus form "${f.name}" beserta riwayat kirimannya?`)) return;
    try {
      await api.del(`/api/forms/${id}`);
      qc.invalidateQueries({ queryKey: ['forms'] });
      onBack();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast('Disalin'));
  const iframe = `<iframe src="${url}?page=NAMA-HALAMAN" style="width:100%;max-width:560px;height:760px;border:0" title="${f.name}"></iframe>`;
  const usedMaps = f.fields.map((x) => x.mapTo).filter(Boolean);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn ghost sm" onClick={onBack}>
          ← Daftar form
        </button>
        <span className={`pill ${f.status === 'active' ? 'olive' : ''}`}>{f.status === 'active' ? 'Aktif' : f.status === 'draft' ? 'Draf' : 'Diarsipkan'}</span>
        <span className="spacer" />
        <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">
          Pratinjau ↗
        </a>
        <button className="btn ghost sm" onClick={remove}>
          Hapus
        </button>
        <button className="btn primary sm" onClick={save}>
          Simpan form
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card title="Pengaturan form">
            <div className="form-grid">
              <Field label="Nama form">
                <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field label="Alamat (slug)" hint={`${list.publicBase}/f/…`}>
                <input className="input mono" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
              </Field>
              <Field label="Status">
                <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as any })}>
                  <option value="active">Aktif (bisa diisi)</option>
                  <option value="draft">Draf (tertutup)</option>
                  <option value="archived">Diarsipkan</option>
                </select>
              </Field>
              <Field label="Tujuan data">
                <select className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value as any })}>
                  <option value="lead">Jadikan lead (masuk pipeline & KPI)</option>
                  <option value="other">Bukan lead (vendor, karier, dll.)</option>
                </select>
              </Field>
              {f.purpose === 'lead' && (
                <Field label="Sumber lead" hint="Kosong = Website. Pilih Pameran untuk QR di booth.">
                  <select className="input" value={f.sourceId ?? ''} onChange={(e) => setF({ ...f, sourceId: e.target.value || null })}>
                    <option value="">Website (bawaan)</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {f.purpose === 'other' && (
                <Field label="Dipakai untuk">
                  <input className="input" value={f.settings.destination ?? ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, destination: e.target.value } })} placeholder="mis. Rekap vendor untuk tim marketing" />
                </Field>
              )}
              <Field label="Judul di halaman" full>
                <input className="input" value={f.settings.title ?? ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, title: e.target.value } })} placeholder={f.name} />
              </Field>
              <Field label="Kalimat pembuka" full>
                <textarea className="input" rows={2} value={f.settings.intro ?? ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, intro: e.target.value } })} />
              </Field>
              <Field label="Teks tombol">
                <input className="input" value={f.settings.submitLabel ?? ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, submitLabel: e.target.value } })} placeholder="Kirim" />
              </Field>
              <Field label="Pesan setelah terkirim">
                <input className="input" value={f.settings.thankYou ?? ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, thankYou: e.target.value } })} placeholder="Terima kasih! Tim kami akan menghubungi Anda lewat WhatsApp." />
              </Field>
            </div>
          </Card>

          <Card
            title="Susunan field"
            sub='"Dipetakan ke" menentukan data lead mana yang langsung terisi — inilah yang membuat skor lead terhitung tanpa AI bertanya ulang.'
            actions={
              <button className="btn sm" onClick={() => setF({ ...f, fields: [...f.fields, { key: keyOf('field baru', f.fields.map((x) => x.key)), label: 'Field baru', type: 'text', required: false, mapTo: null }] })}>
                ＋ Tambah field
              </button>
            }
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Tipe</th>
                    <th>Dipetakan ke</th>
                    <th>Wajib</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {f.fields.map((x, i) => (
                    <tr key={x.key}>
                      <td style={{ minWidth: 180 }}>
                        <input className="input sm" value={x.label} onChange={(e) => setField(i, { label: e.target.value })} />
                        {x.type === 'select' && (
                          <input className="input sm" style={{ marginTop: 4 }} value={(x.options ?? []).join(', ')} onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} placeholder="Pilihan, pisahkan dengan koma" />
                        )}
                      </td>
                      <td>
                        <select className="input sm" style={{ minWidth: 130 }} value={x.type} onChange={(e) => setField(i, { type: e.target.value as any })}>
                          {TYPES.map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select className="input sm" style={{ minWidth: 180 }} value={x.mapTo ?? ''} onChange={(e) => setField(i, { mapTo: e.target.value || null })}>
                          <option value="">— tidak dipetakan —</option>
                          {list.mapTargets.map(([k, l]) => (
                            <option key={k} value={k} disabled={usedMaps.includes(k) && x.mapTo !== k}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Switch on={x.required} onChange={(v) => setField(i, { required: v })} />
                      </td>
                      <td className="nowrap">
                        <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Naikkan">
                          ↑
                        </button>
                        <button className="btn ghost sm" disabled={i === f.fields.length - 1} onClick={() => move(i, 1)} aria-label="Turunkan">
                          ↓
                        </button>
                        <button className="btn ghost sm" onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })} aria-label="Hapus field">
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Otomasi setelah submit">
            {f.purpose === 'lead' && (
              <>
                <div className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ flex: 1 }}>
                    <b className="small">Tugas "Hubungi dalam 15 menit" untuk sales</b>
                    <div className="xs muted">Hitung mundur respons dimulai saat submit, bukan saat dibuka. Sales dipilih lewat Distribusi lead.</div>
                  </div>
                  <Switch on={f.settings.createTask ?? true} onChange={(v) => setF({ ...f, settings: { ...f.settings, createTask: v } })} />
                </div>
                <div className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ flex: 1 }}>
                    <b className="small">Kirim WhatsApp otomatis</b>
                    <div className="xs muted">Template dikirim ke nomor pengisi dengan nama depannya. {'{{1}}'} = nama pengisi, {'{{2}}'} = nama sales.</div>
                  </div>
                  <select className="input sm" style={{ width: 200 }} value={f.settings.waTemplate ?? ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, waTemplate: e.target.value || null } })}>
                    <option value="">Tidak dikirim</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <b className="small">Beri notifikasi ke</b>
              <div className="xs muted" style={{ marginBottom: 6 }}>
                {f.purpose === 'lead' ? 'Sales pemilik lead selalu diberi notifikasi. Tambahkan orang lain bila perlu.' : 'Orang yang menerima notifikasi setiap ada kiriman.'}
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {people.map((p) => {
                  const on = f.settings.notifyUserIds?.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      className={`chip${on ? ' on' : ''}`}
                      onClick={() => setF({ ...f, settings: { ...f.settings, notifyUserIds: on ? f.settings.notifyUserIds!.filter((x) => x !== p.id) : [...(f.settings.notifyUserIds ?? []), p.id] } })}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <Card title="Pasang di mana saja" sub="Form yang sama bisa dibuka lewat link, disematkan di website, atau QR di booth pameran. Simpan dulu bila mengubah alamat.">
            <Field label="Link langsung">
              <div className="row" style={{ gap: 6 }}>
                <input className="input sm mono" readOnly value={url} />
                <button className="btn sm" onClick={() => copy(url)}>
                  Salin
                </button>
              </div>
            </Field>
            <Field label="Sematkan di website (iframe)" hint="Ganti NAMA-HALAMAN supaya laporan tahu form diisi dari halaman mana.">
              <textarea className="input sm mono" rows={3} readOnly value={iframe} />
              <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => copy(iframe)}>
                Salin kode
              </button>
            </Field>
            {qr && (
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <img src={qr} alt={`QR ${f.name}`} width={180} height={180} />
                <div>
                  <a className="btn ghost sm" href={qr} download={`qr-${f.slug}.png`}>
                    ⬇ Unduh QR
                  </a>
                </div>
              </div>
            )}
          </Card>
          <Card title={`Kiriman terbaru · ${data.submissions.length}`} actions={<a className="btn ghost sm" href={`/api/forms/${id}/export.csv`}>Ekspor CSV</a>}>
            {!data.submissions.length ? (
              <Empty>Belum ada kiriman.</Empty>
            ) : (
              data.submissions.slice(0, 15).map((s) => (
                <div key={s.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <b className="small" style={{ flex: 1 }}>
                      {s.data[f.fields.find((x) => x.mapTo === 'name')?.key ?? ''] ?? 'Tanpa nama'}
                    </b>
                    {s.leadId && (
                      <Link className="pill olive" to={`/leads/${s.leadId}`}>
                        {s.leadCode ?? 'Lead'}
                      </Link>
                    )}
                  </div>
                  <div className="xs muted">
                    {dateTime(s.createdAt)}
                    {s.page ? ` · ${s.page.replace(/^https?:\/\//, '').slice(0, 40)}` : ''}
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
