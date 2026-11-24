import { createHash, randomBytes, randomInt } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Human-friendly reference: PREFIX-YYMMDD-XXXXX (e.g. APT-261004-7KQ2M). */
export function humanCode(prefix: string, date = new Date()): string {
  const d = date.toISOString().slice(2, 10).replace(/-/g, '');
  let r = '';
  for (let i = 0; i < 5; i++) r += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${d}-${r}`;
}

/** Opaque URL-safe token (refresh tokens, reset links, QR verification). */
export const secureToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٟ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'p'}-${randomBytes(3).toString('hex')}`;
}
