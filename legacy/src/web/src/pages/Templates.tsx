import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Modal, useToast } from '../components/ui';
import { date } from '../format';

const VARS = ['[nama_customer]', '[jenis_acara]', '[tanggal]', '[lokasi]', '[pax]', '[harga_per_pax]', '[nama_sales]', '[no_rekening]'];
const SEGS = ['Wedding', 'Institusi', 'B2B / Kantin', 'Tradisional', 'Event kantor', 'Ulang tahun'];

export function TemplatesPage() {
  const [tab, setTab] = useState<'proposal' | 'snippet'>('proposal');
  return (
    <Layout flush>
      <div className="tabs">
        <button className={tab === 'proposal' ? 'on' : ''} onClick={() => setTab('proposal')}>
          Proposal
        </button>
        <button className={tab === 'snippet' ? 'on' : ''} onClick={() => setTab('snippet')}>
          Snippet chat
        </button>
      </div>
      <div className="content">{tab === 'proposal' ? <ProposalTemplates /> : <Snippets />}</div>
    </Layout>
  );
}

function ProposalTemplates() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: tpls } = useQuery<any[]>({ queryKey: ['proposal-templates'], queryFn: () => api.get('/api/proposal-templates') });
  const [selId, setSelId] = useState<string>('');
  const [draft, setDraft] = useState<any>(null);
  useEffect(() => {
    if (!selId && tpls?.length) setSelId(tpls[0].id);
  }, [tpls, selId]);
  useEffect(() => {
    const t = tpls?.find((x) => x.id === selId);
    if (t) setDraft(structuredClone(t));
  }, [selId, tpls]);

  const save = async () => {
    try {
      if (draft.id) await api.put(`/api/proposal-templates/${draft.id}`, { name: draft.name, segment: draft.segment, sections: draft.sections });
      else {
        const t = await api.post('/api/proposal-templates', { name: draft.name, segment: draft.segment, sections: draft.sections });
        setSelId(t.id);
      }
      toast('Template disimpan');
      qc.invalidateQueries({ queryKey: ['proposal-templates'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async () => {
    if (!draft.id || !confirm(`Hapus template "${draft.name}"?`)) return;
    await api.del(`/api/proposal-templates/${draft.id}`);
    setSelId('');
    qc.invalidateQueries({ queryKey: ['proposal-templates'] });
  };
  const sec = (i: number, k: 'title' | 'body', v: string) => setDraft({ ...draft, sections: draft.sections.map((s: any, j: number) => (j === i ? { ...s, [k]: v } : s)) });

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)' }}>
      <Card
        title={`Template · ${tpls?.length ?? 0}`}
        actions={
          <button className="btn sm" onClick={() => (setSelId(''), setDraft({ name: 'Template baru', segment: 'Wedding', sections: [{ title: 'Pembuka', body: 'Yth. [nama_customer],' }] }))}>
            ＋ Baru
          </button>
        }
      >
        <div className="stack">
          {tpls?.map((t) => (
            <button key={t.id} className="btn" style={{ justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start', borderColor: t.id === selId ? 'var(--rose-400)' : undefined, background: t.id === selId ? 'var(--rose-100)' : undefined }} onClick={() => setSelId(t.id)}>
              <span>{t.name}</span>
              <span className="xs muted" style={{ fontWeight: 400 }}>
                {t.segment} · diubah {date(t.updatedAt)}
              </span>
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          Template dipakai saat sales menekan <b>Kirim proposal</b> di Inbox atau Detail lead. Template disarankan otomatis dari jenis acara.
        </div>
      </Card>
      {draft ? (
        <div className="stack">
          <Card
            title="Pengaturan template"
            actions={
              <div className="row">
                {draft.id && (
                  <button className="btn sm danger" onClick={remove}>
                    Hapus
                  </button>
                )}
                <button className="btn sm primary" onClick={save}>
                  Simpan
                </button>
              </div>
            }
          >
            <div className="form-grid">
              <Field label="Nama template">
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Segmen (dipakai untuk menyarankan template otomatis)">
                <input className="input" list="segs" value={draft.segment} onChange={(e) => setDraft({ ...draft, segment: e.target.value })} />
                <datalist id="segs">
                  {SEGS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
            </div>
            <div className="label" style={{ margin: '14px 0 6px' }}>
              Variabel otomatis
            </div>
            <div className="row wrap">
              {VARS.map((v) => (
                <span key={v} className={`pill ${v === '[harga_per_pax]' ? 'hot' : 'outline'} mono`}>
                  {v}
                </span>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              <b>[harga_per_pax]</b> wajib diisi sales sebelum kirim — AI tidak pernah mengirim harga.
            </div>
          </Card>
          {draft.sections.map((s: any, i: number) => (
            <Card key={i}>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="avatar">{i + 1}</span>
                <input className="input sm" value={s.title} onChange={(e) => sec(i, 'title', e.target.value)} />
                <button className="btn sm" disabled={i === 0} onClick={() => setDraft({ ...draft, sections: swap(draft.sections, i, i - 1) })}>
                  ↑
                </button>
                <button className="btn sm" disabled={i === draft.sections.length - 1} onClick={() => setDraft({ ...draft, sections: swap(draft.sections, i, i + 1) })}>
                  ↓
                </button>
                <button className="btn sm danger" disabled={draft.sections.length <= 1} onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_: any, j: number) => j !== i) })}>
                  ✕
                </button>
              </div>
              <textarea className="input" rows={4} value={s.body} onChange={(e) => sec(i, 'body', e.target.value)} />
            </Card>
          ))}
          <button className="btn" onClick={() => setDraft({ ...draft, sections: [...draft.sections, { title: 'Bagian baru', body: '' }] })}>
            ＋ Tambah bagian
          </button>
        </div>
      ) : (
        <Empty>Pilih template.</Empty>
      )}
    </div>
  );
}

const swap = <T,>(a: T[], i: number, j: number) => {
  const c = [...a];
  [c[i], c[j]] = [c[j]!, c[i]!];
  return c;
};

function Snippets() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any[]>({ queryKey: ['snippets'], queryFn: () => api.get('/api/snippets') });
  const [folder, setFolder] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const folders = [...new Set((data ?? []).map((s) => s.folder))];
  const rows = (data ?? []).filter((s) => (!folder || s.folder === folder) && (!q || (s.name + s.shortcut + s.body).toLowerCase().includes(q.toLowerCase())));
  const save = async () => {
    try {
      const body = { name: edit.name, shortcut: edit.shortcut, body: edit.body, folder: edit.folder || 'Umum' };
      if (edit.id) await api.patch(`/api/snippets/${edit.id}`, body);
      else await api.post('/api/snippets', body);
      toast('Snippet disimpan');
      qc.invalidateQueries({ queryKey: ['snippets'] });
      setEdit(null);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async (s: any) => {
    if (!confirm(`Hapus snippet "${s.name}"?`)) return;
    await api.del(`/api/snippets/${s.id}`);
    qc.invalidateQueries({ queryKey: ['snippets'] });
  };
  return (
    <Card
      title="Snippet chat cepat"
      sub="Teks siap pakai untuk balasan WhatsApp. Di Conversation, ketik / + shortcut atau klik tombol Template. Variabel {{contact.name}} dan {{sales.name}} terisi otomatis."
      actions={
        <button className="btn sm primary" onClick={() => setEdit({ name: '', shortcut: '/', body: '', folder: folder || 'Umum' })}>
          ＋ Snippet baru
        </button>
      }
    >
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input className="input sm" style={{ maxWidth: 240 }} placeholder="Cari snippet" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`chip${!folder ? ' on' : ''}`} onClick={() => setFolder('')}>
          Semua
        </button>
        {folders.map((f) => (
          <button key={f} className={`chip${folder === f ? ' on' : ''}`} onClick={() => setFolder(f)}>
            {f}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Isi</th>
              <th>Folder</th>
              <th>Shortcut</th>
              <th>Dipakai</th>
              <th>Diperbarui</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="bold">{s.name}</td>
                <td className="small muted" style={{ maxWidth: 360 }}>
                  <div className="ellipsis">{s.body}</div>
                </td>
                <td>{s.folder}</td>
                <td className="mono" style={{ color: 'var(--red-600)' }}>
                  {s.shortcut}
                </td>
                <td>{s.useCount}</td>
                <td className="small muted">{date(s.updatedAt)}</td>
                <td className="nowrap">
                  <button className="btn sm" onClick={() => setEdit(s)}>
                    Ubah
                  </button>{' '}
                  <button className="btn sm danger" onClick={() => remove(s)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty>Tidak ada snippet yang cocok.</Empty>}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Ubah snippet' : 'Snippet baru'} onClose={() => setEdit(null)} footer={<button className="btn primary" onClick={save} disabled={!edit.name || edit.shortcut.length < 2 || !edit.body}>Simpan</button>}>
          <div className="form-grid">
            <Field label="Nama">
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Shortcut" hint="Diawali /, tanpa spasi">
              <input className="input mono" value={edit.shortcut} onChange={(e) => setEdit({ ...edit, shortcut: e.target.value.replace(/\s/g, '') })} />
            </Field>
            <Field label="Folder" full>
              <input className="input" list="folders" value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })} />
              <datalist id="folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
            <Field label="Isi" full>
              <textarea className="input" rows={6} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}
