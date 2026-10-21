import { calibrateRelevanceScore, combineHybridScore, buildProfessionalProfile, createEvent, createProfessionalScorer, roleSubjectLabel, roleSubjectTerms, subjectMatcher, mapInSlices, displayRelevanceScore, passesRelevanceThreshold, RANKING_VERSION, scoreProfessionalArticle, type Intent, type NormalizedArticle, type PublisherRegistry, type RelevanceResult, type RelevanceScoreComponents } from '../core';
import { aiResponseDiagnostics, AIProviderError, type AIResponseDiagnostics } from '../ai/provider';
import { AI_OPERATION_TIMEOUT_CAP_MS } from '../ai/config';
import { mergeProfessionalProfileEnhancement, validateProfessionalProfileEnhancement, validateReportContent, validateSubjectVocabulary, validateSemanticResults, type ExplanationRejection, type ExplanationShapeIssue } from '../ai/validation';
import type { AIRecommendationLayer, EnrichedIntent, ProfessionalAIProvider, ReportContentRequest, SemanticCandidate } from '../ai/types';
import { BoundedCompanyInputResolver, classifyCompanyInput, type CompanyContextProvider, type CompanyInputResolver, type ResolvedCompanyInput } from '../server/company';
import { WIDGET_VERSION } from '../version';
import type { ReportRecord, ReportRecommendation, GenerateReportInput, ReportPerformanceTiming } from './types';
import type { ReportStore } from './types';
import type { StoredAnalyticsEvent } from '../analytics/types';
import type { AnalyticsStore } from '../analytics/types';
import { MAX_SHOWN_THEME_ARTICLE_IDS, profileForTheme, selectReportThemes } from './themes';
import type { ServerLogFields, StructuredLogger } from '../server/logging';
import { safeLogText } from '../server/logging';
import { allocateEditorialSections, articleIdentityKeys } from './sections';
import { articleRelationship, limitOwnCompanyShare } from './relationship';
import { explanationQualityWarnings, summaryQualityWarnings, type ContentQualityCode } from '../ai/content-quality';
import { angleForArticle, normalizeAngle } from '../ai/angles';
import { articleTiming } from '../ai/providers/openai-compatible';
import { PublisherCatalogueCache, type CatalogueArticleIndex, type CatalogueCacheDiagnostics } from './catalogue-cache';

export const GENERATION_VERSION = '1.2';

function clockMs(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

/** Any single generation span above this is logged individually so untimed stalls are visible in production. */
const SLOW_SPAN_MS = 1_000;

/** Recommendations explained by content call A (which also writes the summary); the rest go to call B. */
const CONTENT_PART_A_SIZE = 7;
const ENRICHED_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

interface EnrichmentParts { main?: unknown; vocabulary?: string[] }
interface EnrichmentResult { profile?: ReturnType<typeof buildProfessionalProfile>; complete: boolean; needsVocabulary: boolean; parts: EnrichmentParts }

/** Bound on queued background analytics writes so an unavailable store cannot grow memory without limit. */
const MAX_PENDING_ANALYTICS_WRITES = 500;

function cacheSafeSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cacheSafeSource);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'headers').sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, cacheSafeSource(item)]));
}

function catalogueCacheKey(definition: NonNullable<ReturnType<PublisherRegistry['get']>>, runtimeDiagnostics?: Partial<ServerLogFields>): string | undefined {
  const source = definition.manifest?.contentSource;
  if (!source) return undefined;
  return JSON.stringify({ runtimeVersion: runtimeDiagnostics?.runtimeVersion ?? 0, configVersion: definition.manifest?.publisherConfigVersion ?? 'legacy', source: cacheSafeSource(source) });
}

function createPerformanceTiming(publisherId: string, requestId?: string): ReportPerformanceTiming {
  return { requestId, publisherId, cacheHit: false, cacheAgeMs: 0, catalogueItemCount: 0, runtimeMs: 0, companyResolutionMs: 0, profileMs: 0, aiProfileMs: 0, catalogueCacheLookupMs: 0, catalogueSnapshotLookupMs: 0, catalogueRefreshMs: 0, sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, preselectionMs: 0, deterministicRankingMs: 0, aiRerankingMs: 0, aiExplanationsMs: 0, briefingSummaryMs: 0, sectionAllocationMs: 0, persistenceMs: 0, totalMs: 0 };
}

