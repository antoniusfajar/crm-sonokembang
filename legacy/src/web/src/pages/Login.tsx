import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function LoginPage() {
  const qc = useQueryClient();
  const { data: brand } = useQuery<{ name: string; tagline: string; logo: string | null }>({ queryKey: ['brand'], queryFn: () => api.get('/api/public/brand') });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/api/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="login-art">
        <div className="row">
          <div className="brand-mark">{brand?.logo ? <img src={brand.logo} alt="" /> : 'SK'}</div>
          <div>
            <div className="brand-name">{brand?.name ?? 'Sonokembang Catering Malang'}</div>
            <div className="brand-sub">SALES &amp; MARKETING CRM</div>
          </div>
        </div>
        <h1>Satu hotline, semua chat & lead tercatat rapi.</h1>
        <div style={{ color: 'rgba(255,255,255,.55)', fontSize: 12.5 }}>Hotline WhatsApp resmi · Malang</div>
      </div>
      <div className="login-form">
        <form className="login-box" onSubmit={submit}>
          <div className="eyebrow">Sonokembang Sales CRM</div>
          <h2 style={{ font: '700 28px/1.2 var(--font-display)', margin: '6px 0 22px' }}>Masuk ke CRM</h2>
          <div className="stack">
            <label className="field">
              <span>Email kantor</span>
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            <label className="field">
              <span>Kata sandi</span>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {err && <div className="banner red">{err}</div>}
            <button className="btn primary block" disabled={busy}>
              {busy ? 'Memproses…' : 'Masuk'}
            </button>
            <div className="hint" style={{ textAlign: 'center' }}>
              Chat customer adalah data sensitif. Aktivitas login dicatat.
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
