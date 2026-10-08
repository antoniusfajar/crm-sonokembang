import { randomUUID } from 'node:crypto';
import type { RemoteTemplate, SendResult, WebhookEvent, WhatsAppProvider } from './provider.js';

/**
 * Mode simulasi: dipakai sampai nomor WABA dipindah ke CRM ini.
 * Pesan keluar dianggap terkirim, pesan masuk dibuat lewat menu "Simulasi chat masuk".
 * Format webhook-nya sama dengan Meta, jadi alur yang diuji di sini = alur saat live.
 */
export class SimulatorProvider implements WhatsAppProvider {
  readonly mode = 'simulator' as const;
  readonly sent: { to: string; type: string; body: string }[] = [];

  private record(to: string, type: string, body: string): SendResult {
    this.sent.push({ to, type, body });
    if (this.sent.length > 500) this.sent.shift();
    return { waMessageId: `sim.${randomUUID()}` };
  }
  async sendText(to: string, body: string) {
    return this.record(to, 'text', body);
  }
  async sendTemplate(to: string, name: string, _lang: string, params: string[]) {
    return this.record(to, 'template', `${name}(${params.join(', ')})`);
  }
  async sendDocument(to: string, doc: { filename: string; caption?: string }) {
    return this.record(to, 'document', doc.filename);
  }
  // Webhook publik ditutup di mode simulasi: chat simulasi hanya lewat /api/simulator/inbound (wajib login).
  verifySignature() {
    return false;
  }
  verifyToken() {
    return false;
  }
  parseWebhook(body: unknown): WebhookEvent[] {
    return parseMetaWebhook(body);
  }
  async listTemplates(): Promise<RemoteTemplate[]> {
    return [];
  }
  async getBusinessProfile() {
    return null;
  }
  async updateBusinessProfile() {
    // Mode simulasi: profil hanya disimpan di CRM, dikirim ke Meta setelah WA_MODE=meta.
  }
}

/** Parser payload webhook WhatsApp Cloud API (dipakai simulator & Meta). */
export function parseMetaWebhook(body: any): WebhookEvent[] {
  const out: WebhookEvent[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      if (!v) continue;
      const names = new Map<string, string>();
      for (const c of v.contacts ?? []) if (c?.wa_id) names.set(String(c.wa_id), c?.profile?.name);
      for (const m of v.messages ?? []) {
        let text = '';
        let kind: 'text' | 'image' | 'document' | 'other' = 'other';
        if (m.type === 'text') {
          text = m.text?.body ?? '';
          kind = 'text';
        } else if (m.type === 'image') {
          text = m.image?.caption ?? '[gambar]';
          kind = 'image';
        } else if (m.type === 'document') {
          text = m.document?.caption ?? `[dokumen] ${m.document?.filename ?? ''}`.trim();
          kind = 'document';
        } else if (m.type === 'button') {
          text = m.button?.text ?? '';
          kind = 'text';
        } else if (m.type === 'interactive') {
          text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
          kind = 'text';
        } else {
          text = `[${m.type}]`;
        }
        out.push({
          type: 'message',
          from: String(m.from),
          profileName: names.get(String(m.from)),
          waMessageId: String(m.id),
          timestamp: new Date(Number(m.timestamp ?? Date.now() / 1000) * 1000),
          kind,
          text,
          referral: m.referral
            ? { sourceId: m.referral.source_id, sourceType: m.referral.source_type, headline: m.referral.headline, ctwaClid: m.referral.ctwa_clid }
            : undefined,
        });
      }
      for (const s of v.statuses ?? []) {
        if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
        out.push({
          type: 'status',
          waMessageId: String(s.id),
          status: s.status,
          error: s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title ?? s.errors[0].message ?? ''}` : undefined,
        });
      }
    }
  }
  return out;
}

/** Bentuk payload webhook Meta untuk satu pesan teks (dipakai simulasi & test). */
export function buildInboundPayload(from: string, name: string, text: string, opts: { id?: string; referral?: object } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'SIMULATOR',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [
                {
                  from,
                  id: opts.id ?? `wamid.sim.${randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                  ...(opts.referral ? { referral: opts.referral } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
