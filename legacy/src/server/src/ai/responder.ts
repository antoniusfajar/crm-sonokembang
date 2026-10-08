import { desc, eq } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, conversations, guardrailLogs, messages, promptVersions } from '../db/schema.js';
import { maskPii } from '../lib/phone.js';
import { wibDateString } from '../lib/time.js';
import { applyQualification, openLeadForContact } from '../services/leads.js';
import { handoff, sendOutbound } from '../services/messaging.js';
import { reassignBySpecialRule } from '../services/distribution.js';
import { getSetting } from '../services/settings.js';
import { checkReplyLayer1, customerNeedsSales, matchFaq, type GuardrailConfig } from './guardrails.js';
import type { AiSettings } from './service.js';

export const DEFAULT_PROMPT =
  'Kamu adalah asisten pertama Sonokembang Catering Malang di WhatsApp. Sapa customer dengan hangat dan formal, bahasa Indonesia. ' +
  'Tugasmu: kirim brosur, lalu kumpulkan jenis acara, tanggal, lokasi, jumlah pax, dan perkiraan budget. ' +
  'Setelah data terkumpul atau customer minta harga/ketersediaan, serahkan ke sales dan berhenti membalas.';

interface Guardrails extends GuardrailConfig {
  allow: string[];
  deny: string[];
  handoffWhenFieldsFilled: number;
  handoffWhenScoreAtLeast: number;
  holdMessage: string;
  layer2: boolean;
}

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });

export const RESPONDER_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Balasan WhatsApp untuk customer' },
    extracted: {
      type: 'object',
      properties: {
        customer_name: nullable('string'),
        event_type: nullable('string'),
        event_date: { ...nullable('string'), description: 'YYYY-MM-DD bila tanggal pasti' },
        event_date_text: nullable('string'),
        location: nullable('string'),
        pax: nullable('integer'),
        budget_idr: nullable('integer'),
      },
      required: ['customer_name', 'event_type', 'event_date', 'event_date_text', 'location', 'pax', 'budget_idr'],
      additionalProperties: false,
    },
    wants_handoff: { type: 'boolean' },
    handoff_reason: nullable('string'),
  },
  required: ['reply', 'extracted', 'wants_handoff', 'handoff_reason'],
  additionalProperties: false,
} as const;

interface ResponderOutput {
  reply: string;
  extracted: {
    customer_name: string | null;
    event_type: string | null;
    event_date: string | null;
    event_date_text: string | null;
    location: string | null;
    pax: number | null;
    budget_idr: number | null;
  };
  wants_handoff: boolean;
  handoff_reason: string | null;
}

const LAYER2_SCHEMA = {
  type: 'object',
  properties: { violation: { type: 'boolean' }, reason: nullable('string') },
  required: ['violation', 'reason'],
  additionalProperties: false,
} as const;

export function buildSystemPrompt(prompt: string, g: Guardrails, businessName: string): string {
  return [
    prompt.trim(),
    '',
    `Nama usaha: ${businessName}.`,
    'BOLEH: ' + g.allow.join('; ') + '.',
    'TIDAK BOLEH: ' + g.deny.join('; ') + '. Jangan menulis angka harga atau nominal rupiah apa pun.',
    'Kalau customer menanyakan harga, diskon, atau ketersediaan tanggal, set wants_handoff=true dan balas singkat bahwa tim sales akan membantu.',
    'Balasan singkat (maks. 3 kalimat), ramah, tanpa markdown. Jangan mengarang informasi yang tidak ada.',
    '',
    'Selalu jawab dalam JSON sesuai skema: reply = teks balasan; extracted = data acara yang disebut customer di seluruh percakapan',
    '(null bila belum disebut; event_date format YYYY-MM-DD hanya bila tanggal pasti, selain itu isi event_date_text; pax & budget_idr berupa angka bulat).',
  ].join('\n');
}

/** Validasi hasil ekstraksi AI dengan script sebelum masuk ke field lead (Fase 2 §2 no. 2). */
export function validateExtraction(x: ResponderOutput['extracted'], today = new Date()) {
  const out: { eventType?: string; eventDate?: string; eventDateText?: string; location?: string; pax?: number; budget?: number; name?: string } = {};
  const str = (v: string | null, max = 120) => (v && v.trim() ? v.trim().slice(0, max) : undefined);
  out.eventType = str(x.event_type, 80);
  out.location = str(x.location);
  out.eventDateText = str(x.event_date_text, 60);
  out.name = str(x.customer_name, 80);
  if (x.event_date && /^\d{4}-\d{2}-\d{2}$/.test(x.event_date)) {
    const d = new Date(x.event_date + 'T00:00:00Z');
    const min = new Date(wibDateString(today) + 'T00:00:00Z').getTime() - 86_400_000;
    if (!isNaN(d.getTime()) && d.getTime() >= min && d.getTime() < min + 3 * 365 * 86_400_000) out.eventDate = x.event_date;
  }
  if (Number.isInteger(x.pax) && x.pax! > 0 && x.pax! <= 100_000) out.pax = x.pax!;
  if (Number.isInteger(x.budget_idr) && x.budget_idr! >= 100_000 && x.budget_idr! <= 10_000_000_000) out.budget = x.budget_idr!;
  return out;
}

