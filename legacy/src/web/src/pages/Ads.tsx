import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Loading, Modal, MoneyInput, Seg, Stat, useToast } from '../components/ui';
import { statusColor, Meter } from '../components/charts';
import { relative, rupiahShort } from '../format';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('id-ID'));

export function AdsPage() {
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const [days, setDays] = useState('30');
  const { data } = useQuery<any>({ queryKey: ['ads', days], queryFn: () => api.get(`/api/ads?days=${days}`) });
  const [spendFor, setSpendFor] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [mapId, setMapId] = useState<string | null>(null);
  if (!data) return <Layout><Loading /></Layout>;
  const conn = data.connections[0];
  const refresh = () => qc.invalidateQueries({ queryKey: ['ads'] });
  const k = data.kpi;
  const sync = async () => {
    try {
      const r = await api.post<any>(`/api/integrations/${conn.id}/sync`);
      if (r.ok === false) toast(r.error, true);
      else toast('Sinkron selesai');
      refresh();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Layout>
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="tile row wrap" style={{ gap: 10 }}>
          <span className="pf-badge" style={{ background: conn ? '#1877f2' : 'var(--charcoal-300)' }}>Ads</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b className="small">{conn ? 'Meta Ads terhubung' : 'Meta Ads belum terhubung'}</b>
            <div className="xs muted">
              {conn ? `${conn.name} · ${conn.lastSyncAt ? `sinkron ${relative(conn.lastSyncAt)}` : 'menunggu sinkron pertama'}${conn.lastError ? ` · ${conn.lastError}` : ''}` : 'Sementara itu belanja iklan bisa diisi manual per kampanye per bulan. Lead & closing tetap dihitung otomatis dari CRM.'}
            </div>
          </div>
          {conn && (
            <button className="btn sm" onClick={sync}>
              Sinkron sekarang
            </button>
          )}
          {me.user.role === 'admin' && (
            <Link className="btn ghost sm" to="/pengaturan/integrasi">
              Kelola koneksi
            </Link>
          )}
          <Seg value={days} options={[['7', '7 hari'], ['30', '30 hari'], ['90', '90 hari']]} onChange={setDays} />
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Stat k="Belanja iklan" v={rupiahShort(k.spend)} s={`${days} hari terakhir`} />
          <Stat k="Lead dari iklan" v={n(k.leads)} s="chat click-to-WhatsApp yang jadi lead" />
          <Stat k="Biaya per lead" v={k.cpl ? rupiahShort(k.cpl) : '—'} />
          <Stat k="Closing dari iklan" v={n(k.closings)} s={k.costPerClosing ? `biaya per closing ${rupiahShort(k.costPerClosing)}` : ''} />
          <Stat k="ROAS" v={k.roas ? `${k.roas.toLocaleString('id-ID')}×` : '—'} s={`omzet ${rupiahShort(k.omzet)}`} />
        </div>
        <Card
          title="Kampanye"
          sub="Biaya dari Meta (atau manual) · lead, skor & closing dari CRM. Setiap lead click-to-WhatsApp membawa id iklan di pesan pertama, jadi closing bisa ditarik balik ke iklan asalnya."
          actions={
            <button className="btn sm" onClick={() => setAdding(true)}>
              + Kampanye manual
            </button>
          }
        >
          {!data.campaigns.length ? (
            <Empty>Belum ada kampanye. Hubungkan Meta Ads, atau tambahkan kampanye manual dan isi belanjanya.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Kampanye</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Belanja</th>
                    <th style={{ textAlign: 'right' }}>Lead</th>
                    <th style={{ textAlign: 'right' }}>Biaya/lead</th>
                    <th style={{ textAlign: 'right' }}>Closing</th>
                    <th style={{ textAlign: 'right' }}>Biaya/closing</th>
                    <th style={{ minWidth: 140 }}>Kualitas lead</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c: any) => (
                    <tr key={c.id}>
                      <td>
                        <b>{c.name}</b>
                        <div className="xs muted">
                          {c.objective ?? '—'}
                          {c.manual ? ' · manual' : ''}
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${c.status === 'ACTIVE' ? 'olive' : ''}`}>{c.status === 'ACTIVE' ? 'Aktif' : c.status.toLowerCase()}</span>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        {rupiahShort(c.spend)}
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        {c.leads}
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        {c.cpl ? rupiahShort(c.cpl) : '—'}
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        {c.closings}
                      </td>
                      <td className="tnum" style={{ textAlign: 'right' }}>
                        {c.costPerClosing ? rupiahShort(c.costPerClosing) : '—'}
                      </td>
                      <td>
                        {c.avgScore === null ? (
                          <span className="xs muted">—</span>
                        ) : (
                          <div className="row" style={{ gap: 6 }}>
                            <div style={{ flex: 1 }}>
                              <Meter pct={c.avgScore} color={statusColor(c.avgScore, 70, 55)} />
                            </div>
                            <span className="xs tnum">{c.avgScore}</span>
                          </div>
                        )}
                      </td>
                      <td className="nowrap">
                        {c.manual && (
                          <button className="btn ghost sm" onClick={() => setSpendFor(c)}>
                            Isi belanja
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {(data.notes.length > 0 || data.unknownAdIds.length > 0) && (
          <Card title="Kualitas, bukan hanya jumlah" style={{ marginTop: 0 }}>
            {data.notes.map((t: string, i: number) => (
              <div key={i} className="small" style={{ padding: '5px 0' }}>
                · {t}
              </div>
            ))}
            {data.unknownAdIds.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="xs muted" style={{ marginBottom: 6 }}>
                  Id iklan yang belum dikenal (klik untuk memasukkan ke kampanye):
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {data.unknownAdIds.map((a: string) => (
                    <button key={a} className="chip mono" onClick={() => setMapId(a)}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
      {adding && <AddCampaign onClose={() => setAdding(false)} onDone={refresh} />}
      {spendFor && <SpendModal campaign={spendFor} onClose={() => setSpendFor(null)} onDone={refresh} />}
      {mapId && (
        <Modal title={`Masukkan id iklan ${mapId}`} sub="Lead dengan id iklan ini akan dihitung ke kampanye yang dipilih." onClose={() => setMapId(null)}>
          {data.campaigns.map((c: any) => (
            <button
              key={c.id}
              className="list-row"
              onClick={async () => {
                try {
                  await api.post(`/api/ads/campaigns/${c.id}/ad-ids`, { adId: mapId });
                  setMapId(null);
                  refresh();
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              <b className="small" style={{ flex: 1 }}>
                {c.name}
              </b>
              <span className="xs muted">{c.manual ? 'manual' : 'Meta'}</span>
            </button>
          ))}
        </Modal>
      )}
    </Layout>
  );
}

function AddCampaign({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [obj, setObj] = useState('Pesan WhatsApp');
  const save = async () => {
    try {
      await api.post('/api/ads/campaigns', { name, objective: obj });
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Kampanye manual" sub="Untuk mencatat biaya iklan selama Meta Ads belum terhubung." onClose={onClose} footer={<button className="btn primary" disabled={name.trim().length < 2} onClick={save}>Simpan</button>}>
      <div className="form-grid">
        <Field label="Nama kampanye" full>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Wedding Expo Oktober" />
        </Field>
        <Field label="Tujuan">
          <input className="input" value={obj} onChange={(e) => setObj(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function SpendModal({ campaign, onClose, onDone }: { campaign: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [amount, setAmount] = useState<number | null>(null);
  const save = async () => {
    try {
      await api.put(`/api/ads/campaigns/${campaign.id}/spend`, { month, amount: amount ?? 0 });
      toast('Belanja dicatat');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title={`Belanja ${campaign.name}`} sub="Total tagihan iklan kampanye ini untuk satu bulan (lihat di Ads Manager › Penagihan)." onClose={onClose} footer={<button className="btn primary" onClick={save}>Simpan</button>}>
      <div className="form-grid">
        <Field label="Bulan">
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Field label="Total belanja">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
      </div>
    </Modal>
  );
}
