export interface ServerLogFields {
  requestId?: string;
  publisherId?: string;
  route?: string;
  operation?: string;
  durationMs?: number;
  status?: number;
  errorType?: string;
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
  theme?: string;
  registryMode?: string;
  sourceType?: string;
  sourceConfigured?: boolean;
  adapterResolved?: boolean;
  failureStage?: string;
  contentLength?: number;
  maxResponseBytes?: number;
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
    if (level === 'error' || environment !== 'production') console[level]('[publisher-widget]', JSON.stringify(payload));
  };
  return { info: (message, fields) => write('info', message, fields), error: (message, fields) => write('error', message, fields) };
}

export function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