async function logGuard(ctx: Ctx, conversationId: string, layer: number, reason: string, text: string) {
  await ctx.db.insert(guardrailLogs).values({ conversationId, layer, reason, text: text.slice(0, 2000) });
}

/** Job "ai_reply": membalas pesan customer terakhir bila percakapan masih dipegang AI. */
export async function runResponder(ctx: Ctx, conversationId: string): Promise<'skipped' | 'replied' | 'handoff' | 'faq'> {
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv || !conv.aiActive) return 'skipped';

  const history = (
    await ctx.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.createdAt)).limit(30)
  ).reverse();
  const last = [...history].reverse().find((m) => m.direction !== 'system');
  if (!last || last.direction !== 'in') return 'skipped'; // sudah dibalas

  // Gabungkan pesan customer sejak balasan terakhir kita.
  const pending: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.direction === 'out') break;
    if (m.direction === 'in') pending.unshift(m.body);
  }
  const customerText = pending.join('\n');

  const g = await getSetting<Guardrails>(ctx.db, 'guardrails');
  const sendAi = (body: string) => sendOutbound(ctx, { conversationId, sender: { type: 'ai' }, kind: 'text', body });

  // 1) Script: topik harga/diskon/tanggal → tahan & serahkan ke sales.
  const trigger = customerNeedsSales(customerText, g);
  if (trigger) {
    await logGuard(ctx, conversationId, 1, `Serah terima: ${trigger}`, customerText);
    await sendAi(g.holdMessage).catch(() => undefined);
    await handoff(ctx, conversationId, trigger);
    return 'handoff';
  }

  // 2) Script: FAQ yang cocok dijawab tanpa AI.
  const faq = matchFaq(customerText, await getSetting(ctx.db, 'faq'));
  if (faq) {
    await sendAi(faq);
    return 'faq';
  }

  // 3) AI
  const ai = await getSetting<AiSettings>(ctx.db, 'ai');
  const [prompt] = await ctx.db.select().from(promptVersions).where(eq(promptVersions.active, true)).orderBy(desc(promptVersions.version)).limit(1);
  const biz = await getSetting<{ name: string }>(ctx.db, 'business_profile');
  const [contact] = await ctx.db.select().from(contacts).where(eq(contacts.id, conv.contactId));
  const lead = await openLeadForContact(ctx, conv.contactId);

  const clean = (s: string) => (ai.maskPii ? maskPii(s) : s);
  const transcript = history
    .filter((m) => m.direction !== 'system')
    .map((m) => `${m.direction === 'in' ? 'Customer' : m.senderType === 'ai' ? 'Sonokembang (AI)' : 'Sonokembang (sales)'}: ${clean(m.body)}`)
    .join('\n');
  const known = lead
    ? JSON.stringify({ jenis_acara: lead.eventType, tanggal: lead.eventDate ?? lead.eventDateText, lokasi: lead.location, pax: lead.pax, budget: lead.budget })
    : '{}';
  const userContent = [
    `Hari ini (WIB): ${wibDateString(new Date())}.`,
    `Data yang sudah tercatat: ${known}`,
    '',
    'Riwayat percakapan (paling lama di atas):',
    transcript,
    '',
    'Tulis balasan untuk pesan customer terakhir.',
  ].join('\n');

  let out: ResponderOutput;
  try {
    const r = await ctx.ai.complete(
      'responder',
      'chat',
      { system: buildSystemPrompt(prompt?.content ?? DEFAULT_PROMPT, g, biz.name), messages: [{ role: 'user', content: userContent }], maxTokens: 1024, jsonSchema: RESPONDER_SCHEMA as any },
      { conversationId },
    );
    out = r.json as ResponderOutput;
    if (!out || typeof out.reply !== 'string') throw new Error('Format jawaban AI tidak sesuai');
  } catch (e) {
    await handoff(ctx, conversationId, `AI tidak bisa membalas: ${(e as Error).message}`);
    return 'handoff';
  }

  // Isi data lead dari chat (sudah divalidasi script).
  let score = { score: 0, filledCount: 0 };
  if (lead && out.extracted) {
    const v = validateExtraction(out.extracted);
    // Nama yang disebut di chat = nama pemesan lead; nama kontak tetap nama profil WhatsApp.
    score = await applyQualification(ctx, lead.id, { customerName: v.name, eventType: v.eventType, eventDate: v.eventDate, eventDateText: v.eventDateText, location: v.location, pax: v.pax, budget: v.budget }, 'ai');
    if (v.eventType) await reassignBySpecialRule(ctx, conversationId, v.eventType);
  }

  const reply = out.reply.trim();
  // Lapis 1 (script)
  const l1 = checkReplyLayer1(reply, g);
  if (!l1.ok) {
    await logGuard(ctx, conversationId, 1, l1.reason!, reply);
    await sendAi(g.holdMessage).catch(() => undefined);
    await handoff(ctx, conversationId, `Balasan AI ditahan: ${l1.reason}`);
    return 'handoff';
  }
  // Lapis 2 (AI) — memeriksa kalimat yang lolos lapis 1
  if (g.layer2 !== false) {
    try {
      const r2 = await ctx.ai.complete(
        'guard',
        'chat',
        {
          system:
            'Kamu pemeriksa balasan customer service katering. Tandai violation=true bila balasan menyebut harga, memberi diskon/promo, ' +
            'menjanjikan tanggal tersedia, atau membuat komitmen atas nama perusahaan. Selain itu violation=false.',
          messages: [{ role: 'user', content: `Balasan yang akan dikirim:\n"""${reply}"""` }],
          maxTokens: 200,
          jsonSchema: LAYER2_SCHEMA as any,
        },
        { conversationId },
      );
      const v = r2.json as { violation: boolean; reason: string | null };
      if (v?.violation) {
        const reason = `Lapis 2: ${v.reason ?? 'melanggar aturan'}`;
        await logGuard(ctx, conversationId, 2, reason, reply);
        await sendAi(g.holdMessage).catch(() => undefined);
        await handoff(ctx, conversationId, `Balasan AI ditahan: ${reason}`);
        return 'handoff';
      }
    } catch {
      // Lapis 2 gagal (mis. kuota) → lapis 1 sudah lolos, balasan tetap dikirim.
    }
  }

  await sendAi(reply);

  if (out.wants_handoff) {
    await handoff(ctx, conversationId, out.handoff_reason ?? 'AI meminta sales melanjutkan');
    return 'handoff';
  }
  if (score.filledCount >= g.handoffWhenFieldsFilled) {
    await handoff(ctx, conversationId, `${score.filledCount} dari 5 data kualifikasi terisi`);
    return 'handoff';
  }
  if (score.score >= g.handoffWhenScoreAtLeast) {
    await handoff(ctx, conversationId, `Skor lead ${score.score} (Hot)`);
    return 'handoff';
  }
  return 'replied';
}

