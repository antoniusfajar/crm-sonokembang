export interface SendResult {
  waMessageId: string;
}

export interface InboundMessage {
  type: 'message';
  from: string; // nomor pengirim (digit)
  profileName?: string;
  waMessageId: string;
  timestamp: Date;
  kind: 'text' | 'image' | 'document' | 'other';
  text: string;
  // Data iklan click-to-WhatsApp (Meta mengirim "referral" pada pesan pertama dari iklan)
  referral?: { sourceId?: string; sourceType?: string; headline?: string; ctwaClid?: string };
}

export interface StatusUpdate {
  type: 'status';
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
}

export type WebhookEvent = InboundMessage | StatusUpdate;

export interface RemoteTemplate {
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
}

export interface WaBusinessProfile {
  about: string;
  description: string;
  address: string;
  email: string;
  websites: string[];
  vertical: string;
}

export interface WhatsAppProvider {
  readonly mode: 'simulator' | 'meta';
  sendText(to: string, body: string): Promise<SendResult>;
  sendTemplate(to: string, name: string, language: string, params: string[]): Promise<SendResult>;
  sendDocument(to: string, doc: { buffer: Buffer; filename: string; mime: string; caption?: string }): Promise<SendResult>;
  /** Verifikasi tanda tangan X-Hub-Signature-256 dari Meta. */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  /** Verifikasi saat Meta mendaftarkan webhook (GET hub.challenge). */
  verifyToken(token: string | undefined): boolean;
  parseWebhook(body: unknown): WebhookEvent[];
  listTemplates(): Promise<RemoteTemplate[]>;
  /** null = profil tidak dikelola penyedia ini (mode simulasi). */
  getBusinessProfile(): Promise<WaBusinessProfile | null>;
  updateBusinessProfile(p: WaBusinessProfile): Promise<void>;
}
