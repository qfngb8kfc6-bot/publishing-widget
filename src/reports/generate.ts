import { calibrateRelevanceScore, combineHybridScore, buildProfessionalProfile, createEvent, displayRelevanceScore, passesRelevanceThreshold, RANKING_VERSION, scoreProfessionalArticle, type Intent, type NormalizedArticle, type PublisherRegistry, type RelevanceResult, type RelevanceScoreComponents } from '../core';
import { AIProviderError } from '../ai/provider';
import { mergeProfessionalProfileEnhancement, validateReportContent, validateSemanticResults } from '../ai/validation';
import type { AIRecommendationLayer, EnrichedIntent, ProfessionalAIProvider, ReportContentRequest, SemanticCandidate } from '../ai/types';
import { BoundedCompanyInputResolver, classifyCompanyInput, type CompanyContextProvider, type CompanyInputResolver, type ResolvedCompanyInput } from '../server/company';
import { WIDGET_VERSION } from '../version';
import type { ReportRecord, ReportRecommendation, GenerateReportInput } from './types';
import type { ReportStore } from './types';
import type { StoredAnalyticsEvent } from '../analytics/types';
import type { AnalyticsStore } from '../analytics/types';
import { profileForTheme } from './themes';
import type { ServerLogFields, StructuredLogger } from '../server/logging';
import { safeLogText } from '../server/logging';
import { allocateEditorialSections, articleIdentityKeys } from './sections';
import { PublisherCatalogueCache, type CatalogueCacheDiagnostics } from './catalogue-cache';

export const GENERATION_VERSION = '1.2';

function clockMs(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

function cacheSafeSource(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cacheSafeSource);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'headers').map(([key, item]) => [key, cacheSafeSource(item)]));
}

