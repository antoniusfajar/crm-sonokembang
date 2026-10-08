import type { AppConfig } from './config.js';
import type { DB } from './db/client.js';
import type { EventBus } from './lib/events.js';
import type { SecretBox } from './lib/crypto.js';
import type { WhatsAppProvider } from './whatsapp/provider.js';
import type { AiService } from './ai/service.js';
import type { Mailer, PushSender } from './services/channels.js';

export interface Ctx {
  config: AppConfig;
  db: DB;
  events: EventBus;
  box: SecretBox;
  wa: WhatsAppProvider;
  ai: AiService;
  /** Opsional — dipakai test untuk mengganti pengirim email / web push. */
  mail?: Mailer;
  pushSend?: PushSender;
}
