import type { ExplanationProvider, Intent, RelevanceResult } from '../../core';
import type { AIProvider, EnrichedIntent, ExplanationRequest, ProfessionalAIProvider, ProfessionalProfileEnhancementInput, ReportContentRequest, SemanticCandidate } from '../types';

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

export class MockAIProvider implements AIProvider, ProfessionalAIProvider {
  readonly providerName = 'mock-semantic';

  async enhanceProfessionalProfile(input: ProfessionalProfileEnhancementInput): Promise<unknown> {
    return {
      company: {
        themes: input.company.topics.slice(0, 4),
        technologies: input.company.topics.filter((topic) => /AI|software|cloud|automation|technology|data/i.test(topic)).slice(0, 4),
      },
      person: {
        seniority: /chief|head|director|vp|vice president|executive/i.test(input.submittedJobTitle) ? 'senior' : 'professional',
        decisionAreas: input.role.responsibilities.slice(0, 3),
        themes: input.role.professionalThemes.slice(0, 5),
      },
      professionalInterests: [...input.company.topics, ...input.role.professionalThemes].slice(0, 12),
      likelyInformationNeeds: input.role.responsibilities.slice(0, 4),
      relevantEntities: input.company.entities.slice(0, 8),
      searchTerms: [...input.company.topics, ...input.role.professionalThemes].slice(0, 16),
      semanticQueries: [`${input.role.function} developments at ${input.company.name ?? input.company.domain}`, `What ${input.role.rawTitle} needs to know about ${input.company.industry ?? 'industry change'}`],
      excludedConcepts: [],
    };
  }

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

  async generateReportContent(input: ReportContentRequest): Promise<unknown> {
    return {
      summary: `This briefing connects ${input.profile.role.rawTitle} at ${input.profile.companyName ?? input.profile.companyDomain} with the publisher's coverage of ${input.profile.professionalInterests.slice(0, 3).join(', ')}.`,
      explanations: input.recommendations.map((recommendation) => ({
        articleId: recommendation.article.id,
        explanation: `This story matters because it ${recommendation.relevanceSignals[0] ?? 'matches the professional themes in your profile'}.`,
      })),
    };
  }

  async explain(article: Parameters<ExplanationProvider['explain']>[0], intent: EnrichedIntent, relevance: RelevanceResult): Promise<string> {
    const results = await this.explainMany([{ article, intent, relevance, semanticSignals: [] }]);
    return (results as Array<{ articleId: string; explanation: string }>)[0]?.explanation ?? 'This story connects with your answers.';
  }
}
