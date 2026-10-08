import { and, eq, isNotNull, lt } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, conversations, leads, users } from '../db/schema.js';
import { workingMinutesBetween, type WorkingHours } from '../lib/time.js';
import { pickAssignee, type DistributionSettings } from './distribution.js';
import { notify, usersWithRole } from './notify.js';
import { openLeadForContact } from './leads.js';
import { getSetting } from './settings.js';
import { escalateExternally } from './channels.js';

export interface SlaSettings {
  levels: { minutes: number; action: 'notify_owner' | 'notify_spv' | 'reassign'; label: string }[];
}

/**
 * Tangga eskalasi. Dihitung sejak customer menunggu balasan manusia (setelah serah terima AI),
 * hanya pada jam kerja. Dipanggil worker tiap menit.
 */
export async function checkSla(ctx: Ctx, now = new Date()) {
  const sla = await getSetting<SlaSettings>(ctx.db, 'sla');
  const wh = await getSetting<WorkingHours>(ctx.db, 'working_hours');
  const dist = await getSetting<DistributionSettings>(ctx.db, 'distribution');
  const levels = [...sla.levels].sort((a, b) => a.minutes - b.minutes);
  const waiting = await ctx.db
    .select({ c: conversations, name: contacts.name, phone: contacts.waPhone })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(conversations.aiActive, false), isNotNull(conversations.awaitingReplySince), lt(conversations.slaLevel, levels.length)));

  let escalated = 0;
  for (const { c, name, phone } of waiting) {
    const mins = workingMinutesBetween(c.awaitingReplySince!, now, wh);
    let level = c.slaLevel;
    while (level < levels.length && mins >= levels[level]!.minutes) {
      const L = levels[level]!;
      const label = name ?? phone;
      const link = `/inbox/${c.id}`;
      if (L.action === 'notify_owner') {
        await notify(ctx, [c.assigneeId], 'sla', `${label} belum dibalas ${mins} menit — segera balas`, link);
      } else if (L.action === 'notify_spv') {
        const spv = await usersWithRole(ctx, 'spv');
        await notify(ctx, spv, 'sla', `${label} belum dibalas ${mins} menit — eskalasi ke SPV`, link);
        await escalateExternally(ctx, spv, { level: level + 1, label, minutes: mins, ownerName: await ownerName(ctx, c.assigneeId), link });
      } else if (L.action === 'reassign') {
        const bosses = await usersWithRole(ctx, 'admin', 'spv');
        await notify(ctx, bosses, 'sla', `${label} belum dibalas ${mins} menit — level 3`, link);
        await escalateExternally(ctx, bosses, { level: level + 1, label, minutes: mins, ownerName: await ownerName(ctx, c.assigneeId), link });
        if (dist.rules.escalate) {
          const next = await pickAssignee(ctx, { excludeId: c.assigneeId });
          if (next && next !== c.assigneeId) {
            await ctx.db.update(conversations).set({ assigneeId: next }).where(eq(conversations.id, c.id));
            await ctx.db.update(contacts).set({ ownerId: next }).where(eq(contacts.id, c.contactId));
            const lead = await openLeadForContact(ctx, c.contactId);
            if (lead) await ctx.db.update(leads).set({ ownerId: next }).where(eq(leads.id, lead.id));
            const [u] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, next));
            await notify(ctx, [next, c.assigneeId], 'sla', `${label} dialihkan otomatis ke ${u?.name ?? 'sales lain'}`, link);
          }
        }
      }
      level++;
      escalated++;
    }
    if (level !== c.slaLevel) {
      await ctx.db.update(conversations).set({ slaLevel: level }).where(eq(conversations.id, c.id));
      ctx.events.emit({ type: 'conversation', conversationId: c.id, ownerId: c.assigneeId });
    }
  }
  return escalated;
}

async function ownerName(ctx: Ctx, id: string | null) {
  if (!id) return null;
  const [u] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, id));
  return u?.name ?? null;
}
