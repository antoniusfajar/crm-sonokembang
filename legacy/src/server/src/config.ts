import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://skcrm:skcrm@localhost:5432/skcrm'),
  // 32-byte key, base64. Dipakai untuk mengenkripsi API key AI & token WhatsApp di database.
  APP_ENCRYPTION_KEY: z.string().optional(),
  // Nama cookie & masa berlaku sesi login.
  SESSION_DAYS: z.coerce.number().default(14),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  UPLOAD_DIR: z.string().default('./uploads'),
  WEB_DIST: z.string().default('../web/dist'),
  TZ_OFFSET_MINUTES: z.coerce.number().default(420), // WIB = UTC+7

  // WhatsApp: "simulator" sampai koneksi Meta siap, lalu ganti ke "meta".
  WA_MODE: z.enum(['simulator', 'meta']).default('simulator'),
  WA_PHONE_NUMBER_ID: z.string().optional(),
  WA_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WA_ACCESS_TOKEN: z.string().optional(),
  WA_VERIFY_TOKEN: z.string().optional(),
  WA_APP_SECRET: z.string().optional(),
  WA_GRAPH_VERSION: z.string().default('v23.0'),

  // Email (SMTP) untuk ringkasan harian & eskalasi. Hostinger: smtp.hostinger.com, port 465.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Akun Admin pertama (hanya dipakai bila belum ada pengguna sama sekali).
  ADMIN_NAME: z.string().default('Admin'),
  ADMIN_EMAIL: z.string().default('admin@sonokembang.local'),
  ADMIN_PASSWORD: z.string().optional(),

  WORKER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
});

export type AppConfig = z.infer<typeof Env>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, unknown>> = {}): AppConfig {
  const cfg = Env.parse({ ...process.env, ...overrides });
  if (cfg.NODE_ENV === 'production' && !cfg.APP_ENCRYPTION_KEY) {
    throw new Error('APP_ENCRYPTION_KEY wajib diisi di production (openssl rand -base64 32)');
  }
  if (cfg.WA_MODE === 'meta') {
    for (const k of ['WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN', 'WA_VERIFY_TOKEN', 'WA_APP_SECRET'] as const) {
      if (!cfg[k]) throw new Error(`${k} wajib diisi saat WA_MODE=meta`);
    }
  }
  return cfg;
}
