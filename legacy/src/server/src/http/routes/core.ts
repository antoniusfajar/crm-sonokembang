import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { auditLogs, conversations, loginLogs, notifications, roleSettings, sessions, stages, tasks, users, leads, contacts } from '../../db/schema.js';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../../lib/password.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../lib/http.js';
import { MENU_GROUPS, ROLE_LABEL, ROLES, canOpen, type Role } from '../../lib/permissions.js';
import { createSession, ownOnly, requireMenu, requireRole, requireUser, SESSION_COOKIE, setSessionCookie } from '../auth.js';
import { audit } from '../../services/audit.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { addDays, wibAt, wibDateString } from '../../lib/time.js';
import { saveUpload } from './leads.js';

// Pengaturan yang boleh dibaca semua pengguna yang login (dipakai di form & dropdown).
const PUBLIC_SETTINGS = ['business_profile', 'lost_reasons', 'contact_types', 'working_hours', 'approval', 'score_rules', 'reminder_rules', 'sla', 'kpi_targets'];
// Pengaturan yang hanya bisa diubah Admin lewat endpoint umum.
const ADMIN_SETTINGS = [...PUBLIC_SETTINGS, 'sla', 'reminder_rules', 'guardrails', 'faq', 'notif_channels'];

const loginAttempts = new Map<string, { n: number; until: number }>();

