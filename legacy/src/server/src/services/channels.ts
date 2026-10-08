import webpush from 'web-push';
import nodemailer from 'nodemailer';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { activities, aiCalls, contacts, leads, leadStageHistory, notifications, pushSubscriptions, stages, tasks, users } from '../db/schema.js';
import { getSetting, setSetting } from './settings.js';
import { addDays, wibAt, wibDateString, toWib } from '../lib/time.js';

export interface NotifChannels {
  push: { on: boolean };
  email: { digestOn: boolean; digestTime: string; digestTo: 'admin' | 'admin_spv'; escalationOn: boolean; minSlaLevel: number };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface Mailer {
  send(to: string[], subject: string, text: string, html?: string, attachments?: MailAttachment[]): Promise<void>;
}
export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;

// ---------- Email (SMTP) ----------

let smtpMailer: Mailer | null | undefined;

export function smtpConfigured(ctx: Ctx) {
  const c = ctx.config;
  return !!(c.SMTP_HOST && c.SMTP_USER && c.SMTP_PASS);
}

export function mailer(ctx: Ctx): Mailer | null {
  if (ctx.mail) return ctx.mail;
  if (smtpMailer !== undefined) return smtpMailer;
  if (!smtpConfigured(ctx)) return (smtpMailer = null);
  const c = ctx.config;
  const transport = nodemailer.createTransport({
    host: c.SMTP_HOST,
    port: c.SMTP_PORT,
    secure: c.SMTP_PORT === 465,
    auth: { user: c.SMTP_USER, pass: c.SMTP_PASS },
  });
  smtpMailer = {
    async send(to, subject, text, html, attachments) {
      await transport.sendMail({ from: c.SMTP_FROM || c.SMTP_USER, to: to.join(', '), subject, text, html, attachments });
    },
  };
  return smtpMailer;
}

// ---------- Web push ----------

async function vapid(ctx: Ctx): Promise<{ publicKey: string; privateKey: string }> {
  const v = await getSetting<{ publicKey?: string; privateEnc?: string } | undefined>(ctx.db, 'vapid');
  if (v?.publicKey && v.privateEnc) return { publicKey: v.publicKey, privateKey: ctx.box.decrypt(v.privateEnc) };
  // Kunci VAPID dibuat sekali, kunci privat disimpan terenkripsi.
  const k = webpush.generateVAPIDKeys();
  await setSetting(ctx.db, 'vapid', { publicKey: k.publicKey, privateEnc: ctx.box.encrypt(k.privateKey) });
  return k;
}

export async function vapidPublicKey(ctx: Ctx) {
  return (await vapid(ctx)).publicKey;
}

async function defaultPushSender(ctx: Ctx): Promise<PushSender> {
  const v = await vapid(ctx);
  const subject = ctx.config.SMTP_FROM?.includes('@') ? `mailto:${ctx.config.SMTP_FROM.replace(/.*<|>.*/g, '')}` : ctx.config.PUBLIC_URL;
  return async (sub, payload) => {
    await webpush.sendNotification(sub, payload, { vapidDetails: { subject, publicKey: v.publicKey, privateKey: v.privateKey }, TTL: 6 * 3600 });
  };
}

export async function sendPush(ctx: Ctx, userIds: string[], p: PushPayload): Promise<number> {
  if (!userIds.length) return 0;
  const subs = await ctx.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  if (!subs.length) return 0;
  const send = ctx.pushSend ?? (await defaultPushSender(ctx));
  const url = p.url ? new URL(p.url, ctx.config.PUBLIC_URL).toString() : ctx.config.PUBLIC_URL;
  const payload = JSON.stringify({ ...p, url });
  let ok = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: s.keys }, payload);
        ok++;
        await ctx.db.update(pushSubscriptions).set({ lastOkAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
      } catch (e: any) {
        // 404/410 = langganan sudah tidak berlaku (aplikasi dihapus / izin dicabut)
        if (e?.statusCode === 404 || e?.statusCode === 410) await ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      }
    }),
  );
  return ok;
}

