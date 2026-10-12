import { normalizeToken, tokenize } from './intent';
import type { Intent, NormalizedArticle, RelevanceResult } from './types';
import type { ProfessionalProfile, RetrievalConcept } from './professional';

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'your', 'you', 'that', 'what', 'best', 'describes']);

export const HYBRID_SCORE_WEIGHTS = {
  deterministic: 0.7,
  semantic: 0.3,
} as const;

export const RELEVANCE_THRESHOLDS = {
  candidate: 24,
  direct: 24,
  adjacent: 24,
  featured: 55,
  adjacentMaximum: 59,
} as const;

/** Interpretable evidence weights: title/metadata outrank body-only matches. */
export const PROFESSIONAL_SCORE_WEIGHTS = {
  directTitle: 24,
  directMetadata: 14,
  directBody: 8,
  adjacentTitle: 13,
  adjacentMetadata: 8,
  adjacentBody: 5,
  roleBonus: 2,
  companyBonus: 2,
  freshnessMax: 4,
} as const;

export function combineHybridScore(deterministicScore: number, semanticScore: number, weights: { deterministic: number; semantic: number } = HYBRID_SCORE_WEIGHTS): number {
  const deterministic = Math.max(0, Math.min(100, deterministicScore));
  const semantic = Math.max(0, Math.min(100, semanticScore));
  return Math.round((deterministic * weights.deterministic + semantic * weights.semantic) * 100) / 100;
}

function overlap(tokens: string[], articleText: string): string[] {
  const articleTokens = new Set(tokenize(articleText));
  return tokens.filter((token) => articleTokens.has(token) && !STOP_WORDS.has(token));
}

function firstLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function scoreArticle(article: NormalizedArticle, intent: Intent): RelevanceResult {
  const title = normalizeToken(article.title);
  const description = normalizeToken(article.description ?? '');
  const categories = article.categories.map(normalizeToken);
  const tags = article.tags.map(normalizeToken);
  const audience = (article.audiences ?? []).map(normalizeToken);
  const snippet = normalizeToken(article.contentSnippet ?? '');
  const interestTerms = intent.interests.flatMap(tokenize);
  const personaTerms = intent.personas.flatMap(tokenize);
  const signals: string[] = [];
  let score = 0;

  const interestMatches = [...new Set([
    ...overlap(interestTerms, title),
    ...overlap(interestTerms, description),
    ...interestTerms.filter((term) => categories.some((category) => category.includes(term)) || tags.some((tag) => tag.includes(term))),
  ])];
  if (interestMatches.length > 0) {
    score += 34 + Math.min(interestMatches.length * 5, 16);
    signals.push(`matches your interest in ${firstLabel(intent.interests[0] ?? interestMatches[0])}`);
  }

  const personaMatches = [...new Set([
    ...overlap(personaTerms, title),
    ...overlap(personaTerms, description),
    ...personaTerms.filter((term) => audience.some((item) => item.includes(term)) || tags.some((tag) => tag.includes(term))),
  ])];
  if (personaMatches.length > 0) {
    score += 25 + Math.min(personaMatches.length * 4, 12);
    signals.push(`relevant to your perspective as ${firstLabel(intent.personas[0] ?? personaMatches[0])}`);
  }

  const generalMatches = overlap(intent.keywords, `${title} ${description} ${categories.join(' ')} ${tags.join(' ')} ${snippet}`);
  if (generalMatches.length > 0) score += Math.min(generalMatches.length * 5, 20);
  if (overlap(interestTerms, `${categories.join(' ')} ${tags.join(' ')}`).length > 0) score += 8;
  if (overlap(personaTerms, `${audience.join(' ')} ${tags.join(' ')}`).length > 0) score += 7;

  if (signals.length === 0 && generalMatches.length > 0) signals.push('shares language with your answers');
  if (signals.length === 0) signals.push('comes from the publisher’s relevant coverage');

  return { score: Math.min(score, 100), relevanceSignals: [...new Set(signals)] };
}

export function rankArticles(articles: NormalizedArticle[], intent: Intent, limit: number): Array<RelevanceResult & { article: NormalizedArticle }> {
  return articles
    .map((article, index) => ({ article, ...scoreArticle(article, intent), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ index: _index, ...result }) => result);
}

