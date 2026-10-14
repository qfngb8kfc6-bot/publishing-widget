import { calibrateRelevanceScore, combineHybridScore, buildProfessionalProfile, createEvent, displayRelevanceScore, passesRelevanceThreshold, RANKING_VERSION, scoreProfessionalArticle, type Intent, type NormalizedArticle, type PublisherRegistry, type RelevanceResult } from '../core';
import { AIProviderError } from '../ai/provider';
import { mergeProfessionalProfileEnhancement, validateReportContent, validateSemanticResults } from '../ai/validation';
import type { AIRecommendationLayer, EnrichedIntent, ProfessionalAIProvider, ReportContentRequest, SemanticCandidate } from '../ai/types';
import { normalizeCompanyUrl, type CompanyContextProvider } from '../server/company';
import { WIDGET_VERSION } from '../version';
import type { ReportRecord, ReportRecommendation, GenerateReportInput } from './types';
import type { ReportStore } from './types';
import type { StoredAnalyticsEvent } from '../analytics/types';
import type { AnalyticsStore } from '../analytics/types';
import { profileForTheme } from './themes';
import type { StructuredLogger } from '../server/logging';
import { safeLogText } from '../server/logging';
import { allocateEditorialSections, articleIdentityKeys } from './sections';

export const GENERATION_VERSION = '1.2';

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
}

export class ReportGenerationService {
  constructor(private readonly registry: PublisherRegistry, private readonly companyProvider: CompanyContextProvider, private readonly reports: ReportStore, private readonly analytics?: AnalyticsStore, private readonly ai?: AIRecommendationLayer, private readonly logger?: StructuredLogger) {}

  private logIbi(input: Pick<GenerateReportInput, 'publisherId' | 'requestId'>, message: string, fields: Parameters<StructuredLogger['info']>[1] = {}): void {
    if (input.publisherId !== 'ibi' || !this.logger) return;
    this.logger.info(message, { requestId: input.requestId, publisherId: input.publisherId, ...fields });
  }

  private logIbiError(input: Pick<GenerateReportInput, 'publisherId' | 'requestId'>, stage: string, error: unknown): void {
    if (input.publisherId !== 'ibi' || !this.logger) return;
    this.logger.error('ibi_generation_failed', {
      requestId: input.requestId,
      publisherId: input.publisherId,
      stage,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: safeLogText(error instanceof Error ? error.message : 'Unknown generation failure'),
    });
  }

  private async track(name: Parameters<typeof createEvent>[0], publisherId: string, sessionId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
    if (!this.analytics) return;
    const event = createEvent(name, publisherId, sessionId, metadata);
    await this.analytics.append([{ ...event, eventId: event.eventId!, schemaVersion: event.schemaVersion!, receivedAt: new Date().toISOString() } as StoredAnalyticsEvent]);
  }

  private canUseAI(definition: ReturnType<PublisherRegistry['get']>): definition is NonNullable<ReturnType<PublisherRegistry['get']>> {
    return Boolean(this.ai?.config.enabled && this.ai.config.provider !== 'none' && definition?.manifest?.features?.aiEnabled !== false && isProfessionalAIProvider(this.ai.provider));
  }

