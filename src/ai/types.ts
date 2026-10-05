import type { ExplanationProvider, Intent, NormalizedArticle, RelevanceResult } from '../core';

export interface AIConfig {
  enabled: boolean;
  provider: 'none' | 'mock' | 'http' | 'openai-compatible';
  model: string;
  apiKey?: string;
  endpoint: string;
  rerankLimit: number;
  explanationsEnabled: boolean;
  timeoutMs: number;
  maxTokens: number;
  deterministicWeight: number;
  semanticWeight: number;
}

export interface EnrichedIntent extends Intent {
  baseIntent: Intent;
  primaryThemes: string[];
  relatedThemes: string[];
  searchTerms: string[];
  entities: string[];
  excludedConcepts: string[];
  persona: string;
  industry?: string;
}

export interface SemanticCandidate {
  articleId: string;
  title: string;
  description?: string;
  categories: string[];
  tags: string[];
  contentSnippet?: string;
  deterministicScore: number;
}

export interface ExplanationRequest {
  article: Pick<NormalizedArticle, 'id' | 'title' | 'description' | 'categories' | 'tags' | 'contentSnippet'>;
  intent: EnrichedIntent;
  relevance: RelevanceResult;
  semanticSignals: string[];
}

export interface AIExplanationResult {
  articleId: string;
  explanation: string;
}

export interface IntentEnhancer {
  enhanceIntent(intent: Intent): Promise<unknown>;
}

export interface RerankingProvider {
  rerank(intent: EnrichedIntent, candidates: SemanticCandidate[]): Promise<unknown>;
}

export interface AIExplanationProvider extends ExplanationProvider {
  explainMany(requests: ExplanationRequest[]): Promise<unknown>;
}

export interface AIProvider extends IntentEnhancer, RerankingProvider, AIExplanationProvider {
  readonly providerName: string;
}

export interface AIRecommendationLayer {
  readonly config: AIConfig;
  readonly provider: AIProvider;
}
