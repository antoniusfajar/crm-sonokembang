import { and, eq, sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { jobs } from '../db/schema.js';

export type JobHandler = (ctx: Ctx, payload: any) => Promise<void>;

/**
 * Antrian job sederhana di PostgreSQL (tanpa Redis). Job ai_reply untuk percakapan yang sama
 * digabung: pesan beruntun dari customer hanya memicu satu balasan AI.
 */
export async function enqueue(ctx: Ctx, type: string, payload: Record<string, unknown>, opts: { delayMs?: number } = {}) {
  const runAt = new Date(Date.now() + (opts.delayMs ?? 0));
  if (type === 'ai_reply' && payload.conversationId) {
    const updated = await ctx.db
      .update(jobs)
      .set({ runAt, payload })
      .where(and(eq(jobs.type, type), eq(jobs.status, 'pending'), sql`${jobs.payload}->>'conversationId' = ${String(payload.conversationId)}`))
      .returning({ id: jobs.id });
    if (updated.length) return;
  }
  await ctx.db.insert(jobs).values({ type, payload, runAt });
}

/** Ambil & jalankan job yang sudah jatuh tempo. Mengembalikan jumlah job yang diproses. */
export async function runDueJobs(ctx: Ctx, handlers: Record<string, JobHandler>, limit = 10): Promise<number> {
  const claimed = await ctx.db.execute(sql`
    update ${jobs} set status = 'running', attempts = attempts + 1
    where id in (
      select id from ${jobs}
      where status = 'pending' and run_at <= now()
      order by run_at
      limit ${limit}
      for update skip locked
    )
    returning id, type, payload, attempts
  `);
  for (const row of claimed.rows as { id: number; type: string; payload: any; attempts: number }[]) {
    const h = handlers[row.type];
    try {
      if (!h) throw new Error(`Tidak ada handler untuk job ${row.type}`);
      await h(ctx, row.payload);
      await ctx.db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, row.id));
    } catch (e) {
      const retry = row.attempts < 3;
      await ctx.db
        .update(jobs)
        .set({
          status: retry ? 'pending' : 'failed',
          lastError: (e as Error).message.slice(0, 1000),
          runAt: new Date(Date.now() + row.attempts * 30_000),
        })
        .where(eq(jobs.id, row.id));
    }
  }
  return claimed.rows.length;
}
