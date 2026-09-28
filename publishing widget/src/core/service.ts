import { buildIntent } from './intent';
import { rankArticles } from './relevance';
import type { ExplanationProvider, Intent, ProgressStage, PublisherDefinition, RankedArticle, SearchOptions } from './types';

export class RecommendationService {
  constructor(private readonly definition: PublisherDefinition) {}

  async recommend(answers: Intent['answers'], onProgress?: (stage: ProgressStage) => void): Promise<{ intent: Intent; results: RankedArticle[] }> {
    const { config, adapter, explanationProvider } = this.definition;
    const intent = buildIntent(config, answers);
    onProgress?.('understanding');
    const options: SearchOptions = { limit: config.content.candidateRetrievalLimit, onProgress };
    const rawArticles = await adapter.search(intent, options);
    onProgress?.('comparing');
    const candidates = rawArticles.map((raw) => adapter.normalizeArticle(raw));
    const ranked = rankArticles(candidates, intent, config.results.maximumRecommendations);
    onProgress?.('preparing');
    const results = ranked.map((result) => ({
      ...result,
      explanation: explanationProvider.explain(result.article, intent, result),
    }));
    return { intent, results };
  }
}
