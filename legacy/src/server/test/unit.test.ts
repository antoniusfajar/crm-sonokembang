import { describe, expect, it } from 'vitest';
import { normalizePhone, formatPhone, maskPii } from '../src/lib/phone.js';
import { checkReplyLayer1, containsMoney, customerNeedsSales, matchFaq } from '../src/ai/guardrails.js';
import { computeScore } from '../src/services/scoring.js';
import { DEFAULT_SETTINGS } from '../src/services/defaults.js';
import { workingMinutesBetween, wibAt } from '../src/lib/time.js';
import { parseCsv } from '../src/lib/csv.js';
import { SecretBox } from '../src/lib/crypto.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { validateExtraction } from '../src/ai/responder.js';
import { canOpen, defaultMenus } from '../src/lib/permissions.js';
import { guessMapping } from '../src/http/routes/import.js';
import { parseMetaWebhook, buildInboundPayload } from '../src/whatsapp/simulator.js';
import { MetaCloudProvider } from '../src/whatsapp/meta.js';
import { createHmac } from 'node:crypto';

const g = DEFAULT_SETTINGS.guardrails as any;

describe('nomor WhatsApp', () => {
  it('menormalkan berbagai format', () => {
    expect(normalizePhone('0812-3344-9021')).toBe('6281233449021');
    expect(normalizePhone('+62 812 3344 9021')).toBe('6281233449021');
    expect(normalizePhone('812 3344 9021')).toBe('6281233449021');
    expect(normalizePhone('abc')).toBeNull();
    expect(formatPhone('6281233449021')).toBe('+62 812-3344-9021');
  });
  it('menyembunyikan nomor, email, alamat sebelum ke AI', () => {
    const m = maskPii('hubungi 081233449021 atau a@b.com, alamat Jl. Sukarno Hatta No. 5, Malang');
    expect(m).not.toContain('081233449021');
    expect(m).not.toContain('a@b.com');
    expect(m).not.toContain('Sukarno');
  });
});

describe('pagar pengaman lapis 1', () => {
  it('menahan balasan yang menyebut uang', () => {
    for (const t of ['Harganya Rp 75.000 per pax', 'cuma 75rb kak', 'sekitar 1,5 juta', 'totalnya 120jt']) {
      expect(containsMoney(t)).toBe(true);
      expect(checkReplyLayer1(t, g).ok).toBe(false);
    }
  });
  it('menahan kata terlarang dan meloloskan balasan wajar', () => {
    expect(checkReplyLayer1('Ada diskon 10% untuk kakak', g).ok).toBe(false);
    expect(checkReplyLayer1('Tanggalnya pasti tersedia kak', g).ok).toBe(false);
    expect(checkReplyLayer1('Baik kak, boleh info tanggal acara dan jumlah tamunya? Untuk 800 tamu kami siap bantu.', g).ok).toBe(true);
    expect(checkReplyLayer1('Acara tanggal 12.12 ya kak', g).ok).toBe(true);
  });
  it('mendeteksi pertanyaan harga dari customer', () => {
    expect(customerNeedsSales('kak kalau 300 pax berapa ya?', g)).toBeTruthy();
    expect(customerNeedsSales('Ada diskon?', g)).toBeTruthy();
    expect(customerNeedsSales('Saya mau tanya untuk resepsi', g)).toBeUndefined();
  });
  it('FAQ cocok dengan kata kunci', () => {
    expect(matchFaq('apakah menunya halal?', DEFAULT_SETTINGS.faq as any)).toContain('halal');
  });
});

describe('skor lead', () => {
  const rules = DEFAULT_SETTINGS.score_rules as any;
  it('lead lengkap & besar = Hot', () => {
    const r = computeScore({ eventType: 'Wedding', eventDate: '2026-12-12', location: 'Graha', pax: 800, budget: 120_000_000 }, rules, new Date('2026-10-06'));
    expect(r.temperature).toBe('Hot');
    expect(r.potensi).toBe('Besar');
    expect(r.filledCount).toBe(5);
  });
  it('lead kosong = Cold', () => {
    const r = computeScore({}, rules);
    expect(r.score).toBe(0);
    expect(r.temperature).toBe('Cold');
  });
});

