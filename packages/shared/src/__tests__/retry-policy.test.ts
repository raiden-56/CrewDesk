import { describe, expect, it } from 'vitest';
import { classifyError, computeBackoffMs, DEFAULT_RETRY_POLICY, ExecutionError, shouldRetry } from '../retry-policy.js';

describe('retry policy', () => {
  it('computes exponential backoff with deterministic jitter', () => {
    const noJitter = () => 0.5; // (0.5*2-1) = 0 jitter
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 1, noJitter)).toBe(2000);
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 2, noJitter)).toBe(4000);
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 3, noJitter)).toBe(8000);
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 20, noJitter)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it('applies jitter within +/- ratio', () => {
    const max = computeBackoffMs(DEFAULT_RETRY_POLICY, 1, () => 1);
    const min = computeBackoffMs(DEFAULT_RETRY_POLICY, 1, () => 0);
    expect(max).toBe(2500);
    expect(min).toBe(1500);
  });

  it('only retries retryable failure classes under the attempt limit', () => {
    expect(shouldRetry(DEFAULT_RETRY_POLICY, 1, 'TRANSIENT')).toBe(true);
    expect(shouldRetry(DEFAULT_RETRY_POLICY, 3, 'TRANSIENT')).toBe(false);
    expect(shouldRetry(DEFAULT_RETRY_POLICY, 1, 'PERMANENT')).toBe(false);
    expect(shouldRetry(DEFAULT_RETRY_POLICY, 1, 'PERMISSION')).toBe(false);
    expect(shouldRetry(DEFAULT_RETRY_POLICY, 1, 'BUDGET')).toBe(false);
  });

  it('classifies errors', () => {
    expect(classifyError({ status: 429 })).toBe('RATE_LIMITED');
    expect(classifyError({ status: 503 })).toBe('TRANSIENT');
    expect(classifyError({ status: 403 })).toBe('PERMISSION');
    expect(classifyError({ name: 'AbortError' })).toBe('TIMEOUT');
    expect(classifyError({ status: 400 })).toBe('PERMANENT');
    expect(classifyError(new ExecutionError('x', 'BUDGET'))).toBe('BUDGET');
    expect(classifyError(new Error('something odd'))).toBe('UNKNOWN');
  });
});
