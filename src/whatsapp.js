import crypto from 'node:crypto';
import { config } from './config.js';
import { query, one } from './db.js';
import { callWebsite } from './website.js';

/** Kirim teks WA. Mode simulator hanya mencatat; mode meta memakai WhatsApp Cloud API. */
async function deliver(phone, body) {
  if (config.wa.mode === 'simulator') {
    console.log(`[WA simulator] -> ${phone}: ${body.slice(0, 80)}`);
    return { id: `sim-${crypto.randomUUID()}` };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${config.wa.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.wa.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return { id: data.messages?.[0]?.id };
}

/** Simpan pesan keluar lalu kirim; status pesan diperbarui sesuai hasil. */
export async function sendMessage({ conversationId, body, userId = null, senderType = 'user' }) {
  const conv = await one(
    'SELECT cv.id, c.wa_phone FROM conversations cv JOIN contacts c ON c.id = cv.contact_id WHERE cv.id = ?',
    [conversationId],
  );
  if (!conv) throw new Error('Percakapan tidak ditemukan');
  const r = await query(
    "INSERT INTO messages (conversation_id, direction, sender_type, user_id, body, status) VALUES (?, 'out', ?, ?, ?, 'queued')",
    [conv.id, senderType, userId, body],
  );
  const messageId = r.insertId;
  try {
    const sent = await deliver(conv.wa_phone, body);
    await query("UPDATE messages SET status = 'sent', wa_message_id = ? WHERE id = ?", [sent.id ?? null, messageId]);
  } catch (e) {
    await query("UPDATE messages SET status = 'failed', error = ? WHERE id = ?", [String(e.message).slice(0, 250), messageId]);
    throw e;
  }
  await query(
    `UPDATE conversations SET last_message_at = NOW(), last_message_preview = ?,
       awaiting_reply_since = NULL, sla_level = 0 WHERE id = ?`,
    [body.slice(0, 250), conv.id],
  );
  return { messageId };
}

/** Pesan masuk dari webhook (atau simulator). */
export async function receiveMessage({ phone, name, body, waMessageId = null }) {
  phone = String(phone).replace(/\D/g, '');
  let contact = await one('SELECT id, owner_id FROM contacts WHERE wa_phone = ?', [phone]);
  const isNew = !contact;
  if (isNew) {
    const r = await query('INSERT INTO contacts (wa_phone, name, first_message_at) VALUES (?, ?, NOW())', [phone, name || null]);
    contact = { id: r.insertId, owner_id: null };
  }
  await query('UPDATE contacts SET last_message_at = NOW() WHERE id = ?', [contact.id]);

  let conv = await one("SELECT id FROM conversations WHERE contact_id = ? AND channel = 'whatsapp'", [contact.id]);
  if (!conv) {
    const r = await query('INSERT INTO conversations (contact_id, assignee_id) VALUES (?, ?)', [contact.id, contact.owner_id]);
    conv = { id: r.insertId };
  }
  try {
    await query(
      "INSERT INTO messages (conversation_id, direction, sender_type, body, wa_message_id, status) VALUES (?, 'in', 'customer', ?, ?, 'received')",
      [conv.id, body, waMessageId],
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return { duplicate: true }; // webhook dikirim ulang oleh Meta
    throw e;
  }
  await query(
    `UPDATE conversations SET last_inbound_at = NOW(), last_message_at = NOW(), last_message_preview = ?,
       unread_count = unread_count + 1, awaiting_reply_since = COALESCE(awaiting_reply_since, NOW()) WHERE id = ?`,
    [body.slice(0, 250), conv.id],
  );
  if (/^\s*stop\s*$/i.test(body)) {
    await query('UPDATE contacts SET opt_out_at = NOW() WHERE id = ?', [contact.id]);
  }
  if (isNew) {
    // Kode sumber di pesan pertama, mis. "Halo [IG]" -> ref IG
    const ref = body.match(/\[([A-Z0-9_-]{2,20})\]/)?.[1];
    callWebsite('auto_lead', { contactId: contact.id, sourceRef: ref }).catch((e) =>
      console.error('auto_lead gagal:', e.message),
    );
  }
  return { conversationId: conv.id, contactId: contact.id };
}

/** Verifikasi tanda tangan webhook Meta (X-Hub-Signature-256). */
export function validSignature(rawBody, header) {
  if (!config.wa.appSecret) return config.wa.mode === 'simulator';
  const expected = 'sha256=' + crypto.createHmac('sha256', config.wa.appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Status terkirim/dibaca dari Meta. */
export async function updateStatus(waMessageId, status) {
  if (!['sent', 'delivered', 'read', 'failed'].includes(status)) return;
  await query('UPDATE messages SET status = ? WHERE wa_message_id = ?', [status, waMessageId]);
}
