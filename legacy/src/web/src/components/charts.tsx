import { useRef, useState, type ReactNode } from 'react';

// Grafik ringan tanpa library. Aturan: mark tipis, ujung data membulat 4px, grid hairline,
// legenda untuk ≥2 seri, teks memakai warna teks (bukan warna seri), tooltip saat hover/fokus.

// Palet seri yang sudah lolos validator buta warna (lihat docs/DESIGN-DATA.md).
export const SERIES = { rose: '#db6262', olive: '#46701a', gold: '#c8861f' };
export const STATUS = { good: '#46701a', warn: '#c8861f', bad: '#c6040d' };

export function statusColor(pct: number | null | undefined, good = 100, warn = 70) {
  if (pct === null || pct === undefined) return 'var(--charcoal-300)';
  return pct >= good ? STATUS.good : pct >= warn ? STATUS.warn : STATUS.bad;
}

// ---------- Tooltip ----------
export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const show = (e: React.PointerEvent | React.FocusEvent, content: ReactNode) => {
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    const src = 'clientX' in e ? { x: e.clientX, y: e.clientY } : (() => {
      const b = (e.target as Element).getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top };
    })();
    setTip({ x: src.x - r.left, y: src.y - r.top, content });
  };
  const hide = () => setTip(null);
  const layer = tip ? (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.content}
    </div>
  ) : null;
  return { host, show, hide, layer };
}

export function TipRow({ color, label, value }: { color?: string; label: string; value: ReactNode }) {
  return (
    <div className="tip-row">
      {color && <span className="tip-key" style={{ background: color }} />}
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

// ---------- Cincin persentase (meter) ----------
export function Ring({ pct, color, size = 112, children }: { pct: number | null; color: string; size?: number; children?: ReactNode }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cream-200)" strokeWidth={stroke} />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

// ---------- Bar horizontal (progress / perbandingan) ----------
export function Meter({ pct, color, height = 8 }: { pct: number | null; color: string; height?: number }) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="meter" style={{ height }}>
      <span style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

/** Daftar bar horizontal berlabel (funnel, alasan lost, sumber). */
export function HBars({
  rows,
  color,
  format = (n) => n.toLocaleString('id-ID'),
  note,
  labelWidth = 170,
}: {
  rows: { label: string; value: number; note?: ReactNode; color?: string }[];
  color: string;
  format?: (n: number) => string;
  note?: (r: any) => ReactNode;
  labelWidth?: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const tip = useTip();
  return (
    <div ref={tip.host} style={{ position: 'relative' }}>
      {rows.map((r) => (
        <div
          key={r.label}
          className="hbar-row"
          style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr) auto` }}
          tabIndex={0}
          onPointerMove={(e) => tip.show(e, <TipRow color={r.color ?? color} label={r.label} value={format(r.value)} />)}
          onPointerLeave={tip.hide}
          onFocus={(e) => tip.show(e, <TipRow color={r.color ?? color} label={r.label} value={format(r.value)} />)}
          onBlur={tip.hide}
        >
          <span className="small ellipsis">{r.label}</span>
          <div className="hbar-track">
            <span style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} />
          </div>
          <span className="small nowrap" style={{ textAlign: 'right' }}>
            <b>{format(r.value)}</b> {r.note ?? note?.(r)}
          </span>
        </div>
      ))}
      {tip.layer}
    </div>
  );
}

// ---------- Kolom berkelompok (tren) ----------
export function Columns({
  data,
  series,
  height = 200,
  format = (n) => n.toLocaleString('id-ID'),
}: {
  data: { label: string; values: number[] }[];
  series: { name: string; color: string }[];
  height?: number;
  format?: (n: number) => string;
}) {
  const tip = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const W = 720;
  const padL = 36;
  const padB = 24;
  const plotH = height - padB;
  const band = (W - padL) / data.length;
  const barW = Math.min(18, (band - 10) / series.length - 2);
  const y = (v: number) => plotH - (v / top) * (plotH - 8);
  return (
    <div ref={tip.host} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`Grafik kolom: ${series.map((s) => s.name).join(' vs ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--charcoal-100)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10.5} fill="var(--text-muted)">
              {t.toLocaleString('id-ID')}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const gx = padL + i * band + (band - (barW + 2) * series.length) / 2;
          return (
            <g
              key={d.label}
              tabIndex={0}
              onPointerMove={(e) => {
                setHover(i);
                tip.show(e, (
                  <>
                    <div className="tip-head">{d.label}</div>
                    {series.map((s, k) => (
                      <TipRow key={s.name} color={s.color} label={s.name} value={format(d.values[k] ?? 0)} />
                    ))}
                  </>
                ));
              }}
              onPointerLeave={() => (setHover(null), tip.hide())}
              onFocus={(e) => (setHover(i), tip.show(e, <><div className="tip-head">{d.label}</div>{series.map((s, k) => <TipRow key={s.name} color={s.color} label={s.name} value={format(d.values[k] ?? 0)} />)}</>))}
              onBlur={() => (setHover(null), tip.hide())}
              style={{ outline: 'none' }}
            >
              <rect x={padL + i * band} y={0} width={band} height={plotH} fill={hover === i ? 'var(--cream-100)' : 'transparent'} />
              {d.values.map((v, k) => {
                const h = Math.max(0, plotH - y(v));
                const x = gx + k * (barW + 2);
                return h > 0 ? <path key={k} d={roundTop(x, y(v), barW, h, Math.min(4, h))} fill={series[k]!.color} /> : null;
              })}
              <text x={padL + i * band + band / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {tip.layer}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="row" style={{ gap: 14 }}>
      {items.map((i) => (
        <span key={i.name} className="row xs muted" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
