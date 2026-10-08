import { Fragment, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useMe } from '../../auth';
import { Card, Empty, Field, Loading, Modal, Switch, useToast } from '../../components/ui';
import { MENU_META } from '../../nav';
import { dateTime, initials, relative } from '../../format';

export function useSetting<T = any>(key: string) {
  return useQuery<T>({ queryKey: ['setting', key], queryFn: () => api.get(`/api/settings/${key}`) });
}

export function useSaveSetting(key: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return async (value: unknown) => {
    try {
      await api.put(`/api/settings/${key}`, value);
      toast('Pengaturan disimpan');
      qc.invalidateQueries({ queryKey: ['setting', key] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
}

// ---------- Profil bisnis ----------
export function ProfileTab() {
  const { data } = useSetting<any>('business_profile');
  const save = useSaveSetting('business_profile');
  const [v, setV] = useState<any>(null);
  useEffect(() => data && setV(structuredClone(data)), [data]);
  const qc = useQueryClient();
  const toast = useToast();
  if (!v) return <Loading />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('Ukuran logo maksimal 2 MB', true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post('/api/settings/logo', fd);
      setV({ ...v, logoPath: r.logo.split('v=')[1] });
      toast('Logo diganti');
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['setting', 'business_profile'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const removeLogo = async () => {
    await api.del('/api/settings/logo');
    setV({ ...v, logoPath: null });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <Card title="Profil bisnis" sub="Identitas usaha yang dipakai di header proposal PDF, tanda tangan pesan, dan halaman login." actions={<button className="btn primary sm" onClick={() => save(v)}>Simpan profil</button>}>
        <div className="row" style={{ marginBottom: 16, gap: 14 }}>
          <div className="brand-mark" style={{ width: 72, height: 72, borderRadius: 16, border: '1px solid var(--border-subtle)', fontSize: 22 }}>
            {v.logoPath ? <img src={`/api/public/logo?v=${encodeURIComponent(v.logoPath)}`} alt="Logo" /> : 'SK'}
          </div>
          <div>
            <label className="btn sm">
              Ganti logo
              <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </label>{' '}
            {v.logoPath && (
              <button className="btn sm danger" onClick={removeLogo}>
                Hapus
              </button>
            )}
            <div className="hint" style={{ marginTop: 6 }}>
              PNG/JPG, persegi, min. 512px, maks 2 MB. Dipakai di sidebar, halaman login, dan header proposal PDF.
            </div>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Nama usaha">
            <input className="input" value={v.name} onChange={set('name')} />
          </Field>
          <Field label="Tagline">
            <input className="input" value={v.tagline ?? ''} onChange={set('tagline')} />
          </Field>
          <Field label="Alamat kantor" full>
            <input className="input" value={v.address ?? ''} onChange={set('address')} />
          </Field>
          <Field label="Email">
            <input className="input" value={v.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label="Website">
            <input className="input" value={v.website ?? ''} onChange={set('website')} />
          </Field>
          <Field label="Hotline WhatsApp">
            <input className="input" value={v.hotline ?? ''} onChange={set('hotline')} />
          </Field>
        </div>
      </Card>
      <Card title="Cabang & kantor" actions={<button className="btn sm" onClick={() => setV({ ...v, branches: [...v.branches, { name: '', hotline: '', snippet: '', active: true }] })}>＋ Tambah cabang</button>}>
        {v.branches.map((b: any, i: number) => (
          <div key={i} className="row wrap" style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <input className="input sm" style={{ flex: 2, minWidth: 160 }} placeholder="Cabang" value={b.name} onChange={(e) => setV({ ...v, branches: v.branches.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input className="input sm" style={{ flex: 1, minWidth: 120 }} placeholder="Snippet lokasi (/sby)" value={b.snippet} onChange={(e) => setV({ ...v, branches: v.branches.map((x: any, j: number) => (j === i ? { ...x, snippet: e.target.value } : x)) })} />
            <input className="input sm" style={{ flex: 1, minWidth: 120 }} placeholder="Hotline" value={b.hotline} onChange={(e) => setV({ ...v, branches: v.branches.map((x: any, j: number) => (j === i ? { ...x, hotline: e.target.value } : x)) })} />
            <Switch on={b.active} onChange={(on) => setV({ ...v, branches: v.branches.map((x: any, j: number) => (j === i ? { ...x, active: on } : x)) })} />
            <button className="btn sm danger" onClick={() => setV({ ...v, branches: v.branches.filter((_: any, j: number) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
      </Card>
      <Card title="Rekening pembayaran DP" sub='Muncul otomatis di proposal ([no_rekening]).' actions={<button className="btn sm" onClick={() => setV({ ...v, bankAccounts: [...v.bankAccounts, { bank: '', number: '', holder: '' }] })}>＋ Tambah rekening</button>}>
        {v.bankAccounts.map((b: any, i: number) => (
          <div key={i} className="row wrap" style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
            {(['bank', 'number', 'holder'] as const).map((k) => (
              <input key={k} className="input sm" style={{ flex: 1, minWidth: 140 }} placeholder={{ bank: 'Bank', number: 'No. rekening', holder: 'Atas nama' }[k]} value={b[k]} onChange={(e) => setV({ ...v, bankAccounts: v.bankAccounts.map((x: any, j: number) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
            ))}
            <button className="btn sm danger" onClick={() => setV({ ...v, bankAccounts: v.bankAccounts.filter((_: any, j: number) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------- Peran & akses ----------
export function RolesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any>({ queryKey: ['roles'], queryFn: () => api.get('/api/roles') });
  const [roles, setRoles] = useState<any[] | null>(null);
  useEffect(() => data && setRoles(structuredClone(data.roles)), [data]);
  if (!data || !roles) return <Loading />;
  const set = (role: string, key: string, on: boolean) => setRoles(roles.map((r) => (r.role === role ? { ...r, menus: { ...r.menus, [key]: on } } : r)));
  const save = async () => {
    try {
      for (const r of roles) await api.put(`/api/roles/${r.role}`, { menus: r.menus, scope: r.scope });
      toast('Hak akses disimpan — langsung berlaku');
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const all = data.groups.flatMap((g: any) => g.items);
  return (
    <Card title="Peran & hak akses" sub="Nyalakan/matikan menu yang boleh dibuka tiap peran. Perubahan langsung berlaku setelah disimpan." actions={<button className="btn primary sm" onClick={save}>Simpan</button>}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Menu</th>
              {roles.map((r) => (
                <th key={r.role} style={{ textAlign: 'center' }}>
                  {r.label}
                  <div style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    {all.filter((i: any) => r.menus[i.key] ?? false).length}/{all.length} menu
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.groups.map((g: any) => (
              <Fragment key={g.group}>
                <tr>
                  <td colSpan={5} className="xs bold" style={{ color: 'var(--red-600)', textTransform: 'uppercase', letterSpacing: '.08em', paddingTop: 16 }}>
                    {g.group}
                  </td>
                </tr>
                {g.items.map((i: any) => (
                  <tr key={i.key}>
                    <td>
                      <span className="muted" style={{ width: 20, display: 'inline-block' }}>
                        {MENU_META[i.key]?.icon}
                      </span>
                      {i.label} {i.phase > 1 && <span className="pill outline">Fase {i.phase}</span>}
                    </td>
                    {roles.map((r) => (
                      <td key={r.role} style={{ textAlign: 'center' }}>
                        <Switch on={r.role === 'admin' && i.key === 'setting' ? true : !!r.menus[i.key]} disabled={r.role === 'admin' && i.key === 'setting'} onChange={(on) => set(r.role, i.key, on)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr>
              <td className="bold" style={{ paddingTop: 18 }}>
                Cakupan data
                <div className="xs muted" style={{ fontWeight: 400 }}>
                  "Milik sendiri" = chat, lead & kontak yang ditugaskan ke orang itu saja
                </div>
              </td>
              {roles.map((r) => (
                <td key={r.role} style={{ textAlign: 'center', paddingTop: 18 }}>
                  <select className="input sm" value={r.scope} onChange={(e) => setRoles(roles.map((x) => (x.role === r.role ? { ...x, scope: e.target.value } : x)))}>
                    <option value="own">Milik sendiri</option>
                    <option value="all">Semua</option>
                  </select>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        🔒 Pengaturan untuk Admin selalu aktif supaya tidak ada yang terkunci di luar.
      </div>
    </Card>
  );
}

// ---------- Users ----------
export function UsersTab() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: users } = useQuery<any[]>({ queryKey: ['users'], queryFn: () => api.get('/api/users') });
  const { data: logs } = useQuery<any[]>({ queryKey: ['login-logs'], queryFn: () => api.get('/api/login-logs') });
  const { data: audit } = useQuery<any[]>({ queryKey: ['audit'], queryFn: () => api.get('/api/audit') });
  const [edit, setEdit] = useState<any>(null);
  const [secret, setSecret] = useState<{ email: string; pw: string } | null>(null);
  const [transfer, setTransfer] = useState<any>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['users-options'] });
  };
  const save = async () => {
    try {
      if (edit.id) {
        await api.patch(`/api/users/${edit.id}`, { name: edit.name, email: edit.email, role: edit.role, status: edit.status, phone: edit.phone || null });
        toast('Pengguna disimpan');
      } else {
        const r = await api.post('/api/users', { name: edit.name, email: edit.email, role: edit.role, phone: edit.phone || null });
        setSecret({ email: edit.email, pw: r.tempPassword });
      }
      refresh();
      setEdit(null);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const reset = async (u: any) => {
    if (!confirm(`Reset kata sandi ${u.name}? Sesi login yang aktif akan diputus.`)) return;
    const r = await api.post(`/api/users/${u.id}/reset-password`);
    setSecret({ email: u.email, pw: r.tempPassword });
  };
  const doTransfer = async (to: string) => {
    try {
      const r = await api.post(`/api/users/${transfer.id}/transfer`, { toUserId: to });
      toast(`${r.moved} lead aktif dipindahkan`);
      refresh();
      setTransfer(null);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="stack">
      <Card
        title="Users CRM"
        sub="Satu akun per orang, satu nomor hotline bersama. Sales berstatus cuti tidak ikut pembagian lead otomatis dan tugasnya dialihkan ke SPV."
        actions={<button className="btn primary sm" onClick={() => setEdit({ name: '', email: '', role: 'sales', status: 'aktif', phone: '' })}>＋ Undang pengguna</button>}
      >
        {!users ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Peran</th>
                  <th>Status</th>
                  <th>Lead aktif</th>
                  <th>Terakhir aktif</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ opacity: u.status === 'nonaktif' ? 0.5 : 1 }}>
                    <td>
                      <div className="row">
                        <span className="avatar">{initials(u.name)}</span>
                        <b>{u.name}</b>
                      </div>
                    </td>
                    <td className="small">{u.email}</td>
                    <td>{u.roleLabel}</td>
                    <td>
                      <span className={`pill ${u.status === 'aktif' ? 'olive' : u.status === 'cuti' ? 'warm' : 'cold'}`}>{u.status}</span>
                    </td>
                    <td>{u.openLeads}</td>
                    <td className="small muted">{u.lastActiveAt ? relative(u.lastActiveAt) : 'belum pernah'}</td>
                    <td className="nowrap">
                      <button className="btn sm" onClick={() => setEdit({ ...u, phone: u.phone ?? '' })}>
                        Ubah
                      </button>{' '}
                      <button className="btn sm" onClick={() => reset(u)}>
                        Reset sandi
                      </button>{' '}
                      {u.openLeads > 0 && (
                        <button className="btn sm" onClick={() => setTransfer(u)}>
                          Pindah lead
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="banner info" style={{ marginTop: 12 }}>
          Chat customer adalah data sensitif — nonaktifkan akun di hari terakhir kerja. Akun nonaktif tetap menyimpan riwayat; lead aktif wajib dipindah ke sales lain lebih dulu. Ekspor kontak dengan nomor telepon hanya oleh Admin.
        </div>
      </Card>
      <div className="grid grid-2">
        <Card title="Log login" sub="Waktu, alamat IP, dan perangkat. 200 terakhir.">
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            {logs?.map((l) => (
              <div key={l.id} className="row xs" style={{ padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <span className={`pill ${l.success ? 'olive' : 'hot'}`}>{l.success ? 'OK' : 'Gagal'}</span>
                <span className="bold">{l.email}</span>
                <span className="spacer" />
                <span className="muted">{l.ip}</span>
                <span className="muted">{dateTime(l.at)}</span>
              </div>
            ))}
            {!logs?.length && <Empty>Belum ada.</Empty>}
          </div>
        </Card>
        <Card title="Log audit" sub="Perubahan pengaturan, pengguna, API key, ekspor data.">
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            {audit?.map((a) => (
              <div key={a.id} className="xs" style={{ padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <span className="bold">{a.user ?? 'Sistem'}</span> · <span className="mono">{a.action}</span> {a.entityId ? <span className="muted">({a.entityId.slice(0, 18)})</span> : null}
                <span className="muted" style={{ float: 'right' }}>
                  {dateTime(a.at)}
                </span>
              </div>
            ))}
            {!audit?.length && <Empty>Belum ada.</Empty>}
          </div>
        </Card>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Ubah pengguna' : 'Undang pengguna'} sub={edit.id ? undefined : 'Kata sandi sementara dibuat otomatis dan wajib diganti saat login pertama.'} onClose={() => setEdit(null)} footer={<button className="btn primary" onClick={save} disabled={!edit.name || !edit.email}>Simpan</button>}>
          <div className="form-grid">
            <Field label="Nama">
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Email kantor">
              <input className="input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            </Field>
            <Field label="Peran">
              <select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                <option value="sales">Sales</option>
                <option value="marketing">Marketing</option>
                <option value="spv">SPV Sales</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="No. HP (opsional)">
              <input className="input" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </Field>
            {edit.id && (
              <Field label="Status" full hint={edit.id === me.user.id ? 'Tidak bisa menonaktifkan akun sendiri.' : 'Nonaktif = akses dicabut saat itu juga.'}>
                <select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  <option value="aktif">Aktif</option>
                  <option value="cuti">Cuti (tidak ikut pembagian lead)</option>
                  <option value="nonaktif">Nonaktif</option>
                </select>
              </Field>
            )}
          </div>
        </Modal>
      )}
      {secret && (
        <Modal title="Kata sandi sementara" sub="Sampaikan langsung ke orangnya (jangan lewat grup). Hanya ditampilkan sekali." onClose={() => setSecret(null)}>
          <div className="card" style={{ background: 'var(--cream-050)' }}>
            <div className="small">Email: {secret.email}</div>
            <div className="mono" style={{ fontSize: 18, marginTop: 6, userSelect: 'all' }}>
              {secret.pw}
            </div>
          </div>
        </Modal>
      )}
      {transfer && (
        <Modal title={`Pindahkan lead ${transfer.name}`} sub={`${transfer.openLeads} lead aktif, chat, dan tugas terbuka akan dipindah.`} onClose={() => setTransfer(null)}>
          <div className="stack">
            {users
              ?.filter((u) => u.id !== transfer.id && u.status === 'aktif' && (u.role === 'sales' || u.role === 'spv'))
              .map((u) => (
                <button key={u.id} className="btn" onClick={() => doTransfer(u.id)}>
                  {u.name} · {u.openLeads} lead aktif
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Pipeline ----------
const REQS: [string, string][] = [
  ['source_known', 'Sumber diketahui'],
  ['proposal_sent', 'Proposal terkirim'],
  ['dp_proof', 'Bukti DP'],
  ['lost_reason', 'Alasan Lost'],
];

export function PipelineTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any>({ queryKey: ['pipelines'], queryFn: () => api.get('/api/pipelines') });
  const [sel, setSel] = useState('');
  const [draft, setDraft] = useState<any>(null);
  useEffect(() => {
    if (data && !sel) setSel(data.pipelines[0]?.id ?? '');
  }, [data, sel]);
  useEffect(() => {
    const p = data?.pipelines.find((x: any) => x.id === sel);
    if (p) setDraft(structuredClone(p));
  }, [sel, data]);
  if (!data) return <Loading />;
  const save = async () => {
    const body = {
      name: draft.name,
      color: draft.color,
      targetShare: Number(draft.targetShare) || 0,
      eventTypes: draft.eventTypes,
      active: draft.active,
      stages: draft.stages.map((s: any) => ({ id: s.id, name: s.name, kind: s.kind, probability: Number(s.probability) || 0, slaDays: s.slaDays === '' || s.slaDays === null ? null : Number(s.slaDays), requirements: s.requirements })),
    };
    try {
      if (draft.id) await api.put(`/api/pipelines/${draft.id}`, body);
      else {
        const p = await api.post('/api/pipelines', body);
        setSel(p.id);
      }
      toast('Pipeline disimpan');
      qc.invalidateQueries({ queryKey: ['pipelines'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const st = (i: number, k: string, v: any) => setDraft({ ...draft, stages: draft.stages.map((s: any, j: number) => (j === i ? { ...s, [k]: v } : s)) });
  return (
    <Card
      title="Pengaturan pipeline"
      sub="Atur tahapan tiap pipeline, peluang closing, batas waktu (SLA) per tahap, dan syarat wajib sebelum kartu boleh pindah."
      actions={
        <div className="row">
          <button
            className="btn sm"
            onClick={() => (
              setSel(''),
              setDraft({
                name: 'Pipeline baru',
                color: '#a49a92',
                targetShare: 0,
                eventTypes: [],
                active: true,
                stages: [
                  { name: 'Lead Baru', kind: 'open', probability: 10, slaDays: 1, requirements: [] },
                  { name: 'Follow Up', kind: 'open', probability: 40, slaDays: 3, requirements: [] },
                  { name: 'Closing', kind: 'won', probability: 90, slaDays: 3, requirements: ['dp_proof'] },
                  { name: 'Lost', kind: 'lost', probability: 0, slaDays: null, requirements: ['lost_reason'] },
                ],
              })
            )}
          >
            ＋ Pipeline baru
          </button>
          <button className="btn primary sm" onClick={save} disabled={!draft}>
            Simpan
          </button>
        </div>
      }
    >
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {data.pipelines.map((p: any) => (
          <button key={p.id} className={`chip${sel === p.id ? ' on' : ''}`} onClick={() => setSel(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      {draft && (
        <>
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <Field label="Nama pipeline">
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Porsi target omzet (%)">
              <input className="input" type="number" value={draft.targetShare} onChange={(e) => setDraft({ ...draft, targetShare: e.target.value })} />
            </Field>
            <Field label="Kata kunci jenis acara (untuk memilih pipeline otomatis)" hint="Pisahkan dengan koma, mis. wedding, resepsi, lamaran" full>
              <input className="input" value={draft.eventTypes.join(', ')} onChange={(e) => setDraft({ ...draft, eventTypes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </Field>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Urut</th>
                  <th>Nama tahap</th>
                  <th>Jenis</th>
                  <th>Peluang %</th>
                  <th>SLA hari</th>
                  <th>Syarat wajib pindah ke tahap ini</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.stages.map((s: any, i: number) => (
                  <tr key={s.id ?? `n${i}`}>
                    <td className="nowrap">
                      <button className="btn sm" disabled={i === 0} onClick={() => setDraft({ ...draft, stages: swap(draft.stages, i, i - 1) })}>
                        ↑
                      </button>
                      <button className="btn sm" disabled={i === draft.stages.length - 1} onClick={() => setDraft({ ...draft, stages: swap(draft.stages, i, i + 1) })}>
                        ↓
                      </button>
                    </td>
                    <td>
                      <input className="input sm" value={s.name} onChange={(e) => st(i, 'name', e.target.value)} />
                    </td>
                    <td>
                      <select className="input sm" value={s.kind} onChange={(e) => st(i, 'kind', e.target.value)}>
                        <option value="open">Berjalan</option>
                        <option value="won">Closing / won</option>
                        <option value="lost">Lost</option>
                      </select>
                    </td>
                    <td>
                      <input className="input sm" style={{ width: 70 }} type="number" value={s.probability} onChange={(e) => st(i, 'probability', e.target.value)} />
                    </td>
                    <td>
                      <input className="input sm" style={{ width: 70 }} type="number" value={s.slaDays ?? ''} onChange={(e) => st(i, 'slaDays', e.target.value)} />
                    </td>
                    <td>
                      <div className="row wrap" style={{ gap: 4 }}>
                        {REQS.map(([k, l]) => (
                          <button key={k} className={`chip${s.requirements.includes(k) ? ' on' : ''}`} style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => st(i, 'requirements', s.requirements.includes(k) ? s.requirements.filter((x: string) => x !== k) : [...s.requirements, k])}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="btn sm danger" onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_: any, j: number) => j !== i) })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => setDraft({ ...draft, stages: [...draft.stages, { name: 'Tahap baru', kind: 'open', probability: 50, slaDays: 3, requirements: [] }] })}>
              ＋ Tambah tahap
            </button>
            <span className="hint">SLA lewat → kartu ditandai merah di Kanban. Tahap yang masih berisi lead tidak bisa dihapus.</span>
          </div>
        </>
      )}
    </Card>
  );
}

export const swap = <T,>(a: T[], i: number, j: number) => {
  const c = [...a];
  [c[i], c[j]] = [c[j]!, c[i]!];
  return c;
};