function catalogueCacheKey(definition: NonNullable<ReturnType<PublisherRegistry['get']>>, runtimeDiagnostics?: Partial<ServerLogFields>): string | undefined {
  const source = definition.manifest?.contentSource;
  if (!source) return undefined;
  return JSON.stringify({ runtimeVersion: runtimeDiagnostics?.runtimeVersion ?? 0, configVersion: definition.manifest?.publisherConfigVersion ?? 'legacy', source: cacheSafeSource(source) });
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
  return {
    publisherId,
    answers: { companyUrl: profile.companyUrl, companyDomain: profile.companyDomain, companyName: profile.companyName ?? profile.company.name ?? '', jobTitle: profile.jobTitle },
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
  return {
    ...baseIntent,
    baseIntent,
    primaryThemes: profile.professionalInterests.slice(0, 24),
    relatedThemes: profile.retrieval.topicConcepts.slice(0, 32),
    searchTerms: profile.searchTerms.slice(0, 48),
    entities: profile.entities.slice(0, 24),
    excludedConcepts: profile.excludedConcepts.slice(0, 24),
    persona: profile.role.function,
    industry: profile.company.industry,
  };
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
}

export class ReportGenerationService {
  private readonly companyResolver: CompanyInputResolver;

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

  private async track(name: Parameters<typeof createEvent>[0], publisherId: string, sessionId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
    if (!this.analytics) return;
    const event = createEvent(name, publisherId, sessionId, metadata);
    await this.analytics.append([{ ...event, eventId: event.eventId!, schemaVersion: event.schemaVersion!, receivedAt: new Date().toISOString() } as StoredAnalyticsEvent]);
  }

  private canUseAI(definition: ReturnType<PublisherRegistry['get']>): definition is NonNullable<ReturnType<PublisherRegistry['get']>> {
    return Boolean(this.ai?.config.enabled && this.ai.config.provider !== 'none' && definition?.manifest?.features?.aiEnabled !== false && isProfessionalAIProvider(this.ai.provider));
  }

  private async rankProfile(definition: NonNullable<ReturnType<PublisherRegistry['get']>>, publisherId: string, profile: ReturnType<typeof buildProfessionalProfile>, excludedArticleKeys = new Set<string>(), requestId?: string, archiveWide = false, onStage?: (stage: string) => void): Promise<{ ranked: RankedCandidate[]; retrievedCount: number; normalizedCount: number; normalizedArticleCount: number; preselectionInputCount: number; preselectionOutputCount: number; rawCandidateCount: number; normalizedCandidateCount: number; excludedArticleCount: number; uniqueCandidateCount: number; thresholdInputCount: number; deterministicEligible: number; aiEligibleCount: number; aiInputCount: number; aiFilteredCount: number; aiRerankSurvivors: number; aiRerankUsed: boolean; timings: CatalogueCacheDiagnostics & { currentReportExclusionMs: number; preselectionMs: number; deterministicRankingMs: number; aiRerankMs: number; finalFormattingMs: number } }> {
    const intent = createIntent(profile, publisherId);
    let candidates: unknown[];
    const runtimeInfo = this.runtimeDiagnostics?.(publisherId);
    const cacheKey = catalogueCacheKey(definition, runtimeInfo);
    let catalogueDiagnostics: CatalogueCacheDiagnostics = { catalogueCacheHit: false, catalogueCacheAgeMs: 0, catalogueRefreshMs: 0, catalogueRefreshReason: 'cold' };
    let normalizationMs = 0;
    let usedCatalogueCache = false;
    let catalogueItemCount = 0;
    const catalogueLoadStartedAt = clockMs();
    try {
      const limit = Math.max(definition.config.content.candidateRetrievalLimit, 30);
      const archiveAdapter = definition.adapter as typeof definition.adapter & { loadCatalogue?: (options?: { limit?: number; onDebug?: import('../core').DebugSink }) => Promise<unknown[]>; selectCatalogue?: (articles: NormalizedArticle[], intent: Intent, options: { limit: number; archiveWide?: boolean }) => NormalizedArticle[]; sourceTimings?: { sourceFetchMs?: number; sourceParseMs?: number; normalizationMs?: number; cataloguePreparationMs?: number } };
      if (cacheKey && archiveAdapter.loadCatalogue) {
        usedCatalogueCache = true;
        const loaded = await this.catalogueCache.get(publisherId, cacheKey, async () => {
          const raw = await archiveAdapter.loadCatalogue!({ limit, onDebug: undefined });
          const normalizeStartedAt = clockMs();
          let normalized: NormalizedArticle[];
          try {
            normalized = raw.flatMap((item) => {
              const article = definition.adapter.normalizeArticle(item);
              return article ? [article] : [];
            });
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
        catalogueDiagnostics = loaded.diagnostics;
        catalogueItemCount = loaded.articles.length;
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
        const selected = archiveAdapter.selectCatalogue ? archiveAdapter.selectCatalogue(loaded.articles, intent, { limit, archiveWide }) : loaded.articles;
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
    const preselected = archiveWide
      ? unique
        .map((article) => ({ article, score: scoreProfessionalArticle(article, profile).score }))
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
        const result = scoreProfessionalArticle(article, profile);
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
    let ranked = deterministicRanked.slice(0, finalLimit);
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
        }));
        const semanticResults = validateSemanticResults(await withTimeout(this.ai!.provider.rerank(createEnrichedIntent(profile, publisherId), semanticCandidates), this.ai!.config.timeoutMs), semanticCandidates);
        if (semanticResults.length === 0) throw new Error('no_valid_rerank_results');
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
          return [{ ...result, semanticScore, semanticSignals: semantic.signals ?? [], finalScore, rankingMode: 'hybrid' as const, relevanceType, confidence: semantic.confidence ?? result.confidence, index }];
        });
        const aiRanked = aiRankedCandidates
          .sort((a, b) => (a.relevanceType === b.relevanceType
            ? b.finalScore - a.finalScore
              || b.deterministicScore - a.deterministicScore
              || (b.scoreComponents?.postRecencyScore ?? b.deterministicScore) - (a.scoreComponents?.postRecencyScore ?? a.deterministicScore)
              || a.index - b.index
            : a.relevanceType === 'direct' ? -1 : 1))
          .slice(0, finalLimit)
          .map(({ index: _index, ...result }) => result);
        aiFilteredCount = aiEligibleCount - aiRankedCandidates.length;
        // A valid deterministic candidate set is always a safe fallback. A
        // partial or over-aggressive semantic response must not turn a useful
        // theme search into an empty result.
        if (aiRanked.length > 0) {
          ranked = aiRanked;
          aiRerankUsed = true;
        } else {
          ranked = deterministicRanked.slice(0, finalLimit);
        }
      } catch { /* deterministic ranking remains authoritative */ }
    } else {
      ranked = ranked.slice(0, finalLimit);
    }
    const aiRerankMs = clockMs() - aiStartedAt;
    onStage?.('ranking_complete');
    this.logIbi({ publisherId, requestId }, 'ibi_generation_ranking_output', { stage: 'ranking', deterministicEligible: deterministicRanked.length, aiRerankSurvivors: aiRerankUsed ? ranked.length : 0, finalRecommendations: ranked.length });
    const finalFormattingStartedAt = clockMs();
    const timings = { ...catalogueDiagnostics, normalizationMs: catalogueDiagnostics.normalizationMs ?? normalizationMs, cataloguePreparationMs: catalogueDiagnostics.cataloguePreparationMs ?? (clockMs() - catalogueLoadStartedAt), currentReportExclusionMs, preselectionMs, deterministicRankingMs, aiRerankMs, finalFormattingMs: clockMs() - finalFormattingStartedAt };
    return { ranked, retrievedCount: candidates.length, normalizedCount: unique.length, normalizedArticleCount, preselectionInputCount, preselectionOutputCount, rawCandidateCount: candidates.length, normalizedCandidateCount: normalizedCandidates.length, excludedArticleCount, uniqueCandidateCount: unique.length, thresholdInputCount: preselected.length, deterministicEligible: deterministicRanked.length, aiEligibleCount, aiInputCount: aiEligibleCount, aiFilteredCount, aiRerankSurvivors: aiRerankUsed ? ranked.length : 0, aiRerankUsed, timings };
  }

  private recommendationsFromRanked(profile: ReturnType<typeof buildProfessionalProfile>, ranked: RankedCandidate[], explanationById = new Map<string, string>()): ReportRecommendation[] {
    return ranked.map((item, index) => ({
      articleId: item.article.id,
      rank: index + 1,
      rawScore: item.finalScore,
      displayScore: displayRelevanceScore(item.finalScore),
      explanation: explanationById.get(item.article.id) ?? explanation(profile, item),
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
      },
    }));
  }

  async searchTheme(report: ReportRecord, theme: string): Promise<ReportRecommendation[]> {
    const themeStartedAt = clockMs();
    const definition = this.registry.get(report.publisherId);
    if (!definition || definition.manifest?.enabled === false) throw new Error('invalid_publisher');
    const profile = profileForTheme(report.professionalProfile, theme);
    const excluded = new Set(report.recommendations.flatMap((recommendation) => articleIdentityKeys(recommendation.article)));
    const ranking = await this.rankProfile(definition, report.publisherId, profile, excluded, undefined, true);
    const { ranked } = ranking;
    const failureStage = ranked.length > 0 ? 'complete' : ranking.aiFilteredCount > 0 && ranking.deterministicEligible > 0 ? 'ai_filtered_all' : ranking.deterministicEligible > 0 ? 'final_filter' : 'deterministic_threshold';
    const finalFormattingStartedAt = clockMs();
    const recommendations = this.recommendationsFromRanked(profile, ranked);
    this.logger?.info('theme_retrieval_diagnostics', { publisherId: report.publisherId, theme: safeLogText(theme, 160), catalogueCount: ranking.normalizedArticleCount, catalogueItemCount: ranking.normalizedArticleCount, rawCandidateCount: ranking.rawCandidateCount, candidateCount: ranking.retrievedCount, normalizedCandidateCount: ranking.normalizedCandidateCount, preselectionInputCount: ranking.preselectionInputCount, preselectionOutputCount: ranking.preselectionOutputCount, excludedCurrentReportCount: report.recommendations.length, excludedArticleCount: ranking.excludedArticleCount, uniqueCandidateCount: ranking.uniqueCandidateCount, thresholdInputCount: ranking.thresholdInputCount, deterministicEligibleCount: ranking.deterministicEligible, aiEligibleCount: ranking.aiEligibleCount, aiInputCount: ranking.aiInputCount, aiFilteredCount: ranking.aiFilteredCount, finalResultCount: ranked.length, finalRecommendationCount: ranked.length, excludedExistingCount: report.recommendations.length, eligibleCount: ranking.deterministicEligible, failureStage, ...ranking.timings, totalThemeSearchMs: clockMs() - themeStartedAt, finalFormattingMs: clockMs() - finalFormattingStartedAt });
    return recommendations;
  }

  async generate(input: GenerateReportInput): Promise<ReportRecord> {
    const generationStartedAt = clockMs();
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
    await this.track('generation_started', input.publisherId, activeSession);
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
    this.markStage(input, 'company_resolved');
    const resolutionDiagnostics: Partial<ServerLogFields> = {
      companyInputType: normalized.inputType,
      companyResolutionAttempted: normalized.inputType === 'company_name',
      companyResolutionSucceeded: true,
      resolvedHostnamePresent: Boolean(normalized.domain),
      resolutionMethod: normalized.resolutionMethod,
    };
    await this.track('company_analysis_started', input.publisherId, activeSession);
    let company: Awaited<ReturnType<CompanyContextProvider['getContext']>>;
    try { company = await this.companyProvider.getContext(normalized.domain); }
    catch (error) { annotateGenerationFailure(error, 'company_context'); this.logIbiError(input, 'company_context', error, resolutionDiagnostics); throw error; }
    if (normalized.displayName) company = { ...company, name: normalized.displayName };
    await this.track('company_analysis_completed', input.publisherId, activeSession, { industry: company.industry ?? 'unknown' });
    let profile: ReturnType<typeof buildProfessionalProfile>;
    const profileStartedAt = clockMs();
    try {
      profile = buildProfessionalProfile(company, jobTitle);
    } catch (error) {
      annotateGenerationFailure(error, 'profile');
      this.logIbiError(input, 'profile', error, resolutionDiagnostics);
      throw error;
    }
    const professionalProfileMs = clockMs() - profileStartedAt;
    let aiProfileUsed = false;
    if (this.canUseAI(definition)) {
      try {
        const raw = await withTimeout((this.ai!.provider as ProfessionalAIProvider).enhanceProfessionalProfile({ publisherId: input.publisherId, submittedCompanyUrl: normalized.canonicalUrl, submittedJobTitle: jobTitle, company, role: profile.role, profile }), this.ai!.config.timeoutMs);
        const merged = mergeProfessionalProfileEnhancement(profile, raw);
        if (merged) { profile = merged; aiProfileUsed = true; }
      } catch { /* deterministic profile remains authoritative */ }
    }
    this.markStage(input, 'profile_built');
    await this.track('role_analysis_completed', input.publisherId, activeSession, { roleFunction: profile.role.function });
    await this.track('profile_generated', input.publisherId, activeSession, { roleFunction: profile.role.function, industry: company.industry ?? 'unknown', aiProfileUsed });
    await this.track('retrieval_started', input.publisherId, activeSession);
    let ranking: Awaited<ReturnType<ReportGenerationService['rankProfile']>>;
    try {
      ranking = await this.rankProfile(definition, input.publisherId, profile, new Set<string>(), input.requestId, false, (stage) => this.markStage(input, stage));
    } catch (error) {
      const stage = (error as GenerationFailure).generationStage ?? 'ranking';
      annotateGenerationFailure(error, stage);
      this.logIbiError(input, stage, error, resolutionDiagnostics);
      throw error;
    }
    const ranked = ranking.ranked;
    const aiRerankUsed = ranking.aiRerankUsed;
    this.logger?.info('report_retrieval_diagnostics', { requestId: input.requestId, publisherId: input.publisherId, normalizedArticles: ranking.normalizedCount, normalizedArticleCount: ranking.normalizedArticleCount, catalogueItemCount: ranking.normalizedArticleCount, preselectionInputCount: ranking.preselectionInputCount, preselectionOutputCount: ranking.preselectionOutputCount, retrievalCandidates: ranking.retrievedCount, candidateCount: ranking.retrievedCount, rankingCandidateCount: ranking.retrievedCount, deterministicEligible: ranking.deterministicEligible, eligibleCount: ranking.deterministicEligible, finalRecommendations: ranked.length, finalRecommendationCount: ranked.length, ...ranking.timings });
    this.logIbi(input, 'ibi_generation_counts', { stage: 'ranking', retrievalCandidates: ranking.retrievedCount, normalizedArticles: ranking.normalizedCount, deterministicEligible: ranking.deterministicEligible, aiRerankSurvivors: ranking.aiRerankSurvivors, finalRecommendations: ranked.length });
    const aiAvailable = this.canUseAI(definition);
    await this.track('retrieval_completed', input.publisherId, activeSession, { resultCount: ranking.retrievedCount });
    await this.track('ranking_completed', input.publisherId, activeSession, { resultCount: ranked.length, rankingMode: aiRerankUsed ? 'hybrid' : 'deterministic', aiRerankUsed });
    const deterministicRecommendations = ranked.map((item) => ({
      article: item.article,
      deterministicExplanation: explanation(profile, item),
      relevanceSignals: item.relevanceSignals,
      semanticSignals: item.semanticSignals,
    }));
    let generatedSummary = reportSummary(profile, ranked.length);
    const explanationById = new Map<string, string>();
    let aiSummaryUsed = false;
    let aiExplanationUsed = false;
    const aiExplanationStartedAt = clockMs();
    if (aiAvailable && ranked.length > 0) {
      try {
        const contentRequest: ReportContentRequest = { publisherId: input.publisherId, profile, recommendations: deterministicRecommendations };
        const raw = await withTimeout((this.ai!.provider as ProfessionalAIProvider).generateReportContent(contentRequest), this.ai!.config.timeoutMs);
        const validated = validateReportContent(raw, contentRequest);
        if (validated?.summary) { generatedSummary = validated.summary; aiSummaryUsed = true; }
        if (this.ai!.config.explanationsEnabled && validated) {
          for (const item of validated.explanations ?? []) explanationById.set(item.articleId, item.explanation);
          aiExplanationUsed = explanationById.size > 0;
        }
      } catch { /* deterministic summary and explanations remain authoritative */ }
    }
    const aiExplanationMs = clockMs() - aiExplanationStartedAt;
    this.markStage(input, 'ai_complete');
    const rawRecommendations = this.recommendationsFromRanked(profile, ranked, explanationById).map((recommendation) => ({
      ...recommendation,
      rankingMetadata: {
        ...recommendation.rankingMetadata,
        aiProvider: aiRerankUsed || aiExplanationUsed ? this.ai?.provider.providerName : undefined,
      },
    }));
    const sectionAllocationStartedAt = clockMs();
    const allocation = allocateEditorialSections(rawRecommendations, definition.manifest?.reportSections ?? []);
    const sectionAllocationMs = clockMs() - sectionAllocationStartedAt;
    const recommendations = allocation.recommendations;
    const report: ReportRecord = {
      id: reportId(), publisherId: input.publisherId, sessionId: activeSession, companyUrl: normalized.canonicalUrl, companyDomain: normalized.domain, companyName: profile.companyName, jobTitle: profile.jobTitle, professionalProfile: profile, retrievalContext: profile.retrieval, overallMatchScore: displayRelevanceScore(recommendations.length ? recommendations.reduce((sum, item) => sum + item.displayScore, 0) / recommendations.length : 0), generatedSummary, recommendations, sections: allocation.sections, generationVersion: GENERATION_VERSION, rankingVersion: RANKING_VERSION, professionalProfileVersion: profile.profileVersion, aiProviderVersion: aiProfileUsed || aiRerankUsed || aiSummaryUsed || aiExplanationUsed ? `${this.ai?.provider.providerName}:${this.ai?.config.model}` : 'deterministic', publisherConfigVersion: definition.manifest?.publisherConfigVersion ?? 'legacy', widgetVersion: WIDGET_VERSION, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const persistenceStartedAt = clockMs();
    try { await this.reports.save(report); } catch (error) { annotateGenerationFailure(error, 'report_persistence'); this.logIbiError(input, 'report_persistence', error); throw error; }
    const persistenceMs = clockMs() - persistenceStartedAt;
    this.markStage(input, 'report_persisted');
    try {
      await this.track('report_generated', input.publisherId, activeSession, { reportId: report.id, resultCount: recommendations.length, rankingMode: aiRerankUsed ? 'hybrid' : 'deterministic', aiProfileUsed, aiRerankUsed, aiExplanationUsed });
    } catch (error) {
      annotateGenerationFailure(error, 'analytics');
      this.logIbiError(input, 'analytics', error);
      throw error;
    }
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
    return report;
  }
}
