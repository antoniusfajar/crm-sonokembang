import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Empty, Field, Loading, Modal, Seg, Switch, TempPill, useToast } from '../components/ui';
import { DpModal, LostModal, usePipelines, type LeadLite } from '../components/LeadActions';
import { date, monthLabel, rupiahShort } from '../format';

const COLS = [
  ['code', 'Kode'],
  ['name', 'Nama lead'],
  ['contact', 'Kontak WA'],
  ['stage', 'Tahap'],
  ['score', 'Skor'],
  ['event', 'Acara'],
  ['date', 'Tanggal acara'],
  ['dp', 'Perkiraan DP'],
  ['pax', 'Pax'],
  ['value', 'Nilai potensi'],
  ['source', 'Sumber'],
  ['owner', 'PIC'],
  ['origin', 'Asal'],
  ['created', 'Dibuat'],
] as const;
type ColKey = (typeof COLS)[number][0];

function loadCols(): ColKey[] {
  try {
    const v = JSON.parse(localStorage.getItem('pipeline-cols') ?? 'null');
    if (Array.isArray(v)) return v;
  } catch {
    /* abaikan */
  }
  return ['code', 'name', 'contact', 'stage', 'score', 'date', 'dp', 'pax', 'value', 'source', 'owner'];
}

export function PipelinePage() {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: pdata } = usePipelines();
  const [pipeId, setPipeId] = useState<string>('');
  const [view, setView] = useState<'kanban' | 'table'>(() => (localStorage.getItem('pipeline-view') as any) ?? 'kanban');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');
  const [temp, setTemp] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [cols, setCols] = useState<ColKey[]>(loadCols);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: 'lost' | 'dp'; lead: LeadLite } | null>(null);

  const pipelines = pdata?.pipelines ?? [];
  const activePipe = pipelines.find((p) => p.id === pipeId);
  const { data: users } = useQuery<any[]>({ queryKey: ['users-options'], queryFn: () => api.get('/api/users/options') });
  const { data: sources } = useQuery<any[]>({ queryKey: ['sources'], queryFn: () => api.get('/api/sources') });
  const { data: cf } = useQuery<any[]>({ queryKey: ['custom-fields'], queryFn: () => api.get('/api/custom-fields') });
  const { data: leads, isLoading } = useQuery<any[]>({
    queryKey: ['leads', q, owner, source, temp],
    queryFn: () => api.get('/api/leads' + qs({ q, owner, source, temp })),
  });
  const filtered = useMemo(() => (leads ?? []).filter((l) => !pipeId || l.pipelineId === pipeId), [leads, pipeId]);
  const customCols = (cf ?? []).filter((f) => f.entity === 'lead' && f.showInTable);

  const toLite = (l: any): LeadLite => ({ id: l.id, code: l.code, pipelineId: l.pipelineId, stageId: l.stageId, eventType: l.eventType, estimatedValue: l.estimatedValue ?? null, budget: l.budget ?? null, contact: { id: l.contactId, name: l.contactName, phone: l.phone } });

  const drop = async (stage: any) => {
    const l = filtered.find((x) => x.id === dragId);
    setDragId(null);
    setOverStage(null);
    if (!l || l.stageId === stage.id) return;
    if (String(stage.id).startsWith('m:')) return toast('Tahap ini tidak ada di pipeline lead tersebut', true);
    if (stage.pipelineId !== l.pipelineId) return toast('Kartu hanya bisa dipindah di dalam pipeline yang sama', true);
    if (stage.kind === 'lost') return setPending({ kind: 'lost', lead: toLite(l) });
    if (stage.requirements.includes('dp_proof')) return setPending({ kind: 'dp', lead: toLite(l) });
    try {
      await api.post(`/api/leads/${l.id}/stage`, { stageId: stage.id });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast(`${l.name} → ${stage.name}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const setColsSave = (c: ColKey[]) => {
    setCols(c);
    try {
      localStorage.setItem('pipeline-cols', JSON.stringify(c));
    } catch {
      /* abaikan */
    }
  };

  const cell = (l: any, k: ColKey) => {
    switch (k) {
      case 'code':
        return <span className="mono">{l.code}</span>;
      case 'name':
        return <b>{l.name}</b>;
      case 'contact':
        return (
          <span>
            {l.contactName}
            <div className="xs muted">{l.phone}</div>
          </span>
        );
      case 'dp':
        return monthLabel(l.expectedDpMonth);
      case 'stage':
        return l.stageName;
      case 'score':
        return <TempPill t={l.temperature} score={l.score} />;
      case 'event':
        return l.eventType ?? '—';
      case 'date':
        return l.eventDate ? date(l.eventDate) : (l.eventDateText ?? '—');
      case 'pax':
        return l.pax?.toLocaleString('id-ID') ?? '—';
      case 'value':
        return rupiahShort(l.estimatedValue ?? l.budget);
      case 'source':
        return l.source ?? '—';
      case 'owner':
        return l.owner ?? '—';
      case 'origin':
        return <span className={`pill ${l.origin === 'auto' ? 'olive' : ''}`}>{l.origin === 'auto' ? '⚡ Otomatis' : '✎ Manual'}</span>;
      case 'created':
        return date(l.createdAt);
    }
  };

  const stagesToShow = activePipe ? activePipe.stages : mergeStages(pipelines);

  return (
    <Layout flush>
      <div className="toolbar">
        <input className="input sm" style={{ width: 200 }} placeholder="Cari lead" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          <button className={!pipeId ? 'on' : ''} onClick={() => setPipeId('')}>
            Semua ({leads?.length ?? 0})
          </button>
          {pipelines.map((p) => (
            <button key={p.id} className={pipeId === p.id ? 'on' : ''} onClick={() => setPipeId(p.id)}>
              {p.name} ({leads?.filter((l) => l.pipelineId === p.id).length ?? 0})
            </button>
          ))}
        </div>
        {me.user.scope === 'all' && (
          <select className="input sm" style={{ width: 150 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Semua sales</option>
            {users
              ?.filter((u) => u.role === 'sales' || u.role === 'spv')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        )}
        <select className="input sm" style={{ width: 160 }} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Semua sumber</option>
          {sources?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input sm" style={{ width: 130 }} value={temp} onChange={(e) => setTemp(e.target.value)}>
          <option value="">Semua status</option>
          <option>Hot</option>
          <option>Warm</option>
          <option>Cold</option>
        </select>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setInfoOpen(true)}>
          ⓘ Cara lead masuk
        </button>
        {view === 'table' && (
          <button className="btn sm" onClick={() => setColsOpen(true)} aria-label="Atur kolom">
            ⚙
          </button>
        )}
        <Seg
          value={view}
          options={[
            ['kanban', 'Kanban'],
            ['table', 'Tabel'],
          ]}
          onChange={(v) => (setView(v), localStorage.setItem('pipeline-view', v))}
        />
        <button className="btn sm primary" onClick={() => setNewOpen(true)}>
          ＋ Lead manual
        </button>
      </div>
      {isLoading ? (
        <Loading />
      ) : view === 'kanban' ? (
        <div className="kanban">
          {stagesToShow.map((s: any) => {
            const cards = filtered.filter((l) => (activePipe ? l.stageId === s.id : s.ids.includes(l.stageId)));
            const sum = cards.reduce((a, l) => a + (l.estimatedValue ?? l.budget ?? 0), 0);
            return (
              <div
                key={s.id}
                className={`kcol${overStage === s.id ? ' drop' : ''}`}
                onDragOver={(e) => (e.preventDefault(), setOverStage(s.id))}
                onDragLeave={() => setOverStage(null)}
                onDrop={() => drop(activePipe ? s : { ...s, id: s.idFor[filtered.find((x) => x.id === dragId)?.pipelineId] ?? s.id, pipelineId: filtered.find((x) => x.id === dragId)?.pipelineId })}
              >
                <div className="kcol-head">
                  {s.name}
                  <span className="kcol-count">{cards.length}</span>
                  <span className="kcol-sum">{sum ? rupiahShort(sum) : ''}</span>
                </div>
                {s.kind === 'lost' && <div className="hint" style={{ padding: '0 4px 8px' }}>Kartu tidak bisa masuk kolom ini tanpa alasan Lost.</div>}
                <div className="kcards">
                  {cards.map((l) => {
                    const overdue = l.stageKind === 'open' && l.stageSlaDays && Date.now() - new Date(l.stageChangedAt).getTime() > l.stageSlaDays * 86_400_000;
                    return (
                      <div key={l.id} className={`kcard${overdue ? ' overdue' : ''}`} draggable onDragStart={() => setDragId(l.id)} onClick={() => nav(`/leads/${l.id}`)}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="kcard-title" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{l.name}</span>
                          <TempPill t={l.temperature} score={l.score} />
                        </div>
                        <div className="xs muted ellipsis">
                          {l.contactName} · {l.phone}
                          {l.expectedDpMonth ? ` · DP ${monthLabel(l.expectedDpMonth)}` : ''}
                        </div>
                        <div className="kcard-sub">
                          {[l.eventType, l.pax ? `${l.pax.toLocaleString('id-ID')} pax` : null, l.eventDate ? date(l.eventDate) : l.eventDateText].filter(Boolean).join(' · ') || 'Data kualifikasi belum ada'}
                          {s.kind === 'lost' && l.lostReason && <div>Alasan: {l.lostReason}</div>}
                        </div>
                        <div className="row wrap" style={{ gap: 5 }}>
                          {l.source && <span className="pill outline">{l.source}</span>}
                          {l.potensi && <span className="pill warm">{l.potensi}</span>}
                          <span className={`pill ${l.origin === 'auto' ? 'olive' : ''}`}>{l.origin === 'auto' ? '⚡ Otomatis' : '✎ Manual'}</span>
                          <span className="spacer" />
                          <span className="xs muted">{l.owner ?? '—'}</span>
                        </div>
                        {overdue && <div className="xs" style={{ color: 'var(--red-700)', marginTop: 6 }}>⏱ Lewat SLA tahap ({l.stageSlaDays} hari)</div>}
                      </div>
                    );
                  })}
                  {!cards.length && <div className="hint" style={{ padding: 8, textAlign: 'center' }}>Kosong</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="content">
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  {cols.map((k) => (
                    <th key={k}>{COLS.find((c) => c[0] === k)?.[1]}</th>
                  ))}
                  {customCols.map((c) => (
                    <th key={c.id}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="click" onClick={() => nav(`/leads/${l.id}`)}>
                    {cols.map((k) => (
                      <td key={k}>{cell(l, k)}</td>
                    ))}
                    {customCols.map((c) => (
                      <td key={c.id}>{String(l.custom?.[c.key] ?? '—')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <Empty>Belum ada lead.</Empty>}
          </div>
        </div>
      )}
      {infoOpen && (
        <Modal title="Bagaimana kartu lead tercipta?" sub="Setiap kartu punya label ⚡ Otomatis atau ✎ Manual" onClose={() => setInfoOpen(false)}>
          <div className="stack small">
            <div>
              <b>⚡ Otomatis</b> — chat WhatsApp pertama dari nomor baru (atau pelanggan lama yang chat lagi). Sumber diambil dari penanda di pesan pertama: link WA khusus per kanal, QR pameran, atau data iklan click-to-WhatsApp.
            </div>
            <div>
              <b>✎ Manual</b> — sales menyalakan "Tandai sebagai lead" di Inbox, menambah lead dari telepon / datang langsung / vendor, atau hasil import dari CRM lama.
            </div>
            <div className="banner">Sumber "Tidak diketahui" wajib dikoreksi sales sebelum lead naik ke tahap Proposal.</div>
          </div>
        </Modal>
      )}
      {colsOpen && (
        <Modal title="Atur kolom tabel" sub="Centang untuk tampilkan, ↑↓ untuk urutan" onClose={() => setColsOpen(false)}>
          <div className="stack">
            {[...cols, ...COLS.map((c) => c[0]).filter((k) => !cols.includes(k))].map((k) => {
              const on = cols.includes(k);
              const idx = cols.indexOf(k);
              return (
                <div key={k} className="row">
                  <Switch on={on} onChange={(v) => setColsSave(v ? [...cols, k] : cols.filter((x) => x !== k))} />
                  <span style={{ flex: 1 }}>{COLS.find((c) => c[0] === k)?.[1]}</span>
                  <button className="btn sm" disabled={!on || idx === 0} onClick={() => setColsSave(swap(cols, idx, idx - 1))}>
                    ↑
                  </button>
                  <button className="btn sm" disabled={!on || idx === cols.length - 1} onClick={() => setColsSave(swap(cols, idx, idx + 1))}>
                    ↓
                  </button>
                </div>
              );
            })}
            {customCols.length > 0 && <div className="hint">Kolom kustom ({customCols.map((c) => c.name).join(', ')}) selalu tampil — atur di Pengaturan › Custom field.</div>}
          </div>
        </Modal>
      )}
      {newOpen && <NewLeadModal onClose={() => setNewOpen(false)} />}
      {pending?.kind === 'lost' && <LostModal lead={pending.lead} onClose={() => setPending(null)} />}
      {pending?.kind === 'dp' && <DpModal lead={pending.lead} onClose={() => setPending(null)} />}
    </Layout>
  );
}

const swap = <T,>(a: T[], i: number, j: number) => {
  const c = [...a];
  [c[i], c[j]] = [c[j]!, c[i]!];
  return c;
};

/** Tampilan "Semua pipeline": gabungkan tahap bernama sama dari tiap pipeline. */
function mergeStages(pipelines: any[]) {
  const out: any[] = [];
  for (const p of pipelines) {
    for (const s of p.stages) {
      let m = out.find((x) => x.name === s.name);
      if (!m) {
        m = { id: `m:${s.name}`, name: s.name, kind: s.kind, requirements: s.requirements, ids: [], idFor: {} as Record<string, string>, order: s.sortOrder };
        out.push(m);
      }
      m.ids.push(s.id);
      m.idFor[p.id] = s.id;
    }
  }
  const kindRank = { open: 0, won: 1, lost: 2 } as Record<string, number>;
  return out.sort((a, b) => kindRank[a.kind]! - kindRank[b.kind]! || a.order - b.order);
}

function NewLeadModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data: pdata } = usePipelines();
  const { data: sources } = useQuery<any[]>({ queryKey: ['sources'], queryFn: () => api.get('/api/sources') });
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [note, setNote] = useState('');
  const submit = async () => {
    try {
      const r = await api.post('/api/leads', { phone, name, sourceId: sourceId || null, pipelineId: pipelineId || undefined, note: note || undefined });
      toast('Lead dibuat');
      nav(`/leads/${r.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Lead manual" sub="Untuk kanal offline: telepon, datang ke kantor, vendor WO, referral." onClose={onClose} footer={<button className="btn primary" onClick={submit} disabled={!phone || !sourceId}>Buat lead</button>}>
      <div className="form-grid">
        <Field label="No. WhatsApp">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812…" />
        </Field>
        <Field label="Nama">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Sumber (wajib untuk kanal offline)">
          <select className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Pilih…</option>
            {sources?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pipeline">
          <select className="input" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Otomatis</option>
            {pdata?.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Catatan asal lead" full>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Telepon kantor, vendor WO Amanda" />
        </Field>
      </div>
    </Modal>
  );
}
