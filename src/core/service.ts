import { buildIntent } from './intent';
import { combineHybridScore, rankArticles } from './relevance';
import type { Intent, ProgressStage, RankedArticle, SearchOptions } from './types';
import type { PublisherDefinition } from './registry';
import { DiscoveryError } from './errors';
import type { AIRecommendationLayer, EnrichedIntent, ExplanationRequest, SemanticCandidate } from '../ai/types';
import { sanitizeEnrichedIntent, validateExplanationResults, validateSemanticResults } from '../ai/validation';

interface RecommendationResponse {
  intent: Intent;
  baseIntent: Intent;
  enrichedIntent?: EnrichedIntent;
  results: RankedArticle[];
}

type WorkingRankedArticle = Omit<RankedArticle, 'explanation'> & { explanation?: string };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new Error('ai-timeout')), timeoutMs); }),
  ]).finally(() => { if (timeoutId) clearTimeout(timeoutId); });
}

export class RecommendationService {
  constructor(private readonly definition: PublisherDefinition, private readonly debug?: import('./types').DebugSink, private readonly ai?: AIRecommendationLayer) {}

  async recommendIntent(baseIntent: Intent, onProgress?: (stage: ProgressStage) => void): Promise<RecommendationResponse> {
    const { config, adapter, explanationProvider } = this.definition;
    this.debug?.({ type: 'intent', publisherId: config.publisherId, intent: baseIntent });
    onProgress?.('understanding');
    let intent: Intent = baseIntent;
    let enrichedIntent: EnrichedIntent | undefined;
    const aiEnabled = Boolean(this.ai?.config.enabled && this.ai.config.provider !== 'none' && this.definition.manifest?.features?.aiEnabled !== false);
    const deterministicWeight = this.definition.manifest?.ranking?.deterministicWeight ?? this.ai?.config.deterministicWeight ?? 0.7;
    const semanticWeight = this.definition.manifest?.ranking?.semanticWeight ?? this.ai?.config.semanticWeight ?? 0.3;
    if (aiEnabled && this.ai) {
      try {
        const enriched = sanitizeEnrichedIntent(await withTimeout(this.ai.provider.enhanceIntent(baseIntent), this.ai.config.timeoutMs), baseIntent);
        if (!enriched) throw new Error('invalid intent enrichment');
        enrichedIntent = enriched;
        intent = enriched;
        this.debug?.({ type: 'enriched_intent', publisherId: config.publisherId, intent: enriched });
      } catch (error) {
        this.debug?.({ type: 'ai_fallback', publisherId: config.publisherId, stage: 'intent', reason: error instanceof Error ? error.message : 'provider failure' });
      }
    }
    const options: SearchOptions = { limit: config.content.candidateRetrievalLimit, onProgress, onDebug: this.debug };
    let rawArticles: unknown[];
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      rawArticles = await Promise.race([
        adapter.search(intent, options),
        new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new DiscoveryError('search-timeout')), 10000); }),
      ]);
    } catch (error) {
      if (error instanceof DiscoveryError) throw error;
      throw new DiscoveryError('api-unavailable');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    onProgress?.('comparing');
    const candidates = rawArticles.flatMap((raw) => {
      const article = adapter.normalizeArticle(raw);
      return article ? [article] : [];
    });
    this.debug?.({ type: 'normalized_articles', publisherId: config.publisherId, articles: candidates.map(({ id, url, title, publisherId }) => ({ id, url, title, publisherId })) });
    const finalLimit = Math.min(config.content.resultLimit, config.results.maximumRecommendations);
    const deterministicLimit = aiEnabled && this.ai ? Math.min(candidates.length, Math.max(finalLimit, this.ai.config.rerankLimit)) : finalLimit;
    const deterministicRanked = rankArticles(candidates, intent, deterministicLimit);
    let ranked: WorkingRankedArticle[] = deterministicRanked.map((result) => ({ ...result, finalScore: result.score, rankingMode: 'deterministic' as const }));
    let aiRankingAvailable = false;

    if (aiEnabled && this.ai && enrichedIntent) {
      try {
        const semanticCandidates: SemanticCandidate[] = deterministicRanked.slice(0, this.ai.config.rerankLimit).map((result) => ({
          articleId: result.article.id,
          title: result.article.title,
          description: result.article.description,
          categories: result.article.categories,
          tags: result.article.tags,
          contentSnippet: result.article.contentSnippet?.slice(0, 500),
          deterministicScore: result.score,
        }));
        const semanticResults = validateSemanticResults(await withTimeout(this.ai.provider.rerank(enrichedIntent, semanticCandidates), this.ai.config.timeoutMs), semanticCandidates);
        if (semanticResults.length === 0) throw new Error('no valid semantic results');
        const semanticById = new Map(semanticResults.map((result) => [result.articleId, result]));
        ranked = deterministicRanked.map((result, index) => {
          const semantic = semanticById.get(result.article.id);
          const semanticScore = semantic?.semanticScore ?? result.score;
          return { ...result, semanticScore, semanticSignals: semantic?.signals ?? [], finalScore: combineHybridScore(result.score, semanticScore, { deterministic: deterministicWeight, semantic: semanticWeight }), rankingMode: 'hybrid' as const, index };
        }).sort((a, b) => b.finalScore! - a.finalScore! || b.score - a.score || a.index - b.index).slice(0, finalLimit).map(({ index: _index, ...result }) => result);
        aiRankingAvailable = true;
        this.debug?.({ type: 'semantic_rerank', publisherId: config.publisherId, results: ranked.map((result) => ({ id: result.article.id, deterministicScore: result.score, semanticScore: result.semanticScore ?? result.score, combinedScore: result.finalScore ?? result.score, signals: result.semanticSignals ?? [] })) });
      } catch (error) {
        intent = baseIntent;
        enrichedIntent = undefined;
        const fallbackRanked = rankArticles(candidates, baseIntent, finalLimit);
        ranked = fallbackRanked.map((result) => ({ ...result, finalScore: result.score, rankingMode: 'deterministic' as const }));
        this.debug?.({ type: 'ai_fallback', publisherId: config.publisherId, stage: 'rerank', reason: error instanceof Error ? error.message : 'provider failure' });
      }
    } else {
      ranked = ranked.slice(0, finalLimit);
    }
    onProgress?.('preparing');
    const deterministicExplanations = await Promise.all(ranked.map((result) => Promise.resolve(explanationProvider.explain(result.article, intent, result))));
    let explanationById = new Map<string, string>();
    let explanationProviderName = explanationProvider.providerName ?? 'deterministic';
    let aiExplanationUsed = false;
    if (aiEnabled && this.ai && this.ai.config.explanationsEnabled && this.definition.manifest?.features?.explanationsEnabled !== false && enrichedIntent && aiRankingAvailable) {
      try {
        const requests: ExplanationRequest[] = ranked.map((result) => ({
          article: { id: result.article.id, title: result.article.title, description: result.article.description, categories: result.article.categories, tags: result.article.tags, contentSnippet: result.article.contentSnippet?.slice(0, 500) },
          intent: enrichedIntent!,
          relevance: result,
          semanticSignals: result.semanticSignals ?? [],
        }));
        const explanationResults = validateExplanationResults(await withTimeout(this.ai.provider.explainMany(requests), this.ai.config.timeoutMs), new Set(ranked.map((result) => result.article.id)));
        explanationById = new Map(explanationResults.map((result) => [result.articleId, result.explanation]));
        if (explanationById.size > 0) {
          aiExplanationUsed = true;
          explanationProviderName = this.ai.provider.providerName;
        } else throw new Error('no valid explanations');
      } catch (error) {
        this.debug?.({ type: 'ai_fallback', publisherId: config.publisherId, stage: 'explanation', reason: error instanceof Error ? error.message : 'provider failure' });
      }
    }
    const results: RankedArticle[] = ranked.map((result, index) => ({
      ...result,
      explanation: explanationById.get(result.article.id) ?? deterministicExplanations[index],
      explanationProvider: explanationById.has(result.article.id) ? explanationProviderName : explanationProvider.providerName ?? 'deterministic',
    }));
    this.debug?.({ type: 'explanation_provider', publisherId: config.publisherId, provider: explanationProviderName, used: aiExplanationUsed });
    this.debug?.({ type: 'ranked_results', publisherId: config.publisherId, results: results.map(({ article, score, relevanceSignals }) => ({ id: article.id, score, relevanceSignals })) });
    return { intent, baseIntent, enrichedIntent, results };
  }

  /** @deprecated Use recommendIntent() with a professional or adapter-specific intent. */
  async recommend(answers: Intent['answers'], onProgress?: (stage: ProgressStage) => void): Promise<RecommendationResponse> {
    return this.recommendIntent(buildIntent(this.definition.config, answers), onProgress);
  }
}
