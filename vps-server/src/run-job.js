// Jalankan satu job manual dari terminal VPS:  npm run job -- sla
import { runJob } from './scheduler.js';
import { pool } from './db.js';

const name = process.argv[2];
if (!name) {
  console.error('Pakai: npm run job -- <nama-job>');
  process.exit(1);
}
const result = await runJob(name);
console.log(result);
await pool.end();
