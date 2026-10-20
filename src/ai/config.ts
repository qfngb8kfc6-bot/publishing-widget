import type { AIConfig } from './types';

export interface AIEnvironment {
  AI_ENABLED?: string;
  AI_PROVIDER?: AIConfig['provider'];
  AI_MODEL?: string;
  AI_API_KEY?: string;
  AI_ENDPOINT?: string;
  AI_RERANK_LIMIT?: string;
  AI_EXPLANATIONS_ENABLED?: string;
  AI_TIMEOUT_MS?: string;
  AI_MAX_TOKENS?: string;
  AI_PROFILE_MAX_TOKENS?: string;
  AI_RERANK_MAX_TOKENS?: string;
  AI_CONTENT_MAX_TOKENS?: string;
  AI_TEMPERATURE?: string;
  AI_REASONING_EFFORT?: string;
  AI_DETERMINISTIC_WEIGHT?: string;
  AI_SEMANTIC_WEIGHT?: string;
}

/** Optional AI stages must not hold a report open for an unbounded provider timeout. */
export const AI_OPERATION_TIMEOUT_CAP_MS = 5_000;

export const defaultAIConfig: AIConfig = {
  enabled: false,
  provider: 'none',
  model: 'configured-server-model',
  endpoint: '/api/ai',
  rerankLimit: 12,
  explanationsEnabled: true,
  timeoutMs: 4500,
  maxTokens: 900,
  deterministicWeight: 0.7,
  semanticWeight: 0.3,
};

export function createAIConfig(environment: AIEnvironment = {}): AIConfig {
  const numberOr = (value: string | undefined, fallback: number, min = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  };
  const enabled = environment.AI_ENABLED === 'true';
  const provider = environment.AI_PROVIDER ?? (enabled ? 'openai-compatible' : 'none');
  const deterministicWeight = numberOr(environment.AI_DETERMINISTIC_WEIGHT, defaultAIConfig.deterministicWeight);
  const semanticWeight = numberOr(environment.AI_SEMANTIC_WEIGHT, defaultAIConfig.semanticWeight);
  const total = deterministicWeight + semanticWeight || 1;
  return {
    ...defaultAIConfig,
    enabled,
    provider,
    model: environment.AI_MODEL ?? defaultAIConfig.model,
    apiKey: environment.AI_API_KEY,
    endpoint: environment.AI_ENDPOINT ?? defaultAIConfig.endpoint,
    rerankLimit: numberOr(environment.AI_RERANK_LIMIT, defaultAIConfig.rerankLimit, 1),
    explanationsEnabled: environment.AI_EXPLANATIONS_ENABLED !== 'false',
    timeoutMs: numberOr(environment.AI_TIMEOUT_MS, defaultAIConfig.timeoutMs, 1),
    maxTokens: numberOr(environment.AI_MAX_TOKENS, defaultAIConfig.maxTokens, 1),
    stageMaxTokens: {
      profile: optionalNumber(environment.AI_PROFILE_MAX_TOKENS, 1),
      rerank: optionalNumber(environment.AI_RERANK_MAX_TOKENS, 1),
      content: optionalNumber(environment.AI_CONTENT_MAX_TOKENS, 1),
    },
    temperature: optionalNumber(environment.AI_TEMPERATURE, 0, 2),
    reasoningEffort: reasoningEffort(environment.AI_REASONING_EFFORT),
    deterministicWeight: deterministicWeight / total,
    semanticWeight: semanticWeight / total,
  };
}

/** Unset, blank or out-of-range values mean "not configured", so the parameter is omitted from requests. */
function optionalNumber(value: string | undefined, min: number, max = Number.POSITIVE_INFINITY): number | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

/** Accepts a single lowercase word such as minimal, low, medium or high; anything else is ignored. */
function reasoningEffort(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-z]{1,16}$/.test(normalized) ? normalized : undefined;
}
