import { and, count, eq, inArray } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, conversations, distributionMembers, leads, messages, stages, users } from '../db/schema.js';
import { getSetting } from './settings.js';
import { notify } from './notify.js';

export interface SpecialRule {
  id: string;
  label: string;
  keywords: string[];
  userIds: string[];
  active: boolean;
}

export interface DistributionSettings {
  method: 'weighted' | 'round_robin' | 'manual';
  rules: { sticky: boolean; skipLeave: boolean; cap: boolean; capCount: number; escalate: boolean };
  /** Aturan khusus: jenis acara tertentu selalu ke sales tertentu (mis. korporat/kantin → Bachtiar). */
  specialRules?: SpecialRule[];
}

const normText = (s: string) => s.toLowerCase().normalize('NFKD');

/** Aturan khusus pertama yang kata kuncinya muncul di teks (jenis acara / pesan pertama). */
export function matchSpecialRule(rules: SpecialRule[] | undefined, text: string | null | undefined): SpecialRule | undefined {
  if (!text) return undefined;
  const t = normText(text);
  return (rules ?? []).find((r) => r.active && r.userIds.length && r.keywords.some((k) => k.trim() && t.includes(normText(k.trim()))));
}

/** Dari pool aturan khusus, pilih sales aktif dengan lead terbuka paling sedikit. */
async function pickFromPool(ctx: Ctx, userIds: string[], excludeId?: string | null): Promise<string | null> {
  const pool = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, userIds), eq(users.status, 'aktif')));
  const ids = pool.map((p) => p.id).filter((id) => id !== excludeId);
  if (!ids.length) return null;
  const open = await ctx.db
    .select({ ownerId: leads.ownerId, n: count() })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .where(and(eq(stages.kind, 'open'), inArray(leads.ownerId, ids)))
    .groupBy(leads.ownerId);
  const openBy = new Map(open.map((o) => [o.ownerId, Number(o.n)]));
  return ids.reduce((a, b) => ((openBy.get(b) ?? 0) < (openBy.get(a) ?? 0) ? b : a));
}

/**
 * Menentukan sales penanggung jawab saat pesan pertama masuk (sebelum AI membalas).
 * Pilih sales dengan rasio (lead yang sudah dibagi ÷ bobot) terkecil → porsi sesuai bobot.
 */
