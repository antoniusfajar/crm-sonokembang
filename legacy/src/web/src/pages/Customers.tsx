import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { can, isRole, useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Loading, Modal, Stat, useToast } from '../components/ui';
import { date, rupiah, rupiahShort } from '../format';

type Range = 'all' | '90' | '180' | '365' | 'older';
type Status = 'all' | 'Aktif' | 'Dorman';

const RANGES: [Range, string][] = [
  ['all', 'Semua'],
  ['90', '≤ 90 hari'],
  ['180', '≤ 6 bulan'],
  ['365', '≤ 1 tahun'],
  ['older', '> 1 tahun'],
];

export function CustomersPage() {
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<Range>('all');
  const [status, setStatus] = useState<Status>('all');
  const [segment, setSegment] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const params = { q, range, status, segment, page, size };
  const { data, isLoading } = useQuery<any>({ queryKey: ['customers', params], queryFn: () => api.get('/api/customers' + qs(params)) });
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));

  const makeTasks = async (key: string, n: number) => {
    if (!confirm(`Buat tugas follow-up untuk ${n} pelanggan? Tugas masuk ke PIC terakhir masing-masing.`)) return;
    setBusy(key);
    try {
      const r = await api.post<{ created: number; skipped: number }>(`/api/customers/opportunities/${key}/tasks`);
      toast(`${r.created} tugas dibuat${r.skipped ? ` · ${r.skipped} dilewati (tugas yang sama masih terbuka)` : ''}`);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy('');
    }
  };

  const s = data?.stats;
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;
  return (
    <Layout>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat k="Total pelanggan" v={s ? s.total.toLocaleString('id-ID') : '—'} s="pernah closing minimal 1x" />
        <Stat
          k="Repeat rate 12 bulan"
          v={s?.repeatRate !== null && s?.repeatRate !== undefined ? `${s.repeatRate.toLocaleString('id-ID')}%` : '—'}
          s={s?.repeatRateDelta !== null && s?.repeatRateDelta !== undefined ? `${s.repeatRateDelta >= 0 ? '+' : ''}${s.repeatRateDelta.toLocaleString('id-ID')} poin vs 12 bulan sebelumnya` : 'pelanggan yang order lagi'}
        />
        <Stat k="Nilai rata-rata order" v={s ? rupiahShort(s.avgOrder) : '—'} s={s ? `median ${rupiahShort(s.medianOrder)} · 12 bulan terakhir` : ''} />
        <Stat k="Pelanggan dorman" v={s ? s.dormant.toLocaleString('id-ID') : '—'} s="> 6 bulan tanpa order" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <Card
          title={`Basis data pelanggan · ${data?.total ?? 0}`}
          sub="Dibuat otomatis saat lead closing (DP masuk). Nomor WhatsApp jadi kunci — order berikutnya dari nomor yang sama menempel ke pelanggan ini. Urut dari order terakhir terbaru."
          actions={
            <div className="row" style={{ gap: 6 }}>
              <Link className="btn ghost sm" to="/kontak">
                Semua kontak →
              </Link>
              {isRole(me, 'admin', 'spv') && (
                <a className="btn sm" href={'/api/customers/export.csv' + qs({ q, range, status, segment })}>
                  Ekspor CSV{me.user.role === 'spv' ? ' (tanpa nomor)' : ''}
                </a>
              )}
            </div>
          }
        >
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <input className="input sm" style={{ maxWidth: 260 }} placeholder="Cari nama pelanggan atau nomor" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
            <select className="input sm" style={{ width: 150 }} value={segment} onChange={(e) => reset(setSegment)(e.target.value)}>
              <option value="">Semua segmen</option>
              <option>Personal</option>
              <option>Korporat</option>
              <option>Institusi</option>
              <option value="-">Belum diisi</option>
            </select>
          </div>
          <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
            <span className="xs muted" style={{ width: 92 }}>
              Order terakhir
            </span>
            {RANGES.map(([k, l]) => (
              <button key={k} className={`chip${range === k ? ' on' : ''}`} onClick={() => reset(setRange)(k)}>
                {l}
              </button>
            ))}
            <span className="xs muted" style={{ marginLeft: 10 }}>
              Status
            </span>
            {(['all', 'Aktif', 'Dorman'] as Status[]).map((k) => (
              <button key={k} className={`chip${status === k ? ' on' : ''}`} onClick={() => reset(setStatus)(k)}>
                {k === 'all' ? 'Semua' : k}
              </button>
            ))}
          </div>
          {isLoading ? (
            <Loading />
          ) : !data.rows.length ? (
            <Empty>{data.total === 0 && !q && range === 'all' && status === 'all' && !segment ? 'Belum ada pelanggan. Pelanggan muncul otomatis begitu ada lead yang closing (DP masuk).' : 'Tidak ada pelanggan yang cocok dengan filter.'}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Pelanggan</th>
                    <th>Segmen</th>
                    <th style={{ textAlign: 'right' }}>Order</th>
                    <th>Terakhir</th>
                    <th style={{ textAlign: 'right' }}>Nilai total</th>
                    <th>Status</th>
                    <th>PIC</th>
                    <th>Peluang berikutnya</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((c: any) => (
                    <tr key={c.id} className="click" onClick={() => setOpen(c.id)}>
                      <td>
                        <b>{c.name}</b>
                        <div className="xs muted nowrap">{c.company && c.company !== c.name ? c.company : c.phone}</div>
                      </td>
                      <td className="small">{c.segment ?? <span className="muted">—</span>}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        {c.orders}
                      </td>
                      <td className="small nowrap">{date(c.lastOrder)}</td>
                      <td className="tnum nowrap" style={{ textAlign: 'right' }}>
                        {rupiahShort(c.total)}
                      </td>
                      <td>
                        <span className={`pill ${c.status === 'Aktif' ? 'olive' : 'cold'}`}>{c.status}</span>
                      </td>
                      <td className="small">{c.pic ?? '—'}</td>
                      <td className="small" style={{ minWidth: 200 }}>
                        {c.next}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > 0 && (
            <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
              <span className="small muted">
                {(page - 1) * size + 1}–{Math.min(page * size, data.total)} dari {data.total} pelanggan
              </span>
              <span className="spacer" />
              <span className="xs muted">Baris per halaman</span>
              {[25, 50, 100].map((n) => (
                <button key={n} className={`chip${size === n ? ' on' : ''}`} onClick={() => (setSize(n), setPage(1))}>
                  {n}
                </button>
              ))}
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              <span className="small">
                {page} / {pages}
              </span>
              <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                ›
              </button>
            </div>
          )}
        </Card>

        <Card title="Peluang repeat order" sub="Dihitung dari riwayat order: siklus tahunan, anniversary, dan lamanya diam. Pelanggan yang sedang punya lead berjalan tidak dihitung.">
          {!data ? (
            <Loading />
          ) : (
            data.opportunities.map((o: any) => (
              <div key={o.key} style={{ padding: '12px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <div className="row" style={{ gap: 8 }}>
                  <b className="small" style={{ flex: 1 }}>
                    {o.title}
                  </b>
                  <span className={`pill ${o.count ? 'warm' : ''}`}>{o.count}</span>
                </div>
                <div className="xs muted" style={{ margin: '4px 0 6px' }}>
                  {o.detail}
                </div>
                {o.count > 0 && (
                  <>
                    <div className="xs" style={{ marginBottom: 8 }}>
                      {o.customers.map((c: any) => c.name).join(', ')}
                      {o.count > o.customers.length ? ` +${o.count - o.customers.length} lainnya` : ''}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {me.user.role !== 'marketing' && (
                        <button className="btn sm" disabled={busy === o.key} onClick={() => makeTasks(o.key, o.count)}>
                          {busy === o.key ? 'Membuat…' : `Buat tugas (${o.count})`}
                        </button>
                      )}
                      {can(me, 'broadcast') && (
                        <button className="btn ghost sm" onClick={() => nav(`/broadcast?new=&preset=${encodeURIComponent('repeat:' + o.key)}`)}>
                          Broadcast
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </Card>
      </div>
      {open && <CustomerModal id={open} onClose={() => setOpen(null)} onLead={(id) => nav(`/leads/${id}`)} />}
    </Layout>
  );
}

function CustomerModal({ id, onClose, onLead }: { id: string; onClose: () => void; onLead: (id: string) => void }) {
  const { data } = useQuery<any>({ queryKey: ['customer', id], queryFn: () => api.get(`/api/customers/${id}`) });
  return (
    <Modal title={data?.name ?? 'Pelanggan'} sub={data ? `${data.phone}${data.segment ? ` · ${data.segment}` : ''} · PIC ${data.pic ?? '—'}` : ''} onClose={onClose} wide>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-3" style={{ marginBottom: 14 }}>
            <Stat k="Jumlah order" v={data.orders} s={`pertama ${date(data.firstOrder)}`} />
            <Stat k="Nilai total" v={rupiahShort(data.total)} s={`rata-rata ${rupiahShort(Math.round(data.total / data.orders))}`} />
            <Stat k="Status" v={data.status} s={data.daysSince ? `order terakhir ${data.daysSince} hari lalu` : 'order terakhir hari ini'} />
          </div>
          {data.next !== '—' && (
            <div className="banner info" style={{ marginBottom: 12 }}>
              {data.next}
            </div>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Closing</th>
                <th>Pipeline</th>
                <th>Acara</th>
                <th>Tgl acara</th>
                <th style={{ textAlign: 'right' }}>Nilai order</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((o: any) => (
                <tr key={o.leadId} className="click" onClick={() => onLead(o.leadId)}>
                  <td className="small nowrap">{date(o.closedAt)}</td>
                  <td className="small">{o.pipeline}</td>
                  <td className="small">{o.eventType ?? '—'}</td>
                  <td className="small nowrap">{o.eventDate ? date(o.eventDate) : '—'}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {rupiah(o.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.openLead && (
            <button className="btn sm" style={{ marginTop: 12 }} onClick={() => onLead(data.openLead.id)}>
              Buka lead yang sedang berjalan ({data.openLead.stage}) →
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
