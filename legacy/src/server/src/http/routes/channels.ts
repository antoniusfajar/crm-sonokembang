import type { FastifyInstance } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { pushSubscriptions } from '../../db/schema.js';
import { badRequest } from '../../lib/http.js';
import { requireMenu, requireRole, requireUser } from '../auth.js';
import { audit } from '../../services/audit.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { buildDigest, runDailyDigest, sendPush, sendTestEmail, smtpConfigured, vapidPublicKey, type NotifChannels } from '../../services/channels.js';

export function channelRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  // ---------- Web push (per perangkat) ----------
  app.get('/api/push/key', async (req) => {
    requireUser(req);
    return { publicKey: await vapidPublicKey(ctx) };
  });

  const Sub = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(4) }) });

  app.post('/api/push/subscribe', async (req) => {
    const me = requireUser(req);
    const body = Sub.parse(req.body);
    await db
      .insert(pushSubscriptions)
      .values({ userId: me.id, endpoint: body.endpoint, keys: body.keys, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: me.id, keys: body.keys } });
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    const me = requireUser(req);
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, me.id)));
    return { ok: true };
  });

  app.post('/api/push/test', async (req) => {
    const me = requireUser(req);
    const sent = await sendPush(ctx, [me.id], { title: 'Sonokembang CRM', body: 'Notifikasi di perangkat ini sudah aktif ✅', url: '/notif' });
    if (!sent) throw badRequest('Belum ada perangkat yang terdaftar untuk akun ini, atau pengiriman gagal');
    return { sent };
  });

  // ---------- Pengaturan kanal ----------
  app.get('/api/notif-channels', async (req) => {
    const me = requireMenu(req, 'notif', 'setting');
    const ch = await getSetting<NotifChannels>(db, 'notif_channels');
    const [{ n: devices }] = (await db.select({ n: count() }).from(pushSubscriptions)) as [{ n: number }];
    const [{ n: myDevices }] = (await db.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, me.id))) as [{ n: number }];
    const digest = await getSetting<{ lastDay?: string } | undefined>(db, 'digest_state');
    return {
      settings: ch,
      status: {
        smtpConfigured: smtpConfigured(ctx),
        smtpFrom: ctx.config.SMTP_FROM ?? ctx.config.SMTP_USER ?? null,
        pushDevices: Number(devices),
        myDevices: Number(myDevices),
        lastDigest: digest?.lastDay ?? null,
      },
    };
  });

  app.put('/api/notif-channels', async (req) => {
    const me = requireRole(req, 'admin');
    const body = z
      .object({
        push: z.object({ on: z.boolean() }),
        email: z.object({
          digestOn: z.boolean(),
          digestTime: z.string().regex(/^\d{2}:\d{2}$/),
          digestTo: z.enum(['admin', 'admin_spv']),
          escalationOn: z.boolean(),
          minSlaLevel: z.number().int().min(1).max(3),
        }),
      })
      .parse(req.body);
    await setSetting(db, 'notif_channels', body, me.id);
    await audit(db, me.id, 'notif_channels.update', 'setting', 'notif_channels', body);
    return { ok: true };
  });

  app.post('/api/notif-channels/test-email', async (req) => {
    const me = requireRole(req, 'admin');
    try {
      await sendTestEmail(ctx, me.email);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    return { ok: true, to: me.email };
  });

  app.get('/api/notif-channels/digest-preview', async (req) => {
    requireRole(req, 'admin', 'spv');
    return buildDigest(ctx);
  });

  app.post('/api/notif-channels/digest-now', async (req) => {
    requireRole(req, 'admin');
    const r = await runDailyDigest(ctx, new Date(), true);
    if (r === 'no_smtp') throw badRequest('SMTP belum diatur di .env (SMTP_HOST, SMTP_USER, SMTP_PASS)');
    return { result: r };
  });
}
