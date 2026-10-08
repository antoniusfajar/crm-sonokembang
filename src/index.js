import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import { startScheduler, runJob, jobList } from './scheduler.js';
import { sendMessage, receiveMessage, updateStatus, validSignature } from './whatsapp.js';

const app = express();
// Simpan raw body untuk verifikasi tanda tangan webhook WhatsApp
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

/** Endpoint yang dipanggil website wajib membawa header X-API-Key. */
function requireKey(req, res, next) {
  const given = Buffer.from(String(req.get('X-API-Key') || ''));
  const key = Buffer.from(config.apiKey);
  if (given.length !== key.length || !crypto.timingSafeEqual(given, key)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

// ---------- Untuk website (CI3) ----------
app.get('/health', requireKey, wrap(async (_req, res) => {
  let db = true;
  try { await pool.query('SELECT 1'); } catch { db = false; }
  res.json({ ok: true, db, waMode: config.wa.mode, uptimeSec: Math.round(process.uptime()), jobs: jobList() });
}));

app.post('/wa/send', requireKey, wrap(async (req, res) => {
  const { conversationId, body, userId } = req.body ?? {};
  if (!conversationId || !String(body ?? '').trim()) return res.status(400).json({ error: 'conversationId & body wajib' });
  res.json(await sendMessage({ conversationId: Number(conversationId), body: String(body), userId: userId ? Number(userId) : null }));
}));

app.post('/jobs/:name/run', requireKey, wrap(async (req, res) => {
  res.json(await runJob(req.params.name));
}));

// Mode simulator: pura-pura ada pesan masuk (untuk uji coba tanpa nomor WA)
app.post('/wa/simulate-inbound', requireKey, wrap(async (req, res) => {
  if (config.wa.mode !== 'simulator') return res.status(400).json({ error: 'hanya di WA_MODE=simulator' });
  const { phone, name, body } = req.body ?? {};
  res.json(await receiveMessage({ phone, name, body: String(body ?? '') }));
}));

// ---------- Webhook WhatsApp Cloud API (Meta) ----------
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.wa.verifyToken) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', wrap(async (req, res) => {
  if (!validSignature(req.rawBody ?? Buffer.alloc(0), req.get('X-Hub-Signature-256'))) return res.sendStatus(401);
  res.sendStatus(200); // balas cepat; Meta mengirim ulang bila lambat
  for (const entry of req.body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const names = Object.fromEntries((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages ?? []) {
        const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type}]`;
        await receiveMessage({ phone: m.from, name: names[m.from], body, waMessageId: m.id })
          .catch((e) => console.error('pesan masuk gagal disimpan:', e));
      }
      for (const s of v.statuses ?? []) await updateStatus(s.id, s.status).catch(() => {});
    }
  }
}));

app.get('/', (_req, res) => res.json({ app: 'crm-vps-server', ok: true }));

app.listen(config.port, config.host, () => {
  console.log(`crm-vps-server jalan di http://${config.host}:${config.port} (WA ${config.wa.mode})`);
  startScheduler();
});
