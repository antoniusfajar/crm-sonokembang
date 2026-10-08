// Skor lead Hot/Warm/Cold — murni script (Fase 2 §2 no. 3). Rumus masih draft, dikalibrasi setelah 1–2 bulan data.

export interface ScoreRules {
  hot: number;
  warm: number;
  points: {
    eventType: number;
    eventDate: number;
    location: number;
    pax: number;
    budget: number;
    paxLarge: number;
    budgetLarge: number;
    dateSoon: number;
  };
  potensi: { besar: number; sedang: number };
}

export interface ScoreInput {
  eventType?: string | null;
  eventDate?: string | null; // YYYY-MM-DD
  eventDateText?: string | null;
  location?: string | null;
  pax?: number | null;
  budget?: number | null;
  estimatedValue?: number | null;
}

export interface ScoreResult {
  score: number;
  breakdown: { label: string; pts: number }[];
  temperature: 'Hot' | 'Warm' | 'Cold';
  potensi: 'Kecil' | 'Sedang' | 'Besar';
  filledCount: number;
}

export function computeScore(l: ScoreInput, r: ScoreRules, now = new Date()): ScoreResult {
  const b: { label: string; pts: number }[] = [];
  const p = r.points;
  const filled = {
    eventType: !!l.eventType?.trim(),
    eventDate: !!l.eventDate || !!l.eventDateText?.trim(),
    location: !!l.location?.trim(),
    pax: !!l.pax && l.pax > 0,
    budget: !!l.budget && l.budget > 0,
  };
  if (filled.eventType) b.push({ label: 'Jenis acara jelas', pts: p.eventType });
  if (filled.eventDate) b.push({ label: 'Tanggal acara disebut', pts: p.eventDate });
  if (filled.location) b.push({ label: 'Lokasi acara disebut', pts: p.location });
  if (filled.pax) b.push({ label: 'Jumlah pax disebut', pts: p.pax });
  if (filled.budget) b.push({ label: 'Budget disebut', pts: p.budget });
  if ((l.pax ?? 0) >= 300) b.push({ label: 'Pax besar (≥ 300)', pts: p.paxLarge });
  if ((l.budget ?? 0) >= 50_000_000) b.push({ label: 'Budget besar (≥ Rp 50 jt)', pts: p.budgetLarge });
  if (l.eventDate) {
    const days = (new Date(l.eventDate + 'T00:00:00Z').getTime() - now.getTime()) / 86_400_000;
    if (days >= 0 && days <= 90) b.push({ label: 'Acara ≤ 90 hari lagi', pts: p.dateSoon });
  }
  const score = Math.max(0, Math.min(100, b.reduce((s, x) => s + x.pts, 0)));
  const temperature = score >= r.hot ? 'Hot' : score >= r.warm ? 'Warm' : 'Cold';
  const value = l.estimatedValue ?? l.budget ?? 0;
  const potensi = value >= r.potensi.besar ? 'Besar' : value >= r.potensi.sedang ? 'Sedang' : 'Kecil';
  return { score, breakdown: b, temperature, potensi, filledCount: Object.values(filled).filter(Boolean).length };
}
