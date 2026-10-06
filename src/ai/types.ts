import type { CompanyContext, ExplanationProvider, Intent, NormalizedArticle, ProfessionalProfile, RelevanceResult, RoleContext } from '../core';

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

/** Compatibility retrieval shape for the optional AI reranker; not the persisted professional profile. */
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

export interface ProfessionalProfileEnhancementInput {
  publisherId: string;
  submittedCompanyUrl: string;
  submittedJobTitle: string;
  company: CompanyContext;
  role: RoleContext;
  profile: ProfessionalProfile;
}

export interface AIProfessionalProfileEnhancement {
  company?: {
    industry?: string;
    description?: string;
    activities?: string[];
    productsServices?: string[];
    technologies?: string[];
    markets?: string[];
    themes?: string[];
  };
  person?: {
    function?: string;
    seniority?: string;
    responsibilities?: string[];
    decisionAreas?: string[];
    technologies?: string[];
    themes?: string[];
  };
  professionalInterests?: string[];
  likelyInformationNeeds?: string[];
  relevantEntities?: string[];
  searchTerms?: string[];
  semanticQueries?: string[];
  excludedConcepts?: string[];
}

export interface ReportContentRequest {
  publisherId: string;
  profile: ProfessionalProfile;
  recommendations: Array<{
    article: Pick<NormalizedArticle, 'id' | 'title' | 'description' | 'categories' | 'tags' | 'contentSnippet' | 'publishedAt' | 'publisherId'>;
    deterministicExplanation: string;
    relevanceSignals: string[];
    semanticSignals: string[];
  }>;
}

export interface AIReportContent {
  summary?: string;
  explanations?: AIExplanationResult[];
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

export interface ProfessionalAIProvider extends AIProvider {
  enhanceProfessionalProfile(input: ProfessionalProfileEnhancementInput): Promise<unknown>;
  generateReportContent(input: ReportContentRequest): Promise<unknown>;
}

export interface AIRecommendationLayer {
  readonly config: AIConfig;
  readonly provider: AIProvider;
}
