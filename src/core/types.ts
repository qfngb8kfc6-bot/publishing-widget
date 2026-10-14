export type QuestionType = 'single-select' | 'multi-select' | 'free-text';
export type AnswerValue = string | string[];

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionConfig {
  id: string;
  question: string;
  supportingText?: string;
  type: QuestionType;
  placeholder?: string;
  options?: QuestionOption[];
  required?: boolean;
}

export interface BrandingConfig {
  logo?: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily?: string;
  widgetTitle: string;
  introductoryCopy: string;
  radiusPreference?: 'soft' | 'round' | 'sharp';
  backgroundTreatment?: 'plain' | 'tinted' | 'glass';
}

export interface PublisherConfig {
  publisherId: string;
  publisherName: string;
  branding: BrandingConfig;
  /** Legacy questionnaire schema retained only for existing adapter/config consumers. */
  questions?: QuestionConfig[];
  content: {
    adapterType: string;
    resultLimit: number;
    candidateRetrievalLimit: number;
  };
  results: {
    heading: string;
    description?: string;
    maximumRecommendations: number;
    openArticleInNewTab?: boolean;
  };
}

export interface NormalizedArticle {
  id: string;
  /** Publisher-provided identifier when one exists. */
  externalId?: string;
  title: string;
  description?: string;
  url: string;
  canonicalUrl?: string;
  imageUrl?: string;
  publishedAt?: string;
  updatedAt?: string;
  author?: string;
  category?: string;
  categories: string[];
  tags: string[];
  excerpt?: string;
  contentSnippet?: string;
  body?: string;
  summary?: string;
  language?: string;
  sourceType?: string;
  sourceName?: string;
  searchText?: string;
  contentType?: string;
  metadata?: Record<string, string | number | boolean>;
  sourceMetadata?: Record<string, string | number | boolean>;
  publisherId: string;
  audiences?: string[];
  provenance?: ArticleProvenance;
}

/** Canonical name for articles entering the retrieval pipeline. */
export type PublisherArticle = NormalizedArticle;

export interface ArticleProvenance {
  publisherId: string;
  sourceArticleId: string;
  sourceUrl: string;
  retrievalSource: string;
  sourceType?: string;
  endpoint?: string;
  originalUrl?: string;
  ingestedAt?: string;
  normalizerVersion?: string;
}

export interface Intent {
  publisherId: string;
  answers: Record<string, AnswerValue>;
  queryText: string;
  keywords: string[];
  interests: string[];
  personas: string[];
  /** Optional professional signals used by archive-aware publisher retrieval. */
  directInterests?: string[];
  adjacentInterests?: string[];
  excludedConcepts?: string[];
}

export interface SearchOptions {
  limit: number;
  /** Ask archive-capable adapters to preselect across their complete normalized archive. */
  archiveWide?: boolean;
  onProgress?: (stage: ProgressStage) => void;
  onDebug?: DebugSink;
}

export type ProgressStage = 'understanding' | 'searching' | 'comparing' | 'preparing';

export interface RelevanceResult {
  score: number;
  relevanceSignals: string[];
  scoreComponents?: RelevanceScoreComponents;
  relevanceType?: 'direct' | 'adjacent' | 'weak' | 'none';
  confidence?: number;
  directMatches?: string[];
  adjacentMatches?: string[];
  negativeMatches?: string[];
}

export interface RelevanceScoreComponents {
  direct: number;
  adjacent: number;
  role: number;
  company: number;
  freshness: number;
  negative: number;
  recencyMultiplier?: number;
  raw: number;
  calibrated: number;
}

export interface RankedArticle extends RelevanceResult {
  article: NormalizedArticle;
  explanation: string;
  semanticScore?: number;
  semanticSignals?: string[];
  finalScore?: number;
  rankingMode?: 'deterministic' | 'hybrid';
  explanationProvider?: string;
}

export type MaybePromise<T> = T | Promise<T>;

