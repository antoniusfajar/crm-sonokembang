import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { isRole, useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Empty, Field, Loading, Modal, ScoreRing, useToast } from '../components/ui';
import { DpModal, LostModal, NotesModal, ProposalModal, StageModal, TestFoodModal, TF_DECISIONS, type LeadLite } from '../components/LeadActions';
import { date, dateTime, fromLocalInput, initials, monthLabel, rupiah, toLocalInput } from '../format';

export function LeadDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: l, isLoading, error } = useQuery<any>({ queryKey: ['lead', id], queryFn: () => api.get(`/api/leads/${id}`) });
  const { data: sources } = useQuery<any[]>({ queryKey: ['sources'], queryFn: () => api.get('/api/sources') });
  const { data: users } = useQuery<any[]>({ queryKey: ['users-options'], queryFn: () => api.get('/api/users/options') });
  const { data: cf } = useQuery<any[]>({ queryKey: ['custom-fields'], queryFn: () => api.get('/api/custom-fields') });
  const [modal, setModal] = useState<'' | 'proposal' | 'dp' | 'lost' | 'tf' | 'stage' | 'notes' | 'edit' | 'task'>('');

  if (isLoading) return <Layout><Loading /></Layout>;
  if (error || !l) return <Layout><Empty>{(error as Error)?.message ?? 'Lead tidak ditemukan'}</Empty></Layout>;

  const ll: LeadLite = { id: l.id, code: l.code, pipelineId: l.pipelineId, stageId: l.stageId, eventType: l.eventType, estimatedValue: l.estimatedValue, budget: l.budget, contact: l.contact };
  const cur = l.stages.find((s: any) => s.id === l.stageId);
  const curIdx = l.stages.findIndex((s: any) => s.id === l.stageId);
  // Nama kontak = nama profil WhatsApp (atau nomor); nama lead dibuat otomatis oleh sistem.
  const contactName = l.contact.name ?? l.contact.phone;
  const name = l.name || contactName;
  const pendingProposal = l.proposals.find((p: any) => p.status === 'waiting_approval');

  const patch = async (body: any, msg = 'Tersimpan') => {
    try {
      await api.patch(`/api/leads/${l.id}`, body);
      toast(msg);
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const approve = async (ok: boolean) => {
    try {
      await api.post(`/api/proposals/${pendingProposal.id}/${ok ? 'approve' : 'reject'}`);
      toast(ok ? 'Disetujui — proposal terkirim' : 'Diskon ditolak');
      qc.invalidateQueries({ queryKey: ['lead', id] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const qual: [string, string, string][] = [
    ['Nama pemesan', l.customerName ?? '—', 'customerName'],
    ['Perkiraan DP', monthLabel(l.expectedDpMonth), 'expectedDpMonth'],
    ['Jenis acara', l.eventType ?? '—', 'eventType'],
    ['Tanggal acara', l.eventDate ? date(l.eventDate) : (l.eventDateText ?? '—'), 'eventDate'],
    ['Lokasi', l.location ?? '—', 'location'],
    ['Jumlah pax', l.pax?.toLocaleString('id-ID') ?? '—', 'pax'],
    ['Budget', l.budget ? rupiah(l.budget) : '—', 'budget'],
    ['Nilai potensi', l.estimatedValue ? rupiah(l.estimatedValue) : '—', 'estimatedValue'],
    ...(l.dealValue || l.dpAmount ? [['Nilai order (omzet)', l.dealValue ? rupiah(l.dealValue) : 'belum diisi', 'dealValue'] as [string, string, string]] : []),
  ];

  return (
    <Layout eyebrow="Leads · Detail lead" title={name}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 14 }}>
          <span className="avatar lg">{initials(contactName)}</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="xs muted">
              {l.code} · dibuat {date(l.createdAt)} · <span className={`pill ${l.origin === 'auto' ? 'olive' : ''}`}>{l.origin === 'auto' ? '⚡ Otomatis' : '✎ Manual'}</span> <span className="muted">{l.originNote}</span>
            </div>
            <div style={{ font: '700 22px/1.3 var(--font-display)', color: 'var(--text-heading)', overflowWrap: 'anywhere' }} title="Nama lead dibuat otomatis: pipeline_nama depan_tanggal acara_lokasi">
              {name}
            </div>
            <div className="small" style={{ margin: '2px 0' }}>
              Kontak WA: <b>{contactName}</b>
              {l.contact.name ? ` · ${l.contact.phone}` : ''}
            </div>
            <div className="small muted">
              Sumber {l.source?.name ?? '—'} · PIC {l.owner?.name ?? '—'} · Pipeline {l.pipeline.name}
            </div>
          </div>
          {l.conversationId && (
            <Link className="btn" to={`/inbox/${l.conversationId}`}>
              Buka chat
            </Link>
          )}
          <button className="btn" onClick={() => setModal('notes')}>
            Catatan
          </button>
          <button className="btn primary" onClick={() => setModal('proposal')}>
            Kirim proposal
          </button>
        </div>
        <div className="row wrap" style={{ marginTop: 16, gap: 6 }}>
          {l.stages.map((s: any, i: number) => (
            <button
              key={s.id}
              onClick={() => setModal('stage')}
              className="chip"
              style={{
                background: s.id === l.stageId ? (s.kind === 'lost' ? 'var(--charcoal-900)' : 'var(--rose-500)') : i < curIdx && s.kind !== 'lost' ? 'var(--olive-100)' : undefined,
                color: s.id === l.stageId ? '#fff' : i < curIdx && s.kind !== 'lost' ? 'var(--olive-800)' : undefined,
                borderColor: 'transparent',
              }}
            >
              {s.name}
              <span style={{ opacity: 0.7, fontWeight: 400 }}>{s.enteredAt ? ` · ${date(s.enteredAt, false)}` : ''}</span>
            </button>
          ))}
        </div>
        {cur?.kind === 'lost' && (
          <div className="banner red" style={{ marginTop: 12 }}>
            <b>{l.lostKind}:</b> {l.lostReason}
            {l.lostNote ? ` — ${l.lostNote}` : ''}
          </div>
        )}
        {pendingProposal && (
          <div className="banner" style={{ marginTop: 12 }}>
            Proposal dengan diskon {pendingProposal.discountPct}% menunggu persetujuan SPV.
            {isRole(me, 'spv', 'admin') && (
              <span className="row" style={{ marginTop: 8 }}>
                <button className="btn sm olive" onClick={() => approve(true)}>
                  Setujui & kirim
                </button>
                <button className="btn sm" onClick={() => approve(false)}>
                  Tolak
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)' }}>
        <div className="stack">
          <Card title="Data kualifikasi" sub="Diisi AI dari chat; sales bisa mengoreksi." actions={<button className="btn sm" onClick={() => setModal('edit')}>Ubah</button>}>
            <div className="grid grid-2" style={{ gap: '4px 24px' }}>
              {qual.map(([k, v, key]) => (
                <div className="kv" key={k} style={{ gridTemplateColumns: '110px 1fr auto' }}>
                  <span>{k}</span>
                  <span>{v}</span>
                  {l.aiFilled.includes(key) ? <span className="pill outline">🤖 AI</span> : <span />}
                </div>
              ))}
              {(cf ?? [])
                .filter((f) => f.entity === 'lead')
                .map((f) => (
                  <div className="kv" key={f.id} style={{ gridTemplateColumns: '110px 1fr auto' }}>
                    <span>{f.name}</span>
                    <span>{String(l.custom?.[f.key] ?? '—')}</span>
                    <span />
                  </div>
                ))}
            </div>
          </Card>
          <Card title="Aktivitas & follow-up" sub="Tercatat otomatis dari chat asli — sales tidak bisa menandai follow-up tanpa pesan terkirim." actions={<button className="btn sm" onClick={() => setModal('task')}>＋ Janji follow-up</button>}>
            {!l.activities.length && <Empty>Belum ada aktivitas.</Empty>}
            {l.activities.map((a: any) => (
              <div key={a.id} className="row" style={{ alignItems: 'flex-start', padding: '9px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <span className="xs muted" style={{ width: 110, flex: 'none' }}>
                  {dateTime(a.at)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small bold">{a.title}</div>
                  {a.note && <div className="xs muted" style={{ whiteSpace: 'pre-wrap' }}>{a.note}</div>}
                </div>
                <span className="xs muted">{a.by ?? (a.type === 'handoff' || a.type === 'lead_created' ? 'Sistem' : '')}</span>
              </div>
            ))}
          </Card>
        </div>
        <div className="stack">
          <Card title="Skor lead">
            <div className="row">
              <ScoreRing score={l.score} temp={l.temperature} />
              <div>
                <div className="bold">{l.temperature}</div>
                <div className="xs muted">Hot ≥ 70 · Warm 40–69 · Cold &lt; 40</div>
                <div className="small" style={{ marginTop: 4 }}>
                  Potensi {l.potensi ?? '—'} · ± {rupiah(l.estimatedValue ?? l.budget)}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              {l.scoreBreakdown.map((b: any) => (
                <div key={b.label} className="row small" style={{ padding: '3px 0' }}>
                  <span>{b.label}</span>
                  <span className="spacer" />
                  <b>+{b.pts}</b>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Test food" actions={<button className="btn sm" onClick={() => setModal('tf')}>＋ Test food</button>}>
            {!l.testFoods.length && <div className="hint">Belum dijadwalkan. Aktivitas, bukan tahap pipeline — bisa sebelum atau sesudah closing.</div>}
            {l.testFoods.map((t: any) => (
              <TestFoodRow key={t.id} t={t} lead={ll} />
            ))}
          </Card>
          <Card title="Tindakan">
            <div className="stack">
              <button className="btn block" onClick={() => setModal('stage')}>
                Ubah tahap
              </button>
              <button className="btn olive block" onClick={() => setModal('dp')}>
                Konfirmasi DP & Closing
              </button>
              <button className="btn danger block" onClick={() => setModal('lost')}>
                Tandai Lost / Abandoned
              </button>
              <div className="hint">Tindakan Lost dan Abandoned wajib memilih alasan sebelum bisa disimpan.</div>
            </div>
          </Card>
          {l.dpAmount && (
            <Card title="DP">
              <div className="small">
                {rupiah(l.dpAmount)} · {date(l.dpDate)}
              </div>
              {l.dpProofPath && (
                <a className="small" href={`/api/uploads/${l.dpProofPath}`} target="_blank" rel="noreferrer">
                  Lihat bukti transfer ↗
                </a>
              )}
            </Card>
          )}
          <Card title="Sumber & PIC">
            <div className="stack">
              <Field label="Sumber lead" hint={l.source?.name === 'Tidak diketahui' || !l.source ? 'Wajib dikoreksi sebelum lead naik ke Proposal.' : undefined}>
                <select className="input sm" value={l.source?.id ?? ''} onChange={(e) => patch({ sourceId: e.target.value || null }, 'Sumber diperbarui')}>
                  <option value="">—</option>
                  {sources?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              {me.user.scope === 'all' && (
                <Field label="PIC sales">
                  <select className="input sm" value={l.owner?.id ?? ''} onChange={(e) => patch({ ownerId: e.target.value }, 'PIC diganti')}>
                    {users
                      ?.filter((u) => u.role === 'sales' || u.role === 'spv')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            </div>
          </Card>
          {l.proposals.length > 0 && (
            <Card title="Proposal">
              {l.proposals.map((p: any) => (
                <div key={p.id} className="row small" style={{ padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <span>{dateTime(p.createdAt)}</span>
                  <span className="spacer" />
                  <span>{rupiah(p.pricePerPax)}/pax{p.discountPct ? ` · −${p.discountPct}%` : ''}</span>
                  <span className={`pill ${p.status === 'sent' ? 'olive' : 'warm'}`}>{p.status === 'sent' ? 'Terkirim' : 'Menunggu SPV'}</span>
                  {p.filePath && (
                    <a href={`/api/uploads/${p.filePath}`} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                  )}
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      {modal === 'proposal' && <ProposalModal lead={ll} onClose={() => setModal('')} />}
      {modal === 'dp' && <DpModal lead={ll} onClose={() => setModal('')} />}
      {modal === 'lost' && <LostModal lead={ll} onClose={() => setModal('')} />}
      {modal === 'tf' && <TestFoodModal lead={ll} onClose={() => setModal('')} />}
      {modal === 'notes' && <NotesModal contactId={l.contact.id} name={name} onClose={() => setModal('')} />}
      {modal === 'stage' && <StageModal lead={ll} onClose={() => setModal('')} onLost={() => setModal('lost')} onDp={() => setModal('dp')} />}
      {modal === 'edit' && <EditQualModal l={l} cf={(cf ?? []).filter((f) => f.entity === 'lead')} onSave={(b) => (patch(b), setModal(''))} onClose={() => setModal('')} />}
      {modal === 'task' && <TaskModal leadId={l.id} name={name} onClose={() => setModal('')} />}
    </Layout>
  );
}

function TestFoodRow({ t, lead }: { t: any; lead: LeadLite }) {
  const [open, setOpen] = useState(false);
  const decision = TF_DECISIONS.find(([k]) => k === t.decision)?.[1];
  const hasResult = !!t.decision || !!t.result;
  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div className="row" style={{ gap: 6 }}>
        <div className="small bold" style={{ flex: 1 }}>
          {dateTime(t.scheduledAt)} · {t.place ?? '—'}
          {t.people ? ` · ${t.people} orang` : ''}
        </div>
        {!hasResult && (
          <button className="btn sm" onClick={() => setOpen(true)}>
            Catat hasil
          </button>
        )}
      </div>
      {hasResult && (
        <div className="small" style={{ marginTop: 4, display: 'grid', gap: 2 }}>
          {decision && (
            <div>
              <span className={`pill ${t.decision === 'lanjut' ? 'olive' : t.decision === 'revisi' ? 'warm' : ''}`}>{decision}</span>
              {t.rating ? <span style={{ marginLeft: 8, color: 'var(--gold-500, #c8861f)' }}>{'★'.repeat(t.rating)}<span style={{ color: 'var(--charcoal-300)' }}>{'★'.repeat(5 - t.rating)}</span></span> : null}
            </div>
          )}
          {t.menus?.length > 0 && <div className="xs muted">Menu: {t.menus.join(', ')}</div>}
          {t.result && <div className="xs">{t.result}</div>}
        </div>
      )}
      {open && <TestFoodModal lead={lead} tf={t} onClose={() => setOpen(false)} />}
    </div>
  );
}

function EditQualModal({ l, cf, onSave, onClose }: { l: any; cf: any[]; onSave: (b: any) => void; onClose: () => void }) {
  const [v, setV] = useState({
    customerName: l.customerName ?? '',
    expectedDpMonth: l.expectedDpMonth ?? '',
    eventType: l.eventType ?? '',
    eventDate: l.eventDate ?? '',
    eventDateText: l.eventDateText ?? '',
    location: l.location ?? '',
    pax: l.pax?.toString() ?? '',
    budget: l.budget?.toString() ?? '',
    estimatedValue: l.estimatedValue?.toString() ?? '',
    dealValue: l.dealValue?.toString() ?? '',
  });
  const [custom, setCustom] = useState<Record<string, any>>(l.custom ?? {});
  const num = (s: string) => (s.replace(/\D/g, '') ? Number(s.replace(/\D/g, '')) : null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal
      wide
      title="Ubah data kualifikasi"
      sub="Field yang Anda ubah tidak akan ditimpa AI lagi."
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          onClick={() =>
            onSave({
              customerName: v.customerName.trim() || null,
              expectedDpMonth: v.expectedDpMonth || null,
              eventType: v.eventType || null,
              eventDate: v.eventDate || null,
              eventDateText: v.eventDateText || null,
              location: v.location || null,
              pax: num(v.pax),
              budget: num(v.budget),
              estimatedValue: num(v.estimatedValue),
              ...(l.dealValue || l.dpAmount ? { dealValue: num(v.dealValue) } : {}),
              custom,
            })
          }
        >
          Simpan
        </button>
      }
    >
      <div className="form-grid">
        <Field label="Nama pemesan" hint="Nama depannya dipakai di nama lead. Nama kontak tetap nama profil WhatsApp.">
          <input className="input" value={v.customerName} onChange={set('customerName')} placeholder="mis. Ratna Dewi" />
        </Field>
        <Field label="Perkiraan DP masuk" hint="Bulan perkiraan customer membayar DP — dasar hitungan peluang tahun ini.">
          <input className="input" type="month" value={v.expectedDpMonth} onChange={set('expectedDpMonth')} />
        </Field>
        <Field label="Jenis acara">
          <input className="input" value={v.eventType} onChange={set('eventType')} />
        </Field>
        <Field label="Tanggal acara (pasti)">
          <input className="input" type="date" value={v.eventDate} onChange={set('eventDate')} />
        </Field>
        <Field label="Tanggal (bila belum pasti)">
          <input className="input" value={v.eventDateText} onChange={set('eventDateText')} placeholder="mis. Jan 2027" />
        </Field>
        <Field label="Lokasi">
          <input className="input" value={v.location} onChange={set('location')} />
        </Field>
        <Field label="Jumlah pax">
          <input className="input" inputMode="numeric" value={v.pax} onChange={set('pax')} />
        </Field>
        <Field label="Budget (Rp)">
          <input className="input" inputMode="numeric" value={v.budget} onChange={set('budget')} />
        </Field>
        <Field label="Nilai potensi (Rp)">
          <input className="input" inputMode="numeric" value={v.estimatedValue} onChange={set('estimatedValue')} />
        </Field>
        {(l.dealValue || l.dpAmount) && (
          <Field label="Nilai total order / omzet (Rp)" hint="Harga deal seluruh acara — dihitung sebagai omzet.">
            <input className="input" inputMode="numeric" value={v.dealValue} onChange={set('dealValue')} />
          </Field>
        )}
        {cf.map((f) => (
          <Field key={f.id} label={f.name + (f.required ? ' *' : '')}>
            {f.type === 'select' ? (
              <select className="input" value={custom[f.key] ?? ''} onChange={(e) => setCustom({ ...custom, [f.key]: e.target.value })}>
                <option value="">—</option>
                {f.options.map((o: string) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : f.type === 'boolean' ? (
              <select className="input" value={String(custom[f.key] ?? '')} onChange={(e) => setCustom({ ...custom, [f.key]: e.target.value === 'true' })}>
                <option value="">—</option>
                <option value="true">Ya</option>
                <option value="false">Tidak</option>
              </select>
            ) : (
              <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={custom[f.key] ?? ''} onChange={(e) => setCustom({ ...custom, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })} />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

export function TaskModal({ leadId, name, onClose }: { leadId?: string; name?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(name ? `Follow-up ${name}` : '');
  const [kind, setKind] = useState('Follow-up');
  const [due, setDue] = useState(toLocalInput(new Date(Date.now() + 86_400_000)));
  useEffect(() => {
    if (name) setTitle(`Follow-up ${name}`);
  }, [name]);
  const submit = async () => {
    try {
      await api.post('/api/tasks', { title, kind, dueAt: fromLocalInput(due).toISOString(), leadId });
      toast('Tugas dibuat');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['lead'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Janji follow-up" sub="Tugas muncul di Tugas Hari Ini pada tanggalnya." onClose={onClose} footer={<button className="btn primary" disabled={!title} onClick={submit}>Simpan</button>}>
      <div className="form-grid">
        <Field label="Tugas" full>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Jenis">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {['Follow-up', 'Proposal', 'Test food', 'Tagih DP', 'Lainnya'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Waktu">
          <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
