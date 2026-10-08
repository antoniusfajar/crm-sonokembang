import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Loading, Seg } from '../components/ui';
import { Columns, HBars, Legend, Meter, Ring, SERIES, statusColor } from '../components/charts';
import { usePipelines } from '../components/LeadActions';
import { initials, rupiahShort } from '../format';
import { WeeklySummaryCard } from './WeeklySummary';

type Tab = 'ring' | 'sales' | 'mkt';
type PeriodKey = 'this_month' | 'last_month' | 'this_quarter' | 'this_year';

const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);

function Delta({ now, prev, invert }: { now: number | null; prev: number | null; invert?: boolean }) {
  if (now === null || prev === null || prev === 0) return null;
  const d = Math.round(((now - prev) / prev) * 1000) / 10;
  const good = invert ? d < 0 : d > 0;
  return <span className={`delta ${d === 0 ? 'flat' : good ? 'up' : 'down'}`}>{d > 0 ? '↑' : d < 0 ? '↓' : '·'} {Math.abs(d).toLocaleString('id-ID')}%</span>;
}

export function DashboardPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>(me.user.role === 'marketing' ? 'mkt' : me.user.role === 'spv' ? 'sales' : 'ring');
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const [pipelineId, setPipelineId] = useState('');
  const { data: pd } = usePipelines();
  const q = qs({ period, pipelineId });
  const sum = useQuery<any>({ queryKey: ['an-summary', q], queryFn: () => api.get('/api/analytics/summary' + q) });
  const pipeName = pd?.pipelines.find((p: any) => p.id === pipelineId)?.name;
  return (
    <Layout flush>
      <div className="toolbar">
        <Seg value={tab} options={[['ring', 'Ringkasan'], ['sales', 'Sales'], ['mkt', 'Marketing']]} onChange={setTab} />
        <div className="row wrap" style={{ gap: 6 }}>
          <button className={`chip${!pipelineId ? ' on' : ''}`} onClick={() => setPipelineId('')}>
            Semua pipeline
          </button>
          {pd?.pipelines.map((p: any) => (
            <button key={p.id} className={`chip${pipelineId === p.id ? ' on' : ''}`} onClick={() => setPipelineId(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <Seg
          value={period}
          options={[
            ['this_month', 'Bulan ini'],
            ['last_month', 'Bulan lalu'],
            ['this_quarter', 'Kuartal'],
            ['this_year', 'Tahun ini'],
          ]}
          onChange={setPeriod}
        />
      </div>
      <div className="content">
        {sum.data && (
          <div className="small muted" style={{ marginBottom: 14 }}>
            {sum.data.period.label} · dibanding {sum.data.period.prevLabel} · {pipeName ?? 'semua pipeline'}
            {me.user.scope === 'own' ? ' · data milik Anda' : ''} · omzet = nilai order saat closing (DP masuk)
          </div>
        )}
        {tab === 'ring' && <Ringkasan sum={sum.data} q={q} pipelineId={pipelineId} onPipeline={setPipelineId} />}
        {tab === 'sales' && <SalesTab q={q} />}
        {tab === 'mkt' && <MarketingTab q={q} range={sum.data?.period} />}
      </div>
    </Layout>
  );
}

function Ringkasan({ sum, q, pipelineId, onPipeline }: { sum: any; q: string; pipelineId: string; onPipeline: (id: string) => void }) {
  const trend = useQuery<any[]>({ queryKey: ['an-trend', pipelineId], queryFn: () => api.get('/api/analytics/trend' + qs({ pipelineId })) });
  if (!sum) return <Loading />;
  const k = sum.kpi;
  const thisYear = new Date().getFullYear();
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div className="card">
          <div className="stat-k">Lead masuk</div>
          <div className="stat-v">{k.leadIn.toLocaleString('id-ID')}</div>
          <div className="stat-s row" style={{ gap: 6 }}>
            <Delta now={k.leadIn} prev={k.leadInPrev} /> vs periode lalu
          </div>
        </div>
        <div className="card">
          <div className="stat-k">Peluang dibuat</div>
          <div className="stat-v">{k.created.toLocaleString('id-ID')}</div>
          <div className="stat-s">{fmtPct(k.createdPctOfLeadIn)} dari lead masuk</div>
        </div>
        <div className="card">
          <div className="stat-k">Closing (DP)</div>
          <div className="stat-v">{k.closings}</div>
          <div className="stat-s row" style={{ gap: 6 }}>
            <Delta now={k.closings} prev={k.closingsPrev} /> peluang won
          </div>
        </div>
        <div className="card">
          <div className="stat-k">Omzet won</div>
          <div className="stat-v">{rupiahShort(k.omzet)}</div>
          <div className="stat-s">{k.target ? `${fmtPct(k.targetPct)} dari target` : 'target belum diisi'}</div>
        </div>
        <div className="card">
          <div className="stat-k">Konversi peluang</div>
          <div className="stat-v">{fmtPct(k.conversion)}</div>
          <div className="stat-s">won ÷ peluang dibuat</div>
        </div>
        <div className="card">
          <div className="stat-k">Respons sales</div>
          <div className="stat-v" style={{ color: k.responseAvg !== null && k.responseAvg > k.responseTarget ? STATUS_BAD : undefined }}>{k.responseAvg === null ? '—' : `${k.responseAvg} mnt`}</div>
          <div className="stat-s">
            ideal {k.responseIdeal} · maks {k.responseTarget} mnt
          </div>
        </div>
      </div>

      <Card title="Konversi per pipeline" sub="peluang won ÷ peluang dibuat · klik untuk memfilter">
        <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))` }}>
          {sum.pipelines.map((p: any) => (
            <button key={p.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', borderColor: pipelineId === p.id ? 'var(--rose-400)' : undefined }} onClick={() => onPipeline(pipelineId === p.id ? '' : p.id)}>
              <div className="row">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
                <b>{p.name}</b>
                <span className="spacer" />
                <span className="xs muted">porsi target {p.targetShare}%</span>
              </div>
              <div style={{ margin: '14px 0' }}>
                <Ring pct={p.conversion} color={p.color}>
                  <div>
                    <div style={{ font: '700 20px/1.1 var(--font-body)', color: 'var(--text-heading)' }}>{fmtPct(p.conversion)}</div>
                    <div className="xs muted">
                      {p.won} won · {p.lost} lost
                    </div>
                  </div>
                </Ring>
              </div>
              <div className="xs muted" style={{ textAlign: 'center' }}>
                Omzet won
              </div>
              <div style={{ textAlign: 'center', font: '700 18px/1.3 var(--font-body)', color: 'var(--text-heading)' }}>{rupiahShort(p.omzet)}</div>
              <div style={{ margin: '8px 0 4px' }}>
                <Meter pct={p.targetPct} color={p.color} />
              </div>
              <div className="xs muted" style={{ textAlign: 'center' }}>
                {p.target ? `${fmtPct(p.targetPct)} dari target ${rupiahShort(p.target)}` : 'target belum diisi'}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Omzet vs target">
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
            <span style={{ font: '700 28px/1.2 var(--font-body)', color: 'var(--text-heading)' }}>{rupiahShort(k.omzet)}</span>
            <span className="small muted">dari {k.target ? rupiahShort(k.target) : 'target belum diisi'}</span>
            {k.target > 0 && <span className="pill warm">{fmtPct(k.targetPct)}</span>}
          </div>
          <div style={{ margin: '10px 0 16px' }}>
            <Meter pct={k.targetPct} color={statusColor(k.targetPct)} height={10} />
          </div>
          {sum.pipelines.map((p: any) => (
            <div key={p.id} className="grid" style={{ gridTemplateColumns: '110px 1fr auto', gap: 12, alignItems: 'center', padding: '5px 0' }}>
              <span className="small bold">{p.name}</span>
              <Meter pct={p.targetPct} color={p.color} />
              <span className="small tnum nowrap">
                {rupiahShort(p.omzet)} / {p.target ? rupiahShort(p.target) : '—'}
              </span>
            </div>
          ))}
          <div className="hint" style={{ marginTop: 10 }}>
            Porsi target per pipeline diatur di Pengaturan › Pipeline; target tim di <Link to="/pengaturan/target">Pengaturan › Target omzet</Link>.
          </div>
        </Card>
        <Card title="Peluang yang sedang dikejar" sub="Posisi hari ini — tidak terpengaruh filter periode">
          <div className="grid grid-2" style={{ marginBottom: 14 }}>
            <div className="card" style={{ padding: 14 }}>
              <div className="stat-k">Peluang aktif</div>
              <div className="stat-v">{sum.active.reduce((a: number, x: any) => a + x.active, 0)}</div>
              <div className="stat-s">semua yang masih dikejar</div>
            </div>
            <div className="card" style={{ padding: 14, background: 'var(--rose-100)', borderColor: '#f3c9c9' }}>
              <div className="stat-k" style={{ color: 'var(--red-700)' }}>
                Peluang tahun ini
              </div>
              <div className="stat-v">{sum.active.reduce((a: number, x: any) => a + x.thisYear, 0)}</div>
              <div className="stat-s">perkiraan DP (atau tgl acara) ≤ Des {thisYear}</div>
            </div>
          </div>
          {sum.active.map((a: any) => (
            <div key={a.id} className="grid" style={{ gridTemplateColumns: '110px 1fr auto', gap: 12, alignItems: 'center', padding: '5px 0' }}>
              <span className="small bold">{a.name}</span>
              <Meter pct={a.active ? (a.thisYear / a.active) * 100 : 0} color={a.color} />
              <span className="small tnum">
                {a.thisYear} / {a.active}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(280px, 1fr)' }}>
        <Card
          title="Tren lead per bulan"
          actions={
            <Legend
              items={[
                { name: '12 bulan terakhir', color: SERIES.rose },
                { name: 'Tahun sebelumnya', color: SERIES.olive },
              ]}
            />
          }
        >
          {trend.data ? (
            <Columns
              data={trend.data.map((m) => ({ label: m.label, values: [m.current, m.previous] }))}
              series={[
                { name: '12 bulan terakhir', color: SERIES.rose },
                { name: 'Tahun sebelumnya', color: SERIES.olive },
              ]}
            />
          ) : (
            <Loading />
          )}
          {trend.data && <TrendNote rows={trend.data} />}
        </Card>
        <WeeklySummaryCard pipelineId={pipelineId} />
      </div>
    </div>
  );
}

const STATUS_BAD = '#c6040d';

function TrendNote({ rows }: { rows: { label: string; current: number; previous: number }[] }) {
  const cur = rows.reduce((a, r) => a + r.current, 0);
  const prev = rows.reduce((a, r) => a + r.previous, 0);
  const peak = rows.reduce((a, r) => (r.current > a.current ? r : a), rows[0]!);
  return (
    <div className="hint" style={{ marginTop: 6 }}>
      12 bulan terakhir: {cur.toLocaleString('id-ID')} lead{prev ? ` vs ${prev.toLocaleString('id-ID')} di periode yang sama sebelumnya` : ''}. Puncak di {peak.label} ({peak.current}). Bulan berjalan belum penuh.
    </div>
  );
}

function SalesTab({ q }: { q: string }) {
  const { data } = useQuery<any>({ queryKey: ['an-sales', q], queryFn: () => api.get('/api/analytics/sales' + q) });
  const kpi = useQuery<any>({ queryKey: ['setting', 'kpi_targets'], queryFn: () => api.get('/api/settings/kpi_targets') });
  if (!data) return <Loading />;
  const respLimit = kpi.data?.responseMinutes ?? 15;
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(280px, 1fr)' }}>
        <Card title="Funnel per tahap" sub="Lead yang dibuat di periode ini, sampai tahap mana mereka pernah sampai.">
          <HBars
            rows={data.funnel.map((f: any) => ({ label: f.name, value: f.n, note: f.dropPct !== null ? <span className="xs" style={{ color: f.dropPct >= 40 ? 'var(--red-700)' : 'var(--text-muted)' }}>−{f.dropPct}% gugur</span> : null }))}
            color={SERIES.rose}
          />
          <div className="hint" style={{ marginTop: 8 }}>
            Angka merah = persentase yang gugur dari tahap sebelumnya. Tahap dengan gugur terbesar adalah prioritas coaching.
          </div>
        </Card>
        <Card title="Peluang mandek > 14 hari" sub="Tidak ada aktivitas chat/follow-up dalam 14 hari terakhir">
          {!data.stale.length && <Empty>Tidak ada peluang mandek. 👍</Empty>}
          {data.stale.map((s: any) => (
            <div key={s.stage} className="row" style={{ padding: '9px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ flex: 1 }}>
                <div className="small bold">{s.stage}</div>
                <div className="xs muted">est. nilai {rupiahShort(s.value)}</div>
              </div>
              <span className="pill hot">{s.n} peluang</span>
            </div>
          ))}
          {data.stale.length > 0 && (
            <Link to="/leads" className="btn outline-rose block" style={{ marginTop: 10 }}>
              Bersihkan di pipeline →
            </Link>
          )}
        </Card>
      </div>

      <Card title="Leaderboard tim" sub={`Respons = waktu balasan sales setelah serah terima AI (menit jam kerja) · merah bila > ${respLimit} menit. SLA = dibalas sebelum level 1 (${data.slaLevel1} menit).`}>
        <div className="table-wrap">
          <table className="table tnum">
            <thead>
              <tr>
                <th>Sales</th>
                <th>Lead</th>
                <th>Peluang aktif</th>
                <th>Tahun ini</th>
                <th>Proposal</th>
                <th>Closing</th>
                <th>Omzet</th>
                <th style={{ minWidth: 150 }}>vs target</th>
                <th>Konversi</th>
                <th>Follow-up</th>
                <th>SLA</th>
                <th>Respons</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <div className="row">
                      <span className="avatar">{initials(r.name)}</span>
                      <div>
                        <b>{r.name}</b>
                        <div className="xs muted">{r.role === 'spv' ? 'SPV' : 'Sales'}</div>
                      </div>
                    </div>
                  </td>
                  <td>{r.leads}</td>
                  <td>{r.active}</td>
                  <td>{r.thisYear}</td>
                  <td>{r.proposals}</td>
                  <td className="bold">{r.closings}</td>
                  <td className="bold nowrap">{rupiahShort(r.omzet)}</td>
                  <td>
                    {r.target ? (
                      <div className="row" style={{ gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <Meter pct={r.targetPct} color={statusColor(r.targetPct)} />
                        </div>
                        <span className="xs bold">{fmtPct(r.targetPct)}</span>
                      </div>
                    ) : (
                      <span className="xs muted">target belum diisi</span>
                    )}
                  </td>
                  <td>{fmtPct(r.conversion)}</td>
                  <td>{fmtPct(r.followUpPct)}</td>
                  <td>{fmtPct(r.slaPct)}</td>
                  <td className="bold" style={{ color: r.responseAvg !== null && r.responseAvg > respLimit ? STATUS_BAD : undefined }}>
                    {r.responseAvg === null ? '—' : `${r.responseAvg} mnt`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.leaderboard.length && <Empty>Belum ada sales.</Empty>}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Alasan kalah (Lost / Abandoned)" sub="Alasan wajib dipilih saat lead ditutup — inilah sumber grafik ini.">
          {!data.lost.length ? (
            <Empty>Belum ada lead yang ditutup Lost di periode ini.</Empty>
          ) : (
            <HBars rows={data.lost.map((l: any) => ({ label: l.reason, value: l.n, note: <span className="xs muted">· {fmtPct(l.pct)}{l.abandoned ? ` · ${l.abandoned} abandoned` : ''}</span> }))} color={SERIES.rose} labelWidth={190} />
          )}
        </Card>
        <Card title="SLA terpenuhi per sales" sub={`Persentase serah terima AI yang dibalas sebelum ${data.slaLevel1} menit (jam kerja).`}>
          <HBars
            rows={data.leaderboard.filter((r: any) => r.slaPct !== null).map((r: any) => ({ label: r.name, value: r.slaPct, note: <span className="xs muted">· rata-rata {r.responseAvg ?? '—'} mnt</span>, color: statusColor(r.slaPct, 90, 75) }))}
            color={SERIES.olive}
            format={(n) => `${n.toLocaleString('id-ID')}%`}
            labelWidth={120}
          />
          {!data.leaderboard.some((r: any) => r.slaPct !== null) && <Empty>Belum ada serah terima di periode ini.</Empty>}
        </Card>
      </div>
    </div>
  );
}

function MarketingTab({ q, range }: { q: string; range?: { start: string; end: string } }) {
  const { data } = useQuery<any>({ queryKey: ['an-mkt', q], queryFn: () => api.get('/api/analytics/marketing' + q) });
  if (!data) return <Loading />;
  const maxShare = Math.max(1, ...data.sources.map((s: any) => s.share ?? 0));
  return (
    <div className="stack">
      <Card title="Sumber lead → closing → omzet" sub="Kanal mana yang benar-benar menghasilkan uang. Biaya diisi dari Meta Ads (atau input manual di menu Meta Ads) dan tagihan broadcast WhatsApp.">
        <div className="table-wrap">
          <table className="table tnum">
            <thead>
              <tr>
                <th>Sumber</th>
                <th>Lead</th>
                <th style={{ minWidth: 180 }}>Porsi lead</th>
                <th>Closing</th>
                <th>Konversi</th>
                <th>Omzet</th>
                <th>Biaya</th>
                <th>Biaya / lead</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s: any) => (
                <tr key={s.name}>
                  <td className="bold">{s.name}</td>
                  <td>{s.leads}</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <Meter pct={((s.share ?? 0) / maxShare) * 100} color={SERIES.rose} />
                      </div>
                      <span className="xs">{fmtPct(s.share)}</span>
                    </div>
                  </td>
                  <td>{s.closings}</td>
                  <td className="bold">{fmtPct(s.conversion)}</td>
                  <td className="bold nowrap">{rupiahShort(s.omzet)}</td>
                  <td className={s.cost ? 'nowrap' : 'muted'}>{s.cost ? rupiahShort(s.cost) : '—'}</td>
                  <td className={s.costPerLead ? 'bold nowrap' : 'muted'}>{s.costPerLead ? rupiahShort(s.costPerLead) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.sources.length && <Empty>Belum ada lead di periode ini.</Empty>}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Sumber "Tidak diketahui" yang besar berarti link WA per kanal belum dipakai — buat di Pengaturan › Sumber lead & link WA.
        </div>
      </Card>
      {range && <MarketingChannels from={range.start} to={range.end} />}
    </div>
  );
}

function MarketingChannels({ from, to }: { from: string; to: string }) {
  const me = useMe();
  const has = (k: string) => me.menus.some((g) => g.items.some((i) => i.key === k));
  const rq = qs({ from, to });
  const ads = useQuery<any>({ queryKey: ['mkt-ads', rq], queryFn: () => api.get('/api/ads' + rq) });
  const soc = useQuery<any>({ queryKey: ['mkt-soc', rq], queryFn: () => api.get('/api/social' + rq) });
  const web = useQuery<any>({ queryKey: ['mkt-web', rq], queryFn: () => api.get('/api/website' + rq) });
  const rep = useQuery<any>({ queryKey: ['rep-summary', 30], queryFn: () => api.get('/api/reputation/summary?days=30') });
  const link = (k: string, path: string) => (has(k) ? <Link to={path} className="xs">Buka →</Link> : null);
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('id-ID'));
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      <Card title="Iklan Meta" actions={link('ads', '/ads')}>
        {!ads.data ? <Loading /> : (
          <div className="kv2">
            <span>Belanja</span><b>{rupiahShort(ads.data.kpi.spend)}</b>
            <span>Lead dari iklan</span><b>{n(ads.data.kpi.leads)}</b>
            <span>Biaya / lead</span><b>{ads.data.kpi.cpl ? rupiahShort(ads.data.kpi.cpl) : '—'}</b>
            <span>Closing · ROAS</span><b>{n(ads.data.kpi.closings)} · {ads.data.kpi.roas ? `${ads.data.kpi.roas.toLocaleString('id-ID')}×` : '—'}</b>
          </div>
        )}
      </Card>
      <Card title="Media sosial" actions={link('sosmed', '/sosmed')}>
        {!soc.data ? <Loading /> : (
          <div className="kv2">
            <span>Posting</span><b>{n(soc.data.kpi.posts)}</b>
            <span>Impressions</span><b>{n(soc.data.kpi.impressions)}</b>
            <span>Likes · komentar</span><b>{n(soc.data.kpi.likes)} · {n(soc.data.kpi.comments)}</b>
            <span>Akun terhubung</span><b>{soc.data.perPlatform.filter((p: any) => p.connected).length} / 3</b>
          </div>
        )}
      </Card>
      <Card title="Website" actions={link('website', '/website')}>
        {!web.data ? <Loading /> : (
          <div className="kv2">
            <span>Pengunjung</span><b>{n(web.data.kpi.users)}</b>
            <span>Lead dari website</span><b>{n(web.data.kpi.leads)}</b>
            <span>Konversi sesi → lead</span><b>{web.data.kpi.conversion === null ? '—' : `${web.data.kpi.conversion.toLocaleString('id-ID')}%`}</b>
            <span>Status</span><b>{web.data.status.length ? (web.data.status.some((x: any) => x.up === false) ? 'Ada yang mati' : 'Semua hidup') : 'Belum dipantau'}</b>
          </div>
        )}
      </Card>
      <Card title="Reputasi Google" actions={link('reputasi', '/reputasi')}>
        {!rep.data ? <Loading /> : (
          <div className="kv2">
            <span>Rating total</span><b>{rep.data.kpi.totalAvg ? `${rep.data.kpi.totalAvg.toLocaleString('id-ID')} ★` : '—'}</b>
            <span>Ulasan 30 hari</span><b>{n(rep.data.kpi.count)}</b>
            <span>Belum dibalas</span><b>{n(rep.data.kpi.unreplied)}</b>
            <span>Total ulasan</span><b>{n(rep.data.kpi.total)}</b>
          </div>
        )}
      </Card>
    </div>
  );
}
