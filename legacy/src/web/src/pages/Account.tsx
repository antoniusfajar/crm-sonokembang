import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useMe } from '../auth';
import { Layout } from '../components/Layout';
import { Card, Field, useToast } from '../components/ui';
import { usePush } from '../push';

export function AccountPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const push = usePush();
  const pushAct = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return toast('Kata sandi baru tidak sama', true);
    setBusy(true);
    try {
      await api.post('/api/auth/password', { current: cur, next });
      toast('Kata sandi diganti');
      setCur('');
      setNext('');
      setAgain('');
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (ex) {
      toast((ex as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout title="Akun saya" eyebrow={me.user.roleLabel}>
      <div style={{ maxWidth: 520 }}>
        {me.user.mustChangePassword && <div className="banner" style={{ marginBottom: 16 }}>Ini login pertama Anda. Ganti kata sandi sementara sebelum memakai CRM.</div>}
        <Card title="Notifikasi di perangkat ini" sub="Lead baru, serah terima AI, peringatan SLA, dan tugas muncul di HP/laptop walaupun CRM sedang tidak dibuka." style={{ marginBottom: 16 }}>
          {push.state === 'on' ? (
            <div className="row wrap">
              <span className="pill olive">Aktif</span>
              <button className="btn sm" onClick={() => pushAct(() => api.post('/api/push/test'), 'Notifikasi tes dikirim')}>Kirim tes</button>
              <button className="btn sm" onClick={() => pushAct(push.disable, 'Dimatikan')}>Matikan</button>
            </div>
          ) : push.state === 'off' ? (
            <button className="btn olive" onClick={() => pushAct(push.enable, 'Notifikasi aktif di perangkat ini')}>Aktifkan notifikasi</button>
          ) : push.state === 'denied' ? (
            <div className="banner red">Izin notifikasi diblokir. Buka pengaturan situs di browser lalu izinkan notifikasi.</div>
          ) : push.state === 'unsupported' ? (
            <div className="banner">Browser ini belum mendukung notifikasi. Pakai Chrome atau Edge terbaru.</div>
          ) : null}
          <div className="hint" style={{ marginTop: 10 }}>Tips: pasang CRM di layar utama HP (Android: menu ⋮ → Instal aplikasi) supaya terasa seperti aplikasi.</div>
        </Card>
        <Card title="Ganti kata sandi" sub="Minimal 10 karakter, berisi huruf dan angka.">
          <form className="stack" onSubmit={submit}>
            <Field label="Kata sandi sekarang">
              <input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" />
            </Field>
            <Field label="Kata sandi baru">
              <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
            </Field>
            <Field label="Ulangi kata sandi baru">
              <input className="input" type="password" value={again} onChange={(e) => setAgain(e.target.value)} required autoComplete="new-password" />
            </Field>
            <div>
              <button className="btn primary" disabled={busy}>
                Simpan
              </button>
            </div>
          </form>
        </Card>
      </div>
    </Layout>
  );
}
