import IORedis, { type Redis } from 'ioredis';
import { getConfig } from './config.js';

const clients: Redis[] = [];

export function createRedis(opts: { maxRetriesPerRequest?: number | null } = {}): Redis {
  const client = new IORedis(getConfig().REDIS_URL, {
    maxRetriesPerRequest: opts.maxRetriesPerRequest === undefined ? null : opts.maxRetriesPerRequest,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on('error', (err: Error) => {
    // avoid unhandled error events; connection errors are surfaced by callers
    if (process.env.NODE_ENV !== 'test') console.error('[redis]', err.message);
  });
  clients.push(client);
  return client;
}

let shared: Redis | null = null;
/** Shared general-purpose client (caching, rate limiting, locks). */
export function getRedis(): Redis {
  if (!shared) shared = createRedis();
  return shared;
}

export async function closeRedis(): Promise<void> {
  await Promise.all(clients.map((c) => c.quit().catch(() => undefined)));
  clients.length = 0;
  shared = null;
}

export const REALTIME_CHANNEL = 'csai:realtime';

/** Simple fixed-window rate limiter. Returns remaining tokens (negative when exceeded). */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetSec: number }> {
  const redis = getRedis();
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const count = await redis.incr(bucket);
  if (count === 1) await redis.expire(bucket, windowSec);
  const ttl = await redis.ttl(bucket);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSec: ttl };
}

/** Acquire a short-lived distributed lock. Returns a release function or null. */
export async function acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
  const redis = getRedis();
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  const ok = await redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
  if (!ok) return null;
  return async () => {
    const script = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
    await redis.eval(script, 1, `lock:${key}`, token);
  };
}
