export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  requests: number;
  /** true when at least one record had no provider usage metadata */
  hasUnavailable: boolean;
}

export interface BudgetLimit {
  /** hard limit in USD; null = unlimited */
  hardLimitUsd: number | null;
  /** warning threshold 0..1 of the hard limit */
  warningRatio: number;
  /** optional token hard limit */
  maxTokens?: number | null;
}

export type BudgetState = 'OK' | 'WARNING' | 'EXCEEDED';

export interface BudgetEvaluation {
  state: BudgetState;
  usedUsd: number;
  limitUsd: number | null;
  ratio: number | null;
  usedTokens: number;
  tokenLimit: number | null;
  message: string;
}

export function evaluateBudget(limit: BudgetLimit, usage: UsageTotals): BudgetEvaluation {
  const usedTokens = usage.inputTokens + usage.outputTokens;
  const limitUsd = limit.hardLimitUsd;
  const tokenLimit = limit.maxTokens ?? null;
  const ratio = limitUsd && limitUsd > 0 ? usage.estimatedCostUsd / limitUsd : null;
  let state: BudgetState = 'OK';
  let message = 'Within budget';
  if (limitUsd !== null && limitUsd > 0 && usage.estimatedCostUsd >= limitUsd) {
    state = 'EXCEEDED';
    message = `Estimated cost $${usage.estimatedCostUsd.toFixed(4)} exceeds limit $${limitUsd.toFixed(2)}`;
  } else if (tokenLimit !== null && tokenLimit > 0 && usedTokens >= tokenLimit) {
    state = 'EXCEEDED';
    message = `Token usage ${usedTokens} exceeds limit ${tokenLimit}`;
  } else if (ratio !== null && ratio >= limit.warningRatio) {
    state = 'WARNING';
    message = `Estimated cost at ${(ratio * 100).toFixed(0)}% of budget`;
  } else if (tokenLimit !== null && tokenLimit > 0 && usedTokens / tokenLimit >= limit.warningRatio) {
    state = 'WARNING';
    message = `Token usage at ${((usedTokens / tokenLimit) * 100).toFixed(0)}% of limit`;
  }
  return { state, usedUsd: usage.estimatedCostUsd, limitUsd, ratio, usedTokens, tokenLimit, message };
}

export function sumUsage(
  records: Array<{ inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null }>,
): UsageTotals {
  const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, requests: 0, hasUnavailable: false };
  for (const r of records) {
    totals.requests += 1;
    if (r.inputTokens === null || r.outputTokens === null) totals.hasUnavailable = true;
    totals.inputTokens += r.inputTokens ?? 0;
    totals.outputTokens += r.outputTokens ?? 0;
    totals.estimatedCostUsd += r.estimatedCostUsd ?? 0;
  }
  return totals;
}
