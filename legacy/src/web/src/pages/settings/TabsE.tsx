import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useMe } from '../../auth';
import { Card, Empty, Field, Loading, Modal, Switch, useToast } from '../../components/ui';
import { dateTime, relative } from '../../format';

interface Provider {
  id: string;
  label: string;
  short: string;
  category: 'ads' | 'sosmed' | 'web' | 'reputasi';
  auth: 'meta' | 'google' | 'tiktok' | 'none';
  requirements: string[];
  scope: string;
  expires: boolean;
}
interface Account {
  id: string;
  provider: string;
  providerLabel: string;
  accountName: string;
  accountType: string | null;
  status: 'connected' | 'error' | 'disconnected';
  syncOn: boolean;
  expiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  category: string;
  expires: boolean;
  meta: any;
}

const CATS: [string, string][] = [
  ['all', 'Semua'],
  ['sosmed', 'Media sosial'],
  ['ads', 'Iklan'],
  ['reputasi', 'Reputasi'],
  ['web', 'Website'],
];
const BADGE: Record<string, string> = { meta_ads: '#1877f2', instagram: '#c13584', facebook: '#1877f2', tiktok: '#111', gbp: '#34a853', ga4: '#e37400', gsc: '#4285f4', uptime: '#46701a' };
const FAMILY_LABEL: Record<string, string> = { meta: 'Meta (Facebook)', google: 'Google', tiktok: 'TikTok' };

export function PlatformBadge({ provider, short }: { provider: string; short: string }) {
  return (
    <span className="pf-badge" style={{ background: BADGE[provider] ?? 'var(--charcoal-500)' }} aria-hidden>
      {short}
    </span>
  );
}