const KIND_TITLE: Record<string, string> = { sla: '⏱ SLA', lead: 'Lead baru', ai: '🤖 Serah terima AI', tugas: 'Tugas', sistem: 'Sistem' };

const pending = new Set<Promise<unknown>>();
/** Untuk test: tunggu semua pengiriman kanal selesai. */
export async function flushChannels() {
  await Promise.allSettled([...pending]);
}

/** Dipanggil setiap ada notifikasi di aplikasi: teruskan ke HP (web push) tanpa menahan proses utama. */
export function dispatchPush(ctx: Ctx, userIds: string[], kind: string, text: string, link?: string | null) {
  const job = (async () => {
    const ch = await getSetting<NotifChannels>(ctx.db, 'notif_channels');
    if (!ch.push.on) return;
    await sendPush(ctx, userIds, { title: KIND_TITLE[kind] ?? 'Sonokembang CRM', body: text, url: link ?? '/', tag: link ?? undefined });
  })().catch((e) => console.error('push gagal', e));
  pending.add(job);
  void job.finally(() => pending.delete(job));
}

// ---------- Eskalasi SLA lewat email ----------

export async function escalateExternally(
  ctx: Ctx,
  recipientIds: string[],
  e: { level: number; label: string; minutes: number; ownerName: string | null; link: string },
) {
  const ch = await getSetting<NotifChannels>(ctx.db, 'notif_channels');
  const rcpt = recipientIds.length ? await ctx.db.select().from(users).where(and(inArray(users.id, recipientIds), eq(users.status, 'aktif'))) : [];
  const result = { email: 0 };
  const url = new URL(e.link, ctx.config.PUBLIC_URL).toString();
  const text = `${e.label} belum dibalas ${e.minutes} menit (SLA level ${e.level}). PIC: ${e.ownerName ?? 'belum ada'}.`;

  const m = mailer(ctx);
  if (ch.email.escalationOn && e.level >= ch.email.minSlaLevel && m) {
    const to = rcpt.map((u) => u.email);
    if (to.length) {
      try {
        await m.send(to, `[CRM] Eskalasi SLA level ${e.level}: ${e.label}`, `${text}\n\nBuka chat: ${url}`);
        result.email = to.length;
      } catch (err) {
        console.error('email eskalasi gagal', err);
      }
    }
  }

  return result;
}

// ---------- Ringkasan harian (email) ----------

