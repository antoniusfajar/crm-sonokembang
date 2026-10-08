import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  timezone: '+07:00',
  dateStrings: true,
  charset: 'utf8mb4',
});

// MySQL di hosting biasanya UTC; samakan dengan PHP (Asia/Jakarta) supaya NOW() konsisten
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+07:00'"));

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function one(sql, params = []) {
  return (await query(sql, params))[0] ?? null;
}

export async function notify(userId, type, title, link = null) {
  await query('INSERT INTO notifications (user_id, type, title, link) VALUES (?, ?, ?, ?)', [userId, type, title, link]);
}

export async function supervisors() {
  return query("SELECT id FROM users WHERE role IN ('spv','admin') AND status = 'aktif'");
}

export async function getSetting(key, fallback) {
  const row = await one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  if (!row) return fallback;
  const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  return { ...fallback, ...v };
}
