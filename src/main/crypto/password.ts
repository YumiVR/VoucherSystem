import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { secureBytes } from './random';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * 1024 * 1024;

/** Memory-hard key derivation shared by password hashing and backup encryption. */
export async function deriveKey(password: string, salt: Buffer, n: number = N): Promise<Buffer> {
  return scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N: n, r: R, p: P, maxmem: MAXMEM });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = secureBytes(16);
  const hash = await deriveKey(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  if (n !== N || Number(parts[2]) !== R || Number(parts[3]) !== P) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  const actual = await deriveKey(password, salt, n);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
