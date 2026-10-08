import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Empty, Field, Modal, MoneyInput, useToast } from './ui';
import { date, dateTime, fromLocalInput, relative, rupiah, todayIso, toLocalInput } from '../format';

export interface LeadLite {
  id: string;
  code: string;
  pipelineId: string;
  stageId: string;
  eventType?: string | null;
  estimatedValue?: number | null;
  budget?: number | null;
  contact: { id: string; name: string | null; phone: string };
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['lead'] });
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['conversation'] });
    qc.invalidateQueries({ queryKey: ['conversations'] });
  };
}

export function usePipelines() {
  return useQuery<{ pipelines: any[]; requirements: Record<string, string> }>({ queryKey: ['pipelines'], queryFn: () => api.get('/api/pipelines'), staleTime: 60_000 });
}

// ---------- Kirim proposal ----------
export function ProposalModal({ lead, onClose }: { lead: LeadLite; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data: tpls } = useQuery<any[]>({ queryKey: ['proposal-templates'], queryFn: () => api.get('/api/proposal-templates') });
  const { data: approval } = useQuery<any>({ queryKey: ['setting', 'approval'], queryFn: () => api.get('/api/settings/approval') });
  const suggested = useMemo(() => {
    const et = (lead.eventType ?? '').toLowerCase();
    return tpls?.find((t) => et && (t.segment.toLowerCase().includes(et.split(' ')[0]) || t.name.toLowerCase().includes(et.split(' ')[0]))) ?? tpls?.[0];
  }, [tpls, lead.eventType]);
  const [tplId, setTplId] = useState<string>('');
  const [price, setPrice] = useState('');
  const [disc, setDisc] = useState('0');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!tplId && suggested) setTplId(suggested.id);
  }, [suggested, tplId]);
  const tpl = tpls?.find((t) => t.id === tplId);
  const priceNum = Number(price.replace(/\D/g, ''));
  const discNum = Number(disc) || 0;
  const needApproval = discNum > (approval?.discountNeedsSpvAbove ?? 5);

  const preview = async () => {
    try {
      const blob = await api.blob(`/api/leads/${lead.id}/proposals/preview`, { templateId: tplId, pricePerPax: priceNum, discountPct: discNum });
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/leads/${lead.id}/proposals`, { templateId: tplId, pricePerPax: priceNum, discountPct: discNum });
      if (r.status === 'waiting_approval') toast('Diskon di atas batas — menunggu persetujuan SPV');
      else toast(r.warning ?? 'Proposal terkirim lewat WhatsApp');
      refresh();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title="Kirim proposal"
      sub={`ke ${lead.contact.name ?? lead.contact.phone} · ${lead.contact.phone} · via WhatsApp (PDF)`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={preview} disabled={!tplId || !priceNum}>
            Pratinjau PDF
          </button>
          <button className="btn primary" onClick={send} disabled={busy || !tplId || !priceNum}>
            {needApproval ? 'Minta persetujuan SPV' : 'Kirim proposal'}
          </button>
        </>
      }
    >
      <div className="grid grid-2">
        <div className="stack">
          <div className="label">Pilih template</div>
          {tpls?.map((t) => (
            <button
              key={t.id}
              className="card"
              onClick={() => setTplId(t.id)}
              style={{ textAlign: 'left', cursor: 'pointer', padding: '12px 14px', borderColor: t.id === tplId ? 'var(--rose-400)' : undefined, background: t.id === tplId ? 'var(--rose-100)' : undefined }}
            >
              <div className="bold">{t.name}</div>
              <div className="xs muted">
                {t.segment}
                {t.id === suggested?.id ? ' · disarankan' : ''}
              </div>
            </button>
          ))}
        </div>
        <div className="stack">
          <Field label="Harga per pax (wajib diisi sales)" hint="AI tidak pernah mengirim harga. Angka ini mengisi [harga_per_pax].">
            <input className="input" inputMode="numeric" value={price ? Number(price.replace(/\D/g, '')).toLocaleString('id-ID') : ''} onChange={(e) => setPrice(e.target.value)} placeholder="mis. 95.000" />
          </Field>
          <Field label="Diskon (%)" hint={`Diskon di atas ${approval?.discountNeedsSpvAbove ?? 5}% butuh persetujuan SPV.`}>
            <input className="input" type="number" min={0} max={100} value={disc} onChange={(e) => setDisc(e.target.value)} />
          </Field>
          {!priceNum && <div className="banner">⚠ [harga_per_pax] masih kosong — isi sebelum terkirim.</div>}
          {tpl && (
            <div className="card" style={{ background: 'var(--cream-050)', maxHeight: 260, overflow: 'auto', padding: 14 }}>
              {tpl.sections.map((s: any) => (
                <div key={s.title} style={{ marginBottom: 10 }}>
                  <div className="xs bold" style={{ color: 'var(--red-600)', textTransform: 'uppercase' }}>
                    {s.title}
                  </div>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
                    {s.body}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="hint">Tercatat otomatis sebagai aktivitas "Proposal terkirim" dan lead naik ke tahap Proposal.</div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Konfirmasi DP ----------
export function DpModal({ lead, onClose }: { lead: LeadLite; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data } = usePipelines();
  const wonStages = data?.pipelines.find((p) => p.id === lead.pipelineId)?.stages.filter((s: any) => s.kind === 'won') ?? [];
  const [amount, setAmount] = useState('');
  const [deal, setDeal] = useState<number | null>(lead.estimatedValue ?? lead.budget ?? null);
  const [d, setD] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [stageId, setStageId] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return toast('Unggah bukti transfer dulu', true);
    if (!deal) return toast('Isi nilai total order — ini yang dihitung sebagai omzet', true);
    if (deal < Number(amount.replace(/\D/g, ''))) return toast('Nilai total order tidak boleh lebih kecil dari DP', true);
    const fd = new FormData();
    fd.append('amount', amount.replace(/\D/g, ''));
    fd.append('dealValue', String(deal));
    fd.append('date', d);
    if (stageId) fd.append('stageId', stageId);
    fd.append('file', file);
    setBusy(true);
    try {
      await api.post(`/api/leads/${lead.id}/dp`, fd);
      toast('DP tercatat — lead masuk tahap Closing');
      refresh();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Konfirmasi DP"
      sub={`${lead.code} · ${lead.contact.name ?? lead.contact.phone}`}
      onClose={onClose}
      footer={
        <button className="btn olive" disabled={busy || !amount || !file || !deal} onClick={submit}>
          Simpan & naikkan ke Closing
        </button>
      }
    >
      <div className="stack">
        <Field label="Nilai DP (Rp)">
          <input className="input" inputMode="numeric" value={amount ? Number(amount.replace(/\D/g, '')).toLocaleString('id-ID') : ''} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Nilai total order (omzet)" hint="Harga deal seluruh acara. Ini angka omzet di dashboard & laporan — bukan nilai DP.">
          <MoneyInput value={deal} onChange={setDeal} />
        </Field>
        <Field label="Tanggal masuk">
          <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
        {wonStages.length > 1 && (
          <Field label="Tahap tujuan">
            <select className="input" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">{wonStages[0].name}</option>
              {wonStages.slice(1).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Unggah bukti transfer" hint="JPG / PNG / PDF · maks 5 MB">
          <input className="input" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <div className="banner info">Closing baru terhitung di KPI setelah bukti DP terunggah.</div>
      </div>
    </Modal>
  );
}

// ---------- Tandai Lost / Abandoned ----------
export function LostModal({ lead, onClose }: { lead: LeadLite; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data } = usePipelines();
  const { data: reasons } = useQuery<{ Lost: string[]; Abandoned: string[] }>({ queryKey: ['setting', 'lost_reasons'], queryFn: () => api.get('/api/settings/lost_reasons') });
  const lostStage = data?.pipelines.find((p) => p.id === lead.pipelineId)?.stages.find((s: any) => s.kind === 'lost');
  const [kind, setKind] = useState<'Lost' | 'Abandoned'>('Lost');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const submit = async () => {
    try {
      await api.post(`/api/leads/${lead.id}/stage`, { stageId: lostStage.id, lostKind: kind, lostReason: reason, lostNote: note || undefined });
      toast(`Lead ditandai ${kind}`);
      refresh();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal
      title="Tandai Lost / Abandoned"
      sub={`${lead.code} · ${lead.contact.name ?? lead.contact.phone}`}
      onClose={onClose}
      footer={
        <button className="btn dark" disabled={!reason || !lostStage} onClick={submit}>
          Simpan
        </button>
      }
    >
      <div className="stack">
        <div className="row">
          {(['Lost', 'Abandoned'] as const).map((k) => (
            <button key={k} className={`btn${kind === k ? ' dark' : ''}`} style={{ flex: 1 }} onClick={() => (setKind(k), setReason(''))}>
              {k}
            </button>
          ))}
        </div>
        <div className="label">Alasan · wajib</div>
        <div className="row wrap">
          {(reasons?.[kind] ?? []).map((r) => (
            <button key={r} className={`chip${reason === r ? ' on' : ''}`} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <Field label="Catatan (opsional)">
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="hint">Alasan ini menjadi data grafik "Alasan Lost" di laporan.</div>
      </div>
    </Modal>
  );
}

// ---------- Test food ----------
export interface TfResult {
  menus: string[];
  rating: number | null;
  decision: 'lanjut' | 'revisi' | 'belum' | '';
  note: string;
}
export const TF_DECISIONS: [TfResult['decision'], string][] = [
  ['lanjut', 'Lanjut ke closing'],
  ['revisi', 'Revisi menu dulu'],
  ['belum', 'Belum memutuskan'],
];

/** Form hasil test food: menu yang dicoba, rating, keputusan, catatan. */
function TfResultFields({ v, setV }: { v: TfResult; setV: (v: TfResult) => void }) {
  const [menu, setMenu] = useState('');
  const addMenu = () => {
    const parts = menu.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length) setV({ ...v, menus: [...new Set([...v.menus, ...parts])] });
    setMenu('');
  };
  return (
    <div className="form-grid">
      <Field label="Menu yang dicoba" full hint="Ketik lalu Enter; bisa beberapa sekaligus dipisah koma.">
        <div className="row wrap" style={{ gap: 6 }}>
          {v.menus.map((m) => (
            <button key={m} type="button" className="chip on" title="Hapus" onClick={() => setV({ ...v, menus: v.menus.filter((x) => x !== m) })}>
              {m} ×
            </button>
          ))}
          <input
            className="input sm"
            style={{ flex: 1, minWidth: 160 }}
            value={menu}
            placeholder="mis. Nasi liwet, Ayam bakar madu"
            onChange={(e) => setMenu(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addMenu();
              }
            }}
            onBlur={addMenu}
          />
        </div>
      </Field>
      <Field label="Rating customer">
        <div className="row" style={{ gap: 2 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className="btn ghost sm"
              aria-label={`${n} bintang`}
              style={{ fontSize: 20, padding: '0 3px', color: v.rating && n <= v.rating ? 'var(--gold-500, #c8861f)' : 'var(--charcoal-300)' }}
              onClick={() => setV({ ...v, rating: v.rating === n ? null : n })}
            >
              ★
            </button>
          ))}
        </div>
      </Field>
      <Field label="Keputusan customer" full>
        <div className="row wrap" style={{ gap: 6 }}>
          {TF_DECISIONS.map(([k, label]) => (
            <button key={k} type="button" className={`chip${v.decision === k ? ' on' : ''}`} onClick={() => setV({ ...v, decision: k })}>
              {label}
            </button>
          ))}
        </div>
        {v.decision === 'revisi' && <div className="hint" style={{ marginTop: 6 }}>Tugas "Revisi proposal" otomatis dibuat untuk PIC, besok jam 10.00.</div>}
      </Field>
      <Field label="Catatan" full>
        <textarea className="input" rows={3} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="mis. sambal kurang pedas, minta ganti dessert" />
      </Field>
    </div>
  );
}

const emptyResult = (): TfResult => ({ menus: [], rating: null, decision: '', note: '' });
const resultBody = (r: TfResult) => ({ menus: r.menus, rating: r.rating, decision: r.decision, note: r.note.trim() || undefined });

/** Jadwalkan test food, atau langsung catat hasilnya. Dengan `tf`, mencatat hasil test food yang sudah dijadwalkan. */
export function TestFoodModal({ lead, tf, onClose }: { lead: LeadLite; tf?: { id: number; scheduledAt: string; place: string | null }; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [mode, setMode] = useState<'jadwal' | 'hasil'>(tf ? 'hasil' : 'jadwal');
  const [at, setAt] = useState(toLocalInput(new Date(Date.now() + 3 * 86_400_000)));
  const [place, setPlace] = useState('Dapur Sonokembang');
  const [people, setPeople] = useState('4');
  const [r, setR] = useState<TfResult>(emptyResult);
  const submit = async () => {
    try {
      if (tf) await api.patch(`/api/test-food/${tf.id}`, resultBody(r));
      else
        await api.post(`/api/leads/${lead.id}/test-food`, {
          scheduledAt: fromLocalInput(at).toISOString(),
          place,
          people: Number(people) || undefined,
          ...(mode === 'hasil' ? { result: resultBody(r) } : {}),
        });
      toast(mode === 'hasil' ? 'Hasil test food dicatat' : 'Test food dijadwalkan');
      refresh();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const canSave = mode === 'jadwal' || !!r.decision;
  return (
    <Modal
      title={tf ? 'Catat hasil test food' : 'Test food'}
      sub={tf ? `${new Date(tf.scheduledAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} · ${tf.place ?? ''}` : 'Aktivitas, bukan tahap pipeline — bisa sebelum atau sesudah closing.'}
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!canSave} onClick={submit}>
          Simpan
        </button>
      }
    >
      {!tf && (
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={mode === 'jadwal' ? 'on' : ''} onClick={() => setMode('jadwal')}>
            Jadwalkan
          </button>
          <button className={mode === 'hasil' ? 'on' : ''} onClick={() => setMode('hasil')}>
            Catat hasil
          </button>
        </div>
      )}
      {!tf && (
        <div className="form-grid" style={{ marginBottom: mode === 'hasil' ? 14 : 0 }}>
          <Field label={mode === 'hasil' ? 'Tanggal test food' : 'Jadwal'} full>
            <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <Field label="Tempat">
            <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} />
          </Field>
          <Field label="Jumlah orang">
            <input className="input" type="number" min={1} value={people} onChange={(e) => setPeople(e.target.value)} />
          </Field>
        </div>
      )}
      {mode === 'hasil' && <TfResultFields v={r} setV={setR} />}
    </Modal>
  );
}

// ---------- Catatan internal ----------
export function NotesModal({ contactId, name, onClose }: { contactId: string; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any[]>({ queryKey: ['notes', contactId], queryFn: () => api.get(`/api/contacts/${contactId}/notes`) });
  const [body, setBody] = useState('');
  const add = async () => {
    try {
      await api.post(`/api/contacts/${contactId}/notes`, { body });
      setBody('');
      qc.invalidateQueries({ queryKey: ['notes', contactId] });
      qc.invalidateQueries({ queryKey: ['conversation'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Catatan internal" sub={`${name} · hanya terlihat tim, tidak terkirim ke customer`} onClose={onClose}>
      <div className="stack">
        <textarea className="input" placeholder="Tulis catatan…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div>
          <button className="btn primary" disabled={!body.trim()} onClick={add}>
            Tambah catatan
          </button>
        </div>
        {!data?.length && <Empty>Belum ada catatan untuk kontak ini.</Empty>}
        {data?.map((n) => (
          <div key={n.id} className="card" style={{ padding: '12px 14px', background: 'var(--cream-050)' }}>
            <div className="row xs muted">
              <span className="bold" style={{ color: 'var(--text-heading)' }}>
                {n.by ?? '—'}
              </span>
              <span>{relative(n.at)}</span>
            </div>
            <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
              {n.body}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------- Pindah tahap ----------
export function StageModal({ lead, onClose, onLost, onDp }: { lead: LeadLite; onClose: () => void; onLost: () => void; onDp: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const { data } = usePipelines();
  const p = data?.pipelines.find((x) => x.id === lead.pipelineId);
  const move = async (s: any) => {
    if (s.kind === 'lost') return onLost();
    if (s.requirements.includes('dp_proof')) return onDp();
    try {
      await api.post(`/api/leads/${lead.id}/stage`, { stageId: s.id });
      toast(`Pindah ke ${s.name}`);
      refresh();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Ubah tahap" sub={`${lead.code} · ${lead.contact.name ?? lead.contact.phone}`} onClose={onClose}>
      <div className="stack">
        {p?.stages.map((s: any) => (
          <button key={s.id} className="btn" style={{ justifyContent: 'space-between', borderColor: s.id === lead.stageId ? 'var(--rose-400)' : undefined, background: s.id === lead.stageId ? 'var(--rose-100)' : undefined }} onClick={() => s.id !== lead.stageId && move(s)}>
            <span>{s.name}</span>
            <span className="xs muted">
              {s.id === lead.stageId ? 'tahap sekarang' : s.requirements.map((r: string) => data!.requirements[r]?.split(' ')[0]).join(', ')}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export const fmt = { date, dateTime, rupiah };
