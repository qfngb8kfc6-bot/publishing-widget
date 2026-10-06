import { combineHybridScore, buildProfessionalProfile, createEvent, displayRelevanceScore, RANKING_VERSION, scoreProfessionalArticle, type Intent, type NormalizedArticle, type PublisherRegistry } from '../core';
import { AIProviderError } from '../ai/provider';
import { mergeProfessionalProfileEnhancement, validateReportContent, validateSemanticResults } from '../ai/validation';
import type { AIRecommendationLayer, EnrichedIntent, ProfessionalAIProvider, ReportContentRequest, SemanticCandidate } from '../ai/types';
import { normalizeCompanyUrl, type CompanyContextProvider } from '../server/company';
import { WIDGET_VERSION } from '../version';
import type { ReportRecord, GenerateReportInput } from './types';
import type { ReportStore } from './types';
import type { StoredAnalyticsEvent } from '../analytics/types';
import type { AnalyticsStore } from '../analytics/types';

export const GENERATION_VERSION = '1.1';

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
    answers: { companyUrl: profile.companyUrl, jobTitle: profile.jobTitle },
    queryText: profile.semanticQueries.join(' '),
    keywords: profile.searchTerms,
    interests: profile.professionalInterests,
    personas: [profile.role.function, ...profile.role.professionalThemes],
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

function explanation(profile: ReturnType<typeof buildProfessionalProfile>, relevanceSignals: string[]): string {
  const signal = relevanceSignals[0] ?? 'comes from the publisher’s coverage';
  return `${signal.charAt(0).toUpperCase()}${signal.slice(1)}, with a focus on developments relevant to ${profile.role.rawTitle} at ${profile.companyName ?? profile.companyDomain}.`;
}

function reportSummary(profile: ReturnType<typeof buildProfessionalProfile>): string {
  return `Based on your role in ${profile.role.rawTitle} at ${profile.companyName ?? profile.companyDomain}, this briefing focuses on ${profile.professionalInterests.slice(0, 4).join(', ')} and developments most likely to matter to your work.`;
}

interface RankedCandidate {
  article: NormalizedArticle;
  relevanceSignals: string[];
  deterministicScore: number;
  semanticScore?: number;
  semanticSignals: string[];
  finalScore: number;
  rankingMode: 'deterministic' | 'hybrid';
}

export class ReportGenerationService {
  constructor(private readonly registry: PublisherRegistry, private readonly companyProvider: CompanyContextProvider, private readonly reports: ReportStore, private readonly analytics?: AnalyticsStore, private readonly ai?: AIRecommendationLayer) {}

  private async track(name: Parameters<typeof createEvent>[0], publisherId: string, sessionId: string, metadata?: Record<string, string | number | boolean>): Promise<void> {
    if (!this.analytics) return;
    const event = createEvent(name, publisherId, sessionId, metadata);
    await this.analytics.append([{ ...event, eventId: event.eventId!, schemaVersion: event.schemaVersion!, receivedAt: new Date().toISOString() } as StoredAnalyticsEvent]);
  }

  private canUseAI(definition: ReturnType<PublisherRegistry['get']>): definition is NonNullable<ReturnType<PublisherRegistry['get']>> {
    return Boolean(this.ai?.config.enabled && this.ai.config.provider !== 'none' && definition?.manifest?.features?.aiEnabled !== false && isProfessionalAIProvider(this.ai.provider));
  }

