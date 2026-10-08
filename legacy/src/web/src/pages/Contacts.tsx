import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { isRole, useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Loading, Modal, useToast } from '../components/ui';
import { date, relative } from '../format';

// Status otomatis dari siklus lead (dihitung server), bukan isian manual.
const STATUSES: [string, string][] = [
  ['Lead aktif', 'sedang berjalan di pipeline'],
  ['Pelanggan', 'pernah closing'],
  ['Lost / Abandoned', 'bisa di-follow up ulang'],
  ['Belum diklasifikasi', 'chat masuk, belum jadi lead'],
  ['Bukan prospek', 'vendor, supplier, salah sambung'],
];
const STATUS_PILL: Record<string, string> = { 'Lead aktif': 'warm', Pelanggan: 'olive', 'Lost / Abandoned': 'hot', 'Bukan prospek': 'cold' };

export function ContactsPage() {
  const me = useMe();
  const nav = useNavigate();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(null);
  const { data: types } = useQuery<string[]>({ queryKey: ['setting', 'contact_types'], queryFn: () => api.get('/api/settings/contact_types') });
  const { data, isLoading } = useQuery<any>({ queryKey: ['contacts', status, type, q, page], queryFn: () => api.get('/api/contacts' + qs({ status, type, q, page })) });
  const total = data ? Object.values(data.typeCounts as Record<string, number>).reduce((a, b) => a + b, 0) : 0;
  return (
    <Layout>
      <div className="grid" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {[['', 'Semua kontak', total, 'setiap nomor yang pernah masuk'] as const, ...STATUSES.map(([k, hint]) => [k, k, data?.statusCounts?.[k] ?? 0, hint] as const)].map(([k, label, n, hint]) => (
          <button key={k} className="card" style={{ textAlign: 'left', cursor: 'pointer', borderColor: status === k ? 'var(--rose-400)' : undefined }} onClick={() => (setStatus(k), setPage(1))}>
            <div className="stat-k">{label}</div>
            <div className="stat-v">{n}</div>
            <div className="stat-s">{hint}</div>
          </button>
        ))}
      </div>
      <Card
        title={`Semua kontak · ${data?.total ?? 0}`}
        sub="Setiap nomor yang pernah menghubungi Sonokembang — lead aktif, pelanggan, yang tidak closing, sampai supplier. Nomor WhatsApp jadi kunci, jadi satu orang tidak tercatat dua kali."
        actions={
          isRole(me, 'admin', 'spv') && (
            <a className="btn sm" href="/api/contacts/export.csv">
              Ekspor CSV{me.user.role === 'spv' ? ' (tanpa nomor)' : ''}
            </a>
          )
        }
      >
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <input className="input sm" style={{ maxWidth: 280 }} placeholder="Cari nama, perusahaan, nomor" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
          <span className="xs muted">Tipe:</span>
          <button className={`chip${!type ? ' on' : ''}`} onClick={() => setType('')}>
            Semua
          </button>
          {types?.map((t) => (
            <button key={t} className={`chip${type === t ? ' on' : ''}`} onClick={() => (setType(t), setPage(1))}>
              {t} ({data?.typeCounts[t] ?? 0})
            </button>
          ))}
        </div>
        {isLoading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Kontak</th>
                  <th>Status</th>
                  <th>Tipe</th>
                  <th>Sumber pertama</th>
                  <th>Riwayat</th>
                  <th>PIC</th>
                  <th>Terakhir</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((c: any) => (
                  <tr key={c.id} className={c.conversationId ? 'click' : ''} onClick={() => c.conversationId && nav(`/inbox/${c.conversationId}`)}>
                    <td>
                      <div className="bold">{c.name ?? '—'}</div>
                      <div className="xs muted">
                        {c.phone}
                        {c.company ? ` · ${c.company}` : ''}
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${STATUS_PILL[c.status] ?? ''}`}>{c.status}</span>
                    </td>
                    <td className="small">{c.type}</td>
                    <td>{c.source ?? '—'}</td>
                    <td className="small">{c.leads ? `${c.leads} lead · ${c.won} closing · ${c.lost} lost` : '—'}</td>
                    <td>{c.owner ?? '—'}</td>
                    <td className="small muted">{c.lastMessageAt ? relative(c.lastMessageAt) : date(c.createdAt)}</td>
                    <td>
                      <button className="btn sm" onClick={(e) => (e.stopPropagation(), setEdit(c))}>
                        Ubah
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.rows.length && <Empty>Tidak ada kontak yang cocok.</Empty>}
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <span className="hint">Klik kontak yang punya percakapan untuk membuka chat-nya.</span>
          <span className="spacer" />
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <span className="small">Hal. {page}</span>
          <button className="btn sm" disabled={!data || page * 50 >= data.total} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
      </Card>
      {edit && <EditContact c={edit} types={types ?? []} onClose={() => setEdit(null)} />}
    </Layout>
  );
}

function EditContact({ c, types, onClose }: { c: any; types: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: sources } = useQuery<any[]>({ queryKey: ['sources'], queryFn: () => api.get('/api/sources') });
  const { data: cf } = useQuery<any[]>({ queryKey: ['custom-fields'], queryFn: () => api.get('/api/custom-fields') });
  const [v, setV] = useState({ name: c.name ?? '', contactType: c.type, email: c.email ?? '', company: c.company ?? '', segment: c.segment ?? '' });
  const [custom, setCustom] = useState<Record<string, any>>(c.custom ?? {});
  const save = async () => {
    try {
      await api.patch(`/api/contacts/${c.id}`, { ...v, segment: v.segment || null, custom });
      toast('Kontak disimpan');
      qc.invalidateQueries({ queryKey: ['contacts'] });
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Ubah kontak" sub={c.phone} onClose={onClose} footer={<button className="btn primary" onClick={save}>Simpan</button>}>
      <div className="form-grid">
        <Field label="Nama">
          <input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Tipe kontak">
          <select className="input" value={v.contactType} onChange={(e) => setV({ ...v, contactType: e.target.value })}>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Email">
          <input className="input" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field label="Perusahaan / instansi">
          <input className="input" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
        </Field>
        <Field label="Segmen" hint="Dipakai di menu Pelanggan & laporan repeat order.">
          <select className="input" value={v.segment} onChange={(e) => setV({ ...v, segment: e.target.value })}>
            <option value="">—</option>
            <option>Personal</option>
            <option>Korporat</option>
            <option>Institusi</option>
          </select>
        </Field>
        {(cf ?? [])
          .filter((f) => f.entity === 'contact')
          .map((f) => (
            <Field key={f.id} label={f.name}>
              {f.type === 'select' ? (
                <select className="input" value={custom[f.key] ?? ''} onChange={(e) => setCustom({ ...custom, [f.key]: e.target.value })}>
                  <option value="">—</option>
                  {f.options.map((o: string) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input className="input" value={custom[f.key] ?? ''} onChange={(e) => setCustom({ ...custom, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
        <div className="hint full">Sumber pertama: {sources?.find((s) => s.name === c.source)?.name ?? c.source ?? '—'} (diubah lewat detail lead).</div>
      </div>
    </Modal>
  );
}
