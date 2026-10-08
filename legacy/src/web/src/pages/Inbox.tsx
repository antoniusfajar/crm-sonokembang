import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { isRole, useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Empty, Field, Loading, Modal, ScoreRing, Switch, TempPill, useToast } from '../components/ui';
import { DpModal, LostModal, NotesModal, ProposalModal, TestFoodModal, usePipelines, type LeadLite } from '../components/LeadActions';
import { date, initials, minutesSince, monthLabel, relative, rupiah, time } from '../format';

type Tab = 'all' | 'unreplied' | 'ai' | 'hot' | 'mine';

export function InboxPage() {
  const me = useMe();
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [f, setF] = useState<{ status: string[]; sales: string[]; source: string[]; aiOnly: boolean }>({ status: [], sales: [], source: [], aiOnly: false });
  const [simOpen, setSimOpen] = useState(false);
  const [showSide, setShowSide] = useState(false);

  const { data: counts } = useQuery<Record<Tab, number>>({ queryKey: ['conversations', 'counts'], queryFn: () => api.get('/api/conversations/counts') });
  const { data: list, isLoading } = useQuery<any[]>({
    queryKey: ['conversations', tab, q, f],
    queryFn: () => api.get('/api/conversations' + qs({ tab, q, status: f.status, sales: f.sales, source: f.source, aiOnly: f.aiOnly || undefined })),
  });
  const { data: users } = useQuery<any[]>({ queryKey: ['users-options'], queryFn: () => api.get('/api/users/options') });
  const { data: sources } = useQuery<any[]>({ queryKey: ['sources'], queryFn: () => api.get('/api/sources') });
  const fCount = [f.status.length, f.sales.length, f.source.length, f.aiOnly ? 1 : 0].filter(Boolean).length;

  const aiHeld = (list ?? []).filter((c) => c.aiActive);
  const rest = (list ?? []).filter((c) => !c.aiActive);
  const toggle = (key: 'status' | 'sales' | 'source', v: string) => setF((x) => ({ ...x, [key]: x[key].includes(v) ? x[key].filter((y) => y !== v) : [...x[key], v] }));

  const tabs: [Tab, string][] = [
    ['all', 'Semua'],
    ['unreplied', 'Belum dibalas'],
    ['ai', 'AI belum diserahkan'],
    ['hot', 'Hot'],
    ['mine', 'Milik saya'],
  ];

  return (
    <Layout flush>
      <div className="toolbar">
        {tabs.map(([k, l]) => (
          <button key={k} className={`chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {l} {counts ? `(${counts[k]})` : ''}
          </button>
        ))}
        <span className="spacer" />
        {me.waMode === 'simulator' && isRole(me, 'admin', 'spv') && (
          <button className="btn sm" onClick={() => setSimOpen(true)}>
            ＋ Simulasi chat masuk
          </button>
        )}
        <span className="pill outline desktop-only">{me.user.scope === 'own' ? '👤 Hanya chat milik saya' : `👁 ${me.user.roleLabel} · semua chat`}</span>
      </div>
      <div className={`inbox${id ? ' has-active' : ''}${showSide ? ' show-side' : ''}`} style={{ minHeight: 0 }}>
        <div className="inbox-list">
          <div className="inbox-search" style={{ position: 'relative' }}>
            <input className="input sm" placeholder="Cari nama, nomor, atau isi chat" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className={`btn sm${fCount ? ' dark' : ''}`} onClick={() => setFilterOpen(!filterOpen)}>
              ☰ Filter{fCount ? ` · ${fCount}` : ''}
            </button>
            {filterOpen && (
              <div className="menu-pop" style={{ left: 12, right: 12, top: '100%', padding: 14 }}>
                <div className="label">Status lead</div>
                <div className="row wrap" style={{ margin: '6px 0 12px' }}>
                  {['Hot', 'Warm', 'Cold'].map((s) => (
                    <button key={s} className={`chip${f.status.includes(s) ? ' on' : ''}`} onClick={() => toggle('status', s)}>
                      {s}
                    </button>
                  ))}
                </div>
                {me.user.scope === 'all' && (
                  <>
                    <div className="label">Sales</div>
                    <div className="row wrap" style={{ margin: '6px 0 12px' }}>
                      {users
                        ?.filter((u) => u.role === 'sales' || u.role === 'spv')
                        .map((u) => (
                          <button key={u.id} className={`chip${f.sales.includes(u.id) ? ' on' : ''}`} onClick={() => toggle('sales', u.id)}>
                            {u.name}
                          </button>
                        ))}
                    </div>
                  </>
                )}
                <div className="label">Sumber</div>
                <div className="row wrap" style={{ margin: '6px 0 12px' }}>
                  {sources?.map((s) => (
                    <button key={s.id} className={`chip${f.source.includes(s.name) ? ' on' : ''}`} onClick={() => toggle('source', s.name)}>
                      {s.name}
                    </button>
                  ))}
                </div>
                <label className="row small" style={{ marginBottom: 12 }}>
                  <Switch on={f.aiOnly} onChange={(v) => setF({ ...f, aiOnly: v })} /> Hanya yang masih ditangani AI 🤖
                </label>
                <div className="row">
                  <button className="btn sm" onClick={() => setF({ status: [], sales: [], source: [], aiOnly: false })}>
                    Reset
                  </button>
                  <span className="spacer" />
                  <button className="btn sm dark" onClick={() => setFilterOpen(false)}>
                    Tutup
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="conv-scroll">
            {isLoading && <Loading />}
            {list && !list.length && <Empty>Tidak ada percakapan yang cocok dengan pencarian atau filter.</Empty>}
            {tab === 'all' && aiHeld.length > 0 && (
              <div className="list-section">
                🤖 AI belum diserahkan · {aiHeld.length}
              </div>
            )}
            {(tab === 'all' ? [...aiHeld, ...rest] : (list ?? [])).map((c, i) => (
              <div key={c.id}>
                {tab === 'all' && i === aiHeld.length && aiHeld.length > 0 && rest.length > 0 && <div className="list-section" style={{ background: 'var(--cream-100)', color: 'var(--text-muted)' }}>Ditangani sales</div>}
                <ConvRow c={c} active={c.id === id} onClick={() => nav(`/inbox/${c.id}`)} showOwner={me.user.scope === 'all'} />
              </div>
            ))}
          </div>
        </div>
        {id ? (
          <Thread id={id} onBack={() => nav('/inbox')} onShowLead={() => setShowSide(true)} onHideLead={() => setShowSide(false)} />
        ) : (
          <div className="thread center desktop-only" style={{ gridColumn: 'span 2' }}>
            <div className="empty">Pilih percakapan di kiri untuk membuka chat.</div>
          </div>
        )}
      </div>
      {simOpen && <SimulatorModal onClose={() => setSimOpen(false)} onDone={(cid) => (setSimOpen(false), cid && nav(`/inbox/${cid}`))} />}
    </Layout>
  );
}

function ConvRow({ c, active, onClick, showOwner }: { c: any; active: boolean; onClick: () => void; showOwner: boolean }) {
  const waitMin = c.awaitingSince && !c.aiActive ? minutesSince(c.awaitingSince) : 0;
  return (
    <button className={`conv${active ? ' on' : ''}${c.slaLevel >= 2 ? ' sla2' : ''}`} onClick={onClick}>
      <div className="row" style={{ gap: 6 }}>
        <span className="conv-name ellipsis">{c.contact.name ?? c.contact.phone}</span>
        {c.aiActive && <span className="pill ai">🤖 AI</span>}
        <span className="conv-time">{relative(c.lastMessageAt)}</span>
      </div>
      <div className="conv-preview">{c.preview ?? '—'}</div>
      <div className="row" style={{ gap: 6 }}>
        {c.lead ? <TempPill t={c.lead.temperature} score={c.lead.score} /> : <span className="pill outline">Kontak</span>}
        {c.source && <span className="xs muted ellipsis">{c.source}</span>}
        <span className="spacer" />
        {waitMin >= 15 && <span className={`pill ${c.slaLevel >= 2 ? 'red' : 'hot'}`}>⏱ {waitMin} mnt</span>}
        {c.unread > 0 && <span className="unread">{c.unread}</span>}
        {showOwner && <span className="xs muted">{c.owner?.name ?? 'tanpa PIC'}</span>}
      </div>
    </button>
  );
}

function Thread({ id, onBack, onShowLead, onHideLead }: { id: string; onBack: () => void; onShowLead: () => void; onHideLead: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: conv, isLoading, error } = useQuery<any>({ queryKey: ['conversation', id], queryFn: () => api.get(`/api/conversations/${id}`) });
  const [notesOpen, setNotesOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conv && conv.messages.length) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [conv?.messages.length]);
  useEffect(() => {
    api.post(`/api/conversations/${id}/read`).then(() => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    });
  }, [id, conv?.messages.length, qc]);

  if (isLoading) return <div className="thread"><Loading /></div>;
  if (error || !conv) return <div className="thread"><Empty>{(error as Error)?.message ?? 'Percakapan tidak ditemukan'}</Empty></div>;

  const act = async (url: string, msg: string) => {
    try {
      await api.post(url);
      toast(msg);
      qc.invalidateQueries({ queryKey: ['conversation', id] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const name = conv.contact.name ?? conv.contact.phone;
  return (
    <>
      <div className="thread">
        <div className="thread-head">
          <button className="btn sm mobile-only" onClick={onBack}>
            ←
          </button>
          <span className="avatar lg">{initials(name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="bold ellipsis" style={{ color: 'var(--text-heading)', fontSize: 15 }}>
              {name}
            </div>
            <div className="xs muted ellipsis">
              {conv.contact.phone}
              {conv.contact.source ? ` · ${conv.contact.source}` : ''} · PIC {conv.owner?.name ?? '—'}
            </div>
          </div>
          <button className="btn sm outline-rose" onClick={() => setNotesOpen(true)}>
            Catatan · {conv.noteCount}
          </button>
          {conv.aiActive ? (
            <button className="btn sm dark" onClick={() => act(`/api/conversations/${id}/handoff`, 'Percakapan diambil alih dari AI')}>
              Ambil alih dari AI
            </button>
          ) : (
            <button className="btn sm desktop-only" onClick={() => act(`/api/conversations/${id}/resume-ai`, 'Percakapan dikembalikan ke AI')}>
              🤖 Kembalikan ke AI
            </button>
          )}
          {isRole(me, 'spv', 'admin') && (
            <button className="btn sm desktop-only" onClick={() => setAssignOpen(true)}>
              Tugaskan…
            </button>
          )}
          <button className="btn sm mobile-only" onClick={onShowLead}>
            Lead
          </button>
        </div>
        {conv.handoff && !conv.handoff.claimed && (
          <div className="banner" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
            <b>Serah terima AI:</b> {conv.handoff.reason}
            {conv.handoff.summary && <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{conv.handoff.summary}</div>}
          </div>
        )}
        <div className="thread-body" ref={bodyRef}>
          {conv.messages.map((m: any) =>
            m.direction === 'system' ? (
              <div key={m.id} className="sysmsg">
                {m.body}
                <span className="muted"> · {time(m.at)}</span>
              </div>
            ) : (
              <div key={m.id} className={`bubble ${m.direction === 'in' ? 'in' : m.senderType === 'ai' ? 'ai' : 'out'}`}>
                {m.direction === 'out' && <div className="bubble-who">{m.senderType === 'ai' ? '🤖 AI Responder' : m.senderName}</div>}
                {m.kind === 'document' ? `📄 ${m.mediaName}\n${m.body}` : m.kind === 'template' ? `📋 Template ${m.templateName}\n${m.body}` : m.body}
                <div className="bubble-meta">
                  {time(m.at)} {m.direction === 'out' && (m.status === 'read' ? '✓✓ dibaca' : m.status === 'delivered' ? '✓✓' : m.status === 'failed' ? `⚠ gagal: ${m.error ?? ''}` : m.status === 'queued' ? '⏳' : '✓')}
                </div>
              </div>
            ),
          )}
        </div>
        <Composer conv={conv} />
      </div>
      <LeadSide conv={conv} onClose={onHideLead} />
      {notesOpen && <NotesModal contactId={conv.contact.id} name={name} onClose={() => setNotesOpen(false)} />}
      {assignOpen && <AssignModal convId={id} current={conv.owner?.id} onClose={() => setAssignOpen(false)} />}
    </>
  );
}

function Composer({ conv }: { conv: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [snipIdx, setSnipIdx] = useState(0);
  const [tplOpen, setTplOpen] = useState(false);
  const [snipId, setSnipId] = useState<string | undefined>();
  const { data: snippets } = useQuery<any[]>({ queryKey: ['snippets'], queryFn: () => api.get('/api/snippets') });
  const windowOpen = conv.windowRemainingMs > 0;
  const slash = text.match(/^\/(\S*)$/);
  const matches = useMemo(() => (slash ? (snippets ?? []).filter((s) => s.shortcut.slice(1).startsWith(slash[1]!.toLowerCase()) || s.name.toLowerCase().includes(slash[1]!.toLowerCase())).slice(0, 8) : []), [slash, snippets]);

  const pick = async (s: any) => {
    const r = await api.get(`/api/snippets/render/${s.id}?conversationId=${conv.id}`);
    setText(r.body);
    setSnipId(s.id);
  };
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/conversations/${conv.id}/messages`, { body: text, snippetId: snipId });
      setText('');
      setSnipId(undefined);
      qc.invalidateQueries({ queryKey: ['conversation', conv.id] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const hrs = Math.floor(conv.windowRemainingMs / 3600_000);
  const mins = Math.floor((conv.windowRemainingMs % 3600_000) / 60_000);
  return (
    <div className="composer">
      <div className="row xs" style={{ marginBottom: 8 }}>
        {windowOpen ? (
          <span className="pill olive">Jendela 24 jam: {hrs}j {mins}m</span>
        ) : (
          <span className="pill hot">Jendela 24 jam tutup — wajib pakai template resmi</span>
        )}
        {conv.aiActive && <span className="muted">AI masih memegang percakapan. Membalas sendiri = mengambil alih dari AI.</span>}
      </div>
      <div className="composer-row" style={{ position: 'relative' }}>
        {matches.length > 0 && (
          <div className="snip-pop">
            {matches.map((s, i) => (
              <button key={s.id} className={i === snipIdx ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), pick(s))}>
                <span className="mono" style={{ color: 'var(--red-600)' }}>
                  {s.shortcut}
                </span>{' '}
                <b className="small">{s.name}</b>
                <div className="xs muted ellipsis">{s.body}</div>
              </button>
            ))}
          </div>
        )}
        <button className="btn sm" onClick={() => setTplOpen(true)} title="Template & snippet">
          ▧ Template
        </button>
        <textarea
          className="input"
          rows={1}
          placeholder={windowOpen ? 'Tulis balasan… (ketik / untuk snippet)' : 'Jendela 24 jam tutup — pilih template resmi'}
          disabled={!windowOpen}
          value={text}
          onChange={(e) => (setText(e.target.value), setSnipIdx(0))}
          onKeyDown={(e) => {
            if (matches.length) {
              if (e.key === 'ArrowDown') return e.preventDefault(), setSnipIdx((snipIdx + 1) % matches.length);
              if (e.key === 'ArrowUp') return e.preventDefault(), setSnipIdx((snipIdx - 1 + matches.length) % matches.length);
              if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), pick(matches[snipIdx]);
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary" onClick={send} disabled={busy || !text.trim() || !windowOpen}>
          Kirim
        </button>
      </div>
      {tplOpen && <TemplatePicker conv={conv} windowOpen={windowOpen} onPickSnippet={(s) => (pick(s), setTplOpen(false))} onClose={() => setTplOpen(false)} />}
    </div>
  );
}

function TemplatePicker({ conv, windowOpen, onPickSnippet, onClose }: { conv: any; windowOpen: boolean; onPickSnippet: (s: any) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'snippet' | 'wa'>(windowOpen ? 'snippet' : 'wa');
  const { data: snippets } = useQuery<any[]>({ queryKey: ['snippets'], queryFn: () => api.get('/api/snippets') });
  const { data: tpls } = useQuery<any[]>({ queryKey: ['wa-templates'], queryFn: () => api.get('/api/wa-templates') });
  const [sel, setSel] = useState<any>(null);
  const [params, setParams] = useState<string[]>([]);
  const [labels, setLabels] = useState<(string | null)[]>([]);
  const nParams = sel ? new Set(sel.body.match(/\{\{\d+\}\}/g) ?? []).size : 0;
  // Pilih template → variabel yang dipetakan Admin langsung terisi dari data kontak/lead.
  const choose = async (t: any) => {
    setSel(t);
    setParams([]);
    setLabels([]);
    try {
      const r = await api.get<{ params: string[]; labels: (string | null)[] }>(`/api/conversations/${conv.id}/template-fill/${t.id}`);
      setParams(r.params);
      setLabels(r.labels);
    } catch {
      /* tetap bisa diisi manual */
    }
  };
  const preview = sel ? sel.body.replace(/\{\{(\d+)\}\}/g, (m: string, n: string) => params[Number(n) - 1] || m) : '';
  const sendTpl = async () => {
    try {
      await api.post(`/api/conversations/${conv.id}/messages`, { template: { name: sel.name, language: sel.language, params } });
      toast('Template terkirim');
      qc.invalidateQueries({ queryKey: ['conversation', conv.id] });
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal wide title="Template & snippet" onClose={onClose}>
      <div className="subtabs">
        <button className={`chip${tab === 'snippet' ? ' on' : ''}`} onClick={() => setTab('snippet')} disabled={!windowOpen}>
          Snippet chat cepat
        </button>
        <button className={`chip${tab === 'wa' ? ' on' : ''}`} onClick={() => setTab('wa')}>
          Template resmi WhatsApp
        </button>
      </div>
      {tab === 'snippet' ? (
        <div className="grid grid-2">
          {snippets?.map((s) => (
            <button key={s.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', padding: 14 }} onClick={() => onPickSnippet(s)}>
              <div className="row">
                <b className="small">{s.name}</b>
                <span className="spacer" />
                <span className="mono" style={{ color: 'var(--red-600)' }}>
                  {s.shortcut}
                </span>
              </div>
              <div className="xs muted" style={{ marginTop: 4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                {s.body}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="stack">
          {!tpls?.length && <Empty>Belum ada template. Admin bisa menambah atau menyinkronkan dari Meta di Pengaturan › WhatsApp.</Empty>}
          {tpls?.map((t) => (
            <button key={t.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', padding: 14, borderColor: sel?.id === t.id ? 'var(--rose-400)' : undefined }} onClick={() => choose(t)}>
              <div className="row">
                <b className="small mono">{t.name}</b>
                <span className={`pill ${t.status === 'APPROVED' ? 'olive' : 'warm'}`}>{t.status}</span>
                <span className="xs muted">{t.category}</span>
              </div>
              <div className="small muted" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                {t.body}
              </div>
            </button>
          ))}
          {sel && (
            <div className="card" style={{ background: 'var(--cream-050)' }}>
              {Array.from({ length: nParams }).map((_, i) => (
                <Field key={i} label={`Isi {{${i + 1}}}`} hint={labels[i] ? `Otomatis: ${labels[i]} — boleh diubah` : 'Ketik manual'}>
                  <input className="input sm" value={params[i] ?? ''} onChange={(e) => setParams(Object.assign([...params], { [i]: e.target.value }))} />
                </Field>
              ))}
              <div className="wa-bubble small" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
                {preview}
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={sendTpl} disabled={params.filter(Boolean).length < nParams}>
                  Kirim template
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function LeadSide({ conv, onClose }: { conv: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: lead } = useQuery<any>({ queryKey: ['lead', conv.leadId], queryFn: () => api.get(`/api/leads/${conv.leadId}`), enabled: !!conv.leadId });
  const [modal, setModal] = useState<'' | 'proposal' | 'dp' | 'lost' | 'tf'>('');
  const [showBreak, setShowBreak] = useState(false);
  usePipelines();
  const isLead = !!conv.leadId;

  const toggleLead = async (v: boolean) => {
    try {
      await api.post(`/api/conversations/${conv.id}/lead`, { isLead: v });
      toast(v ? 'Ditandai sebagai lead — masuk tahap Lead Baru' : 'Ditandai bukan prospek');
      qc.invalidateQueries({ queryKey: ['conversation', conv.id] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const ll: LeadLite | null = lead ? { id: lead.id, code: lead.code, pipelineId: lead.pipelineId, stageId: lead.stageId, eventType: lead.eventType, estimatedValue: lead.estimatedValue, budget: lead.budget, contact: lead.contact } : null;
  const curIdx = lead?.stages.findIndex((s: any) => s.id === lead.stageId) ?? -1;
  const fields: [string, any, string][] = lead
    ? [
        ['Pemesan', lead.customerName, 'customerName'],
        ['Jenis acara', lead.eventType, 'eventType'],
        ['Perkiraan DP', lead.expectedDpMonth ? monthLabel(lead.expectedDpMonth) : null, 'expectedDpMonth'],
        ['Tanggal', lead.eventDate ? date(lead.eventDate) : lead.eventDateText, 'eventDate'],
        ['Lokasi', lead.location, 'location'],
        ['Jumlah pax', lead.pax?.toLocaleString('id-ID'), 'pax'],
        ['Budget', lead.budget ? rupiah(lead.budget) : null, 'budget'],
        ['Pipeline', lead.pipeline.name, ''],
        ['Sumber', lead.source?.name, ''],
      ]
    : [];
  return (
    <aside className="side">
      <div className="side-sec">
        <div className="row">
          <span className="xs muted">{lead?.code ?? 'Kontak'}</span>
          <span className="spacer" />
          {lead?.potensi && <span className="pill warm">Potensi {lead.potensi}</span>}
          <button className="btn sm mobile-only" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="bold" style={{ fontSize: 17, color: 'var(--text-heading)', marginTop: 2 }}>
          {conv.contact.name ?? conv.contact.phone}
        </div>
        {lead?.name && (
          <div className="xs" style={{ color: 'var(--text-body)', overflowWrap: 'anywhere' }} title="Nama lead (otomatis)">
            {lead.name}
          </div>
        )}
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div className="row">
            <div style={{ flex: 1 }}>
              <div className="bold small">Tandai sebagai lead</div>
              <div className="xs muted">{lead ? `${lead.origin === 'auto' ? '⚡ Otomatis' : '✎ Manual'} · ${lead.originNote ?? ''}` : 'Belum masuk pipeline'}</div>
            </div>
            <Switch on={isLead} onChange={toggleLead} label="Tandai sebagai lead" />
          </div>
        </div>
        {lead && (
          <Link to={`/leads/${lead.id}`} className="btn outline-rose block" style={{ marginTop: 10 }}>
            Lihat detail lead →
          </Link>
        )}
      </div>
      {lead ? (
        <>
          <div className="side-sec">
            <div className="row">
              <ScoreRing score={lead.score} temp={lead.temperature} />
              <div>
                <div className="bold">{lead.temperature}</div>
                <button className="btn ghost sm" style={{ padding: 0, color: 'var(--red-600)' }} onClick={() => setShowBreak(!showBreak)}>
                  {showBreak ? 'Tutup rincian' : 'Lihat rincian skor'}
                </button>
              </div>
            </div>
            {showBreak && (
              <div style={{ marginTop: 10 }}>
                {lead.scoreBreakdown.map((b: any) => (
                  <div key={b.label} className="row small" style={{ padding: '3px 0' }}>
                    <span>{b.label}</span>
                    <span className="spacer" />
                    <b>+{b.pts}</b>
                  </div>
                ))}
                <div className="hint" style={{ marginTop: 6 }}>
                  Diisi otomatis dari isi chat. Rumus masih draft, dikalibrasi setelah 1–2 bulan data.
                </div>
              </div>
            )}
          </div>
          <div className="side-sec">
            {fields.map(([k, v, key]) => (
              <div className="kv" key={k}>
                <span>{k}</span>
                <span>{v ?? <span className="muted">—</span>}</span>
                {key && lead.aiFilled.includes(key) ? <span className="pill outline">🤖 AI</span> : <span />}
              </div>
            ))}
          </div>
          <div className="side-sec">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Tahap pipeline
            </div>
            <div className="stage-list">
              {lead.stages
                .filter((s: any) => s.kind !== 'lost' || s.id === lead.stageId)
                .map((s: any) => {
                  const idx = lead.stages.findIndex((x: any) => x.id === s.id);
                  const cur = s.id === lead.stageId;
                  return (
                    <div key={s.id} className={`stage-row${cur ? ' cur' : ''}`}>
                      <span className={`stage-dot${cur ? ' cur' : idx < curIdx ? ' done' : ''}`} />
                      <span>{s.name}</span>
                      <span className="spacer" />
                      <span className="xs muted">{s.enteredAt ? date(s.enteredAt, false) : '—'}</span>
                    </div>
                  );
                })}
            </div>
            <div className="stack" style={{ marginTop: 12 }}>
              <button className="btn primary block" onClick={() => setModal('proposal')}>
                Kirim proposal
              </button>
              <button className="btn olive block" onClick={() => setModal('dp')}>
                Naikkan ke Closing (DP masuk)
              </button>
              <div className="row">
                <button className="btn block" onClick={() => setModal('tf')}>
                  Catat test food
                </button>
                <button className="btn block danger" onClick={() => setModal('lost')}>
                  Tandai Lost…
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="side-sec">
          <div className="banner info">
            <b>Belum tercatat sebagai lead.</b> Chat ini tidak masuk pipeline, tidak diberi skor, dan tidak dihitung di KPI sales. Nyalakan <b>Tandai sebagai lead</b> kalau ternyata calon pembeli.
          </div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span>Tipe kontak</span>
            <span>{conv.contact.type}</span>
            <span />
          </div>
          <div className="kv">
            <span>PIC</span>
            <span>{conv.owner?.name ?? '—'}</span>
            <span />
          </div>
        </div>
      )}
      {ll && modal === 'proposal' && <ProposalModal lead={ll} onClose={() => setModal('')} />}
      {ll && modal === 'dp' && <DpModal lead={ll} onClose={() => setModal('')} />}
      {ll && modal === 'lost' && <LostModal lead={ll} onClose={() => setModal('')} />}
      {ll && modal === 'tf' && <TestFoodModal lead={ll} onClose={() => setModal('')} />}
    </aside>
  );
}

function AssignModal({ convId, current, onClose }: { convId: string; current?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: users } = useQuery<any[]>({ queryKey: ['users-options'], queryFn: () => api.get('/api/users/options') });
  const assign = async (userId: string) => {
    try {
      await api.post(`/api/conversations/${convId}/assign`, { userId });
      toast('PIC diganti');
      qc.invalidateQueries({ queryKey: ['conversation', convId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Tugaskan ke…" onClose={onClose}>
      <div className="stack">
        {users
          ?.filter((u) => u.role === 'sales' || u.role === 'spv')
          .map((u) => (
            <button key={u.id} className="btn" style={{ justifyContent: 'space-between' }} disabled={u.id === current} onClick={() => assign(u.id)}>
              <span>{u.name}</span>
              <span className="xs muted">
                {u.role === 'spv' ? 'SPV' : 'Sales'}
                {u.status === 'cuti' ? ' · cuti' : ''}
                {u.id === current ? ' · PIC sekarang' : ''}
              </span>
            </button>
          ))}
      </div>
    </Modal>
  );
}

function SimulatorModal({ onClose, onDone }: { onClose: () => void; onDone: (cid: string | null) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('0812');
  const [name, setName] = useState('');
  const [text, setText] = useState('Halo, saya mau tanya paket catering untuk resepsi pernikahan');
  const [adRef, setAdRef] = useState(false);
  const submit = async () => {
    try {
      const r = await api.post('/api/simulator/inbound', { phone, name, text, adRef });
      toast('Chat masuk disimulasikan — AI akan membalas dalam beberapa detik');
      qc.invalidateQueries({ queryKey: ['conversations'] });
      onDone(r.conversationId);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal
      title="Simulasi chat masuk"
      sub="Mode simulasi: dipakai sampai nomor WABA dipindah ke CRM ini. Alurnya sama persis dengan chat asli dari Meta."
      onClose={onClose}
      footer={<button className="btn primary" onClick={submit}>Kirim sebagai customer</button>}
    >
      <div className="form-grid">
        <Field label="No. WhatsApp customer">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Nama profil WA">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Isi pesan" hint='Tambahkan penanda sumber, mis. "IGADS-wedding" atau "WEB-wisuda", untuk menguji deteksi sumber.' full>
          <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <label className="row small full">
          <Switch on={adRef} onChange={setAdRef} /> Datang dari iklan click-to-WhatsApp
        </label>
      </div>
    </Modal>
  );
}
