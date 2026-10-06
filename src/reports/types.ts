import type { ProfessionalProfile, RankedArticle } from '../core';

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
    aiProvider?: string;
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
  recommendations: ReportRecommendation[];
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

export interface GenerateReportInput {
  publisherId: string;
  companyUrl: string;
  jobTitle: string;
  sessionId?: string;
}