export function coreRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  // ---------- Auth ----------
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
    const key = `${req.ip}|${body.email}`;
    const lock = loginAttempts.get(key);
    if (lock && lock.until > Date.now()) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.');

    const [u] = await db.select().from(users).where(eq(users.email, body.email));
    const ok = !!u && u.status !== 'nonaktif' && (await verifyPassword(body.password, u.passwordHash));
    await db.insert(loginLogs).values({ userId: u?.id ?? null, email: body.email, success: ok, ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null });
    if (!ok) {
      const n = (lock?.n ?? 0) + 1;
      loginAttempts.set(key, { n, until: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
      throw new HttpError(401, 'Email atau kata sandi salah');
    }
    loginAttempts.delete(key);
    const s = await createSession(ctx, u!.id, req);
    setSessionCookie(ctx, reply, s.token, s.expiresAt);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const me = requireUser(req);
    const body = z.object({ current: z.string(), next: z.string() }).parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, me.id));
    if (!(await verifyPassword(body.current, u!.passwordHash))) throw badRequest('Kata sandi lama salah');
    const weak = validatePasswordStrength(body.next);
    if (weak) throw badRequest(weak);
    await db.update(users).set({ passwordHash: await hashPassword(body.next), mustChangePassword: false }).where(eq(users.id, me.id));
    // Keluarkan sesi lain
    const token = req.cookies[SESSION_COOKIE];
    await db.delete(sessions).where(and(eq(sessions.userId, me.id), ne(sessions.id, sha256(token ?? ''))));
    await audit(db, me.id, 'password.change', 'user', me.id);
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const me = requireUser(req);
    const own = ownOnly(me);
    const today = wibDateString(new Date());
    const endToday = wibAt(wibDateString(addDays(new Date(), 1)), '00:00');
    const convWhere = own ? eq(conversations.assigneeId, me.id) : undefined;
    const [[unread], [aiQueue], [taskCount], [notifCount]] = await Promise.all([
      db.select({ n: count() }).from(conversations).where(and(convWhere, gte(conversations.unreadCount, 1))),
      db.select({ n: count() }).from(conversations).where(and(convWhere, eq(conversations.aiActive, false), isNull(conversations.handoffClaimedAt), gte(conversations.handoffAt, addDays(new Date(), -30)))),
      db.select({ n: count() }).from(tasks).where(and(eq(tasks.userId, me.id), isNull(tasks.doneAt), lte(tasks.dueAt, endToday))),
      db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, me.id), isNull(notifications.readAt))),
    ]);
    const biz = await getSetting<{ name: string; logoPath: string | null }>(db, 'business_profile');
    return {
      user: { id: me.id, name: me.name, email: me.email, role: me.role, roleLabel: ROLE_LABEL[me.role], scope: me.scope, mustChangePassword: me.mustChangePassword },
      menus: MENU_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canOpen(me.role, me.menus, i.key)) })).filter((g) => g.items.length),
      badges: { inbox: Number(unread?.n ?? 0), ai: Number(aiQueue?.n ?? 0), tugas: Number(taskCount?.n ?? 0), notif: Number(notifCount?.n ?? 0) },
      business: { name: biz.name, logo: biz.logoPath ? `/api/public/logo?v=${encodeURIComponent(biz.logoPath)}` : null },
      waMode: ctx.wa.mode,
      today,
    };
  });

  // ---------- Peran & akses ----------
  app.get('/api/roles', async (req) => {
    requireMenu(req, 'setting');
    const rows = await db.select().from(roleSettings);
    return {
      groups: MENU_GROUPS,
      roles: ROLES.map((r) => {
        const rs = rows.find((x) => x.role === r);
        return { role: r, label: ROLE_LABEL[r], menus: rs?.menus ?? {}, scope: rs?.scope ?? 'all' };
      }),
    };
  });

  app.put('/api/roles/:role', async (req) => {
    const me = requireRole(req, 'admin');
    const role = z.enum(ROLES).parse((req.params as any).role);
    const body = z.object({ menus: z.record(z.string(), z.boolean()), scope: z.enum(['own', 'all']) }).parse(req.body);
    if (role === 'admin') body.menus.setting = true; // Admin tidak boleh terkunci di luar Pengaturan
    await db.insert(roleSettings).values({ role, ...body }).onConflictDoUpdate({ target: roleSettings.role, set: body });
    await audit(db, me.id, 'role.update', 'role', role, body);
    return { ok: true };
  });

  // ---------- Pengguna ----------
  app.get('/api/users/options', async (req) => {
    requireUser(req);
    return db.select({ id: users.id, name: users.name, role: users.role, status: users.status }).from(users).where(ne(users.status, 'nonaktif')).orderBy(users.name);
  });

  app.get('/api/users', async (req) => {
    requireMenu(req, 'setting');
    const rows = await db.select().from(users).orderBy(users.name);
    const open = await db
      .select({ ownerId: leads.ownerId, n: count() })
      .from(leads)
      .innerJoin(stages, eq(stages.id, leads.stageId))
      .where(eq(stages.kind, 'open'))
      .groupBy(leads.ownerId);
    return rows.map(({ passwordHash, ...u }) => ({ ...u, roleLabel: ROLE_LABEL[u.role], openLeads: Number(open.find((o) => o.ownerId === u.id)?.n ?? 0) }));
  });

  const UserBody = z.object({
    name: z.string().trim().min(2),
    email: z.string().trim().toLowerCase().email(),
    role: z.enum(ROLES),
    phone: z.string().trim().optional().nullable(),
  });

  app.post('/api/users', async (req) => {
    const me = requireRole(req, 'admin');
    const body = UserBody.parse(req.body);
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (exists) throw conflict('Email sudah dipakai pengguna lain');
    const tempPassword = randomToken(9);
    const [u] = await db
      .insert(users)
      .values({ ...body, phone: body.phone ?? null, passwordHash: await hashPassword(tempPassword), mustChangePassword: true })
      .returning({ id: users.id });
    await audit(db, me.id, 'user.create', 'user', u!.id, { email: body.email, role: body.role });
    return { id: u!.id, tempPassword };
  });

  app.patch('/api/users/:id', async (req) => {
    const me = requireRole(req, 'admin');
    const id = (req.params as any).id as string;
    const body = UserBody.partial().extend({ status: z.enum(['aktif', 'cuti', 'nonaktif']).optional() }).parse(req.body);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('Pengguna tidak ditemukan');
    if (body.status === 'nonaktif') {
      if (u.id === me.id) throw badRequest('Tidak bisa menonaktifkan akun sendiri');
      const [open] = await db
        .select({ n: count() })
        .from(leads)
        .innerJoin(stages, eq(stages.id, leads.stageId))
        .where(and(eq(leads.ownerId, id), eq(stages.kind, 'open')));
      if (Number(open?.n) > 0) throw badRequest(`Masih ada ${open!.n} lead aktif. Pindahkan dulu ke sales lain sebelum menonaktifkan akun.`);
      await db.delete(sessions).where(eq(sessions.userId, id)); // akses dicabut saat itu juga
    }
    if (u.role === 'admin' && body.role && body.role !== 'admin') {
      const [admins] = await db.select({ n: count() }).from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'aktif')));
      if (Number(admins?.n) <= 1) throw badRequest('Minimal harus ada satu Admin aktif');
    }
    await db.update(users).set(body).where(eq(users.id, id));
    await audit(db, me.id, 'user.update', 'user', id, body);
    return { ok: true };
  });

  app.post('/api/users/:id/reset-password', async (req) => {
    const me = requireRole(req, 'admin');
    const id = (req.params as any).id as string;
    const tempPassword = randomToken(9);
    await db.update(users).set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true }).where(eq(users.id, id));
    await db.delete(sessions).where(eq(sessions.userId, id));
    await audit(db, me.id, 'user.reset_password', 'user', id);
    return { tempPassword };
  });

  app.post('/api/users/:id/transfer', async (req) => {
    const me = requireRole(req, 'admin', 'spv');
    const id = (req.params as any).id as string;
    const { toUserId } = z.object({ toUserId: z.string().uuid() }).parse(req.body);
    const openStages = db.select({ id: stages.id }).from(stages).where(eq(stages.kind, 'open'));
    const moved = await db
      .update(leads)
      .set({ ownerId: toUserId })
      .where(and(eq(leads.ownerId, id), inArray(leads.stageId, openStages)))
      .returning({ contactId: leads.contactId });
    const contactIds = moved.map((m) => m.contactId);
    if (contactIds.length) {
      await db.update(contacts).set({ ownerId: toUserId }).where(inArray(contacts.id, contactIds));
      await db.update(conversations).set({ assigneeId: toUserId }).where(inArray(conversations.contactId, contactIds));
    }
    await db.update(tasks).set({ userId: toUserId }).where(and(eq(tasks.userId, id), isNull(tasks.doneAt)));
    await audit(db, me.id, 'user.transfer_leads', 'user', id, { toUserId, count: moved.length });
    return { moved: moved.length };
  });

  app.get('/api/login-logs', async (req) => {
    requireRole(req, 'admin');
    return db
      .select({ id: loginLogs.id, email: loginLogs.email, success: loginLogs.success, ip: loginLogs.ip, userAgent: loginLogs.userAgent, at: loginLogs.at })
      .from(loginLogs)
      .orderBy(desc(loginLogs.at))
      .limit(200);
  });

  app.get('/api/audit', async (req) => {
    requireRole(req, 'admin');
    return db
      .select({ id: auditLogs.id, action: auditLogs.action, entity: auditLogs.entity, entityId: auditLogs.entityId, data: auditLogs.data, at: auditLogs.at, user: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .orderBy(desc(auditLogs.at))
      .limit(300);
  });

  // ---------- Pengaturan umum ----------
  app.get('/api/settings/:key', async (req) => {
    const me = requireUser(req);
    const key = (req.params as any).key as string;
    if (!ADMIN_SETTINGS.includes(key)) throw notFound();
    if (!PUBLIC_SETTINGS.includes(key) && !canOpen(me.role, me.menus, 'setting') && !canOpen(me.role, me.menus, 'notif') && !canOpen(me.role, me.menus, 'ai')) throw forbidden();
    return getSetting(db, key);
  });

  // ---------- Logo usaha ----------
  // Publik (tanpa login) karena dipakai di halaman login.
  app.get('/api/public/brand', async () => {
    const biz = await getSetting<{ name: string; tagline?: string; logoPath?: string | null }>(db, 'business_profile');
    return { name: biz.name, tagline: biz.tagline ?? '', logo: biz.logoPath ? `/api/public/logo?v=${encodeURIComponent(biz.logoPath)}` : null };
  });

  app.get('/api/public/logo', async (_req, reply) => {
    const biz = await getSetting<{ logoPath?: string | null }>(db, 'business_profile');
    if (!biz.logoPath) throw notFound();
    const file = path.join(path.resolve(ctx.config.UPLOAD_DIR), path.basename(biz.logoPath));
    if (!fs.existsSync(file)) throw notFound();
    reply.type(file.endsWith('.png') ? 'image/png' : 'image/jpeg').header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(file));
  });

  app.post('/api/settings/logo', async (req) => {
    const me = requireRole(req, 'admin');
    const up = await saveUpload(ctx, req, 'logo', { imagesOnly: true });
    const biz = await getSetting<Record<string, unknown>>(db, 'business_profile');
    await setSetting(db, 'business_profile', { ...biz, logoPath: up.name }, me.id);
    await audit(db, me.id, 'setting.logo', 'setting', 'business_profile');
    return { ok: true, logo: `/api/public/logo?v=${up.name}` };
  });

  app.delete('/api/settings/logo', async (req) => {
    const me = requireRole(req, 'admin');
    const biz = await getSetting<Record<string, unknown>>(db, 'business_profile');
    await setSetting(db, 'business_profile', { ...biz, logoPath: null }, me.id);
    return { ok: true };
  });

  app.put('/api/settings/:key', async (req) => {
    const me = requireRole(req, 'admin');
    const key = (req.params as any).key as string;
    if (!ADMIN_SETTINGS.includes(key)) throw notFound();
    if (req.body === null || typeof req.body !== 'object') throw badRequest('Isi pengaturan tidak valid');
    await setSetting(db, key, req.body, me.id);
    await audit(db, me.id, 'setting.update', 'setting', key);
    return { ok: true };
  });
}

export type { Role };
