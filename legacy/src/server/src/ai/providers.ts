import Anthropic from '@anthropic-ai/sdk';

export type ProviderId = 'anthropic' | 'google' | 'openai';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  model: string;
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  /** Bila diisi, model wajib menjawab JSON sesuai skema ini. */
  jsonSchema?: Record<string, unknown>;
}

export interface AiResponse {
  text: string;
  json?: unknown;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface AiProviderAdapter {
  readonly id: ProviderId;
  complete(req: AiRequest): Promise<AiResponse>;
}

export class AiError extends Error {
  constructor(message: string, public retryable = false) {
    super(message);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new AiError('Jawaban AI bukan JSON yang valid');
  }
}

// ---------- Anthropic (Claude) — memakai SDK resmi ----------

export class AnthropicAdapter implements AiProviderAdapter {
  readonly id = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string, opts: { baseURL?: string; fetch?: typeof fetch } = {}) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000, baseURL: opts.baseURL, fetch: opts.fetch });
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    try {
      const res = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        // System prompt stabil di depan + cache, supaya biaya per chat lebih murah.
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: req.messages,
        ...(req.jsonSchema ? { output_config: { format: { type: 'json_schema', schema: req.jsonSchema } } } : {}),
      });
      if (res.stop_reason === 'refusal') throw new AiError('AI menolak permintaan ini');
      if (res.stop_reason === 'max_tokens') throw new AiError('Jawaban AI terpotong (max_tokens)');
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return {
        text,
        json: req.jsonSchema ? parseJson(text) : undefined,
        inputTokens: (res.usage.input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
        cachedInputTokens: res.usage.cache_read_input_tokens ?? 0,
        outputTokens: res.usage.output_tokens ?? 0,
      };
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new AiError('API key Anthropic tidak valid');
      if (e instanceof Anthropic.PermissionDeniedError) throw new AiError('API key Anthropic tidak punya izin untuk model ini');
      if (e instanceof Anthropic.NotFoundError) throw new AiError(`Model "${req.model}" tidak ditemukan`);
      if (e instanceof Anthropic.RateLimitError) throw new AiError('Batas pemakaian Anthropic tercapai, coba lagi sebentar', true);
      if (e instanceof Anthropic.BadRequestError) throw new AiError(`Permintaan ke Anthropic ditolak: ${e.message}`);
      if (e instanceof Anthropic.APIError) throw new AiError(`Anthropic error ${e.status ?? ''}: ${e.message}`, true);
      throw new AiError(`Gagal menghubungi Anthropic: ${(e as Error).message}`, true);
    }
  }
}

// ---------- Google Gemini (REST) ----------

export class GeminiAdapter implements AiProviderAdapter {
  readonly id = 'google' as const;
  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch) {}

  async complete(req: AiRequest): Promise<AiResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: {
          maxOutputTokens: req.maxTokens,
          ...(req.jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema } : {}),
        },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new AiError(`Gemini error ${res.status}: ${json?.error?.message ?? 'gagal'}`, res.status === 429 || res.status >= 500);
    const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    return {
      text,
      json: req.jsonSchema ? parseJson(text) : undefined,
      inputTokens: json?.usageMetadata?.promptTokenCount ?? 0,
      cachedInputTokens: json?.usageMetadata?.cachedContentTokenCount ?? 0,
      outputTokens: json?.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}

// ---------- OpenAI (REST) ----------

export class OpenAiAdapter implements AiProviderAdapter {
  readonly id = 'openai' as const;
  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch) {}

  async complete(req: AiRequest): Promise<AiResponse> {
    const res = await this.fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        max_completion_tokens: req.maxTokens,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        ...(req.jsonSchema
          ? { response_format: { type: 'json_schema', json_schema: { name: 'output', schema: req.jsonSchema, strict: true } } }
          : {}),
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new AiError(`OpenAI error ${res.status}: ${json?.error?.message ?? 'gagal'}`, res.status === 429 || res.status >= 500);
    const text = json?.choices?.[0]?.message?.content ?? '';
    return {
      text,
      json: req.jsonSchema ? parseJson(text) : undefined,
      inputTokens: json?.usage?.prompt_tokens ?? 0,
      cachedInputTokens: json?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: json?.usage?.completion_tokens ?? 0,
    };
  }
}

export function createAdapter(provider: ProviderId, apiKey: string): AiProviderAdapter {
  if (provider === 'anthropic') return new AnthropicAdapter(apiKey);
  if (provider === 'google') return new GeminiAdapter(apiKey);
  return new OpenAiAdapter(apiKey);
}

// Harga per 1 juta token (USD) — dari dokumen Fase 2 §5, per 6 Okt 2026. Cek ulang sebelum anggaran final.
// Model lain bisa ditambah lewat Pengaturan › Model AI & API key (field "pricing").
export const DEFAULT_PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5, cachedInput: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cachedInput: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cachedInput: 0.2 },
};

export const MODEL_SUGGESTIONS: Record<ProviderId, { chat: string[]; smart: string[] }> = {
  anthropic: { chat: ['claude-haiku-4-5'], smart: ['claude-sonnet-5-5', 'claude-sonnet-5'] },
  google: { chat: [], smart: [] }, // isi ID model Gemini sesuai halaman resmi Google
  openai: { chat: [], smart: [] },
};
