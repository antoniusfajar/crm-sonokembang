import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useMe } from '../auth';
import { MENU_META, PHASE_LABEL, menuForPath } from '../nav';
import { initials, relative } from '../format';
import { useLiveEvents } from '../events';
import { usePush } from '../push';

export function Layout({ children, flush, title, eyebrow }: { children: ReactNode; flush?: boolean; title?: string; eyebrow?: string }) {
  const me = useMe();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  useLiveEvents();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('nav') === 'c');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const activeKey = menuForPath(loc.pathname);
  const meta = activeKey ? MENU_META[activeKey] : undefined;

  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('nav', collapsed ? 'c' : 'o');
    } catch {
      /* abaikan */
    }
  }, [collapsed]);

  const badge = (k: string) => (k === 'inbox' ? me.badges.inbox : k === 'tugas' ? me.badges.tugas : k === 'ai' ? me.badges.ai : 0);

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.setQueryData(['me'], null);
    nav('/login');
  };

  return (
    <div className={`app${collapsed ? ' nav-collapsed' : ''}${mobileOpen ? ' nav-mobile-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">{me.business.logo ? <img src={me.business.logo} alt="" /> : 'SK'}</div>
          <div className="brand-text">
            <div className="brand-name">{me.business.name.replace(/\s+(Catering|Malang).*$/i, '') || 'Sonokembang'}</div>
            <div className="brand-sub">SALES CRM</div>
          </div>
          <button className="collapse-btn desktop-only" onClick={() => setCollapsed(!collapsed)} aria-label="Ciutkan menu">
            {collapsed ? '»' : '«'}
          </button>
        </div>
        {me.menus.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((i) => {
              const m = MENU_META[i.key]!;
              const n = badge(i.key);
              return (
                <Link key={i.key} to={m.path} className={`nav-item${activeKey === i.key ? ' active' : ''}`} title={i.label}>
                  <span className="nav-icon">{m.icon}</span>
                  <span className="nav-label">{i.label}</span>
                  {i.phase > 1 ? <span className="nav-soon">{PHASE_LABEL[i.phase]}</span> : n > 0 && <span className="nav-count">{n > 99 ? '99+' : n}</span>}
                </Link>
              );
            })}
          </div>
        ))}
        <div className="sidebar-foot nav-label">
          <div className="nav-group" style={{ padding: '0 0 6px' }}>
            Fase aktif
          </div>
          Fase 3 — Pemasaran &amp; integrasi
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn sm mobile-only" onClick={() => setMobileOpen(true)} aria-label="Buka menu">
            ☰
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">{eyebrow ?? meta?.eyebrow}</div>
            <div className="page-title ellipsis">{title ?? meta?.title}</div>
          </div>
          <div className="topbar-right">
            <span className={`wa-chip desktop-only${me.waMode === 'simulator' ? ' sim' : ''}`} title={me.waMode === 'simulator' ? 'WhatsApp belum disambungkan ke Meta. Chat masuk lewat menu simulasi.' : 'Terhubung ke WhatsApp Cloud API'}>
              <span className="dot" />
              {me.waMode === 'simulator' ? 'WA mode simulasi' : 'WABA hotline terhubung'}
            </span>
            <Bell open={bellOpen} setOpen={setBellOpen} count={me.badges.notif} />
            <div style={{ position: 'relative' }}>
              <button className="user-chip" onClick={() => setUserOpen(!userOpen)}>
                <span className="avatar">{initials(me.user.name)}</span>
                <span className="desktop-only" style={{ textAlign: 'left' }}>
                  <div className="bold small" style={{ color: 'var(--text-heading)' }}>
                    {me.user.name}
                  </div>
                  <div className="xs muted">{me.user.roleLabel}</div>
                </span>
              </button>
              {userOpen && (
                <div className="menu-pop" onMouseLeave={() => setUserOpen(false)}>
                  <div style={{ padding: '8px 12px 10px' }}>
                    <div className="bold">{me.user.name}</div>
                    <div className="xs muted">{me.user.email}</div>
                  </div>
                  <Link to="/akun" onClick={() => setUserOpen(false)}>
                    Ganti kata sandi
                  </Link>
                  <button onClick={logout}>⇥ Keluar</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className={`content${flush ? ' flush' : ''}`}>{children}</div>
      </div>
      {mobileOpen && <div className="modal-back" style={{ zIndex: 70, background: 'rgba(32,28,26,.3)' }} onClick={() => setMobileOpen(false)} />}
    </div>
  );
}

function Bell({ open, setOpen, count }: { open: boolean; setOpen: (v: boolean) => void; count: number }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const push = usePush();
  const { data } = useQuery<any[]>({ queryKey: ['notifications'], queryFn: () => api.get('/api/notifications'), enabled: open });
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, setOpen]);
  const readAll = async () => {
    await api.post('/api/notifications/read', {});
    qc.invalidateQueries({ queryKey: ['me'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const kindPill: Record<string, string> = { sla: 'hot', lead: 'olive', ai: 'warm', tugas: '', sistem: 'cold' };
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn sm" onClick={() => setOpen(!open)} aria-label="Notifikasi" style={{ position: 'relative' }}>
        🔔{count > 0 && <span className="nav-count" style={{ position: 'absolute', top: -6, right: -6 }}>{count}</span>}
      </button>
      {open && (
        <div className="menu-pop" style={{ width: 340, maxHeight: 420, overflow: 'auto' }}>
          <div className="row" style={{ padding: '6px 10px' }}>
            <span className="bold">Notifikasi</span>
            <span className="spacer" />
            <button className="btn ghost sm" style={{ width: 'auto' }} onClick={readAll}>
              Tandai semua dibaca
            </button>
          </div>
          {push.state === 'off' && (
            <button onClick={() => push.enable().catch((e) => alert((e as Error).message))} style={{ background: 'var(--olive-100)', color: 'var(--olive-800)', fontWeight: 600 }}>
              📱 Aktifkan notifikasi di perangkat ini
            </button>
          )}
          {!data?.length && <div className="empty">Belum ada notifikasi.</div>}
          {data?.map((n) => (
            <button
              key={n.id}
              onClick={async () => {
                await api.post('/api/notifications/read', { id: n.id });
                qc.invalidateQueries({ queryKey: ['me'] });
                setOpen(false);
                if (n.link) nav(n.link);
              }}
              style={{ background: n.readAt ? 'transparent' : 'var(--cream-050)' }}
            >
              <div className="row" style={{ gap: 6 }}>
                <span className={`pill ${kindPill[n.kind] ?? ''}`}>{n.kind.toUpperCase()}</span>
                <span className="xs muted">{relative(n.createdAt)}</span>
              </div>
              <div style={{ marginTop: 4, fontWeight: n.readAt ? 400 : 600, fontSize: 12.5 }}>{n.text}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
