import type { ProfessionalProfile, RankedArticle, RelevanceScoreComponents } from '../core';
import type { EditorialSection, EditorialSectionId } from './sections';

export interface ReportRecommendation {
  articleId: string;
  rank: number;
  rawScore: number;
  displayScore: number;
  explanation: string;
  article: RankedArticle['article'];
  rankingMetadata: {
    relevanceSignals: string[];
    rankingMode: 'deterministic' | 'hybrid';
    rankingVersion: string;
    deterministicScore?: number;
    semanticScore?: number;
    semanticSignals?: string[];
    relevanceType?: 'direct' | 'adjacent';
    confidence?: number;
    scoreComponents?: RelevanceScoreComponents;
    aiProvider?: string;
    /** Whether "why this matters" came from the AI content call or the deterministic template. */
    explanationSource?: 'ai' | 'deterministic';
    editorialSection?: EditorialSectionId;
  };
}

export interface ReportRecord {
  id: string;
  publisherId: string;
  sessionId: string;
  companyUrl: string;
  companyDomain: string;
  companyName?: string;
  jobTitle: string;
  professionalProfile: ProfessionalProfile;
  retrievalContext: ProfessionalProfile['retrieval'];
  overallMatchScore: number;
  generatedSummary: string;
  /** Absent on reports created before content provenance was recorded. */
  summarySource?: 'ai' | 'deterministic';
  /** Why the deterministic summary was used, e.g. timeout, truncated, empty_response, ai_unavailable. */
  summaryFallbackReason?: string;
  recommendations: ReportRecommendation[];
  sections?: EditorialSection[];
  generationVersion: string;
  rankingVersion: string;
  professionalProfileVersion: string;
  aiProviderVersion: string;
  publisherConfigVersion: string;
  widgetVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportStore {
  save(report: ReportRecord): Promise<void>;
  get(id: string, publisherId?: string): Promise<ReportRecord | null>;
}

export interface ReportPerformanceTiming {
  requestId?: string;
  publisherId: string;
  theme?: string;
  cacheHit: boolean;
  cacheAgeMs: number;
  catalogueItemCount: number;
  runtimeMs: number;
  companyResolutionMs: number;
  profileMs: number;
  aiProfileMs: number;
  catalogueCacheLookupMs: number;
  catalogueSnapshotLookupMs: number;
  catalogueRefreshMs: number;
  catalogueRefreshReason?: string;
  sourceFetchMs: number;
  sourceReadMs: number;
  sourceParseMs: number;
  normalizationMs: number;
  preselectionMs: number;
  deterministicRankingMs: number;
  aiRerankingMs: number;
  aiExplanationsMs: number;
  briefingSummaryMs: number;
  sectionAllocationMs: number;
  persistenceMs: number;
  totalMs: number;
  reportLookupMs?: number;
  exclusionMs?: number;
  companyContextMs?: number;
  analyticsMs?: number;
  catalogueSelectionMs?: number;
  catalogueStale?: boolean;
}

export interface GenerateReportInput {
  publisherId: string;
  companyUrl: string;
  jobTitle: string;
  sessionId?: string;
  requestId?: string;
  performance?: ReportPerformanceTiming;
}
