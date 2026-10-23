import { describe, expect, it } from 'vitest';
import { evaluateBudget, sumUsage } from '../budget.js';
import { estimateCostUsd } from '../pricing.js';

describe('budget calculations', () => {
  it('sums usage and flags unavailable provider metadata', () => {
    const totals = sumUsage([
      { inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.001 },
      { inputTokens: null, outputTokens: null, estimatedCostUsd: null },
    ]);
    expect(totals.inputTokens).toBe(100);
    expect(totals.outputTokens).toBe(50);
    expect(totals.requests).toBe(2);
    expect(totals.hasUnavailable).toBe(true);
  });

  it('evaluates OK / WARNING / EXCEEDED', () => {
    const base = { inputTokens: 0, outputTokens: 0, requests: 1, hasUnavailable: false };
    expect(evaluateBudget({ hardLimitUsd: 10, warningRatio: 0.8 }, { ...base, estimatedCostUsd: 1 }).state).toBe('OK');
    expect(evaluateBudget({ hardLimitUsd: 10, warningRatio: 0.8 }, { ...base, estimatedCostUsd: 8.5 }).state).toBe('WARNING');
    expect(evaluateBudget({ hardLimitUsd: 10, warningRatio: 0.8 }, { ...base, estimatedCostUsd: 10 }).state).toBe('EXCEEDED');
    expect(evaluateBudget({ hardLimitUsd: null, warningRatio: 0.8 }, { ...base, estimatedCostUsd: 1000 }).state).toBe('OK');
  });

  it('applies token limits', () => {
    const r = evaluateBudget({ hardLimitUsd: null, warningRatio: 0.8, maxTokens: 1000 }, { inputTokens: 900, outputTokens: 200, estimatedCostUsd: 0, requests: 1, hasUnavailable: false });
    expect(r.state).toBe('EXCEEDED');
  });

  it('estimates cost from the price table and returns null when unknown', () => {
    expect(estimateCostUsd('claude-sonnet-5-5', 1_000_000, 1_000_000)).toBeCloseTo(12);
    expect(estimateCostUsd('unknown-model', 10, 10)).toBeNull();
    expect(estimateCostUsd('claude-sonnet-5-5', null, 10)).toBeNull();
  });
});
