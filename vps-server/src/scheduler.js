import cron from 'node-cron';
import { query } from './db.js';
import { JOBS } from './jobs/index.js';

const running = new Set();
const lastRun = {};

const fmt = (d) => d.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD HH:mm:ss

/** Jalankan satu job; dicatat ke tabel job_runs supaya terlihat di website (menu Server). */
export async function runJob(name) {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Job ${name} tidak dikenal`);
  if (running.has(name)) return { skipped: true }; // job sebelumnya belum selesai
  running.add(name);
  const started = new Date();
  let ok = true;
  let info = '';
  try {
    info = String((await job.run()) ?? 'selesai');
  } catch (e) {
    ok = false;
    info = e.message;
    console.error(`[job ${name}]`, e);
  } finally {
    running.delete(name);
  }
  lastRun[name] = fmt(new Date());
  // Job tiap menit yang tidak melakukan apa-apa tidak perlu memenuhi log
  const quiet = ok && /^(0 |tidak ada)/.test(info);
  if (!quiet) {
    await query('INSERT INTO job_runs (job, ok, info, started_at, finished_at) VALUES (?, ?, ?, ?, ?)', [
      name, ok ? 1 : 0, info.slice(0, 250), fmt(started), fmt(new Date()),
    ]).catch((e) => console.error('gagal mencatat job_runs:', e.message));
  }
  return { ok, info };
}

export function startScheduler() {
  for (const job of JOBS) {
    if (!cron.validate(job.schedule)) throw new Error(`Jadwal cron job ${job.name} tidak valid`);
    cron.schedule(job.schedule, () => runJob(job.name), { timezone: 'Asia/Jakarta' });
  }
  console.log(`Scheduler aktif: ${JOBS.map((j) => j.name).join(', ')}`);
}

export function jobList() {
  return JOBS.map((j) => ({ name: j.name, schedule: j.schedule, description: j.description, lastRun: lastRun[j.name] ?? null }));
}
