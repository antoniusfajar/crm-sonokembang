import { and, gte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { aiCalls, notifications, users } from '../db/schema.js';
import type { SecretBox } from '../lib/crypto.js';
import { getSetting } from '../services/settings.js';
import { wibDateString } from '../lib/time.js';
import { eq } from 'drizzle-orm';
import { AiError, createAdapter, DEFAULT_PRICING, type AiProviderAdapter, type AiRequest, type AiResponse, type ProviderId } from './providers.js';

export interface AiSettings {
  enabled: boolean;
  provider: ProviderId;
  fallbackProvider: ProviderId | null;
  models: { chat: string; smart: string };
  fallbackModels?: { chat: string; smart: string };
  monthlyBudgetIdr: number;
  maskPii: boolean;
  logRetentionDays: number;
  usdToIdr: number;
  layer2?: boolean;
  pricing?: Record<string, { input: number; output: number; cachedInput?: number }>;
}

export type AiKeys = Partial<Record<ProviderId, { enc: string; last4: string; updatedAt: string; updatedBy: string | null }>>;

export class BudgetExceededError extends AiError {
  constructor() {
    super('Batas biaya AI bulan ini sudah habis — chat langsung diteruskan ke sales');
  }
}
export class AiDisabledError extends AiError {}

export type AdapterFactory = (provider: ProviderId, apiKey: string) => AiProviderAdapter;

export class AiService {
  constructor(private db: DB, private box: SecretBox, private factory: AdapterFactory = createAdapter) {}

  async settings(): Promise<AiSettings> {
    return getSetting<AiSettings>(this.db, 'ai');
  }

  async keys(): Promise<AiKeys> {
    return getSetting<AiKeys>(this.db, 'ai_keys');
  }

  costIdr(s: AiSettings, model: string, r: Pick<AiResponse, 'inputTokens' | 'outputTokens' | 'cachedInputTokens'>): number {
    const p = s.pricing?.[model] ?? DEFAULT_PRICING[model];
    if (!p) return 0;
    const usd = (r.inputTokens * p.input + r.cachedInputTokens * (p.cachedInput ?? p.input * 0.1) + r.outputTokens * p.output) / 1_000_000;
    return Math.ceil(usd * s.usdToIdr);
  }

  async monthSpendIdr(now = new Date()): Promise<number> {
    const monthStart = new Date(wibDateString(now).slice(0, 7) + '-01T00:00:00+07:00');
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${aiCalls.costIdr}), 0)::int` })
      .from(aiCalls)
      .where(gte(aiCalls.at, monthStart));
    return row?.total ?? 0;
  }

  private adapterFor(provider: ProviderId, keys: AiKeys): AiProviderAdapter | null {
    const k = keys[provider];
    if (!k) return null;
    return this.factory(provider, this.box.decrypt(k.enc));
  }

  /** Uji koneksi dengan key yang baru ditempel (belum disimpan). */
  async testKey(provider: ProviderId, apiKey: string, model: string): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.factory(provider, apiKey).complete({
        model,
        system: 'Balas hanya dengan kata: OK',
        messages: [{ role: 'user', content: 'Tes koneksi' }],
        maxTokens: 16,
      });
      return { ok: true, message: `Terhubung · ${model} · ${r.inputTokens + r.outputTokens} token` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /**
   * Satu pintu untuk semua panggilan AI. Mengecek saklar & batas biaya, memakai penyedia cadangan
   * bila penyedia utama gagal, lalu mencatat token & biaya.
   */
  async complete(
    task: string,
    tier: 'chat' | 'smart',
    req: Omit<AiRequest, 'model'>,
    opts: { conversationId?: string | null } = {},
  ): Promise<AiResponse & { provider: ProviderId; model: string }> {
    const s = await this.settings();
    if (!s.enabled) throw new AiDisabledError('AI sedang dimatikan di Pengaturan');
    const spend = await this.monthSpendIdr();
    if (s.monthlyBudgetIdr > 0 && spend >= s.monthlyBudgetIdr) throw new BudgetExceededError();

    const keys = await this.keys();
    const attempts: { provider: ProviderId; model: string }[] = [{ provider: s.provider, model: s.models[tier] }];
    if (s.fallbackProvider && s.fallbackProvider !== s.provider && s.fallbackModels?.[tier]) {
      attempts.push({ provider: s.fallbackProvider, model: s.fallbackModels[tier] });
    }

    let lastErr: Error = new AiDisabledError('API key AI belum dipasang — Pengaturan › Model AI & API key');
    for (const a of attempts) {
      const adapter = this.adapterFor(a.provider, keys);
      if (!adapter) continue;
      try {
        const r = await adapter.complete({ ...req, model: a.model });
        const cost = this.costIdr(s, a.model, r);
        await this.db.insert(aiCalls).values({
          task,
          provider: a.provider,
          model: a.model,
          inputTokens: r.inputTokens + r.cachedInputTokens,
          outputTokens: r.outputTokens,
          costIdr: cost,
          ok: true,
          conversationId: opts.conversationId ?? null,
        });
        await this.checkBudgetWarning(s, spend, spend + cost);
        return { ...r, provider: a.provider, model: a.model };
      } catch (e) {
        lastErr = e as Error;
        await this.db.insert(aiCalls).values({
          task,
          provider: a.provider,
          model: a.model,
          ok: false,
          error: lastErr.message.slice(0, 500),
          conversationId: opts.conversationId ?? null,
        });
      }
    }
    throw lastErr;
  }

  /** Notifikasi Admin saat pemakaian melewati 80% dan 100% pagu bulanan (sekali per ambang). */
  private async checkBudgetWarning(s: AiSettings, before: number, after: number) {
    if (s.monthlyBudgetIdr <= 0) return;
    for (const pct of [80, 100]) {
      const limit = (s.monthlyBudgetIdr * pct) / 100;
      if (before < limit && after >= limit) {
        const admins = await this.db.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'aktif')));
        const text =
          pct === 100
            ? 'Biaya AI bulan ini mencapai 100% pagu. AI berhenti membalas, semua chat langsung ke sales.'
            : `Biaya AI bulan ini sudah ${pct}% dari pagu Rp ${s.monthlyBudgetIdr.toLocaleString('id-ID')}.`;
        if (admins.length) {
          await this.db.insert(notifications).values(admins.map((a) => ({ userId: a.id, kind: 'ai' as const, text, link: '/ai' })));
        }
      }
    }
  }
}
