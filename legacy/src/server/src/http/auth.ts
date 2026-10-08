import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { sessions, users, roleSettings } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { canOpen, DEFAULT_SCOPE, defaultMenus, type Role } from '../lib/permissions.js';
import { forbidden, HttpError } from '../lib/http.js';
import type { Ctx } from '../context.js';

export const SESSION_COOKIE = 'skcrm_session';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  menus: Record<string, boolean>;
  scope: 'own' | 'all';
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export async function createSession(ctx: Ctx, userId: string, req: FastifyRequest) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ctx.config.SESSION_DAYS * 86_400_000);
  await ctx.db.insert(sessions).values({
    id: sha256(token),
    userId,
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

export function setSessionCookie(ctx: Ctx, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.NODE_ENV === 'production',
    expires: expiresAt,
  });
}

export async function loadRoleSettings(ctx: Ctx, role: Role) {
  const [rs] = await ctx.db.select().from(roleSettings).where(eq(roleSettings.role, role));
  return { menus: rs?.menus ?? defaultMenus(role), scope: rs?.scope ?? DEFAULT_SCOPE[role] };
}

export function registerAuth(app: FastifyInstance, ctx: Ctx) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const [row] = await ctx.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
    if (!row || row.u.status === 'nonaktif') return;
    const rs = await loadRoleSettings(ctx, row.u.role);
    req.user = {
      id: row.u.id,
      name: row.u.name,
      email: row.u.email,
      role: row.u.role,
      status: row.u.status,
      menus: rs.menus,
      scope: rs.scope,
      mustChangePassword: row.u.mustChangePassword,
    };
    // Perbarui "terakhir aktif" paling sering sekali per 5 menit.
    const last = row.u.lastActiveAt?.getTime() ?? 0;
    if (Date.now() - last > 5 * 60_000) {
      await ctx.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, row.u.id));
    }
  });
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'Silakan login dulu');
  return req.user;
}

export function requireMenu(req: FastifyRequest, ...keys: string[]): AuthUser {
  const u = requireUser(req);
  if (!keys.some((k) => canOpen(u.role, u.menus, k))) throw forbidden();
  return u;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw forbidden();
  return u;
}

/** true bila user hanya boleh melihat data miliknya sendiri. */
export const ownOnly = (u: AuthUser) => u.scope === 'own';
