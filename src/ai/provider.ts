export type AIProviderErrorCode = 'unavailable' | 'timeout' | 'invalid-response' | 'rate-limit' | 'truncated' | 'empty_response';

/** Safe per-call provider facts for logs: never prompts, headers or credentials. */
export interface AIResponseDiagnostics {
  httpStatus?: number;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
}

export class AIProviderError extends Error {
  constructor(readonly code: AIProviderErrorCode, message: string = code, readonly diagnostics: AIResponseDiagnostics = {}) {
    super(message);
    this.name = 'AIProviderError';
  }
}

const responseDiagnostics = new WeakMap<object, AIResponseDiagnostics>();

/** Associates diagnostics with a parsed provider response without changing the provider method signatures. */
export function attachAIResponseDiagnostics<T>(value: T, diagnostics: AIResponseDiagnostics): T {
  if (value && typeof value === 'object') responseDiagnostics.set(value as object, diagnostics);
  return value;
}

export function aiResponseDiagnostics(value: unknown): AIResponseDiagnostics | undefined {
  return value && typeof value === 'object' ? responseDiagnostics.get(value as object) : undefined;
}
