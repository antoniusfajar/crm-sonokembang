import { and, eq, inArray } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { notifications, users } from '../db/schema.js';
import type { Role } from '../lib/permissions.js';
import { dispatchPush } from './channels.js';

export type NotifKind = 'sla' | 'lead' | 'ai' | 'tugas' | 'sistem';

export async function notify(ctx: Ctx, userIds: (string | null | undefined)[], kind: NotifKind, text: string, link?: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await ctx.db.insert(notifications).values(ids.map((userId) => ({ userId, kind, text, link: link ?? null })));
  for (const userId of ids) ctx.events.emit({ type: 'notification', userId });
  dispatchPush(ctx, ids, kind, text, link);
}

export async function usersWithRole(ctx: Ctx, ...roles: Role[]): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, roles), eq(users.status, 'aktif')));
  return rows.map((r) => r.id);
}
