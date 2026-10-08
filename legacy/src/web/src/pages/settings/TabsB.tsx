import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useMe } from '../../auth';
import { Card, Empty, Field, Loading, Modal, Switch, useToast } from '../../components/ui';
import { useSaveSetting, useSetting } from './TabsA';
import { ScoreCalibrationCard } from './TabsD';

// ---------- Sumber lead & link WA ----------
export function SourcesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any[]>({ queryKey: ['sources'], queryFn: () => api.get('/api/sources') });
  const { data: biz } = useSetting<any>('business_profile');
  const [edit, setEdit] = useState<any>(null);
  const hotline = (biz?.hotline || '62341XXXXXX').replace(/\D/g, '').replace(/^0/, '62');
  const save = async () => {
    try {
      const body = { name: edit.name, channel: edit.channel, refCode: edit.refCode || null, howRecorded: edit.howRecorded || null, offline: edit.offline, active: edit.active };
      if (edit.id) await api.patch(`/api/sources/${edit.id}`, body);
      else await api.post('/api/sources', body);
      toast('Sumber disimpan');
      qc.invalidateQueries({ queryKey: ['sources'] });
      setEdit(null);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="stack">
      <Card
        title="Bagaimana sumber lead tercatat"
        sub="Sumber ditentukan dari pesan pertama di chat — tidak diisi ulang oleh sales kecuali kanal offline. Satu nomor hotline, banyak link masuk."
        actions={<button className="btn primary sm" onClick={() => setEdit({ name: '', channel: '', refCode: '', howRecorded: '', offline: false, active: true })}>＋ Sumber baru</button>}
      >
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Sumber</th>
                  <th>Kanal</th>
                  <th>Link / penanda</th>
                  <th>Cara terekam</th>
                  <th>Aktif</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td className="bold">{s.name}</td>
                    <td>{s.channel}</td>
                    <td className="mono">{s.refCode ? `wa.me/${hotline}?text=${s.refCode}-{label}` : s.offline ? '— (diisi sales)' : '—'}</td>
                    <td className="small muted">{s.howRecorded}</td>
                    <td>{s.active ? '✓' : '—'}</td>
                    <td>
                      <button className="btn sm" onClick={() => setEdit({ ...s, refCode: s.refCode ?? '' })}>
                        Ubah
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="banner" style={{ marginTop: 12 }}>
          Kalau customer datang tanpa penanda apa pun, sumber diberi label "Tidak diketahui" dan wajib dikoreksi sales sebelum lead naik ke Proposal. Iklan click-to-WhatsApp dikenali otomatis dari data iklan Meta.
        </div>
      </Card>
      <Card title="Pembuat link WA per kanal" sub="Tempel link ini di bio IG, tombol website, atau QR pameran. Pesan pertama customer membawa penandanya.">
        <LinkBuilder sources={(data ?? []).filter((s) => s.refCode)} hotline={hotline} />
      </Card>
      {edit && (
        <Modal title={edit.id ? 'Ubah sumber' : 'Sumber baru'} onClose={() => setEdit(null)} footer={<button className="btn primary" onClick={save} disabled={!edit.name || !edit.channel}>Simpan</button>}>
          <div className="form-grid">
            <Field label="Nama sumber">
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Kanal">
              <input className="input" value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })} />
            </Field>
            <Field label="Kode penanda" hint="2–12 huruf/angka, mis. IGADS, WEB, EXPO. Kosongkan untuk kanal offline.">
              <input className="input mono" value={edit.refCode} onChange={(e) => setEdit({ ...edit, refCode: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Cara terekam">
              <input className="input" value={edit.howRecorded ?? ''} onChange={(e) => setEdit({ ...edit, howRecorded: e.target.value })} />
            </Field>
            <label className="row small">
              <Switch on={edit.offline} onChange={(v) => setEdit({ ...edit, offline: v })} /> Kanal offline (diisi sales)
            </label>
            <label className="row small">
              <Switch on={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} /> Aktif
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LinkBuilder({ sources, hotline }: { sources: any[]; hotline: string }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState('Halo Sonokembang, saya mau tanya paket catering');
  useEffect(() => {
    if (!code && sources[0]) setCode(sources[0].refCode);
  }, [sources, code]);
  const tag = `${code}${label ? '-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '') : ''}`;
  const link = `https://wa.me/${hotline}?text=${encodeURIComponent(`${msg} (${tag})`)}`;
  return (
    <div className="form-grid">
      <Field label="Sumber">
        <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>
          {sources.map((s) => (
            <option key={s.id} value={s.refCode}>
              {s.name} ({s.refCode})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Label campaign / halaman (opsional)" hint="mis. wisuda, skwedding2026">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Pesan pembuka" full>
        <input className="input" value={msg} onChange={(e) => setMsg(e.target.value)} />
      </Field>
      <div className="full row">
        <input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast('Link disalin'))}>
          Salin
        </button>
      </div>
    </div>
  );
}

// ---------- Distribusi lead ----------
export function DistributionTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any>({ queryKey: ['distribution'], queryFn: () => api.get('/api/distribution') });
  const [v, setV] = useState<any>(null);
  useEffect(() => data && setV(structuredClone(data)), [data]);
  if (!v) return <Loading />;
  const totalW = v.members.filter((m: any) => m.included && m.status === 'aktif').reduce((a: number, m: any) => a + Number(m.weight || 0), 0);
  const save = async () => {
    try {
      await api.put('/api/distribution', {
        method: v.method,
        rules: { ...v.rules, capCount: Number(v.rules.capCount) || 60 },
        members: v.members.map((m: any) => ({ id: m.id, weight: Number(m.weight) || 0, included: m.included })),
        specialRules: (v.specialRules ?? []).map((r: any) => ({ ...r, keywords: typeof r.keywords === 'string' ? r.keywords.split(',').map((k: string) => k.trim()).filter(Boolean) : r.keywords })),
      });
      toast('Distribusi disimpan');
      qc.invalidateQueries({ queryKey: ['distribution'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const rule = (k: string, t: string, d: string) => (
    <div className="row" style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1 }}>
        <div className="small bold">{t}</div>
        <div className="xs muted">{d}</div>
      </div>
      <Switch on={v.rules[k]} onChange={(on) => setV({ ...v, rules: { ...v.rules, [k]: on } })} />
    </div>
  );
  return (
    <div className="stack">
      <div className="banner info">
        Assignee ditetapkan <b>saat pesan pertama masuk</b>, walaupun AI yang membalas lebih dulu. Jadi sejak detik pertama sudah jelas lead ini tanggung jawab siapa.
      </div>
      <Card title="Metode distribusi" actions={<button className="btn primary sm" onClick={save}>Simpan</button>}>
        <div className="row wrap">
          {[
            ['weighted', 'Giliran berbobot', 'Porsi lead sesuai bobot tiap sales'],
            ['round_robin', 'Giliran rata', 'Semua sales dapat jatah sama'],
            ['manual', 'Manual oleh SPV', 'Lead masuk tanpa PIC, SPV yang menugaskan'],
          ].map(([k, t, d]) => (
            <button key={k} className="card" style={{ flex: 1, minWidth: 200, textAlign: 'left', cursor: 'pointer', borderColor: v.method === k ? 'var(--rose-400)' : undefined, background: v.method === k ? 'var(--rose-100)' : undefined }} onClick={() => setV({ ...v, method: k })}>
              <div className="bold small">{t}</div>
              <div className="xs muted">{d}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Assignee & bobot" sub="Sales berstatus cuti otomatis tidak ikut dibagi.">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Sales</th>
                <th>Ikut dibagi</th>
                <th>Bobot</th>
                <th>Porsi lead</th>
                <th>Lead bulan ini</th>
              </tr>
            </thead>
            <tbody>
              {v.members.map((m: any, i: number) => (
                <tr key={m.id} style={{ opacity: m.status === 'aktif' ? 1 : 0.5 }}>
                  <td>
                    <b>{m.name}</b> <span className="xs muted">{m.role === 'spv' ? 'SPV' : 'Sales'}{m.status !== 'aktif' ? ` · ${m.status}` : ''}</span>
                  </td>
                  <td>
                    <Switch on={m.included} onChange={(on) => setV({ ...v, members: v.members.map((x: any, j: number) => (j === i ? { ...x, included: on } : x)) })} />
                  </td>
                  <td>
                    <input className="input sm" style={{ width: 80 }} type="number" min={0} disabled={v.method !== 'weighted'} value={m.weight} onChange={(e) => setV({ ...v, members: v.members.map((x: any, j: number) => (j === i ? { ...x, weight: e.target.value } : x)) })} />
                  </td>
                  <td>{m.included && m.status === 'aktif' && totalW ? `${Math.round((Number(m.weight) / totalW) * 100)}%` : '—'}</td>
                  <td>{m.month}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!v.members.length && <Empty>Belum ada pengguna Sales/SPV. Tambahkan di tab Users.</Empty>}
        </div>
      </Card>
      <Card
        title="Aturan khusus per jenis acara"
        sub="Lead dengan jenis acara tertentu selalu ke sales tertentu. Dicek dari pesan pertama, lalu dicek lagi saat AI mengenali jenis acaranya — selama sales belum mulai menangani chat."
        actions={
          <button
            className="btn sm"
            onClick={() =>
              setV({
                ...v,
                specialRules: [
                  ...(v.specialRules ?? []),
                  { id: crypto.randomUUID(), label: (v.specialRules ?? []).length ? 'Aturan baru' : 'Lead korporat / kantin', keywords: (v.specialRules ?? []).length ? '' : 'kantin, nasi kotak harian, korporat, karyawan, catering kantor', userIds: [], active: true },
                ],
              })
            }
          >
            ＋ Tambah aturan
          </button>
        }
      >
        {!(v.specialRules ?? []).length && <div className="hint">Belum ada aturan khusus — semua lead mengikuti metode distribusi di atas.</div>}
        {(v.specialRules ?? []).map((r: any, i: number) => {
          const upd = (patch: any) => setV({ ...v, specialRules: v.specialRules.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={r.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <div className="row">
                <input className="input sm" style={{ maxWidth: 260 }} value={r.label} onChange={(e) => upd({ label: e.target.value })} />
                <span className="spacer" />
                <Switch on={r.active} onChange={(on) => upd({ active: on })} />
                <button className="btn sm danger" onClick={() => setV({ ...v, specialRules: v.specialRules.filter((_: any, j: number) => j !== i) })}>
                  ✕
                </button>
              </div>
              <Field label="Kata kunci jenis acara (pisahkan koma)">
                <input className="input sm" value={Array.isArray(r.keywords) ? r.keywords.join(', ') : r.keywords} onChange={(e) => upd({ keywords: e.target.value })} />
              </Field>
              <div className="label" style={{ margin: '8px 0 6px' }}>
                Sales tujuan
              </div>
              <div className="row wrap">
                {v.members.map((m: any) => (
                  <button key={m.id} className={`chip${r.userIds.includes(m.id) ? ' on' : ''}`} onClick={() => upd({ userIds: r.userIds.includes(m.id) ? r.userIds.filter((x: string) => x !== m.id) : [...r.userIds, m.id] })}>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </Card>
      <Card title="Aturan tambahan">
        {rule('sticky', 'Kontak lama kembali ke sales sebelumnya', 'Pelanggan repeat order otomatis ke PIC terakhirnya, bukan ikut giliran')}
        {rule('skipLeave', 'Lewati sales yang cuti', 'Status cuti diambil dari halaman Users')}
        <div className="row" style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ flex: 1 }}>
            <div className="small bold">Batas lead aktif per sales</div>
            <div className="xs muted">Kalau penuh, lead dialihkan ke sales berikutnya</div>
          </div>
          <input className="input sm" style={{ width: 80 }} type="number" value={v.rules.capCount} onChange={(e) => setV({ ...v, rules: { ...v.rules, capCount: e.target.value } })} />
          <Switch on={v.rules.cap} onChange={(on) => setV({ ...v, rules: { ...v.rules, cap: on } })} />
        </div>
        {rule('escalate', 'Alihkan otomatis di SLA level 3', 'Jika PIC tidak membalas sampai batas level 3, lead dialihkan ke sales lain yang aktif')}
      </Card>
    </div>
  );
}

// ---------- Custom field ----------
const TYPE_LABEL: Record<string, string> = { text: 'Teks', number: 'Angka', date: 'Tanggal', select: 'Pilihan', boolean: 'Ya/Tidak' };
export function FieldsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any[]>({ queryKey: ['custom-fields'], queryFn: () => api.get('/api/custom-fields') });
  const [scope, setScope] = useState<'lead' | 'contact'>('lead');
  const [nf, setNf] = useState({ name: '', type: 'text', options: '', required: false, aiFillable: false, showInTable: false });
  const rows = (data ?? []).filter((f) => f.entity === scope);
  const builtin =
    scope === 'lead'
      ? ['Jenis acara', 'Tanggal acara', 'Lokasi acara', 'Jumlah pax', 'Budget', 'Nilai potensi', 'Pipeline', 'Tahap', 'Sumber lead', 'PIC sales']
      : ['Nama', 'No. WhatsApp', 'Email', 'Perusahaan', 'Tipe kontak', 'Sumber pertama', 'PIC'];
  const add = async () => {
    try {
      await api.post('/api/custom-fields', { entity: scope, name: nf.name, type: nf.type, options: nf.options.split(',').map((x) => x.trim()).filter(Boolean), required: nf.required, aiFillable: nf.aiFillable, showInTable: nf.showInTable });
      setNf({ name: '', type: 'text', options: '', required: false, aiFillable: false, showInTable: false });
      qc.invalidateQueries({ queryKey: ['custom-fields'] });
      toast('Field ditambahkan');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const patch = async (f: any, b: any) => {
    await api.patch(`/api/custom-fields/${f.id}`, b);
    qc.invalidateQueries({ queryKey: ['custom-fields'] });
  };
  const del = async (f: any) => {
    if (!confirm(`Hapus field "${f.name}"? Data yang sudah terisi tidak ikut terhapus.`)) return;
    await api.del(`/api/custom-fields/${f.id}`);
    qc.invalidateQueries({ queryKey: ['custom-fields'] });
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)' }}>
      <Card title={scope === 'lead' ? 'Field lead' : 'Field kontak'} sub="Field bawaan tidak bisa dihapus. Field tambahan muncul di form & detail.">
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={scope === 'lead' ? 'on' : ''} onClick={() => setScope('lead')}>
            Lead
          </button>
          <button className={scope === 'contact' ? 'on' : ''} onClick={() => setScope('contact')}>
            Kontak
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Tipe</th>
                <th>Wajib</th>
                <th>Diisi AI</th>
                <th>Kolom tabel</th>
                <th>Asal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {builtin.map((b) => (
                <tr key={b} className="muted">
                  <td>{b}</td>
                  <td colSpan={4} />
                  <td>
                    <span className="pill outline">Bawaan</span>
                  </td>
                  <td />
                </tr>
              ))}
              {rows.map((f) => (
                <tr key={f.id}>
                  <td className="bold">
                    {f.name}
                    {f.options.length > 0 && <div className="xs muted">{f.options.join(', ')}</div>}
                  </td>
                  <td>{TYPE_LABEL[f.type]}</td>
                  <td>
                    <Switch on={f.required} onChange={(v) => patch(f, { required: v })} />
                  </td>
                  <td>
                    <Switch on={f.aiFillable} onChange={(v) => patch(f, { aiFillable: v })} />
                  </td>
                  <td>
                    <Switch on={f.showInTable} onChange={(v) => patch(f, { showInTable: v })} />
                  </td>
                  <td>
                    <span className="pill">Kustom</span>
                  </td>
                  <td>
                    <button className="btn sm danger" onClick={() => del(f)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Tambah custom field">
        <div className="stack">
          <Field label="Nama field">
            <input className="input" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
          </Field>
          <Field label="Tipe">
            <select className="input" value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value })}>
              {Object.entries(TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          {nf.type === 'select' && (
            <Field label="Pilihan (pisahkan dengan koma)">
              <input className="input" value={nf.options} onChange={(e) => setNf({ ...nf, options: e.target.value })} />
            </Field>
          )}
          <label className="row small">
            <Switch on={nf.required} onChange={(v) => setNf({ ...nf, required: v })} /> Wajib diisi
          </label>
          <label className="row small">
            <Switch on={nf.aiFillable} onChange={(v) => setNf({ ...nf, aiFillable: v })} /> Boleh diisi AI dari chat 🤖
          </label>
          {scope === 'lead' && (
            <label className="row small">
              <Switch on={nf.showInTable} onChange={(v) => setNf({ ...nf, showInTable: v })} /> Tampilkan sebagai kolom di tabel pipeline
            </label>
          )}
          <button className="btn primary" onClick={add} disabled={!nf.name}>
            Tambah field
          </button>
        </div>
      </Card>
    </div>
  );
}

// ---------- SLA, jam kerja, skor, pengingat ----------
export function KpiTab() {
  const me = useMe();
  const { data: sla } = useSetting<any>('sla');
  const { data: wh } = useSetting<any>('working_hours');
  const { data: score } = useSetting<any>('score_rules');
  const { data: rules } = useSetting<any[]>('reminder_rules');
  const { data: approval } = useSetting<any>('approval');
  const saveSla = useSaveSetting('sla');
  const saveWh = useSaveSetting('working_hours');
  const saveScore = useSaveSetting('score_rules');
  const saveRules = useSaveSetting('reminder_rules');
  const saveApproval = useSaveSetting('approval');
  const [s, setS] = useState<any>(null);
  const [w, setW] = useState<any>(null);
  const [sc, setSc] = useState<any>(null);
  const [ap, setAp] = useState<any>(null);
  useEffect(() => sla && setS(structuredClone(sla)), [sla]);
  useEffect(() => wh && setW(structuredClone(wh)), [wh]);
  useEffect(() => score && setSc(structuredClone(score)), [score]);
  useEffect(() => approval && setAp(structuredClone(approval)), [approval]);
  if (!s || !w || !sc || !ap || !rules) return <Loading />;
  const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const ro = me.user.role !== 'admin';
  return (
    <div className="grid grid-2">
      <Card title="Tangga eskalasi SLA" sub="Dihitung sejak serah terima AI → sales, hanya di jam kerja." actions={!ro && <button className="btn primary sm" onClick={() => saveSla({ levels: s.levels.map((l: any) => ({ ...l, minutes: Number(l.minutes) })) })}>Simpan</button>}>
        {s.levels.map((l: any, i: number) => (
          <div key={i} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <span className="avatar">{i + 1}</span>
            <input className="input sm" style={{ width: 80 }} type="number" value={l.minutes} onChange={(e) => setS({ levels: s.levels.map((x: any, j: number) => (j === i ? { ...x, minutes: e.target.value } : x)) })} />
            <span className="small">menit</span>
            <span className="small muted" style={{ flex: 1 }}>
              {l.label}
            </span>
          </div>
        ))}
      </Card>
      <Card title="Jam kerja" sub="Di luar jam, AI tetap menjawab dan hitungan SLA mulai saat jam buka." actions={!ro && <button className="btn primary sm" onClick={() => saveWh(w)}>Simpan</button>}>
        <div className="row">
          <Field label="Buka">
            <input className="input" type="time" value={w.start} onChange={(e) => setW({ ...w, start: e.target.value })} />
          </Field>
          <Field label="Tutup">
            <input className="input" type="time" value={w.end} onChange={(e) => setW({ ...w, end: e.target.value })} />
          </Field>
        </div>
        <div className="row wrap" style={{ marginTop: 12 }}>
          {DAYS.map((d, i) => (
            <button key={d} className={`chip${w.days.includes(i) ? ' on' : ''}`} onClick={() => setW({ ...w, days: w.days.includes(i) ? w.days.filter((x: number) => x !== i) : [...w.days, i] })}>
              {d}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Skor lead" sub="Poin per data kualifikasi. Rumus masih draft — kalibrasi setelah 1–2 bulan data." actions={!ro && <button className="btn primary sm" onClick={() => saveScore({ ...sc, hot: Number(sc.hot), warm: Number(sc.warm), points: Object.fromEntries(Object.entries(sc.points).map(([k, v]) => [k, Number(v)])) })}>Simpan</button>}>
        <div className="row">
          <Field label="Hot ≥">
            <input className="input" type="number" value={sc.hot} onChange={(e) => setSc({ ...sc, hot: e.target.value })} />
          </Field>
          <Field label="Warm ≥">
            <input className="input" type="number" value={sc.warm} onChange={(e) => setSc({ ...sc, warm: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-2" style={{ marginTop: 12, gap: 8 }}>
          {Object.entries({ eventType: 'Jenis acara', eventDate: 'Tanggal', location: 'Lokasi', pax: 'Pax', budget: 'Budget', paxLarge: 'Pax ≥ 300', budgetLarge: 'Budget ≥ 50 jt', dateSoon: 'Acara ≤ 90 hari' }).map(([k, l]) => (
            <label key={k} className="row small">
              <span style={{ flex: 1 }}>{l}</span>
              <input className="input sm" style={{ width: 64 }} type="number" value={sc.points[k]} onChange={(e) => setSc({ ...sc, points: { ...sc.points, [k]: e.target.value } })} />
            </label>
          ))}
        </div>
      </Card>
      <ScoreCalibrationCard hot={Number(sc.hot)} warm={Number(sc.warm)} ro={ro} onApply={(hot, warm) => setSc({ ...sc, hot, warm })} />
      <Card title="Aturan pengingat otomatis" sub="Membuat tugas di Tugas Hari Ini.">
        {rules.map((r: any) => (
          <div key={r.key} className="row" style={{ padding: '9px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ flex: 1 }}>
              <div className="small bold">{r.trigger}</div>
              <div className="xs muted">{r.action}</div>
            </div>
            <Switch disabled={ro} on={r.on} onChange={(on) => saveRules(rules.map((x: any) => (x.key === r.key ? { ...x, on } : x)))} />
          </div>
        ))}
      </Card>
      <Card title="Persetujuan diskon" actions={!ro && <button className="btn primary sm" onClick={() => saveApproval({ discountNeedsSpvAbove: Number(ap.discountNeedsSpvAbove) })}>Simpan</button>}>
        <label className="row small">
          Diskon di atas
          <input className="input sm" style={{ width: 70 }} type="number" value={ap.discountNeedsSpvAbove} onChange={(e) => setAp({ discountNeedsSpvAbove: e.target.value })} />% butuh persetujuan SPV
        </label>
      </Card>
    </div>
  );
}
