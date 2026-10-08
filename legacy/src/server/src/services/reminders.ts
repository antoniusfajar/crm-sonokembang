import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { contacts, conversations, leads, proposals, stages, tasks, users } from '../db/schema.js';
import { addDays, wibAt, wibDateString } from '../lib/time.js';
import { leadCode } from './leads.js';
import { notify, usersWithRole } from './notify.js';
import { getSetting } from './settings.js';

interface Rule {
  key: string;
  on: boolean;
}

async function taskOwner(ctx: Ctx, ownerId: string | null): Promise<string | null> {
  if (ownerId) {
    const [u] = await ctx.db.select({ status: users.status }).from(users).where(eq(users.id, ownerId));
    if (u?.status === 'aktif') return ownerId;
  }
  // Sales cuti / tanpa PIC → dialihkan ke SPV.
  return (await usersWithRole(ctx, 'spv'))[0] ?? null;
}

async function createAutoTask(
  ctx: Ctx,
  t: { leadId: string; ownerId: string | null; title: string; kind: string; dueAt: Date; ruleKey: string },
): Promise<boolean> {
  const userId = await taskOwner(ctx, t.ownerId);
  if (!userId) return false;
  const res = await ctx.db
    .insert(tasks)
    .values({ leadId: t.leadId, userId, title: t.title, kind: t.kind, dueAt: t.dueAt, auto: true, ruleKey: t.ruleKey })
    .onConflictDoNothing()
    .returning({ id: tasks.id });
  if (res.length) ctx.events.emit({ type: 'task', userId });
  return res.length > 0;
}