/** Uji prompt di sandbox (Pengaturan › Prompt & pagar AI) — tidak mengirim apa pun ke WhatsApp. */
export async function sandboxReply(ctx: Ctx, promptText: string, chat: { from: 'customer' | 'ai'; text: string }[]) {
  const g = await getSetting<Guardrails>(ctx.db, 'guardrails');
  const biz = await getSetting<{ name: string }>(ctx.db, 'business_profile');
  const last = [...chat].reverse().find((c) => c.from === 'customer')?.text ?? '';
  const trigger = customerNeedsSales(last, g);
  if (trigger) return { reply: g.holdMessage, handoff: trigger, extracted: null, guard: null };
  const r = await ctx.ai.complete('sandbox', 'chat', {
    system: buildSystemPrompt(promptText, g, biz.name),
    messages: [
      {
        role: 'user',
        content: [
          `Hari ini (WIB): ${wibDateString(new Date())}.`,
          'Riwayat percakapan:',
          ...chat.map((c) => `${c.from === 'customer' ? 'Customer' : 'Sonokembang (AI)'}: ${c.text}`),
          '',
          'Tulis balasan untuk pesan customer terakhir.',
        ].join('\n'),
      },
    ],
    maxTokens: 1024,
    jsonSchema: RESPONDER_SCHEMA as any,
  });
  const out = r.json as ResponderOutput;
  const l1 = checkReplyLayer1(out.reply, g);
  return { reply: out.reply, handoff: out.wants_handoff ? out.handoff_reason ?? 'AI meminta sales melanjutkan' : null, extracted: out.extracted, guard: l1.ok ? null : l1.reason };
}

