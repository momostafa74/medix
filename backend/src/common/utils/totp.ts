import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits) — the format every authenticator app
 * (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) understands.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 (what the user types if they cannot scan the QR). */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export const totpStep = (at = Date.now()) => Math.floor(at / 1000 / TOTP_STEP_SECONDS);
export const totp = (secret: string, at = Date.now()) => hotp(secret, totpStep(at));

/**
 * Checks a code against the current step ± `window` (clock drift). Returns the matched step
 * so the caller can refuse re-use of the same code (`step <= lastUsedStep`), or null.
 */
export function verifyTotp(secret: string, code: string, at = Date.now(), window = 1): number | null {
  const c = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = totpStep(at);
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(hotp(secret, now + d));
    if (timingSafeEqual(expected, Buffer.from(c))) return now + d;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** 10 one-time backup codes like `4F7K-9Q2M`. */
export function generateBackupCodes(n = 10): string[] {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => chars[x % chars.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const normalizeBackupCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashBackupCode = (c: string) => createHash('sha256').update(normalizeBackupCode(c)).digest('hex');

// ─── Secret encryption at rest (AES-256-GCM) ───

const keyFrom = (material: string) => createHash('sha256').update(`medix-2fa:${material}`).digest();

export function encryptSecret(plain: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyMaterial), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(blob: string, keyMaterial: string): string {
  const [v, iv, tag, enc] = blob.split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', keyFrom(keyMaterial), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}
