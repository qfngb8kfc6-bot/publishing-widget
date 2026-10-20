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
  /** Per-stage completion budgets; each falls back to maxTokens. */
  stageMaxTokens?: AIStageMaxTokens;
  /** Sent only when configured: some reasoning models reject a non-default temperature. */
  temperature?: number;
  /** Sent as reasoning_effort only when configured. */
  reasoningEffort?: string;
  deterministicWeight: number;
  semanticWeight: number;
}

export interface AIStageMaxTokens {
  profile?: number;
  rerank?: number;
  content?: number;
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
  deterministicRelevanceType?: 'direct' | 'adjacent';
  relevanceSignals?: string[];
  publishedAt?: string;
  category?: string;
  /** Profile concepts the deterministic scorer matched in this article. */
  matchedConcepts?: string[];
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
  /** Two or three words naming why it matters, e.g. "supplier risk" or "competitor benchmark". */
  angle?: string;
}

/** How an article relates to the reader's company, derived deterministically from profile and company data. */
export type ArticleRelationship = 'own_company' | 'likely_competitor' | 'supplier_partner' | 'wider_market';

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
  /** false for an explanations-only part of a split content request (no summary is written). Default true. */
  includeSummary?: boolean;
  profile: ProfessionalProfile;
  recommendations: Array<{
    article: Pick<NormalizedArticle, 'id' | 'title' | 'description' | 'categories' | 'tags' | 'contentSnippet' | 'publishedAt' | 'publisherId'> & Partial<Pick<NormalizedArticle, 'category' | 'summary'>>;
    deterministicExplanation: string;
    relevanceSignals: string[];
    semanticSignals: string[];
    /** Profile concepts the deterministic scorer matched in this article. */
    matchedConcepts?: string[];
    /** Final relevance score used for ranking. */
    score?: number;
    relationship?: ArticleRelationship;
  }>;
}

export interface AIReportContent {
  summary?: string;
  /** Supplied article IDs the summary draws on. */
  citedArticleIds?: string[];
  /** Articles the model marked fit:"weak" instead of explaining. */
  weakArticleIds?: string[];
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
