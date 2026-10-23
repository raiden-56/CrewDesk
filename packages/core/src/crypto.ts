import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config.js';

function getKey(): Buffer {
  const cfg = getConfig();
  if (cfg.CREDENTIALS_ENCRYPTION_KEY) {
    const key = Buffer.from(cfg.CREDENTIALS_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 32 bytes base64');
    return key;
  }
  if (cfg.NODE_ENV === 'production') throw new Error('CREDENTIALS_ENCRYPTION_KEY is required in production');
  // development fallback derived from the session secret (documented as insecure for production)
  return createHash('sha256').update(`csai-dev-${cfg.SESSION_SECRET}`).digest();
}

/** AES-256-GCM encryption for integration credentials. Output: base64(iv).base64(tag).base64(ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Stable JSON stringify (sorted keys) so proposal hashes are deterministic. */
export function stableStringify(value: unknown): string {
  const stack = new WeakSet();
  const sort = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (stack.has(v as object)) return '[circular]';
    stack.add(v as object);
    let out: unknown;
    if (Array.isArray(v)) out = v.map(sort);
    else {
      out = Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sort((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    stack.delete(v as object);
    return out;
  };
  // JSON round-trip first so the hash matches what a database JSON column returns
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value ?? null))));
}

export function hashProposal(proposal: unknown): string {
  return sha256(stableStringify(proposal));
}
