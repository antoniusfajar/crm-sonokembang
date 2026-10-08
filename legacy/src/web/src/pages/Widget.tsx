import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Layout } from '../components/Layout';
import { Card, Field, Loading, Seg, Switch, useToast } from '../components/ui';

interface Cfg {
  enabled: boolean;
  position: 'right' | 'left';
  color: string;
  launcher: 'bubble' | 'pill';
  label: string;
  greeting: string;
  showGreeting: boolean;
  badge: boolean;
  prechat: boolean;
  askEvent: boolean;
  askDate: boolean;
  eventOptions: string[];
  hoursNote: string;
  allowedDomains: string[];
  hotline?: string;
  businessName?: string;
  logo?: string | null;
}

export function WidgetPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<{ config: Cfg; embedCode: string; leads30: number }>({ queryKey: ['widget'], queryFn: () => api.get('/api/widget') });
  const [c, setC] = useState<Cfg | null>(null);
  const [mode, setMode] = useState<'closed' | 'open'>('open');
  useEffect(() => {
    if (data) setC(structuredClone(data.config));
  }, [data]);
  if (!data || !c) return <Layout><Loading /></Layout>;
  const save = async () => {
    try {
      const { hotline, businessName, logo, ...body } = c;
      await api.put('/api/widget', body);
      qc.invalidateQueries({ queryKey: ['widget'] });
      toast('Widget disimpan — website mengikuti dalam ±5 menit (cache)');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const set = (p: Partial<Cfg>) => setC({ ...c, ...p });
  return (
    <Layout>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(320px, 1fr)', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {!data.config.hotline && (
            <div className="banner red">
              Nomor hotline belum diisi — widget tidak akan tampil. Isi di <Link to="/pengaturan/profil">Pengaturan › Profil bisnis</Link>.
            </div>
          )}
          <Card
            title="Konfigurasi widget"
            sub="Widget di website mengarahkan percakapan ke hotline WhatsApp yang sama — tidak ada kotak masuk terpisah. Lead dari widget bersumber Website dengan penanda halaman."
            actions={
              <div className="row" style={{ gap: 8 }}>
                <Toggle on={c.enabled} onChange={(v) => set({ enabled: v })} label={c.enabled ? 'Aktif' : 'Mati'} />
                <button className="btn primary sm" onClick={save}>
                  Simpan
                </button>
              </div>
            }
          >
            <div className="form-grid">
              <Field label="Posisi">
                <Seg value={c.position} options={[['right', 'Kanan bawah'], ['left', 'Kiri bawah']]} onChange={(v) => set({ position: v })} />
              </Field>
              <Field label="Warna aksen">
                <div className="row" style={{ gap: 8 }}>
                  <input type="color" value={c.color} onChange={(e) => set({ color: e.target.value })} aria-label="Warna aksen" />
                  <input className="input sm mono" style={{ width: 110 }} value={c.color} onChange={(e) => set({ color: e.target.value })} />
                </div>
              </Field>
              <Field label="Bentuk tombol">
                <Seg value={c.launcher} options={[['bubble', 'Bulat'], ['pill', 'Tombol + teks']]} onChange={(v) => set({ launcher: v })} />
              </Field>
              {c.launcher === 'pill' && (
                <Field label="Teks tombol">
                  <input className="input" value={c.label} onChange={(e) => set({ label: e.target.value })} />
                </Field>
              )}
              <Field label="Sapaan pembuka" full>
                <input className="input" value={c.greeting} onChange={(e) => set({ greeting: e.target.value })} />
              </Field>
              <Field label="Keterangan jam operasional" full>
                <input className="input" value={c.hoursNote} onChange={(e) => set({ hoursNote: e.target.value })} />
              </Field>
            </div>
            <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
              <Toggle on={c.showGreeting} onChange={(v) => set({ showGreeting: v })} label="Tampilkan gelembung sapaan di samping tombol" />
              <Toggle on={c.badge} onChange={(v) => set({ badge: v })} label='Badge "1" agar pengunjung terdorong membuka chat' />
            </div>
          </Card>
          <Card title="Form pra-chat" sub="Diisi sebelum WhatsApp dibuka. Isinya langsung mengisi data lead, jadi AI tidak menanyakan ulang — dan nomor tetap tercatat walau pengunjung batal chat.">
            <div style={{ display: 'grid', gap: 8 }}>
              <Toggle on={c.prechat} onChange={(v) => set({ prechat: v })} label="Minta nama & nomor WhatsApp sebelum chat" />
              {c.prechat && (
                <>
                  <Toggle on={c.askEvent} onChange={(v) => set({ askEvent: v })} label="Tanya jenis acara (opsional untuk pengunjung)" />
                  <Toggle on={c.askDate} onChange={(v) => set({ askDate: v })} label="Tanya perkiraan tanggal (opsional)" />
                  {c.askEvent && (
                    <Field label="Pilihan jenis acara" hint="Pisahkan dengan koma">
                      <input className="input" value={c.eventOptions.join(', ')} onChange={(e) => set({ eventOptions: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                    </Field>
                  )}
                </>
              )}
            </div>
          </Card>
          <Card title="Kode embed" sub="Tempel sebelum </body> di semua halaman website. Nama halaman terkirim otomatis sebagai penanda sumber (WEB-widget-halaman).">
            <textarea className="input mono" rows={2} readOnly value={data.embedCode} />
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(data.embedCode).then(() => toast('Kode disalin'))}>
                Salin kode
              </button>
              <span className="small muted">{data.leads30} lead dari widget dalam 30 hari terakhir</span>
            </div>
            <Field label="Hanya tampil di domain (opsional)" hint="Kosongkan agar tampil di mana saja kode dipasang. Contoh: sonokembangmalang.com">
              <input className="input" value={c.allowedDomains.join(', ')} onChange={(e) => set({ allowedDomains: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} />
            </Field>
          </Card>
        </div>

        <Card title="Pratinjau" actions={<Seg value={mode} options={[['closed', 'Tertutup'], ['open', 'Terbuka']]} onChange={setMode} />}>
          <div className="widget-stage" style={{ justifyContent: c.position === 'left' ? 'flex-start' : 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: c.position === 'left' ? 'flex-start' : 'flex-end', gap: 10 }}>
              {mode === 'open' ? (
                <div className="wpanel">
                  <div className="whead" style={{ background: c.color }}>
                    <div>
                      <b>{data.config.businessName}</b>
                      <small>{c.hoursNote}</small>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: 18 }}>×</span>
                  </div>
                  <div className="wbody">
                    <div className="wmsg">{c.greeting}</div>
                    {c.prechat && (
                      <>
                        <div className="wlabel">Nama</div>
                        <div className="winput" />
                        <div className="wlabel">Nomor WhatsApp</div>
                        <div className="winput" />
                        {c.askEvent && (
                          <>
                            <div className="wlabel">Jenis acara</div>
                            <div className="winput">— pilih —</div>
                          </>
                        )}
                        {c.askDate && (
                          <>
                            <div className="wlabel">Perkiraan tanggal</div>
                            <div className="winput" />
                          </>
                        )}
                      </>
                    )}
                    <div className="wgo">Lanjut chat di WhatsApp</div>
                  </div>
                </div>
              ) : (
                c.showGreeting && <div className="wgreet">{c.greeting}</div>
              )}
              <div className={`wlaunch ${c.launcher}`} style={{ background: c.color }}>
                💬 {c.launcher === 'pill' ? c.label : ''}
                {c.badge && mode === 'closed' && <span className="wdot">1</span>}
              </div>
            </div>
          </div>
          <div className="xs muted" style={{ marginTop: 8 }}>
            Di luar jam operasional, chat tetap masuk ke WhatsApp dan AI membalas lebih dulu.
          </div>
        </Card>
      </div>
    </Layout>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
      <Switch on={on} onChange={onChange} label={label} />
      <span>{label}</span>
    </label>
  );
}