describe('jam kerja SLA', () => {
  const wh = { start: '08:00', end: '20:00', days: [0, 1, 2, 3, 4, 5, 6] };
  it('hanya menghitung jam kerja', () => {
    expect(workingMinutesBetween(wibAt('2026-10-06', '09:00'), wibAt('2026-10-06', '09:45'), wh)).toBe(45);
    // 19:50 → besok 08:10 = 10 menit hari ini + 10 menit besok
    expect(workingMinutesBetween(wibAt('2026-10-06', '19:50'), wibAt('2026-10-07', '08:10'), wh)).toBe(20);
    // masuk tengah malam, SLA mulai 08:00
    expect(workingMinutesBetween(wibAt('2026-10-06', '23:00'), wibAt('2026-10-07', '08:15'), wh)).toBe(15);
  });
});

describe('ekstraksi AI divalidasi script', () => {
  it('menolak tanggal & angka yang tidak masuk akal', () => {
    const v = validateExtraction(
      { customer_name: 'Retno', event_type: 'Wedding', event_date: '2020-01-01', event_date_text: null, location: 'Graha', pax: -5, budget_idr: 50 },
      new Date('2026-10-06'),
    );
    expect(v.eventDate).toBeUndefined();
    expect(v.pax).toBeUndefined();
    expect(v.budget).toBeUndefined();
    expect(v.eventType).toBe('Wedding');
  });
});

describe('lain-lain', () => {
  it('CSV dengan kutip & titik koma', () => {
    expect(parseCsv('a;b\n"x;1";"he said ""hi"""\n')).toEqual([['a', 'b'], ['x;1', 'he said "hi"']]);
  });
  it('enkripsi API key bolak-balik', () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'));
    const enc = box.encrypt('sk-ant-secret');
    expect(enc).not.toContain('secret');
    expect(box.decrypt(enc)).toBe('sk-ant-secret');
  });
  it('hash kata sandi', async () => {
    const h = await hashPassword('rahasia123');
    expect(await verifyPassword('rahasia123', h)).toBe(true);
    expect(await verifyPassword('salah', h)).toBe(false);
  });
  it('hak akses bawaan sesuai prototype', () => {
    expect(canOpen('sales', defaultMenus('sales'), 'setting')).toBe(false);
    expect(canOpen('sales', defaultMenus('sales'), 'inbox')).toBe(true);
    expect(canOpen('marketing', defaultMenus('marketing'), 'inbox')).toBe(false);
    expect(canOpen('admin', { setting: false }, 'setting')).toBe(true);
  });
  it('menebak kolom import', () => {
    expect(guessMapping('contacts', ['Full Name', 'Phone', 'Email'])).toMatchObject({ name: 'Full Name', phone: 'Phone', email: 'Email' });
  });
  it('parser webhook Meta', () => {
    const ev = parseMetaWebhook(buildInboundPayload('6281', 'Budi', 'Halo', { id: 'wamid.1' }));
    expect(ev[0]).toMatchObject({ type: 'message', from: '6281', profileName: 'Budi', text: 'Halo', waMessageId: 'wamid.1' });
  });
  it('verifikasi tanda tangan webhook Meta', () => {
    const p = new MetaCloudProvider({ phoneNumberId: '1', accessToken: 't', verifyToken: 'v', appSecret: 'shh', graphVersion: 'v23.0' });
    const raw = Buffer.from('{"a":1}');
    const sig = 'sha256=' + createHmac('sha256', 'shh').update(raw).digest('hex');
    expect(p.verifySignature(raw, sig)).toBe(true);
    expect(p.verifySignature(raw, 'sha256=00')).toBe(false);
    expect(p.verifyToken('v')).toBe(true);
  });
});
