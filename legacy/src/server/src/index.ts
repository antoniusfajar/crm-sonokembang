import fs from 'node:fs';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { EventBus } from './lib/events.js';
import { SecretBox } from './lib/crypto.js';
import { createWhatsAppProvider } from './whatsapp/index.js';
import { AiService } from './ai/service.js';
import { buildApp } from './app.js';
import { startWorker } from './worker.js';
import { ensureBaseData } from './db/seed.js';
import type { Ctx } from './context.js';

async function main() {
  const config = loadConfig();
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  await runMigrations(config.DATABASE_URL);
  const { db, pool } = createDb(config.DATABASE_URL);
  const box = new SecretBox(config.APP_ENCRYPTION_KEY);
  const ctx: Ctx = { config, db, events: new EventBus(), box, wa: createWhatsAppProvider(config), ai: new AiService(db, box) };
  await ensureBaseData(ctx);

  const app = await buildApp(ctx, { logger: true });
  const stopWorker = config.WORKER_ENABLED ? startWorker(ctx, app.log) : () => {};
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`CRM Sonokembang jalan di ${config.PUBLIC_URL} · WhatsApp mode: ${ctx.wa.mode}`);

  const shutdown = async () => {
    stopWorker();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
