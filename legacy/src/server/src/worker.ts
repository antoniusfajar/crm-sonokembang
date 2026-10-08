import { and, eq, lt } from 'drizzle-orm';
import type { Ctx } from './context.js';
import { aiCalls, jobs, sessions } from './db/schema.js';
import { runResponder } from './ai/responder.js';
import { runDueJobs, type JobHandler } from './services/jobs.js';
import { checkSla } from './services/sla.js';
import { runReminderRules, runTaskDueReminders } from './services/reminders.js';
import { getSetting } from './services/settings.js';
import { runDailyDigest } from './services/channels.js';
import { runDueSchedules } from './services/reportSchedules.js';
import { runDueSyncs } from './integrations/service.js';
import { runBroadcasts } from './services/broadcasts.js';
import { runReviewRequests, runScheduledReplies } from './services/reputation.js';
import { runPostSchedules } from './services/marketing.js';
import { addDays } from './lib/time.js';

export const JOB_HANDLERS: Record<string, JobHandler> = {
  ai_reply: async (ctx, p) => {
    await runResponder(ctx, p.conversationId);
  },
};

async function cleanup(ctx: Ctx) {
  const ai = await getSetting<{ logRetentionDays: number }>(ctx.db, 'ai');
  await ctx.db.delete(aiCalls).where(lt(aiCalls.at, addDays(new Date(), -ai.logRetentionDays)));
  await ctx.db.delete(jobs).where(and(eq(jobs.status, 'done'), lt(jobs.createdAt, addDays(new Date(), -7))));
  await ctx.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Worker di proses yang sama dengan server (cukup untuk satu VPS). */
export function startWorker(ctx: Ctx, log: { error: (o: unknown, m?: string) => void }) {
  const timers: NodeJS.Timeout[] = [];
  let busy = false;
  const safe = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (e) {
      log.error(e, `worker ${name} gagal`);
    }
  };
  timers.push(
    setInterval(async () => {
      if (busy) return;
      busy = true;
      await safe('jobs', () => runDueJobs(ctx, JOB_HANDLERS))();
      busy = false;
    }, 1500),
  );
  timers.push(setInterval(safe('sla', () => checkSla(ctx)), 60_000));
  timers.push(setInterval(safe('reminders', () => runReminderRules(ctx)), 15 * 60_000));
  timers.push(setInterval(safe('task-due', () => runTaskDueReminders(ctx)), 60_000));
  timers.push(setInterval(safe('digest', () => runDailyDigest(ctx)), 60_000));
  timers.push(setInterval(safe('post-schedules', () => runPostSchedules(ctx)), 60_000));
  timers.push(setInterval(safe('review-replies', () => runScheduledReplies(ctx)), 60_000));
  timers.push(setInterval(safe('review-requests', () => runReviewRequests(ctx)), 15 * 60_000));
  let broadcasting = false;
  timers.push(
    setInterval(async () => {
      if (broadcasting) return;
      broadcasting = true;
      await safe('broadcast', () => runBroadcasts(ctx))();
      broadcasting = false;
    }, 30_000),
  );
  let syncing = false;
  timers.push(
    setInterval(async () => {
      if (syncing) return; // sinkron platform bisa lama
      syncing = true;
      await safe('integrations', () => runDueSyncs(ctx))();
      syncing = false;
    }, 60_000),
  );
  let reporting = false;
  timers.push(
    setInterval(async () => {
      if (reporting) return; // pembuatan laporan + AI bisa lebih dari semenit
      reporting = true;
      await safe('reports', () => runDueSchedules(ctx))();
      reporting = false;
    }, 60_000),
  );
  timers.push(setInterval(safe('cleanup', () => cleanup(ctx)), 6 * 60 * 60_000));
  setTimeout(safe('reminders', () => runReminderRules(ctx)), 10_000);
  return () => timers.forEach(clearInterval);
}
