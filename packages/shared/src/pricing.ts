/**
 * Provider price table (USD per 1M tokens). Prices change; these values are used for
 * cost *estimates* only and are labelled as estimates in the UI.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  label: string;
  provider: string;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, label: 'Claude Opus 5.5', provider: 'anthropic' },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, label: 'Claude Sonnet 5.5', provider: 'anthropic' },
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5, label: 'Claude Haiku 5.5', provider: 'anthropic' },
  'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50, label: 'Claude Fable 5.1', provider: 'anthropic' },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, label: 'Claude Opus 4.8', provider: 'anthropic' },
  'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10, label: 'GPT-5', provider: 'openai' },
  'gpt-5-mini': { inputPerMTok: 0.25, outputPerMTok: 2, label: 'GPT-5 mini', provider: 'openai' },
  'gpt-4.1': { inputPerMTok: 2, outputPerMTok: 8, label: 'GPT-4.1', provider: 'openai' },
  'mock-model': { inputPerMTok: 0, outputPerMTok: 0, label: 'Mock model (no cost)', provider: 'mock' },
};

export function estimateCostUsd(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const price = MODEL_PRICES[model];
  if (!price || inputTokens === null || outputTokens === null) return null;
  return (inputTokens / 1_000_000) * price.inputPerMTok + (outputTokens / 1_000_000) * price.outputPerMTok;
}

export function modelsForProvider(provider: string): Array<{ id: string } & ModelPrice> {
  return Object.entries(MODEL_PRICES)
    .filter(([, p]) => p.provider === provider)
    .map(([id, p]) => ({ id, ...p }));
}
