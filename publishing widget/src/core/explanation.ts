import type { ExplanationProvider, Intent, NormalizedArticle, RelevanceResult } from './types';

export class DeterministicExplanationProvider implements ExplanationProvider {
  explain(_article: NormalizedArticle, _intent: Intent, relevance: RelevanceResult): string {
    const signals = relevance.relevanceSignals.slice(0, 2);
    if (signals.length === 1) return `${signals[0].charAt(0).toUpperCase()}${signals[0].slice(1)}.`;
    return `${signals[0].charAt(0).toUpperCase()}${signals[0].slice(1)}, and ${signals[1]}.`;
  }
}