export async function pickAssignee(
  ctx: Ctx,
  opts: { previousOwnerId?: string | null; channel?: string; hint?: string | null; excludeId?: string | null } = {},
): Promise<string | null> {
  const ds = await getSetting<DistributionSettings>(ctx.db, 'distribution');
  const channel = opts.channel ?? 'default';

  if (ds.rules.sticky && opts.previousOwnerId) {
    const [prev] = await ctx.db.select().from(users).where(eq(users.id, opts.previousOwnerId));
    if (prev && prev.status === 'aktif') return prev.id;
  }
  const special = matchSpecialRule(ds.specialRules, opts.hint);
  if (special) {
    const id = await pickFromPool(ctx, special.userIds, opts.excludeId);
    if (id) return id;
  }
  if (ds.method === 'manual') return null;

  let members = await ctx.db
    .select({ userId: distributionMembers.userId, weight: distributionMembers.weight, assigned: distributionMembers.assignedCount, status: users.status })
    .from(distributionMembers)
    .innerJoin(users, eq(users.id, distributionMembers.userId))
    .where(and(eq(distributionMembers.channel, channel), eq(distributionMembers.included, true)));

  if (!members.length && channel !== 'default') return pickAssignee(ctx, { ...opts, channel: 'default', previousOwnerId: null });
  if (!members.length) {
    // Bobot belum diatur: berikan ke sales aktif dengan lead terbuka paling sedikit.
    const sales = (await ctx.db.select({ id: users.id }).from(users).where(and(eq(users.role, 'sales'), eq(users.status, 'aktif')))).filter((u) => u.id !== opts.excludeId);
    if (!sales.length) return null;
    const open = await ctx.db
      .select({ ownerId: leads.ownerId, n: count() })
      .from(leads)
      .innerJoin(stages, eq(stages.id, leads.stageId))
      .where(and(eq(stages.kind, 'open'), inArray(leads.ownerId, sales.map((s) => s.id))))
      .groupBy(leads.ownerId);
    const openBy = new Map(open.map((o) => [o.ownerId, Number(o.n)]));
    return sales.reduce((a, b) => ((openBy.get(b.id) ?? 0) < (openBy.get(a.id) ?? 0) ? b : a)).id;
  }

  members = members.filter((m) => m.userId !== opts.excludeId && m.weight > 0 && (m.status === 'aktif' || (!ds.rules.skipLeave && m.status === 'cuti')));
  if (ds.rules.cap && members.length) {
    const open = await ctx.db
      .select({ ownerId: leads.ownerId, n: count() })
      .from(leads)
      .innerJoin(stages, eq(stages.id, leads.stageId))
      .where(and(eq(stages.kind, 'open'), inArray(leads.ownerId, members.map((m) => m.userId))))
      .groupBy(leads.ownerId);
    const openBy = new Map(open.map((o) => [o.ownerId, Number(o.n)]));
    members = members.filter((m) => (openBy.get(m.userId) ?? 0) < ds.rules.capCount);
  }
  if (!members.length) return null;

  const pick =
    ds.method === 'round_robin'
      ? members.reduce((a, b) => (b.assigned < a.assigned ? b : a))
      : members.reduce((a, b) => ((b.assigned + 1) / b.weight < (a.assigned + 1) / a.weight ? b : a));

  await ctx.db
    .insert(distributionMembers)
    .values({ userId: pick.userId, channel, weight: pick.weight, assignedCount: pick.assigned + 1 })
    .onConflictDoUpdate({
      target: [distributionMembers.userId, distributionMembers.channel],
      set: { assignedCount: pick.assigned + 1 },
    });
  return pick.userId;
}

/**
 * Dipanggil setelah AI mengenali jenis acara. Bila cocok dengan aturan khusus dan percakapan
 * masih dipegang AI (sales belum mulai menangani), lead dipindah ke sales di pool aturan itu.
 */
export async function reassignBySpecialRule(ctx: Ctx, conversationId: string, eventType: string | null | undefined): Promise<string | null> {
  const ds = await getSetting<DistributionSettings>(ctx.db, 'distribution');
  const rule = matchSpecialRule(ds.specialRules, eventType);
  if (!rule) return null;
  const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv || !conv.aiActive) return null;
  if (conv.assigneeId && rule.userIds.includes(conv.assigneeId)) return null;
  const next = await pickFromPool(ctx, rule.userIds);
  if (!next) return null;
  await ctx.db.update(conversations).set({ assigneeId: next }).where(eq(conversations.id, conversationId));
  await ctx.db.update(contacts).set({ ownerId: next }).where(eq(contacts.id, conv.contactId));
  const openStages = ctx.db.select({ id: stages.id }).from(stages).where(eq(stages.kind, 'open'));
  await ctx.db
    .update(leads)
    .set({ ownerId: next })
    .where(and(eq(leads.contactId, conv.contactId), inArray(leads.stageId, openStages)));
  const [u] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, next));
  await ctx.db.insert(messages).values({
    conversationId,
    direction: 'system',
    senderType: 'system',
    kind: 'system',
    body: `PIC dipindah ke ${u?.name ?? 'sales lain'} · aturan khusus "${rule.label}"`,
    status: 'sent',
  });
  await notify(ctx, [next], 'lead', `Lead "${rule.label}" dialihkan ke Anda`, `/inbox/${conversationId}`);
  if (conv.assigneeId) await notify(ctx, [conv.assigneeId], 'lead', `Satu lead dialihkan ke ${u?.name ?? 'sales lain'} (aturan "${rule.label}")`, `/inbox/${conversationId}`);
  ctx.events.emit({ type: 'conversation', conversationId, ownerId: next });
  return next;
}