export async function buildDigest(ctx: Ctx, now = new Date()) {
  const day = wibDateString(now);
  const start = wibAt(day, '00:00');
  const end = addDays(start, 1);
  const db = ctx.db;
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const newLeads = await n(db.select({ n: sql<number>`count(*)` }).from(leads).where(and(gte(leads.createdAt, start), lt(leads.createdAt, end))));
  const handoffs = await n(db.select({ n: sql<number>`count(*)` }).from(activities).where(and(eq(activities.type, 'handoff'), gte(activities.at, start), lt(activities.at, end))));
  const slaAlerts = await n(db.select({ n: sql<number>`count(distinct ${notifications.text})` }).from(notifications).where(and(eq(notifications.kind, 'sla'), gte(notifications.createdAt, start), lt(notifications.createdAt, end))));
  const closings = await db
    .select({ name: contacts.name, phone: contacts.waPhone, dp: leads.dpAmount, owner: users.name })
    .from(leadStageHistory)
    .innerJoin(stages, eq(stages.id, leadStageHistory.stageId))
    .innerJoin(leads, eq(leads.id, leadStageHistory.leadId))
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(and(eq(stages.kind, 'won'), gte(leadStageHistory.at, start), lt(leadStageHistory.at, end)));
  const overdue = await db
    .select({ name: users.name, n: sql<number>`count(*)` })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.userId))
    .where(and(isNull(tasks.doneAt), lt(tasks.dueAt, now)))
    .groupBy(users.name);
  const monthStart = new Date(day.slice(0, 7) + '-01T00:00:00+07:00');
  const aiSpend = await n(db.select({ n: sql<number>`coalesce(sum(${aiCalls.costIdr}),0)::int` }).from(aiCalls).where(gte(aiCalls.at, monthStart)));
  const lostToday = await n(
    db
      .select({ n: sql<number>`count(*)` })
      .from(leadStageHistory)
      .innerJoin(stages, eq(stages.id, leadStageHistory.stageId))
      .where(and(eq(stages.kind, 'lost'), gte(leadStageHistory.at, start), lt(leadStageHistory.at, end))),
  );
  const rp = (x: number) => 'Rp ' + x.toLocaleString('id-ID');
  const lines = [
    `Ringkasan CRM Sonokembang — ${day}`,
    '',
    `Lead baru          : ${newLeads}`,
    `Serah terima AI    : ${handoffs}`,
    `Peringatan SLA     : ${slaAlerts}`,
    `Closing (DP masuk) : ${closings.length}${closings.length ? ` · total DP ${rp(closings.reduce((a, c) => a + (c.dp ?? 0), 0))}` : ''}`,
    `Lost / Abandoned   : ${lostToday}`,
    `Biaya AI bulan ini : ${rp(aiSpend)}`,
    '',
    ...(closings.length ? ['Closing hari ini:', ...closings.map((c) => `- ${c.name ?? c.phone} · ${c.dp ? rp(c.dp) : '-'} · ${c.owner ?? '-'}`), ''] : []),
    ...(overdue.length ? ['Tugas terlambat per sales:', ...overdue.map((o) => `- ${o.name}: ${o.n}`), ''] : []),
    `Buka CRM: ${ctx.config.PUBLIC_URL}`,
  ];
  return { day, subject: `[CRM] Ringkasan harian ${day} · ${newLeads} lead baru, ${closings.length} closing`, text: lines.join('\n') };
}

async function digestRecipients(ctx: Ctx, to: NotifChannels['email']['digestTo']) {
  const roles = to === 'admin_spv' ? (['admin', 'spv'] as const) : (['admin'] as const);
  const rows = await ctx.db.select({ email: users.email }).from(users).where(and(inArray(users.role, [...roles]), eq(users.status, 'aktif')));
  return rows.map((r) => r.email);
}

/** Dipanggil worker tiap menit. Mengirim ringkasan sekali per hari pada jam yang diatur. */
export async function runDailyDigest(ctx: Ctx, now = new Date(), force = false): Promise<'sent' | 'skipped' | 'no_smtp'> {
  const ch = await getSetting<NotifChannels>(ctx.db, 'notif_channels');
  const state = await getSetting<{ lastDay?: string } | undefined>(ctx.db, 'digest_state');
  const today = wibDateString(now);
  if (!force) {
    if (!ch.email.digestOn || state?.lastDay === today) return 'skipped';
    const w = toWib(now);
    const [h, m] = ch.email.digestTime.split(':').map(Number);
    if (w.getUTCHours() * 60 + w.getUTCMinutes() < h! * 60 + m!) return 'skipped';
  }
  const mm = mailer(ctx);
  if (!mm) return 'no_smtp';
  const to = await digestRecipients(ctx, ch.email.digestTo);
  if (!to.length) return 'skipped';
  const d = await buildDigest(ctx, now);
  await mm.send(to, d.subject, d.text);
  if (!force) await setSetting(ctx.db, 'digest_state', { lastDay: today });
  return 'sent';
}

export async function sendTestEmail(ctx: Ctx, to: string) {
  const m = mailer(ctx);
  if (!m) throw new Error('SMTP belum diatur di .env (SMTP_HOST, SMTP_USER, SMTP_PASS)');
  await m.send([to], '[CRM] Tes email', `Email dari CRM Sonokembang berhasil terkirim.\n${ctx.config.PUBLIC_URL}`);
}
