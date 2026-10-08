import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../api';
import { useMe } from '../../auth';
import { Card, Empty, Field, Loading, MoneyInput, useToast } from '../../components/ui';
import { Meter, statusColor } from '../../components/charts';
import { usePipelines } from '../../components/LeadActions';
import { rupiahShort } from '../../format';
import { useSaveSetting, useSetting } from './TabsA';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (k: string) => `${BULAN[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
const shift = (k: string, n: number) => monthKey(new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1 + n, 1));

interface Targets {
  month: string;
  team: number;
  teamRealized: number;
  sales: { id: string; name: string; role: string; status: string; target: number; realized: number }[];
}

/** Hari kerja tersisa di bulan berjalan (termasuk hari ini), mengikuti hari buka di Jam kerja. */
function workDaysLeft(month: string, days: number[]) {
  const now = new Date();
  if (monthKey(now) !== month) return null;
  let n = 0;
  for (let d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.getMonth() === now.getMonth(); d.setDate(d.getDate() + 1)) {
    if (days.includes(d.getDay())) n++;
  }
  return n;
}

const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function TargetTab() {
  const me = useMe();
  const ro = me.user.role !== 'admin';
  const toast = useToast();
  const qc = useQueryClient();
  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(thisMonth);
  const { data } = useQuery<Targets>({ queryKey: ['targets', month], queryFn: () => api.get('/api/targets' + qs({ month })) });
  const { data: wh } = useSetting<{ days: number[] }>('working_hours');
  const { data: pd } = usePipelines();
  const [team, setTeam] = useState<number | null>(0);
  const [rows, setRows] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!data) return;
    setTeam(data.team);
    setRows(Object.fromEntries(data.sales.map((s) => [s.id, s.target])));
  }, [data]);

  const active = useMemo(() => (data?.sales ?? []).filter((s) => s.status !== 'nonaktif'), [data]);
  const totalSales = Object.values(rows).reduce<number>((a, v) => a + (v ?? 0), 0);
  const empty = !!data && !data.team && data.sales.every((s) => !s.target);
  const left = wh ? workDaysLeft(month, wh.days) : null;

  const save = async () => {
    try {
      await api.put('/api/targets', { month, team: team ?? 0, sales: Object.entries(rows).map(([id, t]) => ({ id, target: t ?? 0 })) });
      toast(`Target ${monthLabel(month)} disimpan`);
      qc.invalidateQueries({ queryKey: ['targets'] });
      qc.invalidateQueries({ queryKey: ['an-summary'] });
      qc.invalidateQueries({ queryKey: ['an-sales'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const splitEven = () => {
    const ppl = active.filter((s) => s.role === 'sales');
    if (!ppl.length || !team) return toast('Isi target tim dulu, dan pastikan ada sales aktif', true);
    const each = Math.ceil(team / ppl.length / 1_000_000) * 1_000_000;
    setRows((r) => ({ ...r, ...Object.fromEntries(ppl.map((s) => [s.id, each])) }));
    toast(`Dibagi rata ke ${ppl.length} sales · ${rupiahShort(each)} per orang. Klik Simpan untuk menyimpan.`);
  };

  const copyPrev = async () => {
    try {
      const r = await api.post<{ copied: number }>('/api/targets/copy', { from: shift(month, -1), to: month });
      toast(r.copied ? `Target ${monthLabel(shift(month, -1))} disalin` : `${monthLabel(shift(month, -1))} belum punya target`, !r.copied);
      qc.invalidateQueries({ queryKey: ['targets', month] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  if (!data || !wh) return <Loading />;
  const teamPct = pctOf(data.teamRealized, data.team);
  const months = [-2, -1, 0, 1, 2, 3].map((n) => shift(thisMonth, n));

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', alignItems: 'start' }}>
      <Card
        title="Target omzet"
        sub="Omzet = nilai total order saat closing (DP masuk). Dipakai di Dashboard, leaderboard & laporan."
        actions={
          !ro && (
            <div className="row" style={{ gap: 6 }}>
              {empty && (
                <button className="btn sm" onClick={copyPrev}>
                  Salin dari {monthLabel(shift(month, -1))}
                </button>
              )}
              <button className="btn primary sm" onClick={save}>
                Simpan target
              </button>
            </div>
          )
        }
      >
        <div className="row wrap" style={{ gap: 14, alignItems: 'flex-end' }}>
          <Field label="Periode">
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {m === thisMonth ? ' (berjalan)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target omzet tim / bulan">
            <MoneyInput value={team} onChange={setTeam} disabled={ro} style={{ width: 220 }} />
          </Field>
          <div className="small muted" style={{ paddingBottom: 8 }}>
            Realisasi <b className="tnum" style={{ color: 'var(--text-heading)' }}>{rupiahShort(data.teamRealized)}</b>
            {teamPct !== null && ` · ${teamPct.toLocaleString('id-ID')}%`}
            {left !== null && (
              <>
                <br />
                Sisa {left} hari kerja
              </>
            )}
          </div>
        </div>
        {data.team > 0 && <Meter pct={teamPct} color={statusColor(teamPct)} height={8} />}

        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Sales</th>
                <th style={{ width: 200 }}>Target bulan ini</th>
                <th>Realisasi</th>
                <th style={{ width: 180 }}>Pencapaian</th>
              </tr>
            </thead>
            <tbody>
              {data.sales.map((s) => {
                const p = pctOf(s.realized, rows[s.id] ?? 0);
                return (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b>
                      <div className="xs muted">
                        {s.role === 'spv' ? 'SPV' : 'Sales'}
                        {s.status === 'nonaktif' ? ' · nonaktif' : ''}
                      </div>
                    </td>
                    <td>
                      <MoneyInput value={rows[s.id] ?? null} onChange={(v) => setRows((r) => ({ ...r, [s.id]: v }))} disabled={ro} />
                    </td>
                    <td className="tnum">{rupiahShort(s.realized)}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <Meter pct={p} color={statusColor(p)} />
                        </div>
                        <span className="small tnum" style={{ width: 48, textAlign: 'right' }}>
                          {p === null ? '—' : `${p.toLocaleString('id-ID')}%`}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
          {!ro && (
            <button className="btn ghost sm" onClick={splitEven}>
              Bagi rata otomatis
            </button>
          )}
          <span className="small muted">
            Total target sales {rupiahShort(totalSales)}
            {team ? (totalSales > team ? ' — di atas target tim, selisih jadi bantalan.' : totalSales < team ? ` — kurang ${rupiahShort(team - totalSales)} dari target tim.` : ' — pas dengan target tim.') : ''}
          </span>
        </div>
      </Card>

      <div>
        <Card title="Porsi per pipeline" sub="Target tim dibagi menurut porsi. Ubah porsinya di Pengaturan › Pipeline.">
          {pd?.pipelines.map((p: any) => (
            <div key={p.id} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flex: 'none' }} />
              <span className="small" style={{ flex: 1 }}>
                {p.name}
              </span>
              <span className="small muted tnum">{p.targetShare}%</span>
              <b className="small tnum" style={{ width: 90, textAlign: 'right' }}>
                {rupiahShort(Math.round(((team ?? 0) * p.targetShare) / 100))}
              </b>
            </div>
          ))}
          <Link to="/pengaturan/pipeline" className="small">
            Atur porsi pipeline →
          </Link>
        </Card>
        <KpiTargetsCard ro={ro} />
      </div>
    </div>
  );
}

function KpiTargetsCard({ ro }: { ro: boolean }) {
  const { data } = useSetting<{ responseMinutes: number; responseIdeal: number; followUpPct: number; closingRatePct: number }>('kpi_targets');
  const save = useSaveSetting('kpi_targets');
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => data && setV(Object.fromEntries(Object.entries(data).map(([k, x]) => [k, String(x)]))), [data]);
  if (!data) return <Loading />;
  const items: [string, string, string][] = [
    ['responseMinutes', 'Respons maksimal', 'menit · lewat ini merah di dashboard'],
    ['responseIdeal', 'Respons ideal', 'menit'],
    ['followUpPct', 'Follow-up terlaksana', '% lead aktif yang dibalas'],
    ['closingRatePct', 'Closing rate', '% peluang jadi DP'],
  ];
  return (
    <Card
      title="Target KPI"
      sub="Batas ini dipakai untuk warna di dashboard dan ringkasan mingguan."
      actions={!ro && <button className="btn primary sm" onClick={() => save(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x) || 0])))}>Simpan</button>}
    >
      <div className="grid grid-2" style={{ gap: 10 }}>
        {items.map(([k, label, hint]) => (
          <Field key={k} label={label} hint={hint}>
            <input className="input" type="number" min={0} disabled={ro} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
    </Card>
  );
}

interface Calibration {
  closedLeads: number;
  bands: { range: string; leads: number; won: number; closingRate: number | null }[];
}

const MIN_CLOSED = 50;

/**
 * Closing rate per rentang skor (lead yang sudah selesai 180 hari terakhir) — dasar menggeser ambang Hot/Warm.
 * Saran: Hot = rentang terendah yang closing rate-nya ≥ 1,5× rata-rata; Warm = rentang terendah yang ≥ ½ rata-rata
 * (semua rentang di atasnya juga harus lolos), hanya dari rentang dengan ≥ 10 lead.
 */
export function ScoreCalibrationCard({ hot, warm, ro, onApply }: { hot: number; warm: number; ro: boolean; onApply: (hot: number, warm: number) => void }) {
  const { data } = useQuery<Calibration>({ queryKey: ['score-calibration'], queryFn: () => api.get('/api/analytics/score-calibration') });
  if (!data) return <Loading />;
  const won = data.bands.reduce((a, b) => a + b.won, 0);
  const overall = data.closedLeads ? (won / data.closedLeads) * 100 : 0;
  const lo = (r: string) => Number(r.split('–')[0]);
  const usable = data.bands.filter((b) => b.leads >= 10 && b.closingRate !== null);
  const lowestFrom = (min: number) => {
    let pick: number | null = null;
    for (let i = usable.length - 1; i >= 0; i--) {
      if (usable[i]!.closingRate! >= min) pick = lo(usable[i]!.range);
      else break;
    }
    return pick;
  };
  const sugHot = lowestFrom(overall * 1.5);
  const sugWarm = lowestFrom(overall * 0.5);
  const enoughData = data.closedLeads >= MIN_CLOSED;
  const enough = enoughData && sugHot !== null && sugWarm !== null && sugWarm < sugHot;
  const max = Math.max(1, ...data.bands.map((b) => b.closingRate ?? 0));
  return (
    <Card
      title="Kalibrasi skor"
      sub={`Closing rate per rentang skor dari ${data.closedLeads.toLocaleString('id-ID')} lead yang sudah selesai (won/lost) 180 hari terakhir. Rata-rata ${overall.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%.`}
    >
      {data.closedLeads === 0 ? (
        <Empty>Belum ada lead yang selesai. Kalibrasi bisa dilakukan setelah 1–2 bulan data.</Empty>
      ) : (
        <>
          {data.bands.map((b) => {
            const cat = lo(b.range) >= hot ? 'Hot' : lo(b.range) >= warm ? 'Warm' : 'Cold';
            return (
              <div key={b.range} className="hbar-row" style={{ gridTemplateColumns: '64px 48px minmax(0,1fr) 120px' }}>
                <span className="small tnum">{b.range}</span>
                <span className={`pill ${cat === 'Hot' ? 'hot' : cat === 'Warm' ? 'warm' : 'cold'}`}>{cat}</span>
                <div className="hbar-track">
                  <span style={{ width: `${((b.closingRate ?? 0) / max) * 100}%`, background: cat === 'Hot' ? '#db6262' : cat === 'Warm' ? '#c8861f' : 'var(--charcoal-300)' }} />
                </div>
                <span className="small tnum" style={{ textAlign: 'right' }}>
                  <b>{b.closingRate === null ? '—' : `${b.closingRate.toLocaleString('id-ID')}%`}</b>{' '}
                  <span className="xs muted">
                    {b.won}/{b.leads}
                  </span>
                </span>
              </div>
            );
          })}
          <div className="banner info" style={{ marginTop: 12 }}>
            {!enoughData ? (
              `Data belum cukup untuk saran yang bisa dipercaya (butuh ≥ ${MIN_CLOSED} lead selesai). Ambang sekarang: Hot ≥ ${hot}, Warm ≥ ${warm}.`
            ) : !enough ? (
              `Closing rate belum naik rapi seiring skor, jadi belum ada saran ambang. Cek dulu poin per data di kartu Skor lead. Ambang sekarang: Hot ≥ ${hot}, Warm ≥ ${warm}.`
            ) : sugHot === Number(hot) && sugWarm === Number(warm) ? (
              `Ambang sekarang (Hot ≥ ${hot}, Warm ≥ ${warm}) sudah sesuai data.`
            ) : (
              <div className="row wrap" style={{ gap: 8 }}>
                <span style={{ flex: 1 }}>
                  Saran dari data: <b>Hot ≥ {sugHot}</b>, <b>Warm ≥ {sugWarm}</b> (sekarang Hot ≥ {hot}, Warm ≥ {warm}). Hot = rentang yang closing-nya ≥ 1,5× rata-rata; Warm = ≥ ½ rata-rata.
                </span>
                {!ro && (
                  <button className="btn sm" onClick={() => onApply(sugHot!, sugWarm!)}>
                    Pakai saran (lalu Simpan di kartu Skor lead)
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
