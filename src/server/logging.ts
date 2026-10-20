export interface ServerLogFields {
  requestId?: string;
  publisherId?: string;
  route?: string;
  operation?: string;
  durationMs?: number;
  status?: number;
  errorType?: string;
  errorCode?: string;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  stage?: string;
  sitemapDocumentsFetched?: number;
  sitemapUrlsFound?: number;
  articleUrlsAccepted?: number;
  articleUrlsSelected?: number;
  articlePagesFetched?: number;
  normalizedArticles?: number;
  normalizedArticleCount?: number;
  preselectionInputCount?: number;
  preselectionOutputCount?: number;
  preselectionCount?: number;
  retrievalCandidates?: number;
  rankingCandidateCount?: number;
  deterministicEligible?: number;
  finalRecommendationCount?: number;
  aiRerankSurvivors?: number;
  finalRecommendations?: number;
  catalogueCount?: number;
  excludedExistingCount?: number;
  eligibleCount?: number;
  excludedCurrentReportCount?: number;
  deterministicEligibleCount?: number;
  aiEligibleCount?: number;
  finalResultCount?: number;
  rawCandidateCount?: number;
  normalizedCandidateCount?: number;
  excludedArticleCount?: number;
  uniqueCandidateCount?: number;
  thresholdInputCount?: number;
  aiInputCount?: number;
  aiFilteredCount?: number;
  theme?: string;
  registryMode?: string;
  sourceType?: string;
  sourceConfigured?: boolean;
  adapterResolved?: boolean;
  failureStage?: string;
  runtimeSource?: string;
  feedUrlPresent?: boolean;
  maxBytes?: number;
  candidateLimit?: number;
  runtimeCacheHit?: boolean;
  runtimeVersion?: number;
  configVersion?: string;
  companyInputType?: 'domain' | 'company_name';
  companyResolutionAttempted?: boolean;
  companyResolutionSucceeded?: boolean;
  resolvedHostnamePresent?: boolean;
  resolutionMethod?: string;
  contentLength?: number;
  maxResponseBytes?: number;
  companyResolutionMs?: number;
  professionalProfileMs?: number;
  sourceFetchMs?: number;
  sourceParseMs?: number;
  normalizationMs?: number;
  cataloguePreparationMs?: number;
  currentReportExclusionMs?: number;
  preselectionMs?: number;
  deterministicRankingMs?: number;
  aiRerankMs?: number;
  aiExplanationMs?: number;
  sectionAllocationMs?: number;
  finalFormattingMs?: number;
  persistenceMs?: number;
  totalGenerationMs?: number;
  sourceRefreshMs?: number;
  totalThemeSearchMs?: number;
  catalogueItemCount?: number;
  candidateCount?: number;
  catalogueCacheHit?: boolean;
  catalogueCacheAgeMs?: number;
  catalogueRefreshMs?: number;
  catalogueRefreshReason?: string;
  cacheHit?: boolean;
  cacheAgeMs?: number;
  runtimeMs?: number;
  profileMs?: number;
  catalogueCacheLookupMs?: number;
  catalogueSnapshotLookupMs?: number;
  sourceReadMs?: number;
  aiRerankingMs?: number;
  aiExplanationsMs?: number;
  briefingSummaryMs?: number;
  exclusionMs?: number;
  reportLookupMs?: number;
  totalMs?: number;
  catalogueStale?: boolean;
  aiOperation?: string;
  aiModel?: string;
  aiRequestStart?: string;
  aiDurationMs?: number;
  aiTimeoutMs?: number;
  aiSuccess?: boolean;
  aiRetryCount?: number;
  aiFallbackUsed?: boolean;
  aiErrorCode?: string;
  /** Sanitized provider or validation error, at most 300 characters. */
  aiErrorMessage?: string;
  /** Article the rejected AI explanation was for (an ID, never explanation text). */
  articleId?: string;
  rejectReason?: string;
  /** Comma-separated field names present on the rejected item or response. */
  presentFields?: string;
  aiHttpStatus?: number;
  aiFinishReason?: string;
  aiPromptTokens?: number;
  aiCompletionTokens?: number;
  aiReasoningTokens?: number;
}

export interface StructuredLogger { info(message: string, fields?: ServerLogFields): void; error(message: string, fields?: ServerLogFields): void; }

/** Keep diagnostics useful without allowing exception text to become a secret sink. */
export function safeLogText(value: unknown, limit = 4_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .replace(/bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|cookie|set-cookie)(\s*[:=]\s*)(["']?)([^,\s"']+)\3/gi, '$1$2[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, limit);
}

export function createStructuredLogger(environment: 'development' | 'test' | 'production' = 'production'): StructuredLogger {
  const write = (level: 'info' | 'error', message: string, fields: ServerLogFields = {}) => {
    const payload = { timestamp: new Date().toISOString(), level, message, ...fields };
    const safeProductionDiagnostic = ['ai_performance', 'ai_explanation_rejected', 'report_performance', 'theme_performance', 'slow_span'].includes(message);
    if (level === 'error' || environment !== 'production' || safeProductionDiagnostic) console[level]('[publisher-widget]', JSON.stringify(payload));
  };
  return { info: (message, fields) => write('info', message, fields), error: (message, fields) => write('error', message, fields) };
}

export function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
