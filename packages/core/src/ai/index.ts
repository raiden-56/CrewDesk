import { MODEL_PRICES, modelsForProvider } from '@collabspace/shared';
import { aiProviderConfigured, getConfig } from '../config.js';
import { createAnthropicProvider } from './anthropic.js';
import { createMockProvider } from './mock.js';
import { createOpenAiProvider } from './openai.js';
import type { AiProvider } from './provider.js';

export * from './provider.js';

let cached: AiProvider | null = null;
let cachedKey = '';

/**
 * Resolve the provider for a request. Agents may pin a provider in their model
 * config; the environment decides which providers have credentials. Returns null
 * when nothing is configured so callers can surface an honest "unavailable" state.
 */
export function resolveProvider(requested?: string | null): AiProvider | null {
  const cfg = getConfig();
  const want = requested && requested !== '' ? requested : cfg.AI_PROVIDER;
  if (!want) return null;
  if (want === 'mock') return getOrCreate('mock', () => createMockProvider());
  if (want === 'anthropic') return cfg.ANTHROPIC_API_KEY ? getOrCreate(`anthropic:${cfg.ANTHROPIC_API_KEY.slice(-6)}`, () => createAnthropicProvider(cfg.ANTHROPIC_API_KEY!)) : null;
  if (want === 'openai') return cfg.OPENAI_API_KEY ? getOrCreate(`openai:${cfg.OPENAI_API_KEY.slice(-6)}`, () => createOpenAiProvider(cfg.OPENAI_API_KEY!, cfg.OPENAI_BASE_URL, cfg.EMBEDDINGS_MODEL)) : null;
  return null;
}

function getOrCreate(key: string, make: () => AiProvider): AiProvider {
  if (cached && cachedKey === key) return cached;
  cached = make();
  cachedKey = key;
  return cached;
}

export function resolveEmbeddings(): AiProvider | null {
  const cfg = getConfig();
  if (cfg.EMBEDDINGS_PROVIDER === 'openai' && cfg.OPENAI_API_KEY) return createOpenAiProvider(cfg.OPENAI_API_KEY, cfg.OPENAI_BASE_URL, cfg.EMBEDDINGS_MODEL);
  if (cfg.AI_PROVIDER === 'mock') return createMockProvider();
  return null;
}

export function defaultModelFor(provider: AiProvider['name']): string {
  const cfg = getConfig();
  if (provider === 'mock') return 'mock-model';
  if (MODEL_PRICES[cfg.AI_DEFAULT_MODEL]?.provider === provider) return cfg.AI_DEFAULT_MODEL;
  return modelsForProvider(provider)[0]?.id ?? cfg.AI_DEFAULT_MODEL;
}

export function providerStatus() {
  const cfg = getConfig();
  const status = aiProviderConfigured(cfg);
  const provider = status.configured ? resolveProvider() : null;
  return {
    configured: status.configured,
    provider: status.provider,
    reason: status.reason,
    isMock: provider?.isMock ?? false,
    defaultModel: provider ? defaultModelFor(provider.name) : null,
    models: provider ? modelsForProvider(provider.name).map((m) => ({ id: m.id, label: m.label, provider: m.provider })) : [],
    embeddings: resolveEmbeddings() !== null,
  };
}

export function resetProviderCacheForTests() {
  cached = null;
  cachedKey = '';
}
