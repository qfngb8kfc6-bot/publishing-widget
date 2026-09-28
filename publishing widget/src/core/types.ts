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
}

export type ProgressStage = 'understanding' | 'searching' | 'comparing' | 'preparing';

export interface RelevanceResult {
  score: number;
  relevanceSignals: string[];
}

export interface RankedArticle extends RelevanceResult {
  article: NormalizedArticle;
  explanation: string;
}

export interface PublisherAdapter<RawArticle = unknown> {
  readonly publisherId: string;
  search(intent: Intent, options: SearchOptions): Promise<RawArticle[]>;
  getArticle?(id: string): Promise<RawArticle | null>;
  normalizeArticle(raw: RawArticle): NormalizedArticle;
}

export interface ExplanationProvider {
  explain(article: NormalizedArticle, intent: Intent, relevance: RelevanceResult): string;
}

export type AnalyticsEventName =
  | 'widget_opened'
  | 'question_answered'
  | 'search_started'
  | 'search_completed'
  | 'result_impression'
  | 'article_clicked'
  | 'restart_clicked';

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  publisherId: string;
  sessionId: string;
  timestamp: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AnalyticsClient {
  track(event: AnalyticsEvent): void | Promise<void>;
}