/** Aturan pengingat otomatis (Tugas Hari Ini). Dipanggil worker tiap 15 menit. */
export async function runReminderRules(ctx: Ctx, now = new Date()) {
  const rules = await getSetting<Rule[]>(ctx.db, 'reminder_rules');
  const on = (k: string) => rules.find((r) => r.key === k)?.on !== false;
  let created = 0;

  const openLeads = ctx.db
    .select({ l: leads, s: stages, name: contacts.name, phone: contacts.waPhone })
    .from(leads)
    .innerJoin(stages, eq(stages.id, leads.stageId))
    .innerJoin(contacts, eq(contacts.id, leads.contactId));

  // Brosur terkirim (tahap kedua pipeline) → follow-up H+1 pukul 10.00
  if (on('brochure_followup')) {
    const rows = await openLeads.where(and(eq(stages.kind, 'open'), eq(stages.sortOrder, 1)));
    for (const { l, name, phone } of rows) {
      const day = wibDateString(addDays(l.stageChangedAt, 1));
      const ok = await createAutoTask(ctx, {
        leadId: l.id,
        ownerId: l.ownerId,
        title: `Follow-up setelah brosur — ${name ?? phone}`,
        kind: 'Follow-up',
        dueAt: wibAt(day, '10:00'),
        ruleKey: `brochure:${l.stageChangedAt.toISOString()}`,
      });
      if (ok) created++;
    }
  }

  // 3 hari tanpa balasan customer setelah pesan terakhir kita → pengingat kedua + skor −5
  if (on('no_reply_3d')) {
    const rows = await ctx.db
      .select({ l: leads, c: conversations, name: contacts.name, phone: contacts.waPhone })
      .from(leads)
      .innerJoin(stages, eq(stages.id, leads.stageId))
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .innerJoin(conversations, eq(conversations.contactId, leads.contactId))
      .where(
        and(
          eq(stages.kind, 'open'),
          lt(conversations.lastMessageAt, addDays(now, -3)),
          sql`${conversations.lastMessageAt} > coalesce(${conversations.lastInboundAt}, 'epoch'::timestamptz)`,
        ),
      );
    for (const { l, c, name, phone } of rows) {
      const ok = await createAutoTask(ctx, {
        leadId: l.id,
        ownerId: l.ownerId,
        title: `Pengingat kedua: 3 hari tanpa balasan — ${name ?? phone}`,
        kind: 'Follow-up',
        dueAt: now,
        ruleKey: `noreply3d:${c.lastMessageAt!.toISOString()}`,
      });
      if (ok) {
        await ctx.db.update(leads).set({ score: sql`greatest(${leads.score} - 5, 0)` }).where(eq(leads.id, l.id));
        created++;
      }
    }
  }

  // Proposal terkirim tanpa respons → follow-up H+2
  if (on('proposal_followup')) {
    const rows = await ctx.db
      .select({ l: leads, p: proposals, c: conversations, name: contacts.name, phone: contacts.waPhone })
      .from(proposals)
      .innerJoin(leads, eq(leads.id, proposals.leadId))
      .innerJoin(stages, eq(stages.id, leads.stageId))
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .innerJoin(conversations, eq(conversations.contactId, leads.contactId))
      .where(and(eq(proposals.status, 'sent'), eq(stages.kind, 'open'), lt(proposals.createdAt, addDays(now, -2))));
    for (const { l, p, c, name, phone } of rows) {
      if (c.lastInboundAt && c.lastInboundAt > p.createdAt) continue;
      const ok = await createAutoTask(ctx, {
        leadId: l.id,
        ownerId: l.ownerId,
        title: `Follow-up proposal (belum ada respons) — ${name ?? phone}`,
        kind: 'Proposal',
        dueAt: now,
        ruleKey: `proposal:${p.id}`,
      });
      if (ok) created++;
    }
  }

  // 7 hari tanpa aktivitas → usul tandai Abandoned (alasan tetap wajib, tidak otomatis)
  if (on('idle_7d')) {
    const rows = await openLeads.where(and(eq(stages.kind, 'open'), lt(leads.lastActivityAt, addDays(now, -7))));
    for (const { l, name, phone } of rows) {
      const ok = await createAutoTask(ctx, {
        leadId: l.id,
        ownerId: l.ownerId,
        title: `7 hari tanpa aktivitas — pertimbangkan tandai Abandoned (${leadCode(l.code)} ${name ?? phone})`,
        kind: 'Review',
        dueAt: now,
        ruleKey: `idle7d:${l.lastActivityAt.toISOString()}`,
      });
      if (ok) {
        await notify(ctx, [l.ownerId], 'tugas', `${name ?? phone} 7 hari tanpa aktivitas — usul tandai Abandoned`, `/leads/${l.id}`);
        created++;
      }
    }
  }
  return created;
}


export const DUE_SOON_MINUTES = 30;

/**
 * Janji follow-up (tugas yang dibuat sales, bukan tugas otomatis harian) → notifikasi
 * 30 menit sebelum jatuh tempo, sekali per tugas. Dipanggil worker tiap menit.
 */
export async function runTaskDueReminders(ctx: Ctx, now = new Date()) {
  const rules = await getSetting<Rule[]>(ctx.db, 'reminder_rules');
  if (rules.find((r) => r.key === 'task_due_soon')?.on === false) return 0;
  const until = new Date(now.getTime() + DUE_SOON_MINUTES * 60_000);
  const due = await ctx.db
    .update(tasks)
    .set({ remindedAt: now })
    .where(and(isNull(tasks.doneAt), isNull(tasks.remindedAt), eq(tasks.auto, false), gt(tasks.dueAt, now), lte(tasks.dueAt, until)))
    .returning();
  for (const t of due) {
    const mins = Math.max(1, Math.round((t.dueAt.getTime() - now.getTime()) / 60_000));
    let who = '';
    if (t.leadId) {
      const [l] = await ctx.db.select({ name: leads.name }).from(leads).where(eq(leads.id, t.leadId));
      if (l?.name) who = ` · ${l.name}`;
    }
    await notify(ctx, [t.userId], 'tugas', `${mins} menit lagi: ${t.title}${who}`, t.leadId ? `/leads/${t.leadId}` : '/tugas');
  }
  return due.length;
}
