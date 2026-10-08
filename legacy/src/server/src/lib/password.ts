import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64, PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(pw, Buffer.from(saltB64, 'base64'), expected.length, PARAMS);
  return timingSafeEqual(key, expected);
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return 'Kata sandi minimal 10 karakter';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Kata sandi harus berisi huruf dan angka';
  return null;
}