  async generate(input: GenerateReportInput): Promise<ReportRecord> {
    const definition = this.registry.get(input.publisherId);
    if (!definition) throw new Error('invalid_publisher');
    const jobTitle = input.jobTitle.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!jobTitle) throw new Error('job_title_required');
    const activeSession = input.sessionId ?? sessionId();
    await this.track('generation_started', input.publisherId, activeSession);
    const normalized = normalizeCompanyUrl(input.companyUrl);
    await this.track('company_analysis_started', input.publisherId, activeSession);
    const company = await this.companyProvider.getContext(normalized.domain);
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
    const intent = createIntent(profile, input.publisherId);
    await this.track('retrieval_started', input.publisherId, activeSession);
    const candidates = await definition.adapter.search(intent, { limit: Math.max(definition.config.content.candidateRetrievalLimit, 30) });
    await this.track('retrieval_completed', input.publisherId, activeSession, { resultCount: candidates.length });
    const normalizedArticles = candidates.flatMap((raw) => {
      const article = definition.adapter.normalizeArticle(raw);
      return article ? [article] : [];
    });
    const unique = [...new Map(normalizedArticles.map((article) => [article.id, article])).values()];
    const finalLimit = Math.min(definition.config.results.maximumRecommendations, definition.config.content.resultLimit);
    const aiAvailable = this.canUseAI(definition);
    const candidateLimit = aiAvailable ? Math.min(unique.length, Math.max(finalLimit, this.ai!.config.rerankLimit)) : finalLimit;
    const deterministicRanked: RankedCandidate[] = unique
      .map((article) => {
        const result = scoreProfessionalArticle(article, profile);
        return { article, relevanceSignals: result.relevanceSignals, deterministicScore: result.score, semanticSignals: [], finalScore: result.score, rankingMode: 'deterministic' as const };
      })
      .sort((a, b) => b.deterministicScore - a.deterministicScore)
      .slice(0, candidateLimit);
    let ranked = deterministicRanked;
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
        }));
        const semanticResults = validateSemanticResults(await withTimeout(this.ai!.provider.rerank(createEnrichedIntent(profile, input.publisherId), semanticCandidates), this.ai!.config.timeoutMs), semanticCandidates);
        if (semanticResults.length === 0) throw new Error('no_valid_rerank_results');
        const semanticById = new Map(semanticResults.map((result) => [result.articleId, result]));
        const deterministicWeight = definition.manifest?.ranking?.deterministicWeight ?? this.ai!.config.deterministicWeight;
        const semanticWeight = definition.manifest?.ranking?.semanticWeight ?? this.ai!.config.semanticWeight;
        ranked = deterministicRanked.map((result, index) => {
          const semantic = semanticById.get(result.article.id);
          const semanticScore = semantic?.semanticScore ?? result.deterministicScore;
          return { ...result, semanticScore, semanticSignals: semantic?.signals ?? [], finalScore: combineHybridScore(result.deterministicScore, semanticScore, { deterministic: deterministicWeight, semantic: semanticWeight }), rankingMode: 'hybrid' as const, index };
        }).sort((a, b) => b.finalScore - a.finalScore || b.deterministicScore - a.deterministicScore || a.index - b.index).slice(0, finalLimit).map(({ index: _index, ...result }) => result);
        aiRerankUsed = true;
      } catch { /* deterministic ranking remains authoritative */ }
    } else {
      ranked = ranked.slice(0, finalLimit);
    }
    await this.track('ranking_completed', input.publisherId, activeSession, { resultCount: ranked.length, rankingMode: aiRerankUsed ? 'hybrid' : 'deterministic', aiRerankUsed });
    const deterministicRecommendations = ranked.map((item) => ({
      article: item.article,
      deterministicExplanation: explanation(profile, item.relevanceSignals),
      relevanceSignals: item.relevanceSignals,
      semanticSignals: item.semanticSignals,
    }));
    let generatedSummary = reportSummary(profile);
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
    const recommendations = ranked.map((item, index) => ({
      articleId: item.article.id,
      rank: index + 1,
      rawScore: item.finalScore,
      displayScore: displayRelevanceScore(item.finalScore),
      explanation: explanationById.get(item.article.id) ?? explanation(profile, item.relevanceSignals),
      article: item.article,
      rankingMetadata: {
        relevanceSignals: item.relevanceSignals,
        rankingMode: item.rankingMode,
        rankingVersion: RANKING_VERSION,
        deterministicScore: item.deterministicScore,
        semanticScore: item.semanticScore,
        semanticSignals: item.semanticSignals,
        aiProvider: aiRerankUsed || aiExplanationUsed ? this.ai?.provider.providerName : undefined,
      },
    }));
    const report: ReportRecord = {
      id: reportId(), publisherId: input.publisherId, sessionId: activeSession, companyUrl: normalized.canonicalUrl, companyDomain: normalized.domain, companyName: profile.companyName, jobTitle: profile.jobTitle, professionalProfile: profile, retrievalContext: profile.retrieval, overallMatchScore: displayRelevanceScore(recommendations.length ? recommendations.reduce((sum, item) => sum + item.displayScore, 0) / recommendations.length : 0), generatedSummary, recommendations, generationVersion: GENERATION_VERSION, rankingVersion: RANKING_VERSION, professionalProfileVersion: profile.profileVersion, aiProviderVersion: aiProfileUsed || aiRerankUsed || aiSummaryUsed || aiExplanationUsed ? `${this.ai?.provider.providerName}:${this.ai?.config.model}` : 'deterministic', publisherConfigVersion: definition.manifest?.publisherConfigVersion ?? 'legacy', widgetVersion: WIDGET_VERSION, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await this.reports.save(report);
    await this.track('report_generated', input.publisherId, activeSession, { reportId: report.id, resultCount: recommendations.length, rankingMode: aiRerankUsed ? 'hybrid' : 'deterministic', aiProfileUsed, aiRerankUsed, aiExplanationUsed });
    return report;
  }
}
