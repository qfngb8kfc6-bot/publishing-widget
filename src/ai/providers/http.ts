import { AIProviderError } from '../provider';
import type { AIProvider, EnrichedIntent, ExplanationRequest, ProfessionalAIProvider, ProfessionalProfileEnhancementInput, ReportContentRequest, SemanticCandidate } from '../types';

export interface AIProxyClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class HttpAIProvider implements AIProvider, ProfessionalAIProvider {
  readonly providerName = 'server-ai-proxy';
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: AIProxyClientConfig, fetchImpl?: FetchLike) {
    const nativeFetch = globalThis.fetch;
    if (!fetchImpl && !nativeFetch) throw new Error('A fetch implementation is required for the AI proxy provider.');
    this.fetchImpl = fetchImpl ?? nativeFetch.bind(globalThis);
  }

  enhanceIntent(intent: Parameters<AIProvider['enhanceIntent']>[0]): Promise<unknown> { return this.call('enrich', { intent }); }
  enhanceProfessionalProfile(input: ProfessionalProfileEnhancementInput): Promise<unknown> { return this.call('profile', { input }); }
  rerank(intent: EnrichedIntent, candidates: SemanticCandidate[]): Promise<unknown> { return this.call('rerank', { intent, candidates }); }
  explainMany(requests: ExplanationRequest[]): Promise<unknown> { return this.call('explain', { requests }); }
  generateReportContent(input: ReportContentRequest): Promise<unknown> { return this.call('content', { input }); }
  async explain(article: ExplanationRequest['article'], intent: EnrichedIntent, relevance: ExplanationRequest['relevance']): Promise<string> {
    const result = await this.explainMany([{ article, intent, relevance, semanticSignals: [] }]);
    const first = Array.isArray(result) ? result[0] : null;
    return first && typeof first.explanation === 'string' ? first.explanation : 'This story connects with your answers.';
  }

  private async call(operation: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (response.status === 429) throw new AIProviderError('rate-limit');
      if (!response.ok) throw new AIProviderError('unavailable');
      try { return await response.json(); } catch { throw new AIProviderError('invalid-response'); }
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new AIProviderError('timeout');
      throw new AIProviderError('unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}
