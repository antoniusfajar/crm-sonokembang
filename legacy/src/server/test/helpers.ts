import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { EventBus } from '../src/lib/events.js';
import { SecretBox } from '../src/lib/crypto.js';
import { SimulatorProvider } from '../src/whatsapp/simulator.js';
import { AiService } from '../src/ai/service.js';
import type { AiProviderAdapter, AiRequest, AiResponse } from '../src/ai/providers.js';
import { ensureBaseData } from '../src/db/seed.js';
import { buildApp } from '../src/app.js';
import type { Ctx } from '../src/context.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://skcrm:skcrm@localhost:5432/skcrm_test';

export class FakeAdapter implements AiProviderAdapter {
  readonly id = 'anthropic' as const;
  calls: AiRequest[] = [];
  next: (req: AiRequest) => unknown = () => ({ reply: 'Baik kak', extracted: {}, wants_handoff: false, handoff_reason: null });
  async complete(req: AiRequest): Promise<AiResponse> {
    this.calls.push(req);
    const json = this.next(req);
    return { text: JSON.stringify(json), json, inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0 };
  }
}

export async function setup() {
  const admin = new pg.Client({ connectionString: TEST_DB });
  await admin.connect();
  await admin.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await admin.end();
  await runMigrations(TEST_DB);
  const config = loadConfig({ DATABASE_URL: TEST_DB, NODE_ENV: 'test', UPLOAD_DIR: '/tmp/skcrm-test-uploads', ADMIN_PASSWORD: 'adminpass123', ADMIN_EMAIL: 'admin@test.local', WEB_DIST: '/nonexistent' });
  const { db, pool } = createDb(TEST_DB);
  const box = new SecretBox(undefined);
  const fake = new FakeAdapter();
  const wa = new SimulatorProvider();
  const ctx: Ctx = { config, db, events: new EventBus(), box, wa, ai: new AiService(db, box, () => fake) };
  await ensureBaseData(ctx, () => {});
  const app = await buildApp(ctx);
  return { ctx, app, fake, wa, pool };
}

export async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login gagal: ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'skcrm_session')!;
  return { cookie: `skcrm_session=${c.value}` };
}