export function IntegrationsTab() {
  const me = useMe();
  const isAdmin = me.user.role === 'admin';
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data } = useQuery<{ providers: Provider[]; accounts: Account[] }>({ queryKey: ['integrations'], queryFn: () => api.get('/api/integrations') });
  const [cat, setCat] = useState('all');
  const [connect, setConnect] = useState<string | null | undefined>(undefined); // undefined = tutup, null = pilih platform
  const grant = params.get('grant');
  const err = params.get('error');
  useEffect(() => {
    if (err) {
      toast(err, true);
      setParams({}, { replace: true });
    }
  }, [err]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const act = async (fn: () => Promise<any>, ok?: string) => {
    try {
      const r = await fn();
      if (r?.ok === false) toast(r.error, true);
      else if (ok) toast(ok);
      refresh();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  if (!data) return <Loading />;
  const prov = (id: string) => data.providers.find((p) => p.id === id)!;
  const rows = data.accounts.filter((a) => cat === 'all' || a.category === cat);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card
        title="Integrasi platform"
        sub="Hubungkan akun iklan, media sosial, Google Bisnis, dan website. Data ditarik otomatis; token disimpan terenkripsi di server dan tidak pernah tampil lagi."
        actions={
          isAdmin && (
            <button className="btn primary sm" onClick={() => setConnect(null)}>
              + Hubungkan akun
            </button>
          )
        }
      >
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          {CATS.map(([k, l]) => (
            <button key={k} className={`chip${cat === k ? ' on' : ''}`} onClick={() => setCat(k)}>
              {l}
            </button>
          ))}
        </div>
        {!rows.length ? (
          <Empty>{data.accounts.length ? 'Tidak ada akun di kategori ini.' : 'Belum ada akun yang terhubung. Mulai dari Pemantau website (langsung jalan) atau Google Bisnis untuk ulasan.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Akun</th>
                  <th>Status</th>
                  <th>Masa berlaku izin</th>
                  <th>Sinkron otomatis</th>
                  <th>Terakhir</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const p = prov(a.provider);
                  const days = a.expiresAt ? Math.ceil((new Date(a.expiresAt).getTime() - Date.now()) / 86_400_000) : null;
                  const up = a.provider === 'uptime' ? a.meta?.uptime : null;
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <PlatformBadge provider={a.provider} short={p?.short ?? '?'} />
                          <div style={{ minWidth: 0 }}>
                            <b className="ellipsis" style={{ display: 'block' }}>
                              {a.accountName}
                            </b>
                            <span className="xs muted">
                              {a.providerLabel}
                              {a.accountType ? ` · ${a.accountType}` : ''}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {a.status === 'error' ? (
                          <span className="pill hot">Perlu login ulang</span>
                        ) : up && up.up === false ? (
                          <span className="pill hot">Website mati</span>
                        ) : a.lastError ? (
                          <span className="pill warm" title={a.lastError}>
                            Sinkron gagal
                          </span>
                        ) : (
                          <span className="pill olive">Terhubung</span>
                        )}
                      </td>
                      <td className="small" style={{ color: days !== null && days <= 14 ? 'var(--gold-600)' : undefined, fontWeight: days !== null && days <= 14 ? 600 : undefined }}>
                        {days === null ? (a.provider === 'uptime' ? '—' : 'Diperbarui otomatis') : days > 0 ? `${days} hari lagi` : 'Sudah habis'}
                      </td>
                      <td>
                        <Switch on={a.syncOn} disabled={!isAdmin} onChange={(on) => act(() => api.patch(`/api/integrations/${a.id}`, { syncOn: on }))} />
                      </td>
                      <td className="small muted">
                        {up?.checkedAt ? `${relative(up.checkedAt)}${up.lastMs ? ` · ${up.lastMs} ms` : ''}` : a.lastSyncAt ? relative(a.lastSyncAt) : 'menunggu'}
                        {a.lastError && <div className="xs" style={{ color: 'var(--red-700)', maxWidth: 260 }}>{a.lastError}</div>}
                      </td>
                      {isAdmin && (
                        <td className="nowrap" style={{ textAlign: 'right' }}>
                          <button className="btn ghost sm" onClick={() => act(() => api.post(`/api/integrations/${a.id}/sync`), 'Sinkron selesai')}>
                            Sinkron
                          </button>
                          {(a.status === 'error' || (p?.expires && days !== null)) && p.auth !== 'none' && (
                            <button className="btn sm" onClick={() => setConnect(a.provider)}>
                              Login ulang
                            </button>
                          )}
                          <button className="btn ghost sm" onClick={() => confirm(`Putuskan ${a.accountName}? Data lama tetap tersimpan.`) && act(() => api.del(`/api/integrations/${a.id}`), 'Akun diputus — data lama tetap tersimpan')}>
                            Putuskan
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isAdmin && <DeveloperApps />}

      <Card title="Bagaimana integrasi bekerja">
        <div className="grid grid-2" style={{ gap: 10 }}>
          {[
            ['1. Login resmi', 'Klik Hubungkan → login di Meta / Google / TikTok → pilih akun Sonokembang → setujui izin. CRM hanya menyimpan token izin, bukan password. Untuk Meta, cara paling awet adalah menempel token System User dari Business Manager.'],
            ['2. Tarik data otomatis', 'Ulasan Google tiap jam, iklan tiap 3 jam, media sosial & website tiap 6 jam, pemantau website tiap 5 menit. Matikan "Sinkron otomatis" untuk menjeda.'],
            ['3. Izin punya masa berlaku', 'Token login Meta & TikTok berlaku ±60 hari; 14 hari sebelum habis Admin dapat notifikasi untuk Login ulang. Google dan token System User Meta diperbarui otomatis.'],
            ['4. Syarat akun', 'Instagram harus akun Professional yang terhubung ke Facebook Page. TikTok harus akun Business. Google Bisnis harus profil terverifikasi dan akses Business Profile API sudah disetujui Google.'],
          ].map(([t, d]) => (
            <div key={t} className="tile">
              <b className="small">{t}</b>
              <div className="xs muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
                {d}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {connect !== undefined && <ConnectModal providers={data.providers} initial={connect} onClose={() => setConnect(undefined)} onDone={refresh} />}
      {grant && (
        <GrantModal
          state={grant}
          onClose={() => {
            setParams({}, { replace: true });
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ConnectModal({ providers, initial, onClose, onDone }: { providers: Provider[]; initial: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const [sel, setSel] = useState<string | null>(initial);
  const [token, setToken] = useState('');
  const [url, setUrl] = useState('https://');
  const [busy, setBusy] = useState(false);
  const p = providers.find((x) => x.id === sel);
  const login = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ url: string }>(`/api/integrations/oauth/${p!.auth}/start`);
      window.location.href = r.url;
    } catch (e) {
      toast((e as Error).message, true);
      setBusy(false);
    }
  };
  const pasteToken = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ state: string }>('/api/integrations/meta/token', { token });
      onClose();
      setParams({ grant: r.state });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const addUptime = async () => {
    setBusy(true);
    try {
      await api.post('/api/integrations/uptime', { url });
      toast('Website dipantau tiap 5 menit');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Hubungkan akun" sub="Pilih platform. Admin login dengan akun yang punya akses ke aset Sonokembang." onClose={onClose} wide>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(200px, 240px) minmax(0, 1fr)', gap: 16 }}>
        <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
          {providers.map((x) => (
            <button key={x.id} className={`opt row${sel === x.id ? ' on' : ''}`} style={{ gap: 10 }} onClick={() => setSel(x.id)}>
              <PlatformBadge provider={x.id} short={x.short} />
              <b>{x.label}</b>
            </button>
          ))}
        </div>
        <div>
          {!p ? (
            <Empty>Pilih platform di kiri.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div className="label" style={{ marginBottom: 6 }}>
                  Syarat
                </div>
                {p.requirements.map((r) => (
                  <div key={r} className="small" style={{ marginBottom: 3 }}>
                    ✓ {r}
                  </div>
                ))}
                <div className="xs muted" style={{ marginTop: 6 }}>
                  Izin yang diminta: {p.scope}
                </div>
              </div>
              {p.auth === 'none' ? (
                <>
                  <Field label="Alamat website">
                    <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sonokembangmalang.com" />
                  </Field>
                  <button className="btn primary" disabled={busy} onClick={addUptime}>
                    Mulai pantau
                  </button>
                </>
              ) : (
                <>
                  {p.auth === 'meta' && (
                    <div className="tile">
                      <b className="small">Cara 1 (disarankan): tempel token System User</b>
                      <div className="xs muted" style={{ margin: '4px 0 8px', lineHeight: 1.5 }}>
                        Business Manager › Pengaturan bisnis › Pengguna sistem › buat pengguna sistem (Admin) › tetapkan aset (ad account, Page, Instagram) › Buat token dengan izin ads_read, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_manage_insights, instagram_content_publish. Token ini tidak kedaluwarsa.
                      </div>
                      <textarea className="input" rows={3} value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG…" />
                      <button className="btn primary sm" style={{ marginTop: 8 }} disabled={busy || token.trim().length < 20} onClick={pasteToken}>
                        Cek token & pilih akun
                      </button>
                    </div>
                  )}
                  <div className="tile">
                    <b className="small">{p.auth === 'meta' ? 'Cara 2: ' : ''}Login dengan {FAMILY_LABEL[p.auth]}</b>
                    <div className="xs muted" style={{ margin: '4px 0 8px', lineHeight: 1.5 }}>
                      Butuh {p.auth === 'google' ? 'Client ID & Client Secret Google' : p.auth === 'meta' ? 'App ID & App Secret Meta' : 'Client key & secret TikTok'} di kartu "Aplikasi developer" di bawah. Satu kali login bisa menghubungkan beberapa akun sekaligus.
                    </div>
                    <button className="btn sm" disabled={busy} onClick={login}>
                      Lanjut login {FAMILY_LABEL[p.auth]} →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function GrantModal({ state, onClose }: { state: string; onClose: () => void }) {
  const toast = useToast();
  const { data, error } = useQuery<{ family: string; error: string | null; accounts: { provider: string; accountId: string; name: string; type: string; expiresAt: number | null }[] }>({
    queryKey: ['grant', state],
    queryFn: () => api.get(`/api/integrations/grants/${state}`),
    retry: false,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (data?.accounts) setPicked(new Set(data.accounts.map((a) => `${a.provider}|${a.accountId}`)));
  }, [data]);
  const save = async () => {
    try {
      const picks = [...picked].map((k) => ({ provider: k.split('|')[0], accountId: k.split('|').slice(1).join('|') }));
      const r = await api.post<{ connected: number }>(`/api/integrations/grants/${state}/connect`, { picks });
      toast(`${r.connected} akun terhubung — data pertama ditarik di latar belakang`);
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Modal title="Pilih akun yang dihubungkan" sub="Hanya akun yang dicentang yang datanya ditarik ke CRM." onClose={onClose} footer={data?.accounts?.length ? <button className="btn primary" disabled={!picked.size} onClick={save}>Hubungkan {picked.size} akun</button> : undefined}>
      {error ? (
        <div className="banner red">{(error as Error).message}</div>
      ) : !data ? (
        <Loading />
      ) : data.error ? (
        <div className="banner red">Login gagal: {data.error}</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {data.accounts.map((a) => {
            const k = `${a.provider}|${a.accountId}`;
            return (
              <label key={k} className="row tile" style={{ gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={picked.has(k)}
                  onChange={(e) => {
                    const n = new Set(picked);
                    e.target.checked ? n.add(k) : n.delete(k);
                    setPicked(n);
                  }}
                />
                <div style={{ flex: 1 }}>
                  <b className="small">{a.name}</b>
                  <div className="xs muted">
                    {a.type}
                    {a.expiresAt ? ` · izin s/d ${dateTime(new Date(a.expiresAt).toISOString())}` : ''}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function DeveloperApps() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<Record<string, { id: string | null; secret?: string; redirectUri: string; updatedAt?: string }>>({ queryKey: ['integration-apps'], queryFn: () => api.get('/api/integrations/apps') });
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Record<string, { id: string; secret: string }>>({});
  if (!data) return null;
  const save = async (f: string) => {
    try {
      await api.put(`/api/integrations/apps/${f}`, edit[f]);
      toast('Tersimpan');
      setEdit({ ...edit, [f]: { id: '', secret: '' } });
      qc.invalidateQueries({ queryKey: ['integration-apps'] });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const HELP: Record<string, string> = {
    meta: 'developers.facebook.com › My Apps › buat app tipe Business › Facebook Login for Business. Tambahkan Redirect URI di bawah ke "Valid OAuth Redirect URIs". Tidak wajib bila memakai token System User.',
    google: 'console.cloud.google.com › APIs & Services › aktifkan Google Analytics Admin & Data API, Search Console API, dan Business Profile API › Credentials › OAuth client ID (Web application) › Authorized redirect URI di bawah.',
    tiktok: 'developers.tiktok.com › Manage apps › Login Kit + Display API › Redirect URI di bawah.',
  };
  return (
    <Card
      title="Aplikasi developer"
      sub="Dibutuhkan untuk tombol Login (OAuth). Diisi sekali oleh IT saat pemasangan; secret disimpan terenkripsi."
      actions={
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>
          {open ? 'Tutup' : 'Atur'}
        </button>
      }
    >
      <div className="row wrap" style={{ gap: 8 }}>
        {Object.entries(data).map(([f, a]) => (
          <span key={f} className={`pill ${a.id ? 'olive' : ''}`}>
            {FAMILY_LABEL[f]}: {a.id ? 'terisi' : 'belum'}
          </span>
        ))}
      </div>
      {open &&
        Object.entries(data).map(([f, a]) => (
          <div key={f} style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 14, paddingTop: 14 }}>
            <b className="small">{FAMILY_LABEL[f]}</b>
            <div className="xs muted" style={{ margin: '4px 0 8px', lineHeight: 1.5 }}>
              {HELP[f]}
            </div>
            <div className="small" style={{ marginBottom: 8 }}>
              Redirect URI: <code className="mono">{a.redirectUri}</code>
            </div>
            {a.id && (
              <div className="xs muted" style={{ marginBottom: 8 }}>
                Sekarang: {a.id} · secret {a.secret}
              </div>
            )}
            <div className="form-grid">
              <Field label={f === 'meta' ? 'App ID' : f === 'google' ? 'Client ID' : 'Client key'}>
                <input className="input" value={edit[f]?.id ?? ''} onChange={(e) => setEdit({ ...edit, [f]: { id: e.target.value, secret: edit[f]?.secret ?? '' } })} />
              </Field>
              <Field label={f === 'meta' ? 'App Secret' : 'Client Secret'}>
                <input className="input" type="password" value={edit[f]?.secret ?? ''} onChange={(e) => setEdit({ ...edit, [f]: { id: edit[f]?.id ?? '', secret: e.target.value } })} />
              </Field>
            </div>
            <button className="btn sm" style={{ marginTop: 8 }} disabled={!edit[f]?.id || !edit[f]?.secret} onClick={() => save(f)}>
              Simpan
            </button>
          </div>
        ))}
    </Card>
  );
}