function reportId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `report_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function sessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new AIProviderError('timeout')), timeoutMs); }),
  ]).finally(() => { if (timeoutId) clearTimeout(timeoutId); });
}

function isProfessionalAIProvider(provider: AIRecommendationLayer['provider']): provider is ProfessionalAIProvider {
  return typeof (provider as Partial<ProfessionalAIProvider>).enhanceProfessionalProfile === 'function'
    && typeof (provider as Partial<ProfessionalAIProvider>).generateReportContent === 'function';
}

function createIntent(profile: ReturnType<typeof buildProfessionalProfile>, publisherId: string): Intent {
  const answers = { companyUrl: profile.companyUrl, companyDomain: profile.companyDomain, companyName: profile.companyName ?? profile.company.name ?? '', jobTitle: profile.jobTitle };
  const subjectTerms = roleSubjectTerms(profile.role);
  const onSubject = subjectMatcher(profile.role);
  if (subjectTerms && onSubject) {
    // A generic titled role preselects on its subject: subject concepts at full weight, everything else
    // (leadership themes, company activities, generic AI search terms) at adjacent weight only.
    const subjectInterests = [...new Set([...subjectTerms, ...profile.directInterests.filter(onSubject)])];
    return {
      publisherId,
      answers,
      queryText: profile.semanticQueries.join(' '),
      keywords: profile.searchTerms.filter(onSubject),
      interests: subjectInterests,
      personas: [roleSubjectLabel(profile.role)!],
      directInterests: subjectInterests,
      adjacentInterests: [...new Set([...profile.adjacentInterests, ...profile.professionalInterests.filter((value) => !onSubject(value))])],
      excludedConcepts: profile.excludedConcepts,
    };
  }
  return {
    publisherId,
    answers,
    queryText: profile.semanticQueries.join(' '),
    keywords: profile.searchTerms,
    interests: profile.professionalInterests,
    personas: [profile.role.function, ...profile.role.professionalThemes],
    directInterests: profile.directInterests,
    adjacentInterests: profile.adjacentInterests,
    excludedConcepts: profile.excludedConcepts,
  };
}

function createEnrichedIntent(profile: ReturnType<typeof buildProfessionalProfile>, publisherId: string): EnrichedIntent {
  const baseIntent = createIntent(profile, publisherId);
  const subjectTerms = roleSubjectTerms(profile.role);
  return {
    ...baseIntent,
    baseIntent,
    primaryThemes: (subjectTerms ? baseIntent.directInterests ?? [] : profile.professionalInterests).slice(0, 24),
    relatedThemes: (subjectTerms ? baseIntent.adjacentInterests ?? [] : profile.retrieval.topicConcepts).slice(0, 32),
    searchTerms: baseIntent.keywords.slice(0, 48),
    entities: profile.entities.slice(0, 24),
    excludedConcepts: profile.excludedConcepts.slice(0, 24),
    persona: roleSubjectLabel(profile.role) ?? profile.role.function,
    industry: profile.company.industry,
    ...(subjectTerms ? { subject: roleSubjectLabel(profile.role), subjectTerms: subjectTerms.slice(0, 24) } : {}),
  };
}

/**
 * A neutral, factual line for a theme result: the first sentence of the article's own description, without
 * restating the reader's role. Used until theme results get AI explanations.
 */
export function factualLine(article: Pick<NormalizedArticle, 'title' | 'description' | 'summary' | 'contentSnippet'>): string {
  const text = (article.description ?? article.summary ?? article.contentSnippet ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return article.title;
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  if (sentence.length <= 220) return sentence;
  const clipped = sentence.slice(0, 220);
  return `${clipped.slice(0, Math.max(clipped.lastIndexOf(' '), 160)).trim()}…`;
}

function explanation(profile: ReturnType<typeof buildProfessionalProfile>, relevance: Pick<RelevanceResult, 'relevanceSignals' | 'relevanceType' | 'directMatches' | 'adjacentMatches'>): string {
  const matches = relevance.relevanceType === 'direct' ? relevance.directMatches : relevance.adjacentMatches;
  if (matches?.length) {
    const lead = relevance.relevanceType === 'direct' ? 'Directly matches' : 'Connects with adjacent themes';
    return `${lead} ${matches.slice(0, 2).join(' and ')}, relevant to your work as ${profile.role.rawTitle} at ${profile.companyName ?? profile.companyDomain}.`;
  }
  const relevanceSignals = relevance.relevanceSignals;
  const signal = relevanceSignals[0] ?? 'comes from the publisher’s coverage';
  return `${signal.charAt(0).toUpperCase()}${signal.slice(1)}, with a focus on developments relevant to ${profile.role.rawTitle} at ${profile.companyName ?? profile.companyDomain}.`;
}

function reportSummary(profile: ReturnType<typeof buildProfessionalProfile>, selectedCount: number): string {
  const focus = profile.directInterests.slice(0, 4).join(', ') || profile.professionalInterests.slice(0, 4).join(', ');
  return `Based on your role in ${profile.role.rawTitle} at ${profile.companyName ?? profile.companyDomain}, this briefing focuses on ${focus} and includes ${selectedCount} selected ${selectedCount === 1 ? 'story' : 'stories'} with a clear connection to your work.`;
}

type GenerationFailure = Error & { generationStage?: string };

function annotateGenerationFailure(error: unknown, stage: string): void {
  if (error instanceof Error && !(error as GenerationFailure).generationStage) (error as GenerationFailure).generationStage = stage;
}

interface RankedCandidate {
  article: NormalizedArticle;
  relevanceSignals: string[];
  deterministicScore: number;
  semanticScore?: number;
  semanticSignals: string[];
  finalScore: number;
  rankingMode: 'deterministic' | 'hybrid';
  relevanceType: 'direct' | 'adjacent';
  confidence?: number;
  directMatches: string[];
  adjacentMatches: string[];
  scoreComponents?: RelevanceScoreComponents;
  /** The AI reranker flagged this article as not genuinely helping the reader. */
  weakFit?: boolean;
}

/** Fewest recommendations a report keeps; below this, weak-fit articles stay but are marked lower confidence. */
const MIN_REPORT_RECOMMENDATIONS = 3;

/**
 * Removes weak-fit articles (quality over quantity). If that would leave fewer than the minimum, the strongest
 * weak articles stay in rank order and are returned as lower confidence.
 */
function removeWeakFits(ranked: RankedCandidate[], weakIds: ReadonlySet<string>): { kept: RankedCandidate[]; removed: RankedCandidate[]; lowerConfidenceIds: Set<string> } {
  const strong = ranked.filter((item) => !weakIds.has(item.article.id));
  const weak = ranked.filter((item) => weakIds.has(item.article.id));
  const retainedWeak = weak.slice(0, Math.max(0, MIN_REPORT_RECOMMENDATIONS - strong.length));
  const retained = new Set([...strong, ...retainedWeak]);
  return { kept: ranked.filter((item) => retained.has(item)), removed: weak.filter((item) => !retained.has(item)), lowerConfidenceIds: new Set(retainedWeak.map((item) => item.article.id)) };
}

/** Outcome of an optional AI stage: a validated value, or the reason it fell back. */
interface AIOutcome<T> {
  value?: T;
  errorCode?: string;
}

type ObserveAIResponse = <R>(raw: R) => R;

function aiDiagnosticFields(diagnostics: AIResponseDiagnostics | undefined): Partial<ServerLogFields> {
  if (!diagnostics) return {};
  return { aiHttpStatus: diagnostics.httpStatus, aiFinishReason: diagnostics.finishReason, aiPromptTokens: diagnostics.promptTokens, aiCompletionTokens: diagnostics.completionTokens, aiReasoningTokens: diagnostics.reasoningTokens };
}

interface CachedEnrichedProfile {
  expiresAt: number;
  profile: ReturnType<typeof buildProfessionalProfile>;
}

export class ReportGenerationService {
  private readonly companyResolver: CompanyInputResolver;
  private readonly enrichedProfileCache = new Map<string, CachedEnrichedProfile>();
  private analyticsQueue: Promise<void> = Promise.resolve();
  private pendingAnalyticsWrites = 0;
  private readonly enrichedProfileInFlight = new Map<string, Promise<ReturnType<typeof buildProfessionalProfile> | undefined>>();
  private readonly enrichmentRetries = new Map<string, Promise<ReturnType<typeof buildProfessionalProfile> | undefined>>();

  constructor(private readonly registry: PublisherRegistry, private readonly companyProvider: CompanyContextProvider, private readonly reports: ReportStore, private readonly analytics?: AnalyticsStore, private readonly ai?: AIRecommendationLayer, private readonly logger?: StructuredLogger, private readonly runtimeDiagnostics?: (publisherId: string) => Partial<ServerLogFields>, companyResolver?: CompanyInputResolver, private readonly catalogueCache = new PublisherCatalogueCache()) {
    this.companyResolver = companyResolver ?? new BoundedCompanyInputResolver();
  }

  private logIbi(input: Pick<GenerateReportInput, 'publisherId' | 'requestId'>, message: string, fields: Parameters<StructuredLogger['info']>[1] = {}): void {
    if (input.publisherId !== 'ibi' || !this.logger) return;
    this.logger.info(message, { requestId: input.requestId, publisherId: input.publisherId, ...fields });
  }

  private logIbiError(input: Pick<GenerateReportInput, 'publisherId' | 'requestId'>, stage: string, error: unknown, diagnostics: Partial<ServerLogFields> = {}): void {
    if (!this.logger) return;
    const fields: ServerLogFields = {
      ...this.runtimeDiagnostics?.(input.publisherId),
      ...diagnostics,
      requestId: input.requestId,
      publisherId: input.publisherId,
      stage,
      failureStage: stage,
      errorCode: safeLogText(error instanceof Error ? error.message : undefined, 160),
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: safeLogText(error instanceof Error ? error.message : 'Unknown generation failure'),
    };
    this.logger.error('generation_failed', fields);
    if (input.publisherId === 'ibi') this.logger.error('ibi_generation_failed', fields);
  }

  private markStage(input: Pick<GenerateReportInput, 'publisherId' | 'requestId'>, stage: string): void {
    this.logger?.info('generation_stage', { requestId: input.requestId, publisherId: input.publisherId, stage });
  }

  /**
   * Queues an analytics write without blocking generation. Writes run one at a time in event
   * order on a single connection; failures are logged and never reach the request.
   */
  private track(name: Parameters<typeof createEvent>[0], publisherId: string, sessionId: string, metadata?: Record<string, string | number | boolean>, requestId?: string): void {
    const analytics = this.analytics;
    if (!analytics) return;
    if (this.pendingAnalyticsWrites >= MAX_PENDING_ANALYTICS_WRITES) {
      this.logger?.error('analytics_write_dropped', { requestId, publisherId, operation: name });
      return;
    }
    const event = createEvent(name, publisherId, sessionId, metadata);
    const stored = { ...event, eventId: event.eventId!, schemaVersion: event.schemaVersion!, receivedAt: new Date().toISOString() } as StoredAnalyticsEvent;
    this.pendingAnalyticsWrites += 1;
    this.analyticsQueue = this.analyticsQueue
      .then(async () => {
        const startedAt = clockMs();
        await analytics.append([stored]);
        this.noteSpan({ requestId, publisherId }, `analytics-write:${name}`, clockMs() - startedAt);
      })
      .catch((error: unknown) => {
        this.logger?.error('analytics_write_failed', { requestId, publisherId, operation: name, errorName: error instanceof Error ? error.name : 'unknown', errorMessage: safeLogText(error instanceof Error ? error.message : 'Analytics write failed.', 240) });
      })
      .finally(() => { this.pendingAnalyticsWrites -= 1; });
  }

  /** Resolves once every queued analytics write has settled (used by tests and shutdown). */
  async flushAnalytics(): Promise<void> {
    await this.analyticsQueue;
  }

  private noteSpan(context: Pick<ServerLogFields, 'requestId' | 'publisherId'>, span: string, durationMs: number): void {
    if (durationMs > SLOW_SPAN_MS) this.logger?.info('slow_span', { ...context, stage: span, durationMs: Math.round(durationMs) });
  }

  /** Records the time spent queueing analytics on the request path; the writes themselves run in the background. */
  private trackTimed(timing: ReportPerformanceTiming, name: Parameters<typeof createEvent>[0], publisherId: string, sessionId: string, metadata?: Record<string, string | number | boolean>): void {
    const startedAt = clockMs();
    this.track(name, publisherId, sessionId, metadata, timing.requestId);
    timing.analyticsMs = (timing.analyticsMs ?? 0) + (clockMs() - startedAt);
  }

  private logSlowSpans(timing: ReportPerformanceTiming): void {
    const spans: Array<[string, number | undefined]> = [
      ['company', timing.companyResolutionMs],
      ['ai-profile', timing.aiProfileMs],
      ['catalogue', timing.catalogueCacheLookupMs],
      ['exclusion', timing.exclusionMs],
      ['ranking', timing.preselectionMs + timing.deterministicRankingMs],
      ['ai-rerank', timing.aiRerankingMs],
      ['ai-content', timing.aiExplanationsMs],
      ['sections', timing.sectionAllocationMs],
      ['persist', timing.persistenceMs],
    ];
    for (const [span, durationMs] of spans) this.noteSpan({ requestId: timing.requestId, publisherId: timing.publisherId }, span, durationMs ?? 0);
  }

  private canUseAI(definition: ReturnType<PublisherRegistry['get']>): definition is NonNullable<ReturnType<PublisherRegistry['get']>> {
    return Boolean(this.ai?.config.enabled && this.ai.config.provider !== 'none' && definition?.manifest?.features?.aiEnabled !== false && isProfessionalAIProvider(this.ai.provider));
  }

  private aiTimeoutMs(): number {
    return Math.min(this.ai?.config.timeoutMs ?? AI_OPERATION_TIMEOUT_CAP_MS, AI_OPERATION_TIMEOUT_CAP_MS);
  }

  /**
   * Runs one optional AI stage under the capped timeout. `observe` records the provider's response diagnostics
   * (HTTP status, finish reason, token usage) for ai_performance; prompts and headers are never logged.
   */
  private async runAI<T>(operation: string, work: (observe: ObserveAIResponse) => Promise<T>, context: Pick<ServerLogFields, 'requestId' | 'publisherId' | 'part' | 'aiRetryCount'> = {}): Promise<AIOutcome<T>> {
    const requestStart = new Date().toISOString();
    const startedAt = clockMs();
    const timeoutMs = this.aiTimeoutMs();
    let observed: AIResponseDiagnostics | undefined;
    const observe: ObserveAIResponse = (raw) => { observed = aiResponseDiagnostics(raw) ?? observed; return raw; };
    const base = { aiRetryCount: 0, ...context, aiOperation: operation, aiModel: this.ai?.config.model, aiRequestStart: requestStart, aiTimeoutMs: timeoutMs };
    try {
      const value = await withTimeout(work(observe), timeoutMs);
      this.logger?.info('ai_performance', { ...base, aiDurationMs: Math.max(0, clockMs() - startedAt), aiSuccess: true, aiFallbackUsed: false, ...aiDiagnosticFields(observed) });
      return { value };
    } catch (error) {
      const errorCode = error instanceof AIProviderError ? error.code : error instanceof Error ? error.message : 'unknown';
      const diagnostics = error instanceof AIProviderError && Object.keys(error.diagnostics).length ? error.diagnostics : observed;
      this.logger?.info('ai_performance', { ...base, aiDurationMs: Math.max(0, clockMs() - startedAt), aiSuccess: false, aiFallbackUsed: true, aiErrorCode: safeLogText(errorCode, 120), aiErrorMessage: safeLogText(error instanceof Error ? error.message : 'unknown', 300), ...aiDiagnosticFields(diagnostics) });
      return { errorCode: safeLogText(errorCode, 120) };
    }
  }

  /** One ai_quality_warning line per issue: scope, article ID and code only, never the text. */
  private logQualityWarnings(input: Pick<GenerateReportInput, 'publisherId' | 'requestId'>, scope: 'summary' | 'explanation', warnings: Array<{ code: ContentQualityCode; articleId?: string }>): void {
    for (const warning of warnings) this.logger?.info('ai_quality_warning', { requestId: input.requestId, publisherId: input.publisherId, stage: scope, qualityCode: warning.code, articleId: warning.articleId ? safeLogText(warning.articleId, 200) : undefined });
  }

  /**
   * One ai_explanation_rejected line per discarded explanation, plus not_returned for requested articles the
   * model never explained. Logs article IDs, reason codes and field names only, never explanation text.
   */
  private logExplanationRejections(input: Pick<GenerateReportInput, 'publisherId' | 'requestId'>, request: ReportContentRequest, accepted: Array<{ articleId: string }>, rejections: Array<ExplanationRejection | ExplanationShapeIssue>): void {
    const base = { requestId: input.requestId, publisherId: input.publisherId };
    const mentioned = new Set(accepted.map((item) => item.articleId));
    for (const rejection of rejections) {
      const articleId = 'articleId' in rejection ? rejection.articleId : undefined;
      if (articleId) mentioned.add(articleId);
      this.logger?.info('ai_explanation_rejected', { ...base, rejectReason: rejection.reason, articleId: articleId ? safeLogText(articleId, 200) : undefined, presentFields: rejection.presentFields ? safeLogText(rejection.presentFields.join(','), 200) : undefined });
    }
    for (const recommendation of request.recommendations) {
      if (!mentioned.has(recommendation.article.id)) this.logger?.info('ai_explanation_rejected', { ...base, rejectReason: 'not_returned', articleId: safeLogText(recommendation.article.id, 200) });
    }
  }

  private enrichedProfileCacheKey(publisherId: string, domain: string, profile: ReturnType<typeof buildProfessionalProfile>): string {
    return `${publisherId}:${domain.toLowerCase()}:${profile.profileVersion}:${profile.company.analysisVersion}:${profile.role.normalizedTitle}`;
  }

  private async enrichProfileWithAI(publisherId: string, normalized: ResolvedCompanyInput, company: Awaited<ReturnType<CompanyContextProvider['getContext']>>, profile: ReturnType<typeof buildProfessionalProfile>, requestId?: string): Promise<ReturnType<typeof buildProfessionalProfile> | null> {
    if (!this.ai) return null;
    const key = this.enrichedProfileCacheKey(publisherId, normalized.domain, profile);
    const cached = this.enrichedProfileCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;
    this.enrichedProfileCache.delete(key);
    const pending = this.enrichedProfileInFlight.get(key);
    if (pending) return (await pending) ?? null;
    const operation = this.runEnrichment(publisherId, normalized, company, profile, requestId);
    this.enrichedProfileInFlight.set(key, operation.then((result) => result.profile));
    try {
      const result = await operation;
      // Only a complete enrichment is cached; a failed or partial one is retried once in the background so the
      // next visitor finds a warm cache instead of the same fallback.
      if (result.complete && result.profile) this.enrichedProfileCache.set(key, { profile: result.profile, expiresAt: Date.now() + ENRICHED_PROFILE_TTL_MS });
      else this.retryEnrichmentInBackground(key, publisherId, normalized, company, profile, requestId, result);
      return result.profile ?? null;
    } finally {
      if (this.enrichedProfileInFlight.get(key) !== this.enrichmentRetries.get(key)) this.enrichedProfileInFlight.delete(key);
    }
  }

  /**
   * The main enrichment and, for a generic titled role, the subject vocabulary run as two parallel calls, each
   * under its own AI time cap. Whichever succeeds is merged; `reuse` carries a part that already succeeded.
   */
  private async runEnrichment(publisherId: string, normalized: ResolvedCompanyInput, company: Awaited<ReturnType<CompanyContextProvider['getContext']>>, profile: ReturnType<typeof buildProfessionalProfile>, requestId?: string, reuse: EnrichmentParts = {}, retryCount = 0): Promise<EnrichmentResult> {
    const provider = this.ai!.provider as ProfessionalAIProvider;
    const titleTopics = roleSubjectTerms(profile.role) ? profile.role.titleTopics ?? [] : [];
    const needsVocabulary = titleTopics.length > 0 && typeof provider.generateSubjectVocabulary === 'function';
    const context = { publisherId, requestId, aiRetryCount: retryCount };
    const [main, vocabulary] = await Promise.all([
      reuse.main ? Promise.resolve(reuse.main) : this.runAI('professional_profile_enrichment', async (observe) => {
        const raw = observe(await provider.enhanceProfessionalProfile({ publisherId, submittedCompanyUrl: normalized.canonicalUrl, submittedJobTitle: profile.jobTitle, company, role: profile.role, profile }));
        if (!validateProfessionalProfileEnhancement(raw)) throw new Error('invalid_profile_enrichment');
        return raw;
      }, context).then((outcome) => outcome.value),
      !needsVocabulary || reuse.vocabulary ? Promise.resolve(reuse.vocabulary) : this.runAI('subject_vocabulary', async (observe) => {
        const terms = validateSubjectVocabulary(observe(await provider.generateSubjectVocabulary!({ publisherId, jobTitle: profile.jobTitle, titleTopics, industry: company.industry, companyName: profile.companyName ?? company.name })));
        if (!terms.length) throw new Error('invalid_subject_vocabulary');
        return terms;
      }, context).then((outcome) => outcome.value),
    ]);
    const parts: EnrichmentParts = { main, vocabulary };
    const raw = { ...(main && typeof main === 'object' ? main : {}), ...(vocabulary ? { subjectVocabulary: vocabulary } : {}) };
    const merged = main || vocabulary ? mergeProfessionalProfileEnhancement(profile, raw) : null;
    return { profile: merged ?? undefined, complete: Boolean(main) && (!needsVocabulary || Boolean(vocabulary)), needsVocabulary, parts };
  }

  /** One background retry of the parts that failed; a complete result warms the cache. Logs enrichment_retry. */
  private retryEnrichmentInBackground(key: string, publisherId: string, normalized: ResolvedCompanyInput, company: Awaited<ReturnType<CompanyContextProvider['getContext']>>, profile: ReturnType<typeof buildProfessionalProfile>, requestId: string | undefined, first: EnrichmentResult): void {
    if (this.enrichmentRetries.has(key)) return;
    const retryOperations = [first.parts.main ? undefined : 'professional_profile_enrichment', !first.needsVocabulary || first.parts.vocabulary ? undefined : 'subject_vocabulary'].filter(Boolean).join(',');
    const retry = this.runEnrichment(publisherId, normalized, company, profile, requestId, first.parts, 1)
      .then((result) => {
        if (result.complete && result.profile) this.enrichedProfileCache.set(key, { profile: result.profile, expiresAt: Date.now() + ENRICHED_PROFILE_TTL_MS });
        this.logger?.info('enrichment_retry', { requestId, publisherId, retryOperations, retrySuccess: result.complete });
        return result.profile;
      })
      .catch(() => undefined)
      .finally(() => {
        this.enrichmentRetries.delete(key);
        if (this.enrichedProfileInFlight.get(key) === retry) this.enrichedProfileInFlight.delete(key);
      });
    this.enrichmentRetries.set(key, retry);
    this.enrichedProfileInFlight.set(key, retry);
  }

  /** Resolves when background enrichment retries have finished (tests and graceful shutdown). */
  async flushEnrichmentRetries(): Promise<void> {
    await Promise.all([...this.enrichmentRetries.values()]);
  }

  /**
   * Loads every enabled archive publisher's catalogue (snapshot or source) ahead of the first request, which
   * also starts background index prebuilding. Publishers are warmed one at a time; failures are left for the
   * request path to retry and report.
   */
  async prewarmCatalogues(): Promise<string[]> {
    const warmed: string[] = [];
    for (const definition of this.registry.list()) {
      const publisherId = definition.config.publisherId;
      if (definition.manifest?.enabled === false) continue;
      if (await this.warmCatalogue(definition, publisherId)) warmed.push(publisherId);
    }
    return warmed;
  }

  /** Starts catalogue preparation independently of optional profile enrichment. */
  private async warmCatalogue(definition: NonNullable<ReturnType<PublisherRegistry['get']>>, publisherId: string): Promise<CatalogueCacheDiagnostics | undefined> {
    const runtimeInfo = this.runtimeDiagnostics?.(publisherId);
    const cacheKey = catalogueCacheKey(definition, runtimeInfo);
    const archiveAdapter = definition.adapter as typeof definition.adapter & { loadCatalogue?: (options?: { limit?: number; onDebug?: import('../core').DebugSink }) => Promise<unknown[]>; sourceTimings?: { sourceFetchMs?: number; sourceReadMs?: number; sourceParseMs?: number; normalizationMs?: number; cataloguePreparationMs?: number } };
    if (!cacheKey || !archiveAdapter.loadCatalogue) return undefined;
    const limit = Math.max(definition.config.content.candidateRetrievalLimit, 30);
    try {
      const result = await this.catalogueCache.get(publisherId, cacheKey, async () => {
        const raw = await archiveAdapter.loadCatalogue!({ limit, onDebug: undefined });
        const normalizationStartedAt = clockMs();
        // Normalized in slices so a large catalogue refresh never blocks the event loop for long.
        const normalized = (await mapInSlices(raw, (item) => definition.adapter.normalizeArticle(item))).filter((article): article is NormalizedArticle => Boolean(article));
        const seen = new Set<string>();
        const unique = normalized.filter((article) => {
          const keys = articleIdentityKeys(article);
          if (keys.some((key) => seen.has(key))) return false;
          keys.forEach((key) => seen.add(key));
          return true;
        });
        return { articles: unique, timings: { ...archiveAdapter.sourceTimings, normalizationMs: clockMs() - normalizationStartedAt } };
      });
      return result.diagnostics;
    } catch {
      // The authoritative retrieval path will retry and report the source failure with its normal stage diagnostics.
      return undefined;
    }
  }

  private async rankProfile(definition: NonNullable<ReturnType<PublisherRegistry['get']>>, publisherId: string, profile: ReturnType<typeof buildProfessionalProfile>, excludedArticleKeys = new Set<string>(), requestId?: string, archiveWide = false, onStage?: (stage: string) => void, capOwnCompany = false): Promise<{ ranked: RankedCandidate[]; ownCompanyDeferred: number; retrievedCount: number; normalizedCount: number; normalizedArticleCount: number; preselectionInputCount: number; preselectionOutputCount: number; rawCandidateCount: number; normalizedCandidateCount: number; excludedArticleCount: number; uniqueCandidateCount: number; thresholdInputCount: number; deterministicEligible: number; aiEligibleCount: number; aiInputCount: number; aiFilteredCount: number; aiRerankSurvivors: number; aiRerankUsed: boolean; timings: CatalogueCacheDiagnostics & { catalogueCacheLookupMs: number; catalogueSelectionMs: number; currentReportExclusionMs: number; preselectionMs: number; deterministicRankingMs: number; aiRerankMs: number; finalFormattingMs: number } }> {
    const intent = createIntent(profile, publisherId);
    let candidates: unknown[];
    const runtimeInfo = this.runtimeDiagnostics?.(publisherId);
    const cacheKey = catalogueCacheKey(definition, runtimeInfo);
    let catalogueDiagnostics: CatalogueCacheDiagnostics = { catalogueCacheHit: false, catalogueCacheAgeMs: 0, catalogueRefreshMs: 0, catalogueRefreshReason: 'cold' };
    let normalizationMs = 0;
    let usedCatalogueCache = false;
    let catalogueItemCount = 0;
    let catalogueCacheLookupMs = 0;
    let catalogueSelectionMs = 0;
    let catalogueIndex: CatalogueArticleIndex | undefined;
    const catalogueLoadStartedAt = clockMs();
    try {
      const limit = Math.max(definition.config.content.candidateRetrievalLimit, 30);
      const archiveAdapter = definition.adapter as typeof definition.adapter & { loadCatalogue?: (options?: { limit?: number; onDebug?: import('../core').DebugSink }) => Promise<unknown[]>; selectCatalogue?: (articles: NormalizedArticle[], intent: Intent, options: { limit: number; archiveWide?: boolean; preselectionFields?: CatalogueArticleIndex['preselectionFields'] }) => NormalizedArticle[]; sourceTimings?: { sourceFetchMs?: number; sourceReadMs?: number; sourceParseMs?: number; normalizationMs?: number; cataloguePreparationMs?: number } };
      if (cacheKey && archiveAdapter.loadCatalogue) {
        usedCatalogueCache = true;
        const cacheLookupStartedAt = clockMs();
        const loaded = await this.catalogueCache.get(publisherId, cacheKey, async () => {
          const raw = await archiveAdapter.loadCatalogue!({ limit, onDebug: undefined });
          const normalizeStartedAt = clockMs();
          let normalized: NormalizedArticle[];
          try {
            normalized = (await mapInSlices(raw, (item) => definition.adapter.normalizeArticle(item))).filter((article): article is NormalizedArticle => Boolean(article));
          } catch (error) {
            annotateGenerationFailure(error, 'ranking');
            throw error;
          }
          normalizationMs = clockMs() - normalizeStartedAt;
          const seen = new Set<string>();
          const unique = normalized.filter((article) => {
            const keys = articleIdentityKeys(article);
            if (keys.some((key) => seen.has(key))) return false;
            keys.forEach((key) => seen.add(key));
            return true;
          });
          return { articles: unique, timings: { ...archiveAdapter.sourceTimings, normalizationMs, cataloguePreparationMs: clockMs() - catalogueLoadStartedAt } };
        });
        catalogueCacheLookupMs = clockMs() - cacheLookupStartedAt;
        const loadedFromSource = (loaded.diagnostics.sourceFetchMs ?? 0) > 0 || (loaded.diagnostics.sourceParseMs ?? 0) > 0 || (loaded.diagnostics.normalizationMs ?? 0) > 0;
        catalogueDiagnostics = { ...loaded.diagnostics, catalogueCacheHit: loaded.diagnostics.catalogueCacheHit && !loadedFromSource };
        catalogueItemCount = loaded.articles.length;
        catalogueIndex = loaded.index;
        if (publisherId === 'ibi') {
          const stats = (definition.adapter as { lastDiagnostics?: { sourceStats?: { sitemapDocumentsFetched?: number; sitemapUrlsFound?: number; articleUrlsAccepted?: number; articleUrlsSelected?: number; articlePagesFetched?: number } } }).lastDiagnostics?.sourceStats;
          this.logger?.info('ibi_generation_content_source', {
            requestId,
            publisherId,
            stage: 'retrieval',
            sitemapDocumentsFetched: stats?.sitemapDocumentsFetched,
            sitemapUrlsFound: stats?.sitemapUrlsFound,
            articleUrlsAccepted: stats?.articleUrlsAccepted,
            articleUrlsSelected: stats?.articleUrlsSelected,
            articlePagesFetched: stats?.articlePagesFetched,
            normalizedArticles: loaded.articles.length,
            retrievalCandidates: loaded.articles.length,
          });
        }
        const selectionStartedAt = clockMs();
        const selected = archiveAdapter.selectCatalogue ? archiveAdapter.selectCatalogue(loaded.articles, intent, { limit, archiveWide, preselectionFields: loaded.index.preselectionFields }) : loaded.articles;
        catalogueSelectionMs = clockMs() - selectionStartedAt;
        this.noteSpan({ requestId, publisherId }, 'catalogue-select', catalogueSelectionMs);
        candidates = selected;
      } else {
        candidates = await definition.adapter.search(intent, {
          limit,
          archiveWide,
          onDebug: (event) => {
            if (publisherId !== 'ibi' || event.type !== 'content_source') return;
            const stats = (definition.adapter as { lastDiagnostics?: { sourceStats?: { sitemapDocumentsFetched?: number; sitemapUrlsFound?: number; articleUrlsAccepted?: number; articleUrlsSelected?: number; articlePagesFetched?: number; normalizedArticles?: number; preselectionInputCount?: number; preselectionOutputCount?: number } } }).lastDiagnostics?.sourceStats;
            this.logger?.info('ibi_generation_content_source', {
              requestId,
              publisherId,
              stage: 'retrieval',
              sitemapDocumentsFetched: stats?.sitemapDocumentsFetched ?? event.pagesFetched,
              sitemapUrlsFound: stats?.sitemapUrlsFound,
              articleUrlsAccepted: stats?.articleUrlsAccepted ?? event.rawCount,
              articleUrlsSelected: stats?.articleUrlsSelected,
              articlePagesFetched: stats?.articlePagesFetched,
              normalizedArticles: stats?.normalizedArticles ?? event.normalizedCount,
              preselectionInputCount: stats?.preselectionInputCount,
              preselectionOutputCount: stats?.preselectionOutputCount,
              retrievalCandidates: event.normalizedCount,
            });
          },
        });
        normalizationMs = 0;
      }
    } catch (error) {
      annotateGenerationFailure(error, 'content_retrieval');
      this.logIbiError({ publisherId, requestId }, 'retrieval', error);
      throw error;
    }
    onStage?.('content_retrieved');
    const normalizedCandidates = usedCatalogueCache
      ? candidates as NormalizedArticle[]
      : candidates.flatMap((raw) => {
        const article = definition.adapter.normalizeArticle(raw);
        return article ? [article] : [];
      });
    const exclusionStartedAt = clockMs();
    const excludedArticleCount = normalizedCandidates.filter((article) => articleIdentityKeys(article).some((key) => excludedArticleKeys.has(key))).length;
    const normalizedArticles = normalizedCandidates.filter((article) => articleIdentityKeys(article).every((key) => !excludedArticleKeys.has(key)));
    const seenArticleKeys = new Set<string>();
    const unique = normalizedArticles.filter((article) => {
      const keys = articleIdentityKeys(article);
      if (keys.some((key) => seenArticleKeys.has(key))) return false;
      keys.forEach((key) => seenArticleKeys.add(key));
      return true;
    });
    const currentReportExclusionMs = clockMs() - exclusionStartedAt;
    const sourceStats = (definition.adapter as { lastDiagnostics?: { sourceStats?: { normalizedArticles?: number; preselectionInputCount?: number; preselectionOutputCount?: number } } }).lastDiagnostics?.sourceStats;
    const normalizedArticleCount = usedCatalogueCache ? catalogueItemCount : sourceStats?.normalizedArticles ?? normalizedCandidates.length;
    const preselectionInputCount = usedCatalogueCache ? normalizedArticleCount : archiveWide ? normalizedArticleCount : sourceStats?.preselectionInputCount ?? normalizedArticleCount;
    const preselectionLimit = Math.min(Math.max(definition.config.content.candidateRetrievalLimit, 30), 100);
    const preselectionStartedAt = clockMs();
    const scoreArticle = createProfessionalScorer(profile);
    const preselectionScores = new Map<NormalizedArticle, ReturnType<typeof scoreProfessionalArticle>>();
    const preselected = archiveWide
      ? unique
        .map((article) => {
          const result = scoreArticle(article, catalogueIndex?.professionalFields(article));
          preselectionScores.set(article, result);
          return { article, score: result.score };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, preselectionLimit)
        .map(({ article }) => article)
      : unique;
    const preselectionOutputCount = usedCatalogueCache ? preselected.length : archiveWide ? preselected.length : sourceStats?.preselectionOutputCount ?? preselected.length;
    const preselectionMs = clockMs() - preselectionStartedAt;
    onStage?.('preselection_complete');
    const finalLimit = Math.min(definition.config.results.maximumRecommendations, definition.config.content.resultLimit);
    const aiAvailable = this.canUseAI(definition);
    const deterministicStartedAt = clockMs();
    const deterministicRanked: RankedCandidate[] = preselected
      .map((article) => {
        const result = preselectionScores.get(article) ?? scoreArticle(article, catalogueIndex?.professionalFields(article));
        return { article, relevanceSignals: result.relevanceSignals, deterministicScore: result.score, semanticSignals: [], finalScore: result.score, rankingMode: 'deterministic' as const, relevanceType: result.relevanceType === 'adjacent' ? 'adjacent' as const : 'direct' as const, confidence: result.confidence, directMatches: result.directMatches ?? [], adjacentMatches: result.adjacentMatches ?? [], scoreComponents: result.scoreComponents, result };
      })
      .filter((item) => passesRelevanceThreshold(item.result))
      .sort((a, b) => (a.relevanceType === b.relevanceType
        ? b.deterministicScore - a.deterministicScore
          || (b.scoreComponents?.postRecencyScore ?? b.deterministicScore) - (a.scoreComponents?.postRecencyScore ?? a.deterministicScore)
        : a.relevanceType === 'direct' ? -1 : 1))
      .map(({ result: _result, ...item }) => item);
    const deterministicRankingMs = clockMs() - deterministicStartedAt;
    const aiEligibleCount = aiAvailable ? Math.min(deterministicRanked.length, this.ai!.config.rerankLimit) : 0;
    this.logIbi({ publisherId, requestId }, 'ibi_generation_ranking_input', { stage: 'ranking', retrievalCandidates: candidates.length, rankingCandidateCount: preselected.length, normalizedArticles: unique.length, normalizedArticleCount, preselectionInputCount, preselectionOutputCount, deterministicEligible: deterministicRanked.length, eligibleCount: deterministicRanked.length });
    // The main report holds own-company articles to about 60% when other qualifying articles exist.
    let ownCompanyDeferred = 0;
    const limitRanked = <T extends RankedCandidate>(items: T[]): T[] => {
      if (!capOwnCompany) return items.slice(0, finalLimit);
      const limited = limitOwnCompanyShare(items, finalLimit, (item) => articleRelationship(item.article, profile) === 'own_company');
      ownCompanyDeferred = limited.deferred;
      return limited.selected;
    };
    let ranked = limitRanked(deterministicRanked);
    let aiRerankUsed = false;
    let aiFilteredCount = 0;
    const aiStartedAt = clockMs();
    if (aiAvailable && deterministicRanked.length > 0) {
      try {
        const semanticCandidates: SemanticCandidate[] = deterministicRanked.slice(0, aiEligibleCount).map((result) => ({
          articleId: result.article.id,
          title: result.article.title,
          description: result.article.description,
          categories: result.article.categories,
          tags: result.article.tags,
          contentSnippet: result.article.contentSnippet?.slice(0, 500),
          deterministicScore: result.deterministicScore,
          deterministicRelevanceType: result.relevanceType,
          relevanceSignals: result.relevanceSignals,
          publishedAt: result.article.publishedAt,
          category: result.article.category,
          matchedConcepts: [...result.directMatches, ...result.adjacentMatches],
        }));
        const { value: semanticResults } = await this.runAI('semantic_reranking', async (observe) => {
          const raw = observe(await this.ai!.provider.rerank(createEnrichedIntent(profile, publisherId), semanticCandidates));
          const validated = validateSemanticResults(raw, semanticCandidates);
          if (validated.length === 0) throw new Error('no_valid_rerank_results');
          return validated;
        }, { publisherId, requestId });
        if (!semanticResults) throw new Error('semantic_reranking_unavailable');
        const semanticById = new Map(semanticResults.map((result) => [result.articleId, result]));
        const deterministicWeight = definition.manifest?.ranking?.deterministicWeight ?? this.ai!.config.deterministicWeight;
        const semanticWeight = definition.manifest?.ranking?.semanticWeight ?? this.ai!.config.semanticWeight;
        const aiRankedCandidates = deterministicRanked.slice(0, aiEligibleCount).flatMap((result, index) => {
          const semantic = semanticById.get(result.article.id);
          if (!semantic) return [];
          const semanticScore = semantic.semanticScore ?? result.deterministicScore;
          if (semantic.keep === false) return [];
          const relevanceType = result.relevanceType === 'adjacent' ? 'adjacent' as const : semantic.relevanceType ?? result.relevanceType;
          const finalScore = calibrateRelevanceScore(combineHybridScore(result.deterministicScore, semanticScore, { deterministic: deterministicWeight, semantic: semanticWeight }), relevanceType);
          if (!passesRelevanceThreshold({ score: finalScore, relevanceSignals: result.relevanceSignals, relevanceType })) return [];
          return [{ ...result, semanticScore, semanticSignals: semantic.signals ?? [], finalScore, rankingMode: 'hybrid' as const, ...(semantic.weak ? { weakFit: true } : {}), relevanceType, confidence: semantic.confidence ?? result.confidence, index }];
        });
        const aiRanked = aiRankedCandidates
          .sort((a, b) => (a.relevanceType === b.relevanceType
            ? b.finalScore - a.finalScore
              || b.deterministicScore - a.deterministicScore
              || (b.scoreComponents?.postRecencyScore ?? b.deterministicScore) - (a.scoreComponents?.postRecencyScore ?? a.deterministicScore)
              || a.index - b.index
            : a.relevanceType === 'direct' ? -1 : 1));
        const aiLimited = limitRanked(aiRanked)
          .map(({ index: _index, ...result }) => result);
        aiFilteredCount = aiEligibleCount - aiRankedCandidates.length;
        // A valid deterministic candidate set is always a safe fallback. A
        // partial or over-aggressive semantic response must not turn a useful
        // theme search into an empty result.
        if (aiLimited.length > 0) {
          ranked = aiLimited;
          aiRerankUsed = true;
        } else {
          ranked = limitRanked(deterministicRanked);
        }
      } catch { /* deterministic ranking remains authoritative */ }
    }
    const aiRerankMs = clockMs() - aiStartedAt;
    onStage?.('ranking_complete');
    this.logIbi({ publisherId, requestId }, 'ibi_generation_ranking_output', { stage: 'ranking', deterministicEligible: deterministicRanked.length, aiRerankSurvivors: aiRerankUsed ? ranked.length : 0, finalRecommendations: ranked.length });
    const finalFormattingStartedAt = clockMs();
    const timings = { ...catalogueDiagnostics, normalizationMs: catalogueDiagnostics.normalizationMs ?? normalizationMs, cataloguePreparationMs: catalogueDiagnostics.cataloguePreparationMs ?? (clockMs() - catalogueLoadStartedAt), catalogueCacheLookupMs, catalogueSelectionMs, currentReportExclusionMs, preselectionMs, deterministicRankingMs, aiRerankMs, finalFormattingMs: clockMs() - finalFormattingStartedAt };
    return { ranked, ownCompanyDeferred, retrievedCount: candidates.length, normalizedCount: unique.length, normalizedArticleCount, preselectionInputCount, preselectionOutputCount, rawCandidateCount: candidates.length, normalizedCandidateCount: normalizedCandidates.length, excludedArticleCount, uniqueCandidateCount: unique.length, thresholdInputCount: preselected.length, deterministicEligible: deterministicRanked.length, aiEligibleCount, aiInputCount: aiEligibleCount, aiFilteredCount, aiRerankSurvivors: aiRerankUsed ? ranked.length : 0, aiRerankUsed, timings };
  }

  private recommendationsFromRanked(profile: ReturnType<typeof buildProfessionalProfile>, ranked: RankedCandidate[], explanationById = new Map<string, { explanation: string; angle?: string }>(), citedIds: ReadonlySet<string> = new Set(), lowerConfidenceIds: ReadonlySet<string> = new Set(), fallbackExplanation: (item: RankedCandidate) => string = (item) => explanation(profile, item)): ReportRecommendation[] {
    return ranked.map((item, index) => ({
      articleId: item.article.id,
      rank: index + 1,
      rawScore: item.finalScore,
      displayScore: displayRelevanceScore(item.finalScore),
      explanation: explanationById.get(item.article.id)?.explanation ?? fallbackExplanation(item),
      article: item.article,
      rankingMetadata: {
        relevanceSignals: item.relevanceSignals,
        rankingMode: item.rankingMode,
        rankingVersion: RANKING_VERSION,
        deterministicScore: item.deterministicScore,
        semanticScore: item.semanticScore,
        semanticSignals: item.semanticSignals,
        relevanceType: item.relevanceType,
        confidence: item.confidence,
        scoreComponents: item.scoreComponents,
        aiProvider: item.rankingMode === 'hybrid' ? this.ai?.provider.providerName : undefined,
        explanationSource: explanationById.has(item.article.id) ? 'ai' as const : 'deterministic' as const,
        ...(explanationById.get(item.article.id)?.angle ? { angle: explanationById.get(item.article.id)!.angle } : {}),
        ...(citedIds.has(item.article.id) ? { citedInSummary: true } : {}),
        ...(lowerConfidenceIds.has(item.article.id) ? { lowerConfidence: true } : {}),
      },
    }));
  }

  /**
   * shownArticleIds: articles already shown in other theme results this session (client-supplied, at most
   * MAX_SHOWN_THEME_ARTICLE_IDS). They are excluded alongside the main report's articles; unknown IDs match nothing.
   */
  async searchTheme(report: ReportRecord, theme: string, requestId?: string, performanceTiming?: ReportPerformanceTiming, shownArticleIds: string[] = []): Promise<ReportRecommendation[]> {
    const themeStartedAt = clockMs();
    const timing = performanceTiming ?? createPerformanceTiming(report.publisherId, requestId);
    timing.requestId = requestId ?? timing.requestId;
    timing.publisherId = report.publisherId;
    timing.theme = theme;
    const definition = this.registry.get(report.publisherId);
    if (!definition || definition.manifest?.enabled === false) throw new Error('invalid_publisher');
    const profile = profileForTheme(report.professionalProfile, theme);
    const excluded = new Set([...report.recommendations.flatMap((recommendation) => articleIdentityKeys(recommendation.article)), ...shownArticleIds.slice(0, MAX_SHOWN_THEME_ARTICLE_IDS).map((id) => `id:${id}`)]);
    const ranking = await this.rankProfile(definition, report.publisherId, profile, excluded, requestId, true);
    const { ranked } = ranking;
    const failureStage = ranked.length > 0 ? 'complete' : ranking.aiFilteredCount > 0 && ranking.deterministicEligible > 0 ? 'ai_filtered_all' : ranking.deterministicEligible > 0 ? 'final_filter' : 'deterministic_threshold';
    const finalFormattingStartedAt = clockMs();
    const recommendations = this.recommendationsFromRanked(profile, ranked, undefined, undefined, undefined, (item) => factualLine(item.article));
    timing.cacheHit = ranking.timings.catalogueCacheHit && (ranking.timings.sourceFetchMs ?? 0) === 0 && (ranking.timings.sourceParseMs ?? 0) === 0 && (ranking.timings.normalizationMs ?? 0) === 0;
    timing.cacheAgeMs = ranking.timings.catalogueCacheAgeMs;
    timing.catalogueStale = ranking.timings.catalogueStale;
    timing.catalogueItemCount = ranking.normalizedArticleCount;
    timing.catalogueCacheLookupMs = ranking.timings.catalogueCacheLookupMs ?? 0;
    timing.catalogueSelectionMs = ranking.timings.catalogueSelectionMs;
    timing.catalogueSnapshotLookupMs = ranking.timings.catalogueSnapshotLookupMs ?? 0;
    timing.catalogueRefreshMs = ranking.timings.catalogueRefreshMs ?? 0;
    timing.catalogueRefreshReason = ranking.timings.catalogueRefreshReason;
    timing.sourceFetchMs = ranking.timings.sourceFetchMs ?? 0;
    timing.sourceReadMs = ranking.timings.sourceReadMs ?? 0;
    timing.sourceParseMs = ranking.timings.sourceParseMs ?? 0;
    timing.normalizationMs = ranking.timings.normalizationMs ?? 0;
    timing.preselectionMs = ranking.timings.preselectionMs;
    timing.deterministicRankingMs = ranking.timings.deterministicRankingMs;
    timing.aiRerankingMs = ranking.timings.aiRerankMs;
    timing.exclusionMs = ranking.timings.currentReportExclusionMs;
    timing.totalMs = clockMs() - themeStartedAt;
    this.logger?.info('theme_retrieval_diagnostics', { publisherId: report.publisherId, theme: safeLogText(theme, 160), catalogueCount: ranking.normalizedArticleCount, catalogueItemCount: ranking.normalizedArticleCount, rawCandidateCount: ranking.rawCandidateCount, candidateCount: ranking.retrievedCount, normalizedCandidateCount: ranking.normalizedCandidateCount, preselectionInputCount: ranking.preselectionInputCount, preselectionOutputCount: ranking.preselectionOutputCount, excludedCurrentReportCount: report.recommendations.length, excludedArticleCount: ranking.excludedArticleCount, uniqueCandidateCount: ranking.uniqueCandidateCount, thresholdInputCount: ranking.thresholdInputCount, deterministicEligibleCount: ranking.deterministicEligible, aiEligibleCount: ranking.aiEligibleCount, aiInputCount: ranking.aiInputCount, aiFilteredCount: ranking.aiFilteredCount, finalResultCount: ranked.length, finalRecommendationCount: ranked.length, excludedExistingCount: report.recommendations.length, eligibleCount: ranking.deterministicEligible, failureStage, ...ranking.timings, totalThemeSearchMs: clockMs() - themeStartedAt, finalFormattingMs: clockMs() - finalFormattingStartedAt });
    this.logSlowSpans(timing);
    this.logger?.info('theme_performance', { ...timing, totalMs: timing.totalMs, exclusionMs: timing.exclusionMs ?? 0 });
    return recommendations;
  }

  async generate(input: GenerateReportInput): Promise<ReportRecord> {
    const generationStartedAt = clockMs();
    const timing = input.performance ?? createPerformanceTiming(input.publisherId, input.requestId);
    timing.publisherId = input.publisherId;
    timing.requestId = input.requestId ?? timing.requestId;
    this.logIbi(input, 'ibi_generation_started', { stage: 'start' });
    const definition = this.registry.get(input.publisherId);
    if (!definition || definition.manifest?.enabled === false) {
      const error = new Error('invalid_publisher');
      this.logIbiError(input, 'publisher_resolution', error);
      throw error;
    }
    const jobTitle = input.jobTitle.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!jobTitle) throw new Error('job_title_required');
    const activeSession = input.sessionId ?? sessionId();
    this.trackTimed(timing, 'generation_started', input.publisherId, activeSession);
    const inputType = classifyCompanyInput(input.companyUrl);
    const baseResolutionDiagnostics: Partial<ServerLogFields> = {
      companyInputType: inputType,
      companyResolutionAttempted: inputType === 'company_name',
      companyResolutionSucceeded: false,
      resolvedHostnamePresent: false,
      resolutionMethod: inputType === 'domain' ? 'submitted_domain' : 'bounded_public_site',
    };
    let normalized: ResolvedCompanyInput;
    const companyResolutionStartedAt = clockMs();
    try {
      normalized = await this.companyResolver.resolve(input.companyUrl);
    } catch (error) {
      annotateGenerationFailure(error, inputType === 'company_name' ? 'company_resolution' : 'company_normalization');
      this.logIbiError(input, inputType === 'company_name' ? 'company_resolution' : 'company_normalization', error, baseResolutionDiagnostics);
      throw error;
    }
    const companyResolutionMs = clockMs() - companyResolutionStartedAt;
    timing.companyResolutionMs = companyResolutionMs;
    this.markStage(input, 'company_resolved');
    const resolutionDiagnostics: Partial<ServerLogFields> = {
      companyInputType: normalized.inputType,
      companyResolutionAttempted: normalized.inputType === 'company_name',
      companyResolutionSucceeded: true,
      resolvedHostnamePresent: Boolean(normalized.domain),
      resolutionMethod: normalized.resolutionMethod,
    };
    this.trackTimed(timing, 'company_analysis_started', input.publisherId, activeSession);
    let company: Awaited<ReturnType<CompanyContextProvider['getContext']>>;
    const companyContextStartedAt = clockMs();
    try { company = await this.companyProvider.getContext(normalized.domain); }
    catch (error) { annotateGenerationFailure(error, 'company_context'); this.logIbiError(input, 'company_context', error, resolutionDiagnostics); throw error; }
    timing.companyContextMs = clockMs() - companyContextStartedAt;
    this.noteSpan(input, 'company-context', timing.companyContextMs);
    if (normalized.displayName) company = { ...company, name: normalized.displayName };
    this.trackTimed(timing, 'company_analysis_completed', input.publisherId, activeSession, { industry: company.industry ?? 'unknown' });
    let profile: ReturnType<typeof buildProfessionalProfile>;
    const profileStartedAt = clockMs();
    try {
      profile = buildProfessionalProfile(company, jobTitle);
    } catch (error) {
      annotateGenerationFailure(error, 'profile');
      this.logIbiError(input, 'profile', error, resolutionDiagnostics);
      throw error;
    }
    const catalogueWarmup = this.warmCatalogue(definition, input.publisherId);
    let aiProfileUsed = false;
    const aiProfileStartedAt = clockMs();
    let warmupDiagnostics: CatalogueCacheDiagnostics | undefined;
    if (this.canUseAI(definition)) {
      const [enriched, warmed] = await Promise.all([this.enrichProfileWithAI(input.publisherId, normalized, company, profile, input.requestId), catalogueWarmup]);
      warmupDiagnostics = warmed;
      if (enriched) { profile = enriched; aiProfileUsed = true; }
    } else {
      warmupDiagnostics = await catalogueWarmup;
    }
    timing.aiProfileMs = this.canUseAI(definition) ? clockMs() - aiProfileStartedAt : 0;
    const professionalProfileMs = clockMs() - profileStartedAt;
    timing.profileMs = professionalProfileMs;
    this.markStage(input, 'profile_built');
    this.trackTimed(timing, 'role_analysis_completed', input.publisherId, activeSession, { roleFunction: profile.role.function });
    this.trackTimed(timing, 'profile_generated', input.publisherId, activeSession, { roleFunction: profile.role.function, industry: company.industry ?? 'unknown', aiProfileUsed });
    this.trackTimed(timing, 'retrieval_started', input.publisherId, activeSession);
    let ranking: Awaited<ReturnType<ReportGenerationService['rankProfile']>>;
    try {
      // Archive-wide, like theme search: the professional scorer preselects across the whole catalogue. The
      // adapter's token preselection let company-name and leadership-word matches fill its 100 slots, so a
      // subject-anchored role lost on-subject stories about other companies that theme search then found.
      ranking = await this.rankProfile(definition, input.publisherId, profile, new Set<string>(), input.requestId, true, (stage) => this.markStage(input, stage), true);
    } catch (error) {
      const stage = (error as GenerationFailure).generationStage ?? 'ranking';
      annotateGenerationFailure(error, stage);
      this.logIbiError(input, stage, error, resolutionDiagnostics);
      throw error;
    }
    if (warmupDiagnostics && !warmupDiagnostics.catalogueCacheHit) {
      ranking.timings = {
        ...ranking.timings,
        catalogueCacheHit: false,
        sourceFetchMs: warmupDiagnostics.sourceFetchMs ?? ranking.timings.sourceFetchMs,
        sourceReadMs: warmupDiagnostics.sourceReadMs ?? ranking.timings.sourceReadMs,
        sourceParseMs: warmupDiagnostics.sourceParseMs ?? ranking.timings.sourceParseMs,
        normalizationMs: warmupDiagnostics.normalizationMs ?? ranking.timings.normalizationMs,
        catalogueSnapshotLookupMs: warmupDiagnostics.catalogueSnapshotLookupMs ?? ranking.timings.catalogueSnapshotLookupMs,
        cataloguePreparationMs: warmupDiagnostics.cataloguePreparationMs ?? ranking.timings.cataloguePreparationMs,
        catalogueRefreshMs: warmupDiagnostics.catalogueRefreshMs ?? ranking.timings.catalogueRefreshMs,
        catalogueRefreshReason: warmupDiagnostics.catalogueRefreshReason,
      };
    }
    const ranked = ranking.ranked;
    const aiRerankUsed = ranking.aiRerankUsed;
    this.logger?.info('report_retrieval_diagnostics', { requestId: input.requestId, publisherId: input.publisherId, normalizedArticles: ranking.normalizedCount, normalizedArticleCount: ranking.normalizedArticleCount, catalogueItemCount: ranking.normalizedArticleCount, preselectionInputCount: ranking.preselectionInputCount, preselectionOutputCount: ranking.preselectionOutputCount, retrievalCandidates: ranking.retrievedCount, candidateCount: ranking.retrievedCount, rankingCandidateCount: ranking.retrievedCount, deterministicEligible: ranking.deterministicEligible, eligibleCount: ranking.deterministicEligible, finalRecommendations: ranked.length, finalRecommendationCount: ranked.length, ...ranking.timings });
    this.logIbi(input, 'ibi_generation_counts', { stage: 'ranking', retrievalCandidates: ranking.retrievedCount, normalizedArticles: ranking.normalizedCount, deterministicEligible: ranking.deterministicEligible, aiRerankSurvivors: ranking.aiRerankSurvivors, finalRecommendations: ranked.length });
    const aiAvailable = this.canUseAI(definition);
    this.trackTimed(timing, 'retrieval_completed', input.publisherId, activeSession, { resultCount: ranking.retrievedCount });
    this.trackTimed(timing, 'ranking_completed', input.publisherId, activeSession, { resultCount: ranked.length, rankingMode: aiRerankUsed ? 'hybrid' : 'deterministic', aiRerankUsed });
    // Rerank weak fits leave before the content call so the summary is never built on them.
    const rerankWeakIds = new Set(ranked.filter((item) => item.weakFit).map((item) => item.article.id));
    const afterRerank = removeWeakFits(ranked, rerankWeakIds);
    const contentRanked = afterRerank.kept;
    const deterministicRecommendations = contentRanked.map((item) => ({
      article: item.article,
      deterministicExplanation: explanation(profile, item),
      relevanceSignals: item.relevanceSignals,
      semanticSignals: item.semanticSignals,
      matchedConcepts: [...item.directMatches, ...item.adjacentMatches],
      score: Math.round(item.finalScore),
      relationship: articleRelationship(item.article, profile),
    }));
    const themes = selectReportThemes(profile, contentRanked.map((item) => item.article));
    let generatedSummary = reportSummary(profile, ranked.length);
    const explanationById = new Map<string, { explanation: string; angle?: string }>();
    let citedIds = new Set<string>();
    const contentWeakIds = new Set<string>();
    let aiSummaryUsed = false;
    let aiExplanationUsed = false;
    let themeDescriptions: Record<string, string> | undefined;
    let summaryFallbackReason: string | undefined = !aiAvailable ? 'ai_unavailable' : ranked.length === 0 ? 'no_recommendations' : undefined;
    const aiExplanationStartedAt = clockMs();
    if (aiAvailable && ranked.length > 0) {
      // Two batched calls in parallel keep each inside the AI time cap: A writes the summary and the first
      // explanations, B (only when needed) the remaining explanations. Each falls back independently.
      const explanationsEnabled = this.ai!.config.explanationsEnabled;
      const parts: Array<{ part: 'A' | 'B'; request: ReportContentRequest }> = [
        { part: 'A', request: { publisherId: input.publisherId, profile, themes, recommendations: deterministicRecommendations.slice(0, CONTENT_PART_A_SIZE) } },
        ...(explanationsEnabled && deterministicRecommendations.length > CONTENT_PART_A_SIZE ? [{ part: 'B' as const, request: { publisherId: input.publisherId, profile, includeSummary: false, recommendations: deterministicRecommendations.slice(CONTENT_PART_A_SIZE) } }] : []),
      ];
      const outcomes = await Promise.all(parts.map(async ({ part, request }) => {
        const rejections: Array<ExplanationRejection | ExplanationShapeIssue> = [];
        const outcome = await this.runAI('report_content', async (observe) => {
          const raw = observe(await (this.ai!.provider as ProfessionalAIProvider).generateReportContent(request));
          const result = validateReportContent(raw, request, (rejection) => rejections.push(rejection));
          if (!result) throw new Error('invalid_report_content');
          return result;
        }, { publisherId: input.publisherId, requestId: input.requestId, part });
        return { part, request, rejections, ...outcome };
      }));
      const partA = outcomes.find((outcome) => outcome.part === 'A')!;
      if (partA.value?.summary) {
        generatedSummary = partA.value.summary;
        aiSummaryUsed = true;
        citedIds = new Set(partA.value.citedArticleIds ?? []);
        this.logQualityWarnings(input, 'summary', summaryQualityWarnings(partA.value.summary, partA.value.citedArticleIds ?? [], { jobTitle: profile.jobTitle, companyName: profile.companyName ?? profile.company.name }).map((code) => ({ code })));
      } else summaryFallbackReason = partA.errorCode ?? 'summary_missing';
      themeDescriptions = partA.value?.themeDescriptions;
      for (const outcome of outcomes) for (const articleId of outcome.value?.weakArticleIds ?? []) contentWeakIds.add(articleId);
      if (explanationsEnabled) {
        const accepted = outcomes.flatMap((outcome) => {
          if (!outcome.value) return [];
          this.logExplanationRejections(input, outcome.request, [...(outcome.value.explanations ?? []), ...(outcome.value.weakArticleIds ?? []).map((articleId) => ({ articleId }))], outcome.rejections);
          return outcome.value.explanations ?? [];
        });
        const articleById = new Map(ranked.map((item) => [item.article.id, item.article]));
        for (const item of accepted) {
          const article = articleById.get(item.articleId);
          explanationById.set(item.articleId, { explanation: item.explanation, angle: article ? angleForArticle(normalizeAngle(item.angle), article) : normalizeAngle(item.angle) });
        }
        aiExplanationUsed = explanationById.size > 0;
        this.logQualityWarnings(input, 'explanation', explanationQualityWarnings(accepted, new Map(ranked.map((item) => {
          const timing = articleTiming(item.article.publishedAt);
          return [item.article.id, { title: item.article.title, olderYear: timing.older ? timing.published : undefined }];
        }))));
      }
    }
    const aiExplanationMs = clockMs() - aiExplanationStartedAt;
    const afterContent = removeWeakFits(contentRanked, contentWeakIds);
    const weakFit = { kept: afterContent.kept, lowerConfidenceIds: new Set([...afterRerank.lowerConfidenceIds, ...afterContent.lowerConfidenceIds]) };
    if (!aiSummaryUsed) generatedSummary = reportSummary(profile, weakFit.kept.length);
    if (rerankWeakIds.size || contentWeakIds.size) this.logger?.info('weak_fit_removed', { requestId: input.requestId, publisherId: input.publisherId, weakFlagged: new Set([...rerankWeakIds, ...contentWeakIds]).size, weakFromRerank: rerankWeakIds.size, weakFromContent: contentWeakIds.size, weakRemoved: afterRerank.removed.length + afterContent.removed.length, weakKeptLowerConfidence: weakFit.lowerConfidenceIds.size, finalRecommendationCount: weakFit.kept.length });
    timing.cacheHit = ranking.timings.catalogueCacheHit && (ranking.timings.sourceFetchMs ?? 0) === 0 && (ranking.timings.sourceParseMs ?? 0) === 0 && (ranking.timings.normalizationMs ?? 0) === 0;
    timing.cacheAgeMs = ranking.timings.catalogueCacheAgeMs;
    timing.catalogueStale = ranking.timings.catalogueStale;
    timing.catalogueItemCount = ranking.normalizedArticleCount;
    timing.catalogueCacheLookupMs = ranking.timings.catalogueCacheLookupMs ?? 0;
    timing.catalogueSelectionMs = ranking.timings.catalogueSelectionMs;
    timing.catalogueSnapshotLookupMs = ranking.timings.catalogueSnapshotLookupMs ?? 0;
    timing.catalogueRefreshMs = ranking.timings.catalogueRefreshMs ?? 0;
    timing.catalogueRefreshReason = ranking.timings.catalogueRefreshReason;
    timing.sourceFetchMs = ranking.timings.sourceFetchMs ?? 0;
    timing.sourceReadMs = ranking.timings.sourceReadMs ?? 0;
    timing.sourceParseMs = ranking.timings.sourceParseMs ?? 0;
    timing.normalizationMs = ranking.timings.normalizationMs ?? 0;
    timing.preselectionMs = ranking.timings.preselectionMs;
    timing.deterministicRankingMs = ranking.timings.deterministicRankingMs;
    timing.aiRerankingMs = ranking.timings.aiRerankMs;
    timing.aiExplanationsMs = aiExplanationMs;
    timing.briefingSummaryMs = aiExplanationMs;
    this.markStage(input, 'ai_complete');
    const rawRecommendations = this.recommendationsFromRanked(profile, weakFit.kept, explanationById, citedIds, weakFit.lowerConfidenceIds).map((recommendation) => ({
      ...recommendation,
      rankingMetadata: {
        ...recommendation.rankingMetadata,
        aiProvider: aiRerankUsed || aiExplanationUsed ? this.ai?.provider.providerName : undefined,
      },
    }));
    const sectionAllocationStartedAt = clockMs();
    const allocation = allocateEditorialSections(rawRecommendations, definition.manifest?.reportSections ?? []);
    const sectionAllocationMs = clockMs() - sectionAllocationStartedAt;
    timing.sectionAllocationMs = sectionAllocationMs;
    const recommendations = allocation.recommendations;
    const ownCompanyCount = recommendations.filter((recommendation) => articleRelationship(recommendation.article, profile) === 'own_company').length;
    this.logger?.info('own_company_share', { requestId: input.requestId, publisherId: input.publisherId, ownCompanyShare: recommendations.length ? Number((ownCompanyCount / recommendations.length).toFixed(2)) : 0, ownCompanyCount, recommendationCount: recommendations.length, ownCompanyDeferred: ranking.ownCompanyDeferred });
    const report: ReportRecord = {
      id: reportId(), publisherId: input.publisherId, sessionId: activeSession, companyUrl: normalized.canonicalUrl, companyDomain: normalized.domain, companyName: profile.companyName, jobTitle: profile.jobTitle, professionalProfile: { ...profile, themes }, retrievalContext: profile.retrieval, overallMatchScore: displayRelevanceScore(recommendations.length ? recommendations.reduce((sum, item) => sum + item.displayScore, 0) / recommendations.length : 0), generatedSummary, summarySource: aiSummaryUsed ? 'ai' : 'deterministic', summaryFallbackReason: aiSummaryUsed ? undefined : summaryFallbackReason, recommendations, sections: allocation.sections, ...(themeDescriptions ? { themeDescriptions } : {}), generationVersion: GENERATION_VERSION, rankingVersion: RANKING_VERSION, professionalProfileVersion: profile.profileVersion, aiProviderVersion: aiProfileUsed || aiRerankUsed || aiSummaryUsed || aiExplanationUsed ? `${this.ai?.provider.providerName}:${this.ai?.config.model}` : 'deterministic', publisherConfigVersion: definition.manifest?.publisherConfigVersion ?? 'legacy', widgetVersion: WIDGET_VERSION, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const persistenceStartedAt = clockMs();
    try { await this.reports.save(report); } catch (error) { annotateGenerationFailure(error, 'report_persistence'); this.logIbiError(input, 'report_persistence', error); throw error; }
    const persistenceMs = clockMs() - persistenceStartedAt;
    timing.persistenceMs = persistenceMs;
    timing.totalMs = clockMs() - generationStartedAt;
    this.markStage(input, 'report_persisted');
    this.trackTimed(timing, 'report_generated', input.publisherId, activeSession, { reportId: report.id, resultCount: recommendations.length, rankingMode: aiRerankUsed ? 'hybrid' : 'deterministic', aiProfileUsed, aiRerankUsed, aiSummaryUsed, aiExplanationUsed });
    this.logIbi(input, 'ibi_generation_completed', { stage: 'complete', finalRecommendations: recommendations.length });
    this.logger?.info('report_generation_diagnostics', {
      requestId: input.requestId,
      publisherId: input.publisherId,
      companyResolutionMs,
      professionalProfileMs,
      sourceFetchMs: ranking.timings.sourceFetchMs ?? 0,
      sourceParseMs: ranking.timings.sourceParseMs ?? 0,
      normalizationMs: ranking.timings.normalizationMs ?? 0,
      cataloguePreparationMs: ranking.timings.cataloguePreparationMs ?? 0,
      aiExplanationMs,
      sectionAllocationMs,
      persistenceMs,
      totalGenerationMs: clockMs() - generationStartedAt,
      catalogueItemCount: ranking.normalizedArticleCount,
      candidateCount: ranking.retrievedCount,
      finalRecommendationCount: recommendations.length,
      ...ranking.timings,
    });
    timing.exclusionMs = ranking.timings.currentReportExclusionMs;
    this.logSlowSpans(timing);
    this.logger?.info('report_performance', { ...timing, totalMs: timing.totalMs });
    return report;
  }
}
