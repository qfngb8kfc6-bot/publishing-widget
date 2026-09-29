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
  launcherText: string;
  widgetTitle: string;
  introductoryCopy: string;
  radiusPreference?: 'soft' | 'round' | 'sharp';
  backgroundTreatment?: 'plain' | 'tinted' | 'glass';
}

export interface PublisherConfig {
  publisherId: string;
  publisherName: string;
  branding: BrandingConfig;
  questions: QuestionConfig[];
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
  title: string;
  description?: string;
  url: string;
  imageUrl?: string;
  publishedAt?: string;
  author?: string;
  categories: string[];
  tags: string[];
  contentSnippet?: string;
  publisherId: string;
  audiences?: string[];
  provenance?: ArticleProvenance;
}

export interface ArticleProvenance {
  publisherId: string;
  sourceArticleId: string;
  sourceUrl: string;
  retrievalSource: string;
}

export interface Intent {
  publisherId: string;
  answers: Record<string, AnswerValue>;
  queryText: string;
  keywords: string[];
  interests: string[];
  personas: string[];
}

export interface SearchOptions {
  limit: number;
  onProgress?: (stage: ProgressStage) => void;
  onDebug?: DebugSink;
}

export type ProgressStage = 'understanding' | 'searching' | 'comparing' | 'preparing';

export interface RelevanceResult {
  score: number;
  relevanceSignals: string[];
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

export type DebugEvent =
  | { type: 'intent'; publisherId: string; intent: Intent }
  | { type: 'publisher_search_request'; publisherId: string; url: string; method: string; query: Record<string, string | number> }
  | { type: 'candidate_retrieval'; publisherId: string; count: number }
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
  | 'search_failed';

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