function phraseMatches(concept: string, value: string): boolean {
  const normalizedConcept = normalizeToken(concept);
  const normalizedValue = normalizeToken(value);
  if (!normalizedConcept || !normalizedValue) return false;
  // Multi-word concepts must occur as a phrase. Treating their words as an
  // unordered AND match makes unrelated metadata such as "developer" and
  // "technology" look like a direct engineering signal.
  if (normalizedConcept.includes(' ')) return normalizedValue.includes(normalizedConcept);
  return normalizedValue.split(/\s+/).some((token) => token === normalizedConcept || (normalizedConcept.length >= 6 && token.length >= 6 && token.slice(0, 5) === normalizedConcept.slice(0, 5)));
}

function unique(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }

function fallbackConcepts(profile: ProfessionalProfile): RetrievalConcept[] {
  const direct = profile.directInterests?.length ? profile.directInterests : profile.professionalInterests;
  const adjacent = profile.adjacentInterests ?? [];
  return [
    ...direct.map((concept) => ({ concept, weight: 1, relevanceType: 'direct' as const, source: 'role' as const })),
    ...adjacent.map((concept) => ({ concept, weight: 0.7, relevanceType: 'adjacent' as const, source: 'company' as const })),
  ];
}

function matchingConcepts(concepts: RetrievalConcept[], value: string): RetrievalConcept[] {
  return concepts.filter((concept) => phraseMatches(concept.concept, value));
}

function professionalFields(article: NormalizedArticle): { title: string; metadata: string; body: string; all: string } {
  const title = article.title;
  // Audience labels describe distribution, not article subject matter. They
  // must not turn "manufacturer" into a direct "manufacturing" match.
  const metadata = [article.description ?? '', ...article.categories, ...article.tags].join(' ');
  const body = [article.contentSnippet ?? '', article.summary ?? '', article.body ?? ''].join(' ');
  return { title, metadata, body, all: `${title} ${metadata} ${body}` };
}

function cappedContribution(matches: RetrievalConcept[], field: string, amount: number, cap: number): number {
  return Math.min(cap, matches.reduce((sum, match) => sum + amount * match.weight, 0) * (field ? 1 : 0));
}

