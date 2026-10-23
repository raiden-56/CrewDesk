import pino from 'pino';
import { getConfig } from './config.js';

const REDACT_PATHS = [
  'password',
  'passwordHash',
  'secret',
  'encryptedSecret',
  'token',
  'apiKey',
  'authorization',
  'cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  'req.headers.authorization',
  'req.headers.cookie',
];

export const logger = pino({
  level: getConfig().LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

/** Remove keys that look like secrets from objects before persisting them in logs/events. */
export function scrubSecrets<T>(value: T): T {
  const secretKey = /(password|secret|token|api[-_]?key|authorization|cookie|credential)/i;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = secretKey.test(k) ? '[redacted]' : walk(val);
      }
      return out;
    }
    if (typeof v === 'string') {
      // redact common key formats appearing inside strings
      return v.replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, '[redacted]').replace(/sk-[A-Za-z0-9]{20,}/g, '[redacted]').replace(/ghp_[A-Za-z0-9]{20,}/g, '[redacted]');
    }
    return v;
  };
  return walk(value) as T;
}
