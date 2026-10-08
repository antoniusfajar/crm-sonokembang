import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RemoteTemplate, SendResult, WaBusinessProfile, WhatsAppProvider } from './provider.js';
import { parseMetaWebhook } from './simulator.js';

export interface MetaConfig {
  phoneNumberId: string;
  businessAccountId?: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  graphVersion: string;
}

/** WhatsApp Cloud API (Meta). Aktif bila WA_MODE=meta. */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly mode = 'meta' as const;
  private base: string;

  constructor(private cfg: MetaConfig, private fetchFn: typeof fetch = fetch) {
    this.base = `https://graph.facebook.com/${cfg.graphVersion}`;
  }

  private async call(path: string, init: RequestInit): Promise<any> {
    const res = await this.fetchFn(`${this.base}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.cfg.accessToken}`, ...(init.headers ?? {}) },
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = json?.error;
      throw new Error(`WhatsApp API ${res.status}: ${e?.message ?? 'gagal'}${e?.code ? ` (kode ${e.code})` : ''}`);
    }
    return json;
  }

  private async send(payload: object): Promise<SendResult> {
    const json = await this.call(`${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    });
    const id = json?.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp API tidak mengembalikan id pesan');
    return { waMessageId: id };
  }

  sendText(to: string, body: string) {
    return this.send({ to, type: 'text', text: { preview_url: true, body } });
  }

  sendTemplate(to: string, name: string, language: string, params: string[]) {
    return this.send({
      to,
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [],
      },
    });
  }

  async sendDocument(to: string, doc: { buffer: Buffer; filename: string; mime: string; caption?: string }) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', doc.mime);
    form.append('file', new Blob([new Uint8Array(doc.buffer)], { type: doc.mime }), doc.filename);
    const media = await this.call(`${this.cfg.phoneNumberId}/media`, { method: 'POST', body: form });
    return this.send({ to, type: 'document', document: { id: media.id, filename: doc.filename, caption: doc.caption } });
  }

  verifySignature(rawBody: Buffer, header: string | undefined): boolean {
    if (!header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', this.cfg.appSecret).update(rawBody).digest();
    const got = Buffer.from(header.slice(7), 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  verifyToken(token: string | undefined): boolean {
    return !!token && token === this.cfg.verifyToken;
  }

  parseWebhook(body: unknown) {
    return parseMetaWebhook(body);
  }

  async listTemplates(): Promise<RemoteTemplate[]> {
    if (!this.cfg.businessAccountId) return [];
    const json = await this.call(`${this.cfg.businessAccountId}/message_templates?limit=200`, { method: 'GET' });
    return (json?.data ?? []).map((t: any) => ({
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      body: (t.components ?? []).find((c: any) => c.type === 'BODY')?.text ?? '',
    }));
  }

  async getBusinessProfile(): Promise<WaBusinessProfile> {
    const json = await this.call(`${this.cfg.phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,websites,vertical`, { method: 'GET' });
    const d = json?.data?.[0] ?? {};
    return {
      about: d.about ?? '',
      description: d.description ?? '',
      address: d.address ?? '',
      email: d.email ?? '',
      websites: d.websites ?? [],
      vertical: d.vertical ?? 'UNDEFINED',
    };
  }

  async updateBusinessProfile(p: WaBusinessProfile): Promise<void> {
    await this.call(`${this.cfg.phoneNumberId}/whatsapp_business_profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        about: p.about,
        description: p.description,
        address: p.address,
        email: p.email,
        websites: p.websites.filter(Boolean),
        vertical: p.vertical,
      }),
    });
  }
}