/** Version-independent deterministic professional score used by persisted reports. */
export function scoreProfessionalArticle(article: NormalizedArticle, profile: ProfessionalProfile): RelevanceResult {
  const concepts = profile.retrieval?.concepts?.length ? profile.retrieval.concepts : fallbackConcepts(profile);
  const directConcepts = concepts.filter((concept) => concept.relevanceType === 'direct');
  const adjacentConcepts = concepts.filter((concept) => concept.relevanceType === 'adjacent');
  const fields = professionalFields(article);
  const directTitle = matchingConcepts(directConcepts, fields.title);
  const directMetadata = matchingConcepts(directConcepts, fields.metadata);
  const directBody = matchingConcepts(directConcepts, fields.body);
  const adjacentTitle = matchingConcepts(adjacentConcepts, fields.title);
  const adjacentMetadata = matchingConcepts(adjacentConcepts, fields.metadata);
  const adjacentBody = matchingConcepts(adjacentConcepts, fields.body);
  const directMatches = unique([...directTitle, ...directMetadata, ...directBody].map((item) => item.concept));
  const adjacentMatches = unique([...adjacentTitle, ...adjacentMetadata, ...adjacentBody].map((item) => item.concept));
  const exclusions = profile.excludedConcepts?.length ? profile.excludedConcepts : profile.retrieval?.exclusions ?? [];
  const negativeTitle = exclusions.filter((concept) => phraseMatches(concept, fields.title));
  const negativeMetadata = exclusions.filter((concept) => phraseMatches(concept, fields.metadata));
  const negativeBody = exclusions.filter((concept) => phraseMatches(concept, fields.body));
  const negativeMatches = unique([...negativeTitle, ...negativeMetadata, ...negativeBody]);
  const roleConcepts = concepts.filter((concept) => concept.source === 'role');
  const roleMatchCount = [...directTitle, ...directMetadata, ...directBody, ...adjacentTitle, ...adjacentMetadata, ...adjacentBody].filter((match) => roleConcepts.includes(match)).length;
  const companyTerms = tokenize(`${profile.companyName ?? ''} ${profile.companyDomain}`);
  const companyMatches = companyTerms.filter((term) => phraseMatches(term, fields.all));
  const ageDays = article.publishedAt ? Math.max(0, (Date.now() - Date.parse(article.publishedAt)) / 86_400_000) : 365;
  const freshness = Number.isFinite(ageDays) ? Math.max(0, PROFESSIONAL_SCORE_WEIGHTS.freshnessMax - Math.min(ageDays / 90, PROFESSIONAL_SCORE_WEIGHTS.freshnessMax)) : 0;
  const directScore = cappedContribution(directTitle, fields.title, PROFESSIONAL_SCORE_WEIGHTS.directTitle, 58) + cappedContribution(directMetadata, fields.metadata, PROFESSIONAL_SCORE_WEIGHTS.directMetadata, 30) + cappedContribution(directBody, fields.body, PROFESSIONAL_SCORE_WEIGHTS.directBody, 18);
  const adjacentScore = cappedContribution(adjacentTitle, fields.title, PROFESSIONAL_SCORE_WEIGHTS.adjacentTitle, 28) + cappedContribution(adjacentMetadata, fields.metadata, PROFESSIONAL_SCORE_WEIGHTS.adjacentMetadata, 20) + cappedContribution(adjacentBody, fields.body, PROFESSIONAL_SCORE_WEIGHTS.adjacentBody, 12);
  const roleBonus = Math.min(10, roleMatchCount * PROFESSIONAL_SCORE_WEIGHTS.roleBonus);
  const companyBonus = Math.min(6, companyMatches.length * PROFESSIONAL_SCORE_WEIGHTS.companyBonus);
  const negativePenalty = Math.min(45, negativeTitle.length * 28 + negativeMetadata.length * 18 + negativeBody.length * 10);
  const rawScore = Math.max(0, Math.min(100, Math.round(directScore + adjacentScore + roleBonus + companyBonus + freshness - negativePenalty)));
  const meaningfulDirect = directMatches.length > 0 && directScore >= 12 && (directTitle.length > 0 || directMatches.length >= 2 || directMetadata.some((match) => match.source === 'company'));
  const meaningfulAdjacent = adjacentMatches.length > 0 && adjacentScore >= 12;
  const relevanceType: RelevanceResult['relevanceType'] = meaningfulDirect ? 'direct' : meaningfulAdjacent ? 'adjacent' : rawScore > 0 ? 'weak' : 'none';
  const score = calibrateRelevanceScore(rawScore, relevanceType);
  const signals: string[] = [];
  if (meaningfulDirect) signals.push(`directly matches ${directMatches.slice(0, 2).join(' and ')}`);
  if (!meaningfulDirect && meaningfulAdjacent) signals.push(`connects with adjacent themes: ${adjacentMatches.slice(0, 2).join(' and ')}`);
  if (companyMatches.length) signals.push(`connects to ${profile.companyName ?? profile.companyDomain}`);
  if (negativeMatches.length) signals.push(`conflicts with excluded topic ${negativeMatches[0]}`);
  if (freshness >= 3 && (meaningfulDirect || meaningfulAdjacent)) signals.push('is recent coverage');
  const confidence = Math.max(0, Math.min(100, Math.round(score * 0.82 + (meaningfulDirect ? 12 : meaningfulAdjacent ? 3 : 0) - negativePenalty * 0.2)));
  return { score, relevanceSignals: unique(signals), relevanceType, confidence, directMatches, adjacentMatches, negativeMatches };
}

export function calibrateRelevanceScore(score: number, relevanceType?: RelevanceResult['relevanceType']): number {
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return relevanceType === 'adjacent' ? Math.min(bounded, RELEVANCE_THRESHOLDS.adjacentMaximum) : bounded;
}

export function passesRelevanceThreshold(result: RelevanceResult, featured = false): boolean {
  if (result.relevanceType === 'direct') return result.score >= (featured ? RELEVANCE_THRESHOLDS.featured : Math.max(RELEVANCE_THRESHOLDS.candidate, RELEVANCE_THRESHOLDS.direct));
  if (result.relevanceType === 'adjacent') return !featured && result.score >= Math.max(RELEVANCE_THRESHOLDS.candidate, RELEVANCE_THRESHOLDS.adjacent);
  return false;
}
