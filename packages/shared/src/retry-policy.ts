import type { FailureClass } from './enums.js';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  /** 0..1 - fraction of the delay used for random jitter */
  jitterRatio: number;
  retryOn: FailureClass[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 2000,
  maxDelayMs: 60000,
  multiplier: 2,
  jitterRatio: 0.25,
  retryOn: ['TRANSIENT', 'RATE_LIMITED', 'TIMEOUT'],
};

export const NO_RETRY_POLICY: RetryPolicy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 1, retryOn: [] };

/** Exponential backoff with jitter. `random` is injectable so tests are deterministic. */
export function computeBackoffMs(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(1, attempt);
  const raw = policy.baseDelayMs * Math.pow(policy.multiplier, safeAttempt - 1);
  const capped = Math.min(raw, policy.maxDelayMs);
  const jitter = capped * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

export function shouldRetry(policy: RetryPolicy, attempt: number, failure: FailureClass): boolean {
  if (attempt >= policy.maxAttempts) return false;
  return policy.retryOn.includes(failure);
}

export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly failureClass: FailureClass,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}

/** Classify an error into a failure class used by retry decisions. */
export function classifyError(err: unknown): FailureClass {
  const e = err as { name?: string; code?: string; status?: number; message?: string; failureClass?: FailureClass };
  if (e?.failureClass) return e.failureClass;
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.name === 'AbortError' || msg.includes('timed out') || msg.includes('timeout') || e?.code === 'ETIMEDOUT') return 'TIMEOUT';
  if (e?.status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) return 'RATE_LIMITED';
  if (e?.status === 401 || e?.status === 403 || msg.includes('permission') || msg.includes('forbidden')) return 'PERMISSION';
  if (typeof e?.status === 'number' && e.status >= 500) return 'TRANSIENT';
  if (e?.code === 'ECONNRESET' || e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND' || msg.includes('overloaded')) return 'TRANSIENT';
  if (msg.includes('budget')) return 'BUDGET';
  if (msg.includes('cancel')) return 'CANCELLED';
  if (typeof e?.status === 'number' && e.status >= 400) return 'PERMANENT';
  return 'UNKNOWN';
}
