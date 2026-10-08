import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Loading, Seg, Stat } from '../components/ui';
import { Columns, HBars, SERIES, STATUS } from '../components/charts';
import { relative } from '../format';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('id-ID'));
const trend = (a: number, b: number) => (b ? `${a >= b ? '↑' : '↓'} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs periode lalu` : 'periode lalu: —');

export function WebsitePage() {
  const me = useMe();
  const [days, setDays] = useState('30');
  const { data } = useQuery<any>({ queryKey: ['website', days], queryFn: () => api.get(`/api/website?days=${days}`) });
  if (!data) return <Layout><Loading /></Layout>;
  const k = data.kpi;
  const ga = data.connections.ga4.length > 0;
  const gsc = data.connections.gsc.length > 0;
  return (
    <Layout>
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Seg value={days} options={[['7', '7 hari'], ['30', '30 hari'], ['90', '90 hari']]} onChange={setDays} />
          <span className="spacer" />
          <span className={`pill ${ga ? 'olive' : ''}`}>GA4 {ga ? 'terhubung' : 'belum'}</span>
          <span className={`pill ${gsc ? 'olive' : ''}`}>Search Console {gsc ? 'terhubung' : 'belum'}</span>
          <span className={`pill ${data.connections.uptime ? 'olive' : ''}`}>Pemantau {data.connections.uptime ? `${data.connections.uptime} website` : 'belum'}</span>
          {me.user.role === 'admin' && (
            <Link className="btn ghost sm" to="/pengaturan/integrasi">
              Kelola integrasi
            </Link>
          )}
        </div>

        {data.status.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {data.status.map((s: any) => (
              <div key={s.url} className="card" style={{ borderLeft: `4px solid ${s.up === false ? STATUS.bad : s.up ? STATUS.good : 'var(--charcoal-300)'}` }}>
                <div className="row" style={{ gap: 8 }}>
                  <b className="small" style={{ flex: 1 }}>
                    {s.name}
                  </b>
                  <span className={`pill ${s.up === false ? 'hot' : s.up ? 'olive' : ''}`}>{s.up === false ? 'Tidak bisa dibuka' : s.up ? 'Hidup' : 'Menunggu cek'}</span>
                </div>
                <div className="xs muted" style={{ marginTop: 6 }}>
                  Uptime {s.uptimePct === null ? '—' : `${s.uptimePct.toLocaleString('id-ID')}%`} · rata-rata {s.avgMs ? `${(s.avgMs / 1000).toFixed(1)} dtk` : '—'} · cek {s.checkedAt ? relative(s.checkedAt) : '—'}
                </div>
                <a className="xs" href={s.url} target="_blank" rel="noreferrer">
                  Buka website ↗
                </a>
              </div>
            ))}
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Stat k="Pengunjung" v={n(k.users)} s={ga ? trend(k.users, k.usersPrev) : 'hubungkan GA4'} />
          <Stat k="Sesi" v={n(k.sessions)} s={ga ? trend(k.sessions, k.sessionsPrev) : ''} />
          <Stat k="Rata durasi sesi" v={k.avgSessionSec ? `${Math.floor(k.avgSessionSec / 60)}m ${k.avgSessionSec % 60}d` : '—'} />
          <Stat k="Klik dari Google" v={n(k.searchClicks)} s={gsc ? 'Search Console' : 'hubungkan Search Console'} />
          <Stat k="Lead dari website" v={n(k.leads)} s={`${trend(k.leads, k.leadsPrev)} · ${k.closings} closing`} />
          <Stat k="Konversi sesi → lead" v={k.conversion === null ? '—' : `${k.conversion.toLocaleString('id-ID')}%`} s="form, widget & tombol WA" />
        </div>

        {data.alerts.length > 0 && (
          <Card title="Yang perlu diperhatikan">
            {data.alerts.map((a: any, i: number) => (
              <div key={i} className={`banner ${a.level === 'bad' ? 'red' : a.level === 'warn' ? '' : 'info'}`} style={{ marginTop: i ? 8 : 0 }}>
                {a.text}
              </div>
            ))}
          </Card>
        )}

        {!ga ? (
          <Empty>Grafik pengunjung, sumber trafik, dan halaman teratas muncul setelah Google Analytics 4 terhubung di Pengaturan › Integrasi. Lead dari website sudah dihitung dari CRM sekarang.</Empty>
        ) : (
          <>
            <Card title="Pengunjung per hari">
              <Columns data={data.daily.map((d: any) => ({ label: `${Number(d.day.slice(8))}/${Number(d.day.slice(5, 7))}`, values: [d.users] }))} series={[{ name: 'Pengunjung', color: SERIES.rose }]} height={190} />
            </Card>
            <div className="grid grid-2" style={{ alignItems: 'start' }}>
              <Card title="Sumber trafik" sub="Sesi per kanal (GA4)">
                {data.channels.length ? <HBars rows={data.channels.slice(0, 8).map((c: any) => ({ label: c.channel, value: c.sessions }))} color={SERIES.olive} labelWidth={140} /> : <Empty>—</Empty>}
              </Card>
              <Card title="Halaman teratas" sub="Paling sering dibuka">
                {data.pages.length ? <HBars rows={data.pages.map((p: any) => ({ label: p.page, value: p.views }))} color={SERIES.gold} labelWidth={200} /> : <Empty>—</Empty>}
              </Card>
            </div>
          </>
        )}
        <Card title="Kata kunci Google" sub="Dari Search Console · data terlambat ±2 hari · posisi rata-rata di hasil pencarian">
          {!data.keywords.length ? (
            <Empty>{gsc ? 'Belum ada data kata kunci.' : 'Hubungkan Search Console untuk melihat kata kunci.'}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Kata kunci</th>
                    <th style={{ textAlign: 'right' }}>Klik</th>
                    <th style={{ textAlign: 'right' }}>Tayang</th>
                    <th style={{ textAlign: 'right' }}>Posisi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.keywords.map((q: any) => (
                    <tr key={q.query}>
                      <td>{q.query}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{n(q.clicks)}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{n(q.impressions)}</td>
                      <td className="tnum" style={{ textAlign: 'right', color: q.position && q.position <= 3 ? STATUS.good : q.position && q.position > 10 ? STATUS.bad : undefined }}>
                        {q.position === null ? '—' : q.position.toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
}
