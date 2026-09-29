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
  AI_DETERMINISTIC_WEIGHT?: string;
  AI_SEMANTIC_WEIGHT?: string;
}

export const defaultAIConfig: AIConfig = {
  enabled: false,
  provider: 'none',
  model: 'configured-server-model',
  endpoint: '/api/ai',
  rerankLimit: 12,
  explanationsEnabled: true,
  timeoutMs: 4500,
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
    deterministicWeight: deterministicWeight / total,
    semanticWeight: semanticWeight / total,
  };
}
