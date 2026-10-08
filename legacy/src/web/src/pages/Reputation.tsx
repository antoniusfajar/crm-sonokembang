import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Loading, Modal, Seg, Stat, Switch, useToast } from '../components/ui';
import { Columns, HBars, SERIES, STATUS } from '../components/charts';
import { date, dateTime, relative, todayIso } from '../format';

type Tab = 'sum' | 'reviews' | 'comp' | 'set';
const STAR = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
const one = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export function ReputationPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'sum';
  const [ask, setAsk] = useState(false);
  const { data: s } = useQuery<any>({ queryKey: ['rep-summary', 30], queryFn: () => api.get('/api/reputation/summary?days=30') });
  return (
    <Layout flush>
      <div className="tabs">
        {(
          [
            ['sum', 'Ringkasan'],
            ['reviews', 'Ulasan'],
            ['comp', 'Kompetitor'],
            ['set', 'Pengaturan'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setParams({ tab: k })}>
            {l}
          </button>
        ))}
        <span className="spacer" />
        <span className="xs muted" style={{ alignSelf: 'center' }}>
          Sumber: Google Business Profile ·{' '}
          {s?.connected ? (
            <span style={{ color: STATUS.good }}>terhubung, sinkron tiap jam</span>
          ) : me.user.role === 'admin' ? (
            <Link to="/pengaturan/integrasi">belum terhubung — hubungkan</Link>
          ) : (
            'belum terhubung'
          )}
        </span>
        <button className="btn sm" style={{ alignSelf: 'center', margin: '0 8px' }} onClick={() => setAsk(true)}>
          Kirim permintaan ulasan
        </button>
      </div>
      <div className="content">
        {tab === 'sum' && <SummaryTab />}
        {tab === 'reviews' && <ReviewsTab />}
        {tab === 'comp' && <CompetitorsTab />}
        {tab === 'set' && <SettingsTab />}
      </div>
      {ask && <RequestModal onClose={() => setAsk(false)} />}
    </Layout>
  );
}

function SummaryTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [days, setDays] = useState('30');
  const { data } = useQuery<any>({ queryKey: ['rep-summary', Number(days)], queryFn: () => api.get(`/api/reputation/summary?days=${days}`) });
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const k = data.kpi;
  const trend = (now: number, prev: number) => (prev ? `${now >= prev ? '↑' : '↓'} ${Math.abs(Math.round(((now - prev) / prev) * 100))}% vs periode lalu` : 'vs periode lalu: —');
  const runAi = async () => {
    setBusy(true);
    try {
      await api.post('/api/reputation/summary/ai');
      qc.invalidateQueries({ queryKey: ['rep-summary'] });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row">
        <Seg value={days} options={[['30', '30 hari'], ['90', '90 hari'], ['365', '1 tahun']]} onChange={setDays} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Stat k="Rating periode ini" v={one(k.avg)} s={k.avgPrev ? `sebelumnya ${one(k.avgPrev)}` : 'dari ulasan baru'} />
        <Stat k="Ulasan baru" v={k.count} s={trend(k.count, k.countPrev)} />
        <Stat k="Sudah dibalas" v={k.replied} s={k.count ? `${Math.round((k.replied / k.count) * 100)}% dari ulasan baru` : ''} />
        <Stat k="Belum dibalas" v={<span style={{ color: k.unrepliedLow ? STATUS.bad : undefined }}>{k.unreplied}</span>} s={k.unrepliedLow ? `${k.unrepliedLow} ulasan ≤3★ — prioritaskan` : 'aman'} />
        <Stat k="Rata waktu balas" v={k.respHours === null ? '—' : k.respHours < 1 ? `${Math.round(k.respHours * 60)} mnt` : `${one(k.respHours)} jam`} s="AI + manual" />
        <Stat k="Rating total" v={one(k.totalAvg)} s={`${k.total.toLocaleString('id-ID')} ulasan`} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <Card title="Ulasan baru per minggu" sub="Batang = jumlah ulasan · arahkan kursor untuk rata-rata bintang">
          <Columns data={data.weeks.map((w: any) => ({ label: w.label, values: [w.n] }))} series={[{ name: 'Ulasan', color: SERIES.gold }]} height={190} />
          <div className="row wrap xs muted" style={{ gap: 10, marginTop: 6 }}>
            {data.weeks.slice(-6).map((w: any) => (
              <span key={w.label}>
                {w.label}: {w.avg ? `★ ${one(w.avg)}` : '—'}
              </span>
            ))}
          </div>
        </Card>
        <Card>
          <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
            <span style={{ font: '700 40px/1 var(--font-display)' }}>{one(k.totalAvg)}</span>
            <span style={{ color: SERIES.gold, letterSpacing: 2 }}>{k.totalAvg ? STAR(Math.round(k.totalAvg)) : ''}</span>
          </div>
          <div className="small muted" style={{ marginBottom: 10 }}>
            dari {k.total.toLocaleString('id-ID')} ulasan · sepanjang waktu
          </div>
          <HBars rows={data.dist.map((d: any) => ({ label: `${d.stars} ★`, value: d.pct, color: d.stars >= 4 ? SERIES.gold : d.stars === 3 ? 'var(--charcoal-300)' : SERIES.rose }))} color={SERIES.gold} format={(n) => `${n}%`} labelWidth={36} />
        </Card>
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card
          title={`Ringkasan AI${data.ai ? ` dari ${data.ai.count} ulasan terakhir` : ''}`}
          sub={data.ai ? `Dibuat ${relative(data.ai.at)}` : 'AI merangkum pujian & keluhan yang berulang.'}
          actions={
            <button className="btn sm" disabled={busy} onClick={runAi}>
              {busy ? 'Merangkum…' : data.ai ? '↻ Perbarui' : '✷ Rangkum dengan AI'}
            </button>
          }
        >
          {data.ai ? (
            <>
              <p style={{ margin: '0 0 10px', lineHeight: 1.6 }}>{data.ai.text}</p>
              <div className="row wrap" style={{ gap: 6 }}>
                {data.ai.good.map((g: string) => (
                  <span key={g} className="pill olive">
                    ✓ {g}
                  </span>
                ))}
                {data.ai.bad.map((g: string) => (
                  <span key={g} className="pill hot">
                    ✕ {g}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <Empty>Belum dirangkum.</Empty>
          )}
        </Card>
        <Card title="Sentimen periode ini" sub="Dari bintang: 4–5 positif, 3 netral, 1–2 negatif">
          <div className="stackbar">
            {(
              [
                ['positif', STATUS.good],
                ['netral', 'var(--charcoal-300)'],
                ['negatif', STATUS.bad],
              ] as const
            ).map(([kk, c]) => (data.sentiment[kk] ? <span key={kk} style={{ width: `${data.sentiment[kk]}%`, background: c }} title={`${kk} ${data.sentiment[kk]}%`} /> : null))}
          </div>
          <div className="row wrap small" style={{ gap: 14, marginTop: 8 }}>
            {(
              [
                ['Positif', 'positif', STATUS.good],
                ['Netral', 'netral', 'var(--charcoal-300)'],
                ['Negatif', 'negatif', STATUS.bad],
              ] as const
            ).map(([l, kk, c]) => (
              <span key={kk} className="row" style={{ gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} /> {l} {data.sentiment[kk]}%
              </span>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ReviewsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [stars, setStars] = useState<number[]>([]);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [add, setAdd] = useState(false);
  const key = ['rep-reviews', stars.join(','), status, q];
  const { data } = useQuery<any[]>({ queryKey: key, queryFn: () => api.get('/api/reputation/reviews' + qs({ stars: stars.join(','), status, q })) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['rep-reviews'] });
    qc.invalidateQueries({ queryKey: ['rep-summary'] });
  };
  const act = async (id: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(id);
    try {
      const r = await fn();
      if (ok) toast(ok);
      refresh();
      return r;
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy('');
    }
  };
  const draft = (id: string) => act(id, async () => setEdit({ ...edit, [id]: (await api.post<{ text: string }>(`/api/reputation/reviews/${id}/draft`)).text }));
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="xs muted">Bintang</span>
        {[5, 4, 3, 2, 1].map((s) => (
          <button key={s} className={`chip${stars.includes(s) ? ' on' : ''}`} onClick={() => setStars(stars.includes(s) ? stars.filter((x) => x !== s) : [...stars, s])}>
            {s} ★
          </button>
        ))}
        <span style={{ width: 10 }} />
        <Seg value={status} options={[['all', 'Semua'], ['unreplied', 'Belum dibalas'], ['scheduled', 'Terjadwal AI'], ['replied', 'Sudah dibalas']]} onChange={setStatus} />
        <input className="input sm" style={{ width: 200 }} placeholder="Cari ulasan" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" />
        <button className="btn sm" onClick={() => setAdd(true)}>
          + Tambah / impor ulasan
        </button>
      </div>
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <Empty>Tidak ada ulasan yang cocok dengan filter.</Empty>
      ) : (
        data.map((r) => (
          <div key={r.id} className="card review" style={{ marginTop: 0 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="avatar">{r.author.slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: 1 }}>
                <b>{r.author}</b> <span style={{ color: SERIES.gold, letterSpacing: 1 }}>{STAR(r.rating)}</span>
                <div className="xs muted">
                  {r.provider === 'gbp' ? 'Google' : 'Dicatat manual'} · {date(r.reviewedAt)}
                </div>
              </div>
              {r.provider === 'gbp' && r.rating <= 3 && r.replyStatus !== 'sent' && <span className="pill hot">SPV sudah dinotifikasi</span>}
            </div>
            {r.text && <p style={{ margin: '10px 0', lineHeight: 1.55 }}>{r.text}</p>}
            {r.replyStatus === 'sent' && (
              <div className="reply-box">
                <div className="xs muted">
                  Balasan Sonokembang · {r.repliedAt ? dateTime(r.repliedAt) : ''}
                </div>
                <div className="small">{r.replyText}</div>
              </div>
            )}
            {r.replyStatus === 'scheduled' && edit[r.id] === undefined && (
              <div className="reply-box">
                <div className="xs muted">Balasan AI · terbit otomatis {relative(r.replyDueAt)}</div>
                <div className="small">{r.replyText}</div>
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <button className="btn ghost sm" disabled={busy === r.id} onClick={() => act(r.id, () => api.post(`/api/reputation/reviews/${r.id}/cancel`)).then(() => setEdit({ ...edit, [r.id]: r.replyText }))}>
                    Tahan & edit
                  </button>
                  <button className="btn sm" disabled={busy === r.id} onClick={() => act(r.id, () => api.post(`/api/reputation/reviews/${r.id}/reply`, { text: r.replyText }), 'Balasan terbit')}>
                    Terbitkan sekarang
                  </button>
                </div>
              </div>
            )}
            {r.replyStatus !== 'sent' && (r.replyStatus !== 'scheduled' || edit[r.id] !== undefined) && (
              <div style={{ marginTop: 8 }}>
                {edit[r.id] !== undefined ? (
                  <>
                    <textarea className="input" rows={3} value={edit[r.id]} onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })} placeholder="Tulis balasan publik…" />
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      <span className="xs muted" style={{ flex: 1 }}>
                        Balasan tampil publik di Google atas nama Sonokembang.
                      </span>
                      <button className="btn ghost sm" onClick={() => setEdit(Object.fromEntries(Object.entries(edit).filter(([k]) => k !== r.id)))}>
                        Batal
                      </button>
                      <button className="btn primary sm" disabled={busy === r.id || !edit[r.id]?.trim()} onClick={() => act(r.id, () => api.post(`/api/reputation/reviews/${r.id}/reply`, { text: edit[r.id] }), r.provider === 'gbp' ? 'Balasan terbit di Google' : 'Balasan dicatat — tempel juga di Google').then(() => setEdit(Object.fromEntries(Object.entries(edit).filter(([k]) => k !== r.id))))}>
                        {r.provider === 'gbp' ? 'Kirim balasan' : 'Tandai sudah dibalas'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="row" style={{ gap: 6 }}>
                    {r.replyError && (
                      <span className="xs" style={{ color: 'var(--red-700)', flex: 1 }}>
                        {r.replyError}
                      </span>
                    )}
                    {!r.replyError && <span className="xs muted" style={{ flex: 1 }}>{r.replyText ? 'Ada draf balasan' : 'Belum dibalas'}</span>}
                    <button className="btn sm" disabled={busy === r.id} onClick={() => draft(r.id)}>
                      {busy === r.id ? 'Menulis…' : '✷ Buat balasan AI'}
                    </button>
                    <button className="btn ghost sm" onClick={() => setEdit({ ...edit, [r.id]: r.replyText ?? '' })}>
                      Balas manual
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
      {add && <AddReviewModal onClose={() => setAdd(false)} onDone={refresh} />}
    </div>
  );
}

function AddReviewModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ author: '', rating: '5', text: '', reviewedAt: todayIso() });
  const [csv, setCsv] = useState('');
  const save = async () => {
    try {
      await api.post('/api/reputation/reviews', { ...v, rating: Number(v.rating) });
      toast('Ulasan dicatat');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const importCsv = async () => {
    try {
      const r = await api.post<{ added: number }>('/api/reputation/reviews/import', { csv });
      toast(`${r.added} ulasan diimpor`);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Tambah ulasan" sub="Dipakai selama Google Business belum terhubung, atau untuk memindahkan riwayat dari CRM lama." onClose={onClose} wide>
      <div className="grid grid-2" style={{ gap: 18 }}>
        <div className="form-grid" style={{ alignContent: 'start' }}>
          <Field label="Nama">
            <input className="input" value={v.author} onChange={(e) => setV({ ...v, author: e.target.value })} />
          </Field>
          <Field label="Bintang">
            <select className="input" value={v.rating} onChange={(e) => setV({ ...v, rating: e.target.value })}>
              {[5, 4, 3, 2, 1].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Tanggal">
            <input className="input" type="date" value={v.reviewedAt} onChange={(e) => setV({ ...v, reviewedAt: e.target.value })} />
          </Field>
          <Field label="Isi ulasan" full>
            <textarea className="input" rows={4} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
          </Field>
          <button className="btn primary" disabled={!v.author.trim()} onClick={save}>
            Simpan ulasan
          </button>
        </div>
        <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          <b className="small">Impor CSV</b>
          <div className="xs muted">Kolom: nama, bintang, ulasan, tanggal (YYYY-MM-DD), balasan (opsional). Baris yang tidak valid dilewati.</div>
          <textarea className="input mono" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'nama,bintang,ulasan,tanggal,balasan\nBu Ratna,5,Masakan enak,2026-09-01,Terima kasih Bu'} />
          <button className="btn" disabled={csv.trim().length < 10} onClick={importCsv}>
            Impor
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CompetitorsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ['rep-comp'], queryFn: () => api.get('/api/reputation/competitors') });
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState('');
  if (!data) return <Loading />;
  const refresh = () => qc.invalidateQueries({ queryKey: ['rep-comp'] });
  const analyze = async (id: string | null) => {
    setBusy(id ?? 'self');
    try {
      await api.post(id ? `/api/reputation/competitors/${id}/analyze` : '/api/reputation/self/analyze');
      refresh();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy('');
    }
  };
  const cards = [{ ...data.self, id: null, me: true }, ...data.list];
  const best = Math.max(...cards.map((c) => c.rating ?? 0));
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {cards.map((c) => (
          <div key={c.id ?? 'me'} className="card" style={{ borderTop: `4px solid ${c.me ? SERIES.rose : 'var(--charcoal-300)'}` }}>
            <div className="row" style={{ gap: 6 }}>
              <b style={{ flex: 1 }}>{c.name}</b>
              {c.me ? (
                <span className="pill hot">Kita</span>
              ) : (
                <button className="btn ghost sm" onClick={() => setForm(c)}>
                  Ubah
                </button>
              )}
            </div>
            <div style={{ font: '700 28px/1.2 var(--font-display)', margin: '8px 0 0', color: c.rating === best ? STATUS.good : undefined }}>{one(c.rating)} ★</div>
            <div className="small muted">{c.reviewCount != null ? `${c.reviewCount.toLocaleString('id-ID')} ulasan` : 'jumlah ulasan belum diisi'}</div>
            {c.analysis ? (
              <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                <div className="xs">
                  <b>Kekuatan:</b> {c.analysis.strengths.join(' · ')}
                </div>
                <div className="xs">
                  <b>Kelemahan:</b> {c.analysis.weaknesses.join(' · ')}
                </div>
              </div>
            ) : null}
            <button className="btn sm" style={{ marginTop: 10 }} disabled={busy === (c.id ?? 'self')} onClick={() => analyze(c.id)}>
              {busy === (c.id ?? 'self') ? 'Menganalisa…' : c.analysis ? '↻ Analisa ulang' : '✷ Analisa AI'}
            </button>
          </div>
        ))}
        {data.list.length < 3 && (
          <button className="card" style={{ display: 'grid', placeItems: 'center', minHeight: 180, cursor: 'pointer', borderStyle: 'dashed' }} onClick={() => setForm({ name: '', rating: null, reviewCount: null, mapsUrl: '', notes: '' })}>
            <span>
              <b>+ Tambah kompetitor</b>
              <div className="xs muted">Bisa membandingkan sampai 3</div>
            </span>
          </button>
        )}
      </div>
      <Card title="Artinya buat kita" sub="Dirangkum dari analisa AI di atas (peluang yang bisa dimanfaatkan).">
        {cards.flatMap((c) => (c.analysis?.opportunities ?? []).map((o: string) => ({ o, n: c.name }))).length ? (
          cards
            .flatMap((c) => (c.analysis?.opportunities ?? []).map((o: string) => ({ o, n: c.name })))
            .map((x, i) => (
              <div key={i} className="small" style={{ padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                · {x.o} <span className="xs muted">({x.n})</span>
              </div>
            ))
        ) : (
          <Empty>Jalankan analisa AI pada kartu di atas.</Empty>
        )}
      </Card>
      {form && <CompetitorModal init={form} onClose={() => setForm(null)} onDone={refresh} />}
    </div>
  );
}

function CompetitorModal({ init, onClose, onDone }: { init: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: init.name ?? '', mapsUrl: init.mapsUrl ?? '', rating: init.rating ?? '', reviewCount: init.reviewCount ?? '', notes: init.notes ?? '' });
  const save = async () => {
    const body = { name: v.name, mapsUrl: v.mapsUrl || null, rating: v.rating === '' ? null : Number(String(v.rating).replace(',', '.')), reviewCount: v.reviewCount === '' ? null : Number(v.reviewCount), notes: v.notes || null };
    try {
      if (init.id) await api.put(`/api/reputation/competitors/${init.id}`, body);
      else await api.post('/api/reputation/competitors', body);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async () => {
    if (!confirm(`Hapus ${init.name}?`)) return;
    await api.del(`/api/reputation/competitors/${init.id}`);
    onDone();
    onClose();
  };
  return (
    <Modal
      title={init.id ? `Ubah ${init.name}` : 'Tambah kompetitor'}
      sub="Rating & jumlah ulasan diisi dari Google Maps. Tempel beberapa ulasan publik mereka sebagai bahan analisa AI."
      onClose={onClose}
      footer={
        <>
          {init.id && (
            <button className="btn ghost" onClick={remove}>
              Hapus
            </button>
          )}
          <button className="btn primary" disabled={v.name.trim().length < 2} onClick={save}>
            Simpan
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nama usaha" full>
          <input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Rating Google">
          <input className="input" inputMode="decimal" value={v.rating} onChange={(e) => setV({ ...v, rating: e.target.value })} placeholder="4,6" />
        </Field>
        <Field label="Jumlah ulasan">
          <input className="input" inputMode="numeric" value={v.reviewCount} onChange={(e) => setV({ ...v, reviewCount: e.target.value })} />
        </Field>
        <Field label="Link Google Maps" full>
          <input className="input" value={v.mapsUrl} onChange={(e) => setV({ ...v, mapsUrl: e.target.value })} />
        </Field>
        <Field label="Kutipan ulasan publik (bahan analisa)" full hint="Salin 10–30 ulasan terbaru dari Google Maps, termasuk yang negatif.">
          <textarea className="input" rows={6} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function SettingsTab() {
  const toast = useToast();
  const { data } = useQuery<any>({ queryKey: ['rep-settings'], queryFn: () => api.get('/api/reputation/settings') });
  const { data: templates } = useQuery<any[]>({ queryKey: ['wa-templates'], queryFn: () => api.get('/api/wa-templates') });
  const [v, setV] = useState<any>(null);
  useEffect(() => {
    if (data) setV(structuredClone(data));
  }, [data]);
  if (!v || !templates) return <Loading />;
  const save = async () => {
    try {
      await api.put('/api/reputation/settings', { ...v, delayMinutes: Number(v.delayMinutes), request: { ...v.request, cooldownDays: Number(v.request.cooldownDays) } });
      toast('Pengaturan reputasi disimpan');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const rule = (k: string, t: string, d: string) => (
    <div className="row" style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1 }}>
        <b className="small">{t}</b>
        <div className="xs muted">{d}</div>
      </div>
      <Switch on={v[k]} onChange={(on) => setV({ ...v, [k]: on })} label={t} />
    </div>
  );
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card title="Balasan otomatis AI" sub="Atur kapan AI boleh membalas ulasan sendiri." actions={<button className="btn primary sm" onClick={save}>Simpan</button>}>
        {rule('autoReply', 'Balas semua ulasan otomatis dengan AI', 'Semua bintang. Gaya ramah, menyebut nama customer, tanpa menyebut harga (pagar pengaman tetap berlaku).')}
        {rule('notifyLow', 'Notifikasi SPV & Marketing untuk ulasan ≤3★', 'Tetap dibalas AI, tapi tim diberi tahu supaya bisa menindaklanjuti customernya lewat WA.')}
        <div className="row" style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ flex: 1 }}>
            <b className="small">Tunda balasan AI</b>
            <div className="xs muted">Memberi waktu tim mengedit atau menahan sebelum terbit.</div>
          </div>
          <input className="input sm" style={{ width: 70 }} type="number" min={0} value={v.delayMinutes} onChange={(e) => setV({ ...v, delayMinutes: e.target.value })} /> <span className="small">menit</span>
        </div>
        {rule('hotlineOnNegative', 'Tambahkan ajakan hubungi hotline di ulasan ≤3★', 'Nomor hotline dari Profil bisnis ditambahkan oleh sistem, bukan ditulis AI.')}
      </Card>
      <Card title="Permintaan ulasan otomatis" sub="Customer yang acaranya selesai dikirimi link ulasan Google lewat WhatsApp." actions={<button className="btn primary sm" onClick={save}>Simpan</button>}>
        <div style={{ display: 'grid', gap: 12 }}>
          <label className="row small" style={{ gap: 8 }}>
            <Switch on={v.request.on} onChange={(on) => setV({ ...v, request: { ...v.request, on } })} label="Aktifkan" />
            Kirim otomatis
          </label>
          <Field label="Kirim setelah">
            <select className="input" value={v.request.timing} onChange={(e) => setV({ ...v, request: { ...v.request, timing: e.target.value } })}>
              <option value="h1">H+1 setelah tanggal acara, jam 10.00</option>
              <option value="h2">H+2 setelah tanggal acara, jam 10.00</option>
              <option value="same_day">Hari yang sama, jam 19.00</option>
            </select>
          </Field>
          <Field label="Template WhatsApp" hint="{{1}} = nama depan customer, {{2}} = link ulasan.">
            <select className="input" value={v.request.template} onChange={(e) => setV({ ...v, request: { ...v.request, template: e.target.value } })}>
              {templates.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name} · {t.status}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Link ulasan Google" hint="Google Business Profile › Minta ulasan › salin link (https://g.page/r/…/review).">
            <input className="input" value={v.request.link} onChange={(e) => setV({ ...v, request: { ...v.request, link: e.target.value } })} placeholder="https://g.page/r/…/review" />
          </Field>
          <Field label="Jeda per customer (hari)">
            <input className="input" type="number" min={7} value={v.request.cooldownDays} onChange={(e) => setV({ ...v, request: { ...v.request, cooldownDays: e.target.value } })} />
          </Field>
          <div className="xs muted">Hanya untuk lead yang sudah closing (DP) dan punya tanggal acara. Tidak dikirim ke kontak yang membalas STOP. Acara lebih dari 14 hari lalu dilewati.</div>
        </div>
      </Card>
    </div>
  );
}

function RequestModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<any[]>({ queryKey: ['rep-candidates'], queryFn: () => api.get('/api/reputation/requests/candidates') });
  const [sent, setSent] = useState<Set<string>>(new Set());
  const send = async (leadId: string) => {
    try {
      await api.post('/api/reputation/requests', { leadId });
      setSent(new Set([...sent, leadId]));
      toast('Permintaan ulasan terkirim lewat WhatsApp');
      qc.invalidateQueries({ queryKey: ['rep-candidates'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Kirim permintaan ulasan" sub="Customer closing yang acaranya baru selesai (≤ 14 hari) dan belum diminta ulasan dalam 90 hari." onClose={onClose}>
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <Empty>Tidak ada customer yang perlu dimintai ulasan sekarang.</Empty>
      ) : (
        data.map((c) => (
          <div key={c.leadId} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ flex: 1 }}>
              <b className="small">{c.name ?? 'Tanpa nama'}</b>
              <div className="xs muted">Acara {date(c.eventDate)}</div>
            </div>
            <button className="btn sm" disabled={sent.has(c.leadId)} onClick={() => send(c.leadId)}>
              {sent.has(c.leadId) ? 'Terkirim' : 'Kirim'}
            </button>
          </div>
        ))
      )}
    </Modal>
  );
}
