import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------- Toast ----------
type ToastState = { msg: string; error?: boolean } | null;
const ToastCtx = createContext<(msg: string, error?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<ToastState>(null);
  const timer = useRef<number>();
  const show = useCallback((msg: string, error?: boolean) => {
    setT({ msg, error });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), error ? 5000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className={`toast${t.error ? ' error' : ''}`} role="status">
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Komponen kecil ----------
export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' on' : ''}`} disabled={disabled} onClick={() => onChange?.(!on)} />;
}

export function TempPill({ t, score }: { t?: string | null; score?: number | null }) {
  if (!t) return null;
  return (
    <span className={`pill ${t.toLowerCase()}`}>
      {t}
      {score !== undefined && score !== null ? ` ${score}` : ''}
    </span>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Memuat" />;
}
export function Loading() {
  return (
    <div className="center">
      <Spinner />
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Modal({ title, sub, onClose, children, footer, wide }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <div className="modal-title">{title}</div>
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          <button className="x-btn" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, full }: { label: ReactNode; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field${full ? ' full' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Card({ title, sub, actions, children, className, style }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`card${className ? ' ' + className : ''}`} style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <div className="card-title">{title}</div>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          <div className="spacer" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([k, l]) => (
        <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)} type="button">
          {l}
        </button>
      ))}
    </div>
  );
}

export function Stat({ k, v, s }: { k: ReactNode; v: ReactNode; s?: ReactNode }) {
  return (
    <div className="card">
      <div className="stat-k">{k}</div>
      <div className="stat-v">{v}</div>
      {s && <div className="stat-s">{s}</div>}
    </div>
  );
}

export function ScoreRing({ score, temp }: { score: number; temp: string }) {
  const color = temp === 'Hot' ? 'var(--rose-500)' : temp === 'Warm' ? 'var(--gold-400)' : 'var(--charcoal-300)';
  return (
    <div className="score-ring" style={{ background: `conic-gradient(${color} ${score * 3.6}deg, var(--cream-200) 0)` }}>
      <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#fff', display: 'grid', placeItems: 'center' }}>{score}</div>
    </div>
  );
}

/** Input rupiah dengan pemisah ribuan; nilai keluar berupa angka (atau null bila kosong). */
export function MoneyInput({ value, onChange, placeholder, style, disabled }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; style?: React.CSSProperties; disabled?: boolean }) {
  return (
    <div className="money-input" style={style}>
      <span>Rp</span>
      <input
        className="input"
        inputMode="numeric"
        disabled={disabled}
        value={value === null || value === undefined ? '' : value.toLocaleString('id-ID')}
        placeholder={placeholder}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, '');
          onChange(d ? Math.min(Number(d), 1e13) : null);
        }}
      />
    </div>
  );
}
