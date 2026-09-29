import type { ExplanationProvider, Intent, RelevanceResult } from '../../core';
import type { AIProvider, EnrichedIntent, ExplanationRequest, SemanticCandidate } from '../types';

const RELATED_CONCEPTS: Record<string, string[]> = {
  sustainability: ['electric propulsion', 'hybrid propulsion', 'alternative fuels', 'marine emissions', 'decarbonisation', 'circular economy', 'renewable energy'],
  technology: ['software', 'automation', 'robotics', 'artificial intelligence', 'digital systems', 'sensors', 'data'],
  science: ['research', 'evidence', 'climate', 'ecosystems', 'discovery', 'measurement'],
  business: ['investment', 'market growth', 'strategy', 'operations', 'leadership', 'trade'],
  culture: ['community', 'public space', 'education', 'creative practice', 'belonging'],
  health: ['wellbeing', 'public health', 'rest', 'care', 'prevention'],
};

function lower(value: string): string { return value.toLowerCase(); }

function conceptsFor(intent: Intent): string[] {
  return [...new Set(intent.interests.flatMap((interest) => {
    const key = Object.keys(RELATED_CONCEPTS).find((candidate) => lower(interest).includes(candidate));
    return key ? RELATED_CONCEPTS[key] : [];
  }))];
}

export class MockAIProvider implements AIProvider {
  readonly providerName = 'mock-semantic';

  async enhanceIntent(intent: Intent): Promise<unknown> {
    const relatedThemes = conceptsFor(intent);
    return {
      primaryThemes: intent.interests,
      relatedThemes,
      searchTerms: [...intent.interests, ...intent.personas, ...relatedThemes],
      entities: [],
      excludedConcepts: [],
    };
  }

  async rerank(intent: EnrichedIntent, candidates: SemanticCandidate[]): Promise<unknown> {
    const concepts = [...intent.relatedThemes, ...intent.searchTerms].map(lower);
    return candidates.map((candidate) => {
      const text = lower([candidate.title, candidate.description ?? '', ...candidate.categories, ...candidate.tags, candidate.contentSnippet ?? ''].join(' '));
      const signals = concepts.filter((concept) => text.includes(concept)).slice(0, 3);
      const semanticScore = Math.min(100, 42 + signals.length * 19 + (text.includes(lower(intent.persona)) ? 9 : 0));
      return { articleId: candidate.articleId, semanticScore, signals };
    });
  }

  async explainMany(requests: ExplanationRequest[]): Promise<unknown> {
    return requests.map((request) => {
      const signal = request.semanticSignals[0] ?? request.relevance.relevanceSignals[0] ?? 'the themes in your answers';
      const interest = request.intent.baseIntent.interests[0] ?? 'your interests';
      return {
        articleId: request.article.id,
        explanation: `This story connects ${signal} with your interest in ${interest}, based on its title and publisher metadata.`,
      };
    });
  }

  async explain(article: Parameters<ExplanationProvider['explain']>[0], intent: EnrichedIntent, relevance: RelevanceResult): Promise<string> {
    const results = await this.explainMany([{ article, intent, relevance, semanticSignals: [] }]);
    return (results as Array<{ articleId: string; explanation: string }>)[0]?.explanation ?? 'This story connects with your answers.';
  }
}
