import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useMe } from '../../auth';
import { Card, Empty, Field, Loading, Modal, Stat, Switch, useToast } from '../../components/ui';
import { dateTime, rupiah } from '../../format';
import { useSaveSetting, useSetting } from './TabsA';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const commas = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

// ---------- Prompt & pagar AI ----------
export function PromptTab() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = me.user.role === 'admin';
  const { data: versions } = useQuery<any[]>({ queryKey: ['prompts'], queryFn: () => api.get('/api/ai/prompts') });
  const { data: g } = useSetting<any>('guardrails');
  const { data: faq } = useSetting<any[]>('faq');
  const saveG = useSaveSetting('guardrails');
  const saveFaq = useSaveSetting('faq');
  const active = versions?.find((v) => v.active);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [gd, setGd] = useState<any>(null);
  const [fq, setFq] = useState<any[] | null>(null);
  const [sandbox, setSandbox] = useState(false);
  useEffect(() => active && setText(active.content), [active?.id]);
  useEffect(() => g && setGd({ ...g, allowT: g.allow.join('\n'), denyT: g.deny.join('\n'), blockedT: g.blockedPhrases.join(', '), handoffT: g.handoffKeywords.join(', ') }), [g]);
  useEffect(() => faq && setFq(structuredClone(faq)), [faq]);
  if (!versions || !gd || !fq) return <Loading />;

  const saveVersion = async () => {
    try {
      await api.post('/api/ai/prompts', { content: text, note: note || undefined });
      toast('Versi baru disimpan & aktif');
      setNote('');
      qc.invalidateQueries({ queryKey: ['prompts'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const activate = async (id: number) => {
    await api.post(`/api/ai/prompts/${id}/activate`);
    toast('Versi dikembalikan');
    qc.invalidateQueries({ queryKey: ['prompts'] });
  };
  const saveGuard = () =>
    saveG({
      allow: lines(gd.allowT),
      deny: lines(gd.denyT),
      blockedPhrases: commas(gd.blockedT),
      handoffKeywords: commas(gd.handoffT),
      blockRupiah: gd.blockRupiah,
      handoffWhenFieldsFilled: Number(gd.handoffWhenFieldsFilled),
      handoffWhenScoreAtLeast: Number(gd.handoffWhenScoreAtLeast),
      stopAfterFollowups: Number(gd.stopAfterFollowups),
      holdMessage: gd.holdMessage,
      layer2: gd.layer2,
    });

  return (
    <div className="stack">
      <Card
        title={
          <>
            Prompt AI responder <span className="pill hot">HANYA ADMIN</span>
          </>
        }
        sub="Bisa diubah tanpa deploy. Setiap perubahan disimpan sebagai versi baru dengan nama pengubah, dan bisa dikembalikan."
        actions={
          <div className="row">
            <button className="btn sm" onClick={() => setSandbox(true)} disabled={!isAdmin}>
              Uji di chat sandbox
            </button>
            <button className="btn primary sm" onClick={saveVersion} disabled={!isAdmin || text === active?.content || text.length < 20}>
              Simpan versi baru
            </button>
          </div>
        }
      >
        <textarea className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} disabled={!isAdmin} />
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input sm" placeholder="Catatan perubahan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="xs muted nowrap">
            {active ? `v${active.version} · diubah ${active.by ?? 'sistem'}, ${dateTime(active.at)}` : ''}
          </span>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="small bold" style={{ cursor: 'pointer' }}>
            Riwayat versi ({versions.length})
          </summary>
          {versions.map((v) => (
            <div key={v.id} className="row small" style={{ padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
              <b>v{v.version}</b>
              <span className="muted">
                {v.by ?? 'sistem'} · {dateTime(v.at)} {v.note ? `· ${v.note}` : ''}
              </span>
              <span className="spacer" />
              {v.active ? (
                <span className="pill olive">Aktif</span>
              ) : (
                isAdmin && (
                  <button className="btn sm" onClick={() => activate(v.id)}>
                    Kembalikan
                  </button>
                )
              )}
            </div>
          ))}
        </details>
      </Card>
      <Card title="Pagar pengaman & aturan serah terima" sub="Daftar boleh/tidak boleh di layar AI & Otomasi dibaca dari sini. Kata terlarang & angka Rp dicek script SEBELUM balasan dikirim (lapis 1), lalu dicek AI (lapis 2)." actions={isAdmin && <button className="btn primary sm" onClick={saveGuard}>Simpan</button>}>
        <div className="form-grid">
          <Field label="Boleh (satu per baris)">
            <textarea className="input" rows={5} value={gd.allowT} onChange={(e) => setGd({ ...gd, allowT: e.target.value })} />
          </Field>
          <Field label="Tidak boleh (satu per baris)">
            <textarea className="input" rows={5} value={gd.denyT} onChange={(e) => setGd({ ...gd, denyT: e.target.value })} />
          </Field>
          <Field label="Lapis 1 — kata/frasa terlarang di balasan AI (pisahkan koma)" full>
            <textarea className="input" rows={2} value={gd.blockedT} onChange={(e) => setGd({ ...gd, blockedT: e.target.value })} />
          </Field>
          <label className="row small full">
            <Switch on={gd.blockRupiah} onChange={(v) => setGd({ ...gd, blockRupiah: v })} /> Tahan balasan AI yang menyebut angka uang (Rp, rb, juta)
          </label>
          <label className="row small full">
            <Switch on={gd.layer2 !== false} onChange={(v) => setGd({ ...gd, layer2: v })} /> Lapis 2: AI memeriksa ulang balasan yang lolos lapis 1 (menambah ±1 panggilan AI per balasan)
          </label>
          <Field label="Customer menyebut kata ini → serahkan segera ke sales (pisahkan koma)" full>
            <textarea className="input" rows={2} value={gd.handoffT} onChange={(e) => setGd({ ...gd, handoffT: e.target.value })} />
          </Field>
          <Field label="Serahkan ke sales bila data kualifikasi terisi ≥">
            <input className="input" type="number" min={1} max={5} value={gd.handoffWhenFieldsFilled} onChange={(e) => setGd({ ...gd, handoffWhenFieldsFilled: e.target.value })} />
          </Field>
          <Field label="Serahkan segera bila skor lead ≥">
            <input className="input" type="number" value={gd.handoffWhenScoreAtLeast} onChange={(e) => setGd({ ...gd, handoffWhenScoreAtLeast: e.target.value })} />
          </Field>
          <Field label="Pesan saat balasan ditahan / diteruskan ke sales (dikirim script, bukan AI)" full>
            <textarea className="input" rows={2} value={gd.holdMessage} onChange={(e) => setGd({ ...gd, holdMessage: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card title="FAQ" sub="Dicocokkan dengan kata kunci lebih dulu — kalau cocok, dijawab tanpa memanggil AI (lebih murah & pasti benar)." actions={isAdmin && <button className="btn primary sm" onClick={() => saveFaq(fq.map((f) => ({ keywords: typeof f.keywords === 'string' ? commas(f.keywords) : f.keywords, answer: f.answer })))}>Simpan FAQ</button>}>
        {fq.map((f, i) => (
          <div key={i} className="grid" style={{ gridTemplateColumns: '1fr 2fr auto', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <input className="input sm" placeholder="kata kunci, pisah koma" value={Array.isArray(f.keywords) ? f.keywords.join(', ') : f.keywords} onChange={(e) => setFq(fq.map((x, j) => (j === i ? { ...x, keywords: e.target.value } : x)))} />
            <input className="input sm" placeholder="Jawaban" value={f.answer} onChange={(e) => setFq(fq.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
            <button className="btn sm danger" onClick={() => setFq(fq.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn sm" onClick={() => setFq([...fq, { keywords: '', answer: '' }])}>
          ＋ Tambah FAQ
        </button>
      </Card>
      {sandbox && <Sandbox prompt={text} onClose={() => setSandbox(false)} />}
    </div>
  );
}

function Sandbox({ prompt, onClose }: { prompt: string; onClose: () => void }) {
  const toast = useToast();
  const [chat, setChat] = useState<{ from: 'customer' | 'ai'; text: string }[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  const send = async () => {
    const next = [...chat, { from: 'customer' as const, text: msg }];
    setChat(next);
    setMsg('');
    setBusy(true);
    try {
      const r = await api.post('/api/ai/sandbox', { prompt, chat: next });
      setLast(r);
      setChat([...next, { from: 'ai', text: r.reply }]);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal wide title="Uji prompt di chat sandbox" sub="Tidak ada pesan yang terkirim ke WhatsApp. Biaya AI tetap terhitung." onClose={onClose}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(220px, 1fr)' }}>
        <div className="thread" style={{ borderRadius: 12, minHeight: 320 }}>
          <div className="thread-body">
            {!chat.length && <div className="empty">Ketik pesan sebagai customer.</div>}
            {chat.map((c, i) => (
              <div key={i} className={`bubble ${c.from === 'customer' ? 'in' : 'ai'}`}>
                {c.text}
              </div>
            ))}
          </div>
          <div className="composer composer-row">
            <input className="input" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && msg && !busy && send()} placeholder="Pesan customer…" />
            <button className="btn primary" onClick={send} disabled={!msg || busy}>
              {busy ? '…' : 'Kirim'}
            </button>
          </div>
        </div>
        <div className="stack small">
          <div className="label">Hasil terakhir</div>
          {!last && <div className="muted">—</div>}
          {last?.handoff && <div className="banner">Serah terima ke sales: {last.handoff}</div>}
          {last?.guard && <div className="banner red">Ditahan lapis 1: {last.guard}</div>}
          {last?.extracted && (
            <div className="card" style={{ padding: 12 }}>
              {Object.entries(last.extracted).map(([k, v]) => (
                <div key={k} className="row xs">
                  <span className="muted" style={{ width: 110 }}>
                    {k}
                  </span>
                  <b>{v === null ? '—' : String(v)}</b>
                </div>
              ))}
            </div>
          )}
          <button className="btn sm" onClick={() => (setChat([]), setLast(null))}>
            Mulai ulang
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Model AI & API key ----------
const PROVIDERS: [string, string][] = [
  ['anthropic', 'Anthropic (Claude)'],
  ['google', 'Google (Gemini)'],
  ['openai', 'OpenAI'],
];

export function AiModelTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any>({ queryKey: ['ai-config'], queryFn: () => api.get('/api/ai/config') });
  const [s, setS] = useState<any>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  useEffect(() => data && setS(structuredClone({ ...data.settings, fallbackModels: data.settings.fallbackModels ?? { chat: '', smart: '' } })), [data]);
  if (!data || !s) return <Loading />;
  const save = async () => {
    try {
      await api.put('/api/ai/config', {
        ...s,
        monthlyBudgetIdr: Number(s.monthlyBudgetIdr),
        logRetentionDays: Number(s.logRetentionDays),
        usdToIdr: Number(s.usdToIdr),
        fallbackProvider: s.fallbackProvider || null,
        fallbackModels: s.fallbackProvider ? s.fallbackModels : undefined,
      });
      toast('Pengaturan AI disimpan');
      qc.invalidateQueries({ queryKey: ['ai-config'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const test = async (p: string) => {
    const r = await api.post(`/api/ai/keys/${p}/test`);
    toast(r.ok ? r.message : `Gagal: ${r.message}`, !r.ok);
  };
  const removeKey = async (p: string) => {
    if (!confirm('Hapus API key ini? AI berhenti membalas bila ini penyedia utama.')) return;
    await api.del(`/api/ai/keys/${p}`);
    qc.invalidateQueries({ queryKey: ['ai-config'] });
  };
  const pct = s.monthlyBudgetIdr ? Math.round((data.spendIdr / s.monthlyBudgetIdr) * 100) : 0;
  return (
    <div className="stack">
      <div className="grid grid-3">
        <Stat k="Biaya AI bulan ini" v={rupiah(data.spendIdr)} s={s.monthlyBudgetIdr ? `${pct}% dari pagu` : 'tanpa pagu'} />
        <Stat k="Penyedia utama" v={PROVIDERS.find((p) => p[0] === s.provider)?.[1]} s={`chat: ${s.models.chat}`} />
        <Stat k="Status" v={s.enabled ? (data.keys[s.provider] ? 'Aktif' : 'Key belum dipasang') : 'Dimatikan'} s={s.enabled ? 'AI membalas chat pertama' : 'Semua chat langsung ke sales'} />
      </div>
      <Card title="Penyedia AI & API key" sub="Pasang API key sekali, semua fitur AI di CRM langsung memakainya. Key disimpan terenkripsi di server; setelah disimpan hanya 4 karakter terakhir yang terlihat." actions={<button className="btn primary sm" onClick={save}>Simpan</button>}>
        <label className="row small" style={{ marginBottom: 12 }}>
          <Switch on={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} /> AI aktif
        </label>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Penyedia</th>
                <th>API key</th>
                <th>Peran</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map(([p, l]) => (
                <tr key={p}>
                  <td className="bold">{l}</td>
                  <td className="mono">{data.keys[p] ? `${data.keys[p].last4} · ${dateTime(data.keys[p].updatedAt)}` : <span className="muted">belum dipasang</span>}</td>
                  <td>
                    <select className="input sm" value={s.provider === p ? 'main' : s.fallbackProvider === p ? 'fallback' : ''} onChange={(e) => setS({ ...s, provider: e.target.value === 'main' ? p : s.provider === p ? 'anthropic' : s.provider, fallbackProvider: e.target.value === 'fallback' ? p : s.fallbackProvider === p ? null : s.fallbackProvider })}>
                      <option value="">—</option>
                      <option value="main">Utama</option>
                      <option value="fallback">Cadangan</option>
                    </select>
                  </td>
                  <td className="nowrap">
                    <button className="btn sm" onClick={() => setKeyFor(p)}>
                      {data.keys[p] ? 'Ganti key' : 'Pasang key'}
                    </button>{' '}
                    {data.keys[p] && (
                      <>
                        <button className="btn sm" onClick={() => test(p)}>
                          Uji
                        </button>{' '}
                        <button className="btn sm danger" onClick={() => removeKey(p)}>
                          Hapus
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Model per tugas" sub="Tugas yang sering (chat) pakai model hemat; tugas berat tapi jarang (laporan, analisa) pakai model yang lebih pintar.">
        <div className="form-grid">
          <Field label="Chat, ekstraksi data, pagar lapis 2 — penyedia utama" hint={`Saran: ${data.suggestions[s.provider]?.chat.join(', ') || 'isi ID model dari halaman resmi penyedia'}`}>
            <input className="input mono" value={s.models.chat} onChange={(e) => setS({ ...s, models: { ...s.models, chat: e.target.value } })} />
          </Field>
          <Field label="Laporan & analisa — penyedia utama" hint={`Saran: ${data.suggestions[s.provider]?.smart.join(', ') || '—'}`}>
            <input className="input mono" value={s.models.smart} onChange={(e) => setS({ ...s, models: { ...s.models, smart: e.target.value } })} />
          </Field>
          {s.fallbackProvider && (
            <>
              <Field label="Chat — cadangan">
                <input className="input mono" value={s.fallbackModels.chat} onChange={(e) => setS({ ...s, fallbackModels: { ...s.fallbackModels, chat: e.target.value } })} />
              </Field>
              <Field label="Laporan — cadangan">
                <input className="input mono" value={s.fallbackModels.smart} onChange={(e) => setS({ ...s, fallbackModels: { ...s.fallbackModels, smart: e.target.value } })} />
              </Field>
            </>
          )}
        </div>
      </Card>
      <Card title="Batas biaya & pengaman">
        <div className="form-grid">
          <Field label="Batas biaya per bulan (Rp)" hint="Notifikasi Admin di 80%. Di 100%, AI berhenti dan chat langsung ke sales; CRM tetap jalan. Isi 0 = tanpa batas.">
            <input className="input" type="number" value={s.monthlyBudgetIdr} onChange={(e) => setS({ ...s, monthlyBudgetIdr: e.target.value })} />
          </Field>
          <Field label="Kurs USD → Rp (untuk hitung biaya)">
            <input className="input" type="number" value={s.usdToIdr} onChange={(e) => setS({ ...s, usdToIdr: e.target.value })} />
          </Field>
          <Field label="Simpan log panggilan AI (hari)">
            <input className="input" type="number" value={s.logRetentionDays} onChange={(e) => setS({ ...s, logRetentionDays: e.target.value })} />
          </Field>
          <label className="row small">
            <Switch on={s.maskPii} onChange={(v) => setS({ ...s, maskPii: v })} /> Sembunyikan nomor HP, email & alamat sebelum dikirim ke AI
          </label>
        </div>
        {data.usage.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tugas</th>
                  <th>Model</th>
                  <th>Panggilan</th>
                  <th>Gagal</th>
                  <th>Biaya</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((u: any) => (
                  <tr key={u.task + u.model}>
                    <td>{u.task}</td>
                    <td className="mono">{u.model}</td>
                    <td>{u.calls}</td>
                    <td>{u.failed}</td>
                    <td>{rupiah(u.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {keyFor && <KeyModal provider={keyFor} model={s.provider === keyFor ? s.models.chat : s.fallbackModels?.chat || s.models.chat} onClose={() => setKeyFor(null)} />}
    </div>
  );
}

function KeyModal({ provider, model, onClose }: { provider: string; model: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [m, setM] = useState(model);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/ai/keys', { provider, apiKey: key, model: m });
      toast(`Tersimpan · ${r.message}`);
      qc.invalidateQueries({ queryKey: ['ai-config'] });
      qc.invalidateQueries({ queryKey: ['ai-overview'] });
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`API key ${PROVIDERS.find((p) => p[0] === provider)?.[1]}`} sub="Key diuji dulu ke penyedia; hanya disimpan bila koneksi berhasil." onClose={onClose} footer={<button className="btn primary" disabled={busy || key.length < 10} onClick={submit}>{busy ? 'Menguji…' : 'Simpan & uji koneksi'}</button>}>
      <div className="stack">
        <Field label="API key">
          <input className="input mono" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="Model untuk uji koneksi">
          <input className="input mono" value={m} onChange={(e) => setM(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------- WhatsApp ----------
export function WhatsAppTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: st } = useQuery<any>({ queryKey: ['wa-status'], queryFn: () => api.get('/api/whatsapp/status') });
  const { data: tpls } = useQuery<any[]>({ queryKey: ['wa-templates'], queryFn: () => api.get('/api/wa-templates') });
  const [varsFor, setVarsFor] = useState<any>(null);
  const [nt, setNt] = useState<any>(null);
  const [sub, setSub] = useState<'num' | 'prof' | 'tpl'>('num');
  if (!st) return <Loading />;
  const sync = async () => {
    try {
      const r = await api.post('/api/wa-templates/sync');
      toast(`${r.synced} template disinkronkan dari Meta`);
      qc.invalidateQueries({ queryKey: ['wa-templates'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const addTpl = async () => {
    try {
      await api.post('/api/wa-templates', nt);
      toast('Template ditambahkan');
      qc.invalidateQueries({ queryKey: ['wa-templates'] });
      setNt(null);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const sim = st.mode === 'simulator';
  return (
    <div className="stack">
      <div className="subtabs">
        {(
          [
            ['num', 'Nomor & koneksi'],
            ['prof', 'Profil bisnis WA'],
            ['tpl', 'Template pesan'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`chip${sub === k ? ' on' : ''}`} onClick={() => setSub(k)}>
            {l}
          </button>
        ))}
      </div>
      {sub === 'prof' && <WaProfileCard sim={sim} />}
      {sub === 'num' && (
      <Card title="Nomor & koneksi">
        <div className={`banner ${sim ? '' : 'olive'}`}>
          {sim ? (
            <>
              <b>Mode simulasi.</b> CRM belum tersambung ke WhatsApp Cloud API — chat masuk dibuat lewat tombol "Simulasi chat masuk" di Conversation. Semua alur (AI, serah terima, SLA, proposal) berjalan sama persis dengan saat live.
            </>
          ) : (
            <>
              <b>Terhubung ke WhatsApp Cloud API</b> · Phone number ID {st.phoneNumberId} · Graph {st.graphVersion}
            </>
          )}
        </div>
        <div className="grid grid-2" style={{ marginTop: 14 }}>
          <div className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
            <span>Webhook URL</span>
            <span className="mono">{st.webhookUrl}</span>
          </div>
          <div className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
            <span>Pesan masuk terakhir</span>
            <span>{st.lastInboundAt ? dateTime(st.lastInboundAt) : '—'}</span>
          </div>
          <div className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
            <span>Verify token</span>
            <span>{st.verifyTokenSet ? '✓ terpasang' : '— belum'}</span>
          </div>
          <div className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
            <span>App secret (tanda tangan)</span>
            <span>{st.appSecretSet ? '✓ terpasang' : '— belum'}</span>
          </div>
        </div>
        {sim && (
          <details style={{ marginTop: 12 }}>
            <summary className="small bold" style={{ cursor: 'pointer' }}>
              Langkah menyambungkan saat migrasi dari CRM lama
            </summary>
            <ol className="small" style={{ lineHeight: 1.8 }}>
              <li>Di Meta Business Manager → WhatsApp → API Setup, catat <b>Phone number ID</b> dan <b>WhatsApp Business Account ID</b>.</li>
              <li>Buat System User dengan izin whatsapp_business_messaging & whatsapp_business_management, lalu buat <b>access token permanen</b>.</li>
              <li>Ambil <b>App secret</b> dari App Dashboard → Settings → Basic.</li>
              <li>
                Isi di file <span className="mono">.env</span> server: WA_MODE=meta, WA_PHONE_NUMBER_ID, WA_BUSINESS_ACCOUNT_ID, WA_ACCESS_TOKEN, WA_APP_SECRET, dan WA_VERIFY_TOKEN (bebas, buat acak). Restart aplikasi.
              </li>
              <li>
                Di App Dashboard → WhatsApp → Configuration, isi Callback URL <span className="mono">{st.webhookUrl}</span> + verify token yang sama, lalu subscribe field <b>messages</b>.
              </li>
              <li>Putuskan webhook dari CRM lama (nomor yang sama, customer tidak perlu menyimpan nomor baru), lalu klik "Sinkron dari Meta" di bawah.</li>
            </ol>
            <div className="hint">Detail lengkap ada di docs/DEPLOY.md.</div>
          </details>
        )}
      </Card>
      )}
      {sub === 'tpl' && (
      <Card
        title="Template pesan WhatsApp"
        sub="Pesan resmi yang disetujui Meta — wajib untuk memulai chat atau membalas setelah jendela 24 jam habis."
        actions={
          <div className="row">
            <button className="btn sm" onClick={sync} disabled={sim}>
              Sinkron dari Meta
            </button>
            <button className="btn sm primary" onClick={() => setNt({ name: '', category: 'UTILITY', language: 'id', body: '', folder: 'Umum' })}>
              ＋ Template lokal
            </button>
          </div>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Kategori</th>
                <th>Isi</th>
                <th>Isi otomatis</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tpls?.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.name}</td>
                  <td>{t.category}</td>
                  <td className="small muted" style={{ maxWidth: 420 }}>
                    {t.body}
                  </td>
                  <td className="small" style={{ minWidth: 150 }}>
                    {slotCount(t.body) === 0 ? (
                      <span className="muted">tanpa variabel</span>
                    ) : (
                      <button className="btn ghost sm" style={{ padding: 0, textAlign: 'left' }} onClick={() => setVarsFor(t)}>
                        {(t.varMap ?? []).filter(Boolean).length}/{slotCount(t.body)} otomatis · Atur
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${t.status === 'APPROVED' ? 'olive' : t.status === 'REJECTED' ? 'hot' : 'warm'}`}>{t.status}</span>
                  </td>
                  <td>
                    <button
                      className="btn sm danger"
                      onClick={async () => {
                        await api.del(`/api/wa-templates/${t.id}`);
                        qc.invalidateQueries({ queryKey: ['wa-templates'] });
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tpls?.length && <Empty>Belum ada template.</Empty>}
        </div>
        {varsFor && <TemplateVarsModal t={varsFor} onClose={() => setVarsFor(null)} />}
        <div className="hint" style={{ marginTop: 8 }}>
          Template lokal dipakai untuk uji di mode simulasi. Saat live, buat & ajukan template di Meta lalu sinkronkan — hanya yang berstatus APPROVED yang bisa dikirim.
        </div>
      </Card>
      )}
      {nt && (
        <Modal title="Template lokal" onClose={() => setNt(null)} footer={<button className="btn primary" onClick={addTpl} disabled={!nt.name || !nt.body}>Simpan</button>}>
          <div className="form-grid">
            <Field label="Nama (huruf kecil & _)">
              <input className="input mono" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
            </Field>
            <Field label="Kategori">
              <select className="input" value={nt.category} onChange={(e) => setNt({ ...nt, category: e.target.value })}>
                <option>UTILITY</option>
                <option>MARKETING</option>
              </select>
            </Field>
            <Field label="Isi (variabel {{1}}, {{2}}, …)" full>
              <textarea className="input" value={nt.body} onChange={(e) => setNt({ ...nt, body: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

const VERTICALS: [string, string][] = [
  ['EVENT_PLAN', 'Jasa Event & Katering'],
  ['RESTAURANT', 'Restoran'],
  ['GROCERY', 'Makanan & Bahan Makanan'],
  ['OTHER', 'Lainnya'],
];

function WaProfileCard({ sim }: { sim: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ['wa-profile'], queryFn: () => api.get('/api/whatsapp/profile') });
  const [v, setV] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => data && setV({ ...data, websites: [...(data.websites ?? []), '', ''].slice(0, 2) }), [data]);
  if (!v) return <Loading />;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/api/whatsapp/profile', { about: v.about, description: v.description, address: v.address, email: v.email, websites: v.websites, vertical: v.vertical });
      toast(r.syncedAt ? 'Profil tersimpan & terkirim ke Meta' : 'Profil tersimpan — dikirim ke Meta setelah WhatsApp tersambung');
      qc.invalidateQueries({ queryKey: ['wa-profile'] });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(260px, 1fr)' }}>
      <Card
        title="Profil bisnis WhatsApp"
        sub="Yang dilihat customer saat membuka info kontak hotline."
        actions={
          <button className="btn primary sm" onClick={save} disabled={busy}>
            {sim ? 'Simpan' : 'Simpan ke Meta'}
          </button>
        }
      >
        {v.error && <div className="banner red" style={{ marginBottom: 12 }}>{v.error}</div>}
        {sim && <div className="banner" style={{ marginBottom: 12 }}>Mode simulasi: profil disimpan di CRM dulu. Setelah WhatsApp tersambung, buka tab ini dan klik "Simpan ke Meta".</div>}
        <div className="form-grid">
          <Field label="Kategori">
            <select className="input" value={v.vertical} onChange={set('vertical')}>
              {VERTICALS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email">
            <input className="input" value={v.email} onChange={set('email')} />
          </Field>
          <Field label={`Bio singkat (About) · ${v.about.length}/139`} full>
            <input className="input" maxLength={139} value={v.about} onChange={set('about')} />
          </Field>
          <Field label={`Deskripsi · ${v.description.length}/512`} full>
            <textarea className="input" maxLength={512} value={v.description} onChange={set('description')} />
          </Field>
          <Field label="Alamat" full>
            <input className="input" maxLength={256} value={v.address} onChange={set('address')} />
          </Field>
          {[0, 1].map((i) => (
            <Field key={i} label={`Website ${i + 1}`}>
              <input className="input" placeholder="https://" value={v.websites[i]} onChange={(e) => setV({ ...v, websites: v.websites.map((w: string, j: number) => (j === i ? e.target.value : w)) })} />
            </Field>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          Nama tampilan & foto profil diubah lewat WhatsApp Manager di Meta (ganti nama perlu ditinjau Meta 1–3 hari dan harus sesuai brand).
          {v.syncedAt && <> Terakhir dikirim ke Meta: {dateTime(v.syncedAt)}.</>}
        </div>
      </Card>
      <Card title="Pratinjau">
        <div style={{ background: 'var(--cream-100)', borderRadius: 14, padding: 18, textAlign: 'center' }}>
          <div className="brand-mark" style={{ width: 64, height: 64, margin: '0 auto 10px', borderRadius: '50%', fontSize: 20 }}>SK</div>
          <div className="bold">Sonokembang Catering Malang</div>
          <div className="xs muted">Akun bisnis · {VERTICALS.find((x) => x[0] === v.vertical)?.[1]}</div>
          <div className="small" style={{ marginTop: 12, textAlign: 'left' }}>{v.about || <span className="muted">Bio singkat…</span>}</div>
          <div className="xs muted" style={{ marginTop: 8, textAlign: 'left', whiteSpace: 'pre-wrap' }}>{v.description}</div>
          <div className="xs" style={{ marginTop: 8, textAlign: 'left' }}>
            {v.address && <div>📍 {v.address}</div>}
            {v.email && <div>✉ {v.email}</div>}
            {v.websites.filter(Boolean).map((w: string) => (
              <div key={w}>🔗 {w}</div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------- Import data ----------
export function ImportTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any>({ queryKey: ['imports'], queryFn: () => api.get('/api/import') });
  const [kind, setKind] = useState<'contacts' | 'leads' | 'chats' | 'snippets'>('contacts');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', file);
    setBusy(true);
    try {
      const r = await api.post('/api/import', fd);
      setPreview(r);
      setMapping(r.mapping);
      setResult(null);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/import/${preview.id}/commit`, { mapping });
      setResult(r);
      setPreview(null);
      qc.invalidateQueries();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <Card title="Import data" sub="Pindahkan data dari CRM lama atau file lain. Data tidak langsung ditimpa — selalu ada langkah cek dulu, dan field yang sudah terisi tidak diubah.">
        <div className="row wrap">
          {(
            [
              ['contacts', 'Kontak'],
              ['leads', 'Lead / opportunity'],
              ['chats', 'Riwayat chat'],
              ['snippets', 'Snippet'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => (setKind(k), setPreview(null))}>
              {l}
            </button>
          ))}
          <input className="input sm" style={{ maxWidth: 320 }} type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="btn primary sm" disabled={!file || busy} onClick={upload}>
            Unggah & cek
          </button>
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          File CSV atau Excel (.xlsx). Cara ekspor di CRM lama: menu Kontak → pilih semua → Ekspor · menu Opportunity/Pipeline → Ekspor. Tahap lama (New Lead, Contacted, Proposal Sent, Won / DP Paid, Lost) dipetakan otomatis ke tahap baru.
        </div>
        {kind === 'chats' && (
          <div className="banner info" style={{ marginTop: 10 }}>
            <b>Urutan impor riwayat chat:</b>
            <div className="small" style={{ marginTop: 4 }}>
              Dua bentuk file diterima: <b>satu baris = satu pesan</b> (kolom isi, waktu, arah inbound/outbound), atau <b>satu baris = pesan masuk + balasannya</b> (kolom isi & waktu inbound/outbound terpisah). Kolom kanal selain WhatsApp dilewati.
              <br />
              1. Bila file chat <b>tidak berisi nomor HP</b> (hanya contact_id), impor <b>Kontak</b> dulu dan petakan <span className="mono">contact_id</span> ke "ID kontak CRM lama".
              <br />
              2. Impor file chat. Nama sales dicocokkan dengan nama pengguna CRM (mis. "Aziza SPC" → Aziza), jadi buat akun sales dulu.
              <br />
              3. Aman diimpor ulang: pesan yang sudah ada (message_id sama) dilewati. Pesan hasil impor tidak memicu AI, SLA, atau notifikasi. Maksimal 100.000 baris per file.
            </div>
          </div>
        )}
      </Card>
      {preview && (
        <Card title={`Cek dulu · ${preview.total} baris`} sub="Cocokkan kolom file dengan field CRM. Tebakan otomatis bisa diubah." actions={<button className="btn olive sm" onClick={commit} disabled={busy}>{busy ? 'Memproses…' : `Import ${preview.total} baris`}</button>}>
          <div className="form-grid">
            {preview.fields.map((f: any) => (
              <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                <select className="input sm" value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                  <option value="">— tidak diimpor —</option>
                  {preview.headers.map((h: string) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="table">
              <thead>
                <tr>
                  {preview.headers.map((h: string) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r: any, i: number) => (
                  <tr key={i}>
                    {preview.headers.map((h: string) => (
                      <td key={h} className="small">
                        {r[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {result && (
        <div className={`banner ${result.errorCount ? '' : 'olive'}`}>
          Selesai: {result.created} {result.conversations !== undefined ? `pesan masuk ke ${result.conversations} percakapan` : 'dibuat'}, {result.updated} dilengkapi, {result.skipped} dilewati{result.otherChannel ? `, ${result.otherChannel} kanal lain dilewati` : ''}, {result.errorCount} gagal.
          {result.errors.slice(0, 10).map((e: any, i: number) => (
            <div key={i} className="xs">
              {e.row ? `Baris ${e.row}: ` : ''}
              {e.error}
            </div>
          ))}
        </div>
      )}
      <Card title="Riwayat import">
        {data?.jobs.map((j: any) => (
          <div key={j.id} className="row small" style={{ padding: '7px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <b>{j.filename}</b>
            <span className="muted">{j.kind}</span>
            <span className="spacer" />
            <span className={`pill ${j.status === 'done' ? 'olive' : j.status === 'cancelled' ? 'cold' : 'warm'}`}>{j.status}</span>
            {j.result && <span className="xs muted">{j.result.created} dibuat · {j.result.updated} dilengkapi</span>}
            <span className="xs muted">{dateTime(j.at)}</span>
          </div>
        ))}
        {!data?.jobs.length && <Empty>Belum ada import.</Empty>}
      </Card>
    </div>
  );
}

const slotCount = (body: string) => Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

/** Peta {{n}} → field CRM. Saat sales memilih template di Conversation, isinya langsung terisi. */
function TemplateVarsModal({ t, onClose }: { t: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: fields } = useQuery<{ key: string; label: string }[]>({ queryKey: ['wa-template-fields'], queryFn: () => api.get('/api/wa-templates/fields') });
  const n = slotCount(t.body);
  const [map, setMap] = useState<string[]>(Array.from({ length: n }, (_, i) => t.varMap?.[i] ?? ''));
  const label = (k: string) => fields?.find((f) => f.key === k)?.label;
  const preview = t.body.replace(/\{\{(\d+)\}\}/g, (m: string, d: string) => (map[Number(d) - 1] ? `[${label(map[Number(d) - 1]!) ?? m}]` : m));
  const save = async () => {
    try {
      await api.put(`/api/wa-templates/${t.id}/vars`, { varMap: map });
      qc.invalidateQueries({ queryKey: ['wa-templates'] });
      toast('Isi otomatis disimpan');
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title={`Isi otomatis · ${t.name}`} sub="Pilih data CRM untuk tiap variabel. Yang dibiarkan manual diketik sales saat mengirim." onClose={onClose} footer={<button className="btn primary" onClick={save}>Simpan</button>}>
      <div className="form-grid">
        {map.map((k, i) => (
          <Field key={i} label={`{{${i + 1}}}`}>
            <select className="input" value={k} onChange={(e) => setMap(Object.assign([...map], { [i]: e.target.value }))}>
              <option value="">Diketik manual</option>
              {fields?.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <div className="wa-bubble small" style={{ marginTop: 14 }}>
        {preview}
      </div>
    </Modal>
  );
}