  private async rankProfile(definition: NonNullable<ReturnType<PublisherRegistry['get']>>, publisherId: string, profile: ReturnType<typeof buildProfessionalProfile>, excludedArticleKeys = new Set<string>(), requestId?: string): Promise<{ ranked: RankedCandidate[]; retrievedCount: number; normalizedCount: number; normalizedArticleCount: number; preselectionInputCount: number; preselectionOutputCount: number; deterministicEligible: number; aiRerankSurvivors: number; aiRerankUsed: boolean }> {
    const intent = createIntent(profile, publisherId);
    let candidates: unknown[];
    try {
      candidates = await definition.adapter.search(intent, {
        limit: Math.max(definition.config.content.candidateRetrievalLimit, 30),
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
    } catch (error) {
      this.logIbiError({ publisherId, requestId }, 'retrieval', error);
      throw error;
    }
    const normalizedArticles = candidates.flatMap((raw) => {
      const article = definition.adapter.normalizeArticle(raw);
      return article && articleIdentityKeys(article).every((key) => !excludedArticleKeys.has(key)) ? [article] : [];
    });
    const seenArticleKeys = new Set<string>();
    const unique = normalizedArticles.filter((article) => {
      const keys = articleIdentityKeys(article);
      if (keys.some((key) => seenArticleKeys.has(key))) return false;
      keys.forEach((key) => seenArticleKeys.add(key));
      return true;
    });
    const finalLimit = Math.min(definition.config.results.maximumRecommendations, definition.config.content.resultLimit);
    const aiAvailable = this.canUseAI(definition);
    const deterministicRanked: RankedCandidate[] = unique
      .map((article) => {
        const result = scoreProfessionalArticle(article, profile);
        return { article, relevanceSignals: result.relevanceSignals, deterministicScore: result.score, semanticSignals: [], finalScore: result.score, rankingMode: 'deterministic' as const, relevanceType: result.relevanceType === 'adjacent' ? 'adjacent' as const : 'direct' as const, confidence: result.confidence, directMatches: result.directMatches ?? [], adjacentMatches: result.adjacentMatches ?? [], result };
      })
      .filter((item) => passesRelevanceThreshold(item.result))
      .sort((a, b) => (a.relevanceType === b.relevanceType ? b.deterministicScore - a.deterministicScore : a.relevanceType === 'direct' ? -1 : 1))
      .map(({ result: _result, ...item }) => item);
    const sourceStats = (definition.adapter as { lastDiagnostics?: { sourceStats?: { normalizedArticles?: number; preselectionInputCount?: number; preselectionOutputCount?: number } } }).lastDiagnostics?.sourceStats;
    const normalizedArticleCount = sourceStats?.normalizedArticles ?? candidates.length;
    const preselectionInputCount = sourceStats?.preselectionInputCount ?? normalizedArticleCount;
    const preselectionOutputCount = sourceStats?.preselectionOutputCount ?? candidates.length;
    this.logIbi({ publisherId, requestId }, 'ibi_generation_ranking_input', { stage: 'ranking', retrievalCandidates: candidates.length, rankingCandidateCount: candidates.length, normalizedArticles: unique.length, normalizedArticleCount, preselectionInputCount, preselectionOutputCount, deterministicEligible: deterministicRanked.length, eligibleCount: deterministicRanked.length });
    let ranked = deterministicRanked.slice(0, finalLimit);
    let aiRerankUsed = false;
    if (aiAvailable && deterministicRanked.length > 0) {
      try {
        const semanticCandidates: SemanticCandidate[] = deterministicRanked.slice(0, this.ai!.config.rerankLimit).map((result) => ({
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
        ranked = deterministicRanked.flatMap((result, index) => {
          const semantic = semanticById.get(result.article.id);
          if (!semantic) return [];
          const semanticScore = semantic.semanticScore ?? result.deterministicScore;
          if (semantic.keep === false) return [];
          const relevanceType = result.relevanceType === 'adjacent' ? 'adjacent' as const : semantic.relevanceType ?? result.relevanceType;
          const finalScore = calibrateRelevanceScore(combineHybridScore(result.deterministicScore, semanticScore, { deterministic: deterministicWeight, semantic: semanticWeight }), relevanceType);
          if (!passesRelevanceThreshold({ score: finalScore, relevanceSignals: result.relevanceSignals, relevanceType })) return [];
          return [{ ...result, semanticScore, semanticSignals: semantic.signals ?? [], finalScore, rankingMode: 'hybrid' as const, relevanceType, confidence: semantic.confidence ?? result.confidence, index }];
        }).sort((a, b) => (a.relevanceType === b.relevanceType ? b.finalScore - a.finalScore || b.deterministicScore - a.deterministicScore || a.index - b.index : a.relevanceType === 'direct' ? -1 : 1)).slice(0, finalLimit).map(({ index: _index, ...result }) => result);
        aiRerankUsed = true;
      } catch { /* deterministic ranking remains authoritative */ }
    } else {
      ranked = ranked.slice(0, finalLimit);
    }
    this.logIbi({ publisherId, requestId }, 'ibi_generation_ranking_output', { stage: 'ranking', deterministicEligible: deterministicRanked.length, aiRerankSurvivors: aiRerankUsed ? ranked.length : 0, finalRecommendations: ranked.length });
    return { ranked, retrievedCount: candidates.length, normalizedCount: unique.length, normalizedArticleCount, preselectionInputCount, preselectionOutputCount, deterministicEligible: deterministicRanked.length, aiRerankSurvivors: aiRerankUsed ? ranked.length : 0, aiRerankUsed };
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
        aiProvider: item.rankingMode === 'hybrid' ? this.ai?.provider.providerName : undefined,
      },
    }));
  }

  async searchTheme(report: ReportRecord, theme: string): Promise<ReportRecommendation[]> {
    const definition = this.registry.get(report.publisherId);
    if (!definition || definition.manifest?.enabled === false) throw new Error('invalid_publisher');
    const profile = profileForTheme(report.professionalProfile, theme);
    const excluded = new Set(report.recommendations.flatMap((recommendation) => articleIdentityKeys(recommendation.article)));
    const ranking = await this.rankProfile(definition, report.publisherId, profile, excluded);
    this.logger?.info('theme_retrieval_diagnostics', { publisherId: report.publisherId, theme: safeLogText(theme, 160), catalogueCount: ranking.preselectionInputCount, preselectionCount: ranking.preselectionOutputCount, excludedExistingCount: report.recommendations.length, eligibleCount: ranking.deterministicEligible });
    const { ranked } = ranking;
    return this.recommendationsFromRanked(profile, ranked);
  }

  async generate(input: GenerateReportInput): Promise<ReportRecord> {
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
    let normalized: ReturnType<typeof normalizeCompanyUrl>;
    try { normalized = normalizeCompanyUrl(input.companyUrl); } catch (error) { this.logIbiError(input, 'company_normalization', error); throw error; }
    await this.track('company_analysis_started', input.publisherId, activeSession);
    let company: Awaited<ReturnType<CompanyContextProvider['getContext']>>;
    try { company = await this.companyProvider.getContext(normalized.domain); }
    catch (error) { this.logIbiError(input, 'company_context', error); throw error; }
    await this.track('company_analysis_completed', input.publisherId, activeSession, { industry: company.industry ?? 'unknown' });
    let profile = buildProfessionalProfile(company, jobTitle);
    let aiProfileUsed = false;
    if (this.canUseAI(definition)) {
      try {
        const raw = await withTimeout((this.ai!.provider as ProfessionalAIProvider).enhanceProfessionalProfile({ publisherId: input.publisherId, submittedCompanyUrl: normalized.canonicalUrl, submittedJobTitle: jobTitle, company, role: profile.role, profile }), this.ai!.config.timeoutMs);
        const merged = mergeProfessionalProfileEnhancement(profile, raw);
        if (merged) { profile = merged; aiProfileUsed = true; }
      } catch { /* deterministic profile remains authoritative */ }
    }
    await this.track('role_analysis_completed', input.publisherId, activeSession, { roleFunction: profile.role.function });
    await this.track('profile_generated', input.publisherId, activeSession, { roleFunction: profile.role.function, industry: company.industry ?? 'unknown', aiProfileUsed });
    await this.track('retrieval_started', input.publisherId, activeSession);
    const ranking = await this.rankProfile(definition, input.publisherId, profile, new Set<string>(), input.requestId);
    const ranked = ranking.ranked;
    const aiRerankUsed = ranking.aiRerankUsed;
    this.logger?.info('report_retrieval_diagnostics', { requestId: input.requestId, publisherId: input.publisherId, normalizedArticles: ranking.normalizedCount, normalizedArticleCount: ranking.normalizedArticleCount, preselectionInputCount: ranking.preselectionInputCount, preselectionOutputCount: ranking.preselectionOutputCount, retrievalCandidates: ranking.retrievedCount, rankingCandidateCount: ranking.retrievedCount, deterministicEligible: ranking.deterministicEligible, eligibleCount: ranking.deterministicEligible, finalRecommendations: ranked.length, finalRecommendationCount: ranked.length });
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
    const rawRecommendations = this.recommendationsFromRanked(profile, ranked, explanationById).map((recommendation) => ({
      ...recommendation,
      rankingMetadata: {
        ...recommendation.rankingMetadata,
        aiProvider: aiRerankUsed || aiExplanationUsed ? this.ai?.provider.providerName : undefined,
      },
    }));
    const allocation = allocateEditorialSections(rawRecommendations, definition.manifest?.reportSections ?? []);
    const recommendations = allocation.recommendations;
    const report: ReportRecord = {
      id: reportId(), publisherId: input.publisherId, sessionId: activeSession, companyUrl: normalized.canonicalUrl, companyDomain: normalized.domain, companyName: profile.companyName, jobTitle: profile.jobTitle, professionalProfile: profile, retrievalContext: profile.retrieval, overallMatchScore: displayRelevanceScore(recommendations.length ? recommendations.reduce((sum, item) => sum + item.displayScore, 0) / recommendations.length : 0), generatedSummary, recommendations, sections: allocation.sections, generationVersion: GENERATION_VERSION, rankingVersion: RANKING_VERSION, professionalProfileVersion: profile.profileVersion, aiProviderVersion: aiProfileUsed || aiRerankUsed || aiSummaryUsed || aiExplanationUsed ? `${this.ai?.provider.providerName}:${this.ai?.config.model}` : 'deterministic', publisherConfigVersion: definition.manifest?.publisherConfigVersion ?? 'legacy', widgetVersion: WIDGET_VERSION, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    try { await this.reports.save(report); } catch (error) { this.logIbiError(input, 'report_persistence', error); throw error; }
    await this.track('report_generated', input.publisherId, activeSession, { reportId: report.id, resultCount: recommendations.length, rankingMode: aiRerankUsed ? 'hybrid' : 'deterministic', aiProfileUsed, aiRerankUsed, aiExplanationUsed });
    this.logIbi(input, 'ibi_generation_completed', { stage: 'complete', finalRecommendations: recommendations.length });
    return report;
  }
}
