// Pagar pengaman lapis 1 (script). Dicek SEBELUM balasan AI dikirim.

export interface GuardrailConfig {
  blockedPhrases: string[];
  blockRupiah: boolean;
  handoffKeywords: string[];
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD');

// Angka uang: "Rp 75.000", "rp75rb", "75 ribu", "1,5 juta", "120jt", "Rp. 1.000.000"
const RUPIAH_RE = /(\brp\.?\s*\d)|(\b\d+([.,]\d+)?\s*(rb|ribu|k|jt|juta|m|miliar)\b)|(\b\d{1,3}(\.\d{3}){1,4}\b)/i;

export function containsMoney(text: string): boolean {
  return RUPIAH_RE.test(text);
}

function phraseHit(text: string, phrases: string[]): string | undefined {
  const t = norm(text);
  return phrases.find((p) => {
    const q = norm(p.trim());
    if (!q) return false;
    // cocokkan sebagai kata/frasa utuh
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
    return re.test(t);
  });
}

/** Lapis 1: tahan balasan AI yang menyebut uang atau frasa terlarang. */
export function checkReplyLayer1(reply: string, cfg: GuardrailConfig): GuardResult {
  if (cfg.blockRupiah && containsMoney(reply)) return { ok: false, reason: 'Balasan AI menyebut angka harga/uang' };
  const hit = phraseHit(reply, cfg.blockedPhrases);
  if (hit) return { ok: false, reason: `Balasan AI memuat kata terlarang "${hit}"` };
  return { ok: true };
}

/** Pesan customer yang menyentuh harga/diskon/ketersediaan → serahkan segera ke sales. */
export function customerNeedsSales(message: string, cfg: GuardrailConfig): string | undefined {
  const hit = phraseHit(message, cfg.handoffKeywords);
  if (hit) return `Customer menyinggung "${hit}"`;
  return undefined;
}

export function matchFaq(message: string, faq: { keywords: string[]; answer: string }[]): string | undefined {
  for (const f of faq) if (phraseHit(message, f.keywords)) return f.answer;
  return undefined;
}
