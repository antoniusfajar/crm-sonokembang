import type { AppConfig } from '../config.js';
import { MetaCloudProvider } from './meta.js';
import { SimulatorProvider } from './simulator.js';
import type { WhatsAppProvider } from './provider.js';

export function createWhatsAppProvider(cfg: AppConfig): WhatsAppProvider {
  if (cfg.WA_MODE === 'meta') {
    return new MetaCloudProvider({
      phoneNumberId: cfg.WA_PHONE_NUMBER_ID!,
      businessAccountId: cfg.WA_BUSINESS_ACCOUNT_ID,
      accessToken: cfg.WA_ACCESS_TOKEN!,
      verifyToken: cfg.WA_VERIFY_TOKEN!,
      appSecret: cfg.WA_APP_SECRET!,
      graphVersion: cfg.WA_GRAPH_VERSION,
    });
  }
  return new SimulatorProvider();
}