export interface PublisherAdapter<RawArticle = unknown> {
  readonly publisherId: string;
  search(intent: Intent, options: SearchOptions): Promise<RawArticle[]>;
  getArticle?(id: string): Promise<RawArticle | null>;
  normalizeArticle(raw: RawArticle): NormalizedArticle | null;
}

export interface PublisherContentAdapter<RawArticle = unknown> extends PublisherAdapter<RawArticle> {
  readonly sourceType: string;
  readonly supportsPagination: boolean;
  fetch(intent: Intent, options: SearchOptions): Promise<RawArticle[]>;
  healthCheck?(): Promise<ContentSourceHealth>;
}

export interface ContentSourceHealth {
  publisherId: string;
  sourceType: string;
  reachable: boolean;
  recordsChecked: number;
  normalized: number;
  warnings: string[];
}

export type DebugEvent =
  | { type: 'intent'; publisherId: string; intent: Intent }
  | { type: 'publisher_search_request'; publisherId: string; url: string; method: string; query: Record<string, string | number> }
  | { type: 'candidate_retrieval'; publisherId: string; count: number }
  | { type: 'content_source'; publisherId: string; sourceType: string; durationMs: number; pagesFetched: number; rawCount: number; normalizedCount: number; rejectedCount: number; duplicateCount: number }
  | { type: 'normalized_articles'; publisherId: string; articles: Array<Pick<NormalizedArticle, 'id' | 'url' | 'title' | 'publisherId'>> }
  | { type: 'ranked_results'; publisherId: string; results: Array<{ id: string; score: number; relevanceSignals: string[] }> }
  | { type: 'enriched_intent'; publisherId: string; intent: unknown }
  | { type: 'semantic_rerank'; publisherId: string; results: Array<{ id: string; deterministicScore: number; semanticScore: number; combinedScore: number; signals: string[] }> }
  | { type: 'explanation_provider'; publisherId: string; provider: string; used: boolean }
  | { type: 'ai_fallback'; publisherId: string; stage: 'intent' | 'rerank' | 'explanation'; reason: string };

export type DebugSink = (event: DebugEvent) => void;

export interface ExplanationProvider {
  readonly providerName?: string;
  explain(article: NormalizedArticle, intent: Intent, relevance: RelevanceResult): MaybePromise<string>;
}

export type AnalyticsEventName =
  | 'widget_impression'
  | 'widget_opened'
  | 'intro_viewed'
  | 'question_answered'
  | 'search_started'
  | 'search_completed'
  | 'result_impression'
  | 'article_clicked'
  | 'change_answers'
  | 'restart_clicked'
  | 'widget_closed'
  | 'search_failed'
  | 'company_entered'
  | 'role_entered'
  | 'report_requested'
  | 'generation_started'
  | 'company_analysis_started'
  | 'company_analysis_completed'
  | 'role_analysis_completed'
  | 'profile_generated'
  | 'retrieval_started'
  | 'retrieval_completed'
  | 'ranking_completed'
  | 'report_generated'
  | 'report_viewed'
  | 'story_impression'
  | 'story_clicked'
  | 'profile_edit_clicked'
  | 'report_shared'
  | 'report_saved'
  | 'cta_clicked'
  | 'theme_find_stories_clicked'
  | 'theme_results_loaded'
  | 'theme_story_clicked';

export type AnalyticsMetadataValue = string | number | boolean;
export type AnalyticsMetadata = Record<string, AnalyticsMetadataValue>;

export interface AnalyticsEvent {
  eventId?: string;
  schemaVersion?: string;
  name: AnalyticsEventName;
  publisherId: string;
  sessionId: string;
  timestamp: string;
  widgetVersion?: string;
  publisherConfigVersion?: string;
  metadata?: AnalyticsMetadata;
}

export interface AnalyticsClient {
  track(event: AnalyticsEvent): void | Promise<void>;
  flush?(preferBeacon?: boolean): void | Promise<void>;
}
