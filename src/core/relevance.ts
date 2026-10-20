import { normalizeToken, tokenize } from './intent';
import { compactFieldIndexes, type TextMatchIndex, type TokenDictionary } from './compact-index';
import type { Intent, NormalizedArticle, RelevanceResult } from './types';
import type { ProfessionalProfile, RetrievalConcept } from './professional';
import type { RelevanceScoreComponents } from './types';

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
  directTitle: 22,
  directMetadata: 12,
  directBody: 7,
  adjacentTitle: 12,
  adjacentMetadata: 7,
  adjacentBody: 4,
  roleBonus: 2,
  companyTitle: 8,
  companyMetadata: 4,
  companyBody: 2,
  freshnessMax: 6,
} as const;

/**
 * Freshness preference is intentionally bounded and interpolated between
 * age bands. Relevance remains the primary signal; age only changes how
 * equally relevant coverage is ordered.
 */
const RECENCY_CURVE = [
  { ageDays: 0, multiplier: 1 },
  { ageDays: 90, multiplier: 1 },
  { ageDays: 365, multiplier: 0.95 },
  { ageDays: 730, multiplier: 0.84 },
  { ageDays: 1_825, multiplier: 0.68 },
  { ageDays: 3_650, multiplier: 0.50 },
  { ageDays: 7_300, multiplier: 0.38 },
] as const;
const UNKNOWN_DATE_RECENCY_MULTIPLIER = 0.80;

export function recencyMultiplierForAge(ageDays: number): number {
  if (!Number.isFinite(ageDays)) return UNKNOWN_DATE_RECENCY_MULTIPLIER;
  const age = Math.max(0, ageDays);
  for (let index = 1; index < RECENCY_CURVE.length; index += 1) {
    const previous = RECENCY_CURVE[index - 1];
    const current = RECENCY_CURVE[index];
    if (age <= current.ageDays) {
      const progress = (age - previous.ageDays) / (current.ageDays - previous.ageDays);
      return previous.multiplier + (current.multiplier - previous.multiplier) * progress;
    }
  }
  return RECENCY_CURVE[RECENCY_CURVE.length - 1].multiplier - 0.04;
}

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

/** A field normalized once so every concept check is a set lookup. */
export interface ProfessionalTextIndex extends TextMatchIndex {
  readonly normalized: string;
  /** Every whitespace-separated token of the normalized text, of any length. */
  readonly tokens: TextMatchIndex['tokens'];
  /** Five-character prefixes of tokens with at least six characters. */
  readonly prefixes: TextMatchIndex['prefixes'];
}

export function professionalTextIndex(value: string): { normalized: string; tokens: Set<string>; prefixes: Set<string> } {
  const normalized = normalizeToken(value);
  const tokens = new Set<string>();
  const prefixes = new Set<string>();
  if (normalized) {
    for (const token of normalized.split(/\s+/)) {
      tokens.add(token);
      if (token.length >= 6) prefixes.add(token.slice(0, 5));
    }
  }
  return { normalized, tokens, prefixes };
}

function normalizedConceptMatches(normalizedConcept: string, text: ProfessionalTextIndex): boolean {
  if (!normalizedConcept) return false;
  // Multi-word concepts must occur as a phrase. Treating their words as an
  // unordered AND match makes unrelated metadata such as "developer" and
  // "technology" look like a direct engineering signal.
  if (normalizedConcept.includes(' ')) return text.normalized.includes(normalizedConcept);
  // Empty text has no tokens or prefixes, so single-token concepts need no separate emptiness check.
  return text.tokens.has(normalizedConcept) || (normalizedConcept.length >= 6 && text.prefixes.has(normalizedConcept.slice(0, 5)));
}

/** Phrase concepts match as normalized substrings; single concepts match a token or a shared five-character prefix when both are at least six characters. */
export function phraseMatches(concept: string, value: string): boolean {
  return normalizedConceptMatches(normalizeToken(concept), professionalTextIndex(value));
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

export interface ProfessionalFieldIndexes {
  title: ProfessionalTextIndex;
  metadata: ProfessionalTextIndex;
  body: ProfessionalTextIndex;
}

function professionalValues(article: NormalizedArticle): { title: string; metadata: string; body: string } {
  // Audience labels describe distribution, not article subject matter. They
  // must not turn "manufacturer" into a direct "manufacturing" match.
  return {
    title: article.title,
    metadata: [article.description ?? '', ...article.categories, ...article.tags].join(' '),
    body: [article.contentSnippet ?? '', article.summary ?? '', article.body ?? ''].join(' '),
  };
}

export function professionalFieldIndexes(article: NormalizedArticle): ProfessionalFieldIndexes {
  const values = professionalValues(article);
  return { title: professionalTextIndex(values.title), metadata: professionalTextIndex(values.metadata), body: professionalTextIndex(values.body) };
}

/** Memory-compact field indexes for caching with a catalogue; normalized text is kept because phrase concepts need it. */
export function compactProfessionalFieldIndexes(article: NormalizedArticle, dictionary: TokenDictionary): ProfessionalFieldIndexes {
  const values = professionalValues(article);
  return compactFieldIndexes(dictionary, { title: professionalTextIndex(values.title), metadata: professionalTextIndex(values.metadata), body: professionalTextIndex(values.body) });
}

interface PreparedConcept { concept: RetrievalConcept; normalized: string }
interface PreparedTerm { term: string; normalized: string }

function evidenceContribution(matches: PreparedConcept[], fields: ProfessionalFieldIndexes, amounts: { title: number; metadata: number; body: number }, cap: number): { score: number; matches: RetrievalConcept[] } {
  const seen = new Set<string>();
  const selected: RetrievalConcept[] = [];
  let score = 0;
  for (const { concept: match, normalized: key } of matches) {
    if (!key || seen.has(key)) continue;
    const field = normalizedConceptMatches(key, fields.title) ? 'title' : normalizedConceptMatches(key, fields.metadata) ? 'metadata' : normalizedConceptMatches(key, fields.body) ? 'body' : undefined;
    if (!field) continue;
    seen.add(key);
    selected.push(match);
    score += amounts[field] * Math.max(0.65, Math.min(1.25, match.weight));
  }
  return { score: Math.min(cap, score), matches: selected };
}

function companyEvidence(terms: PreparedTerm[], fields: ProfessionalFieldIndexes): { score: number; matches: string[] } {
  const seen = new Set<string>();
  let score = 0;
  for (const { normalized: key } of terms) {
    if (!key || seen.has(key)) continue;
    const amount = normalizedConceptMatches(key, fields.title) ? PROFESSIONAL_SCORE_WEIGHTS.companyTitle : normalizedConceptMatches(key, fields.metadata) ? PROFESSIONAL_SCORE_WEIGHTS.companyMetadata : normalizedConceptMatches(key, fields.body) ? PROFESSIONAL_SCORE_WEIGHTS.companyBody : 0;
    if (!amount) continue;
    seen.add(key);
    score += amount;
  }
  return { score: Math.min(14, score), matches: [...seen] };
}

export type ProfessionalArticleScorer = (article: NormalizedArticle, fields?: ProfessionalFieldIndexes) => RelevanceResult;

/**
 * Prepares a profile's concepts once so scoring a whole archive normalizes each
 * concept a single time. Pass precomputed field indexes to skip re-indexing an article.
 */
export function createProfessionalScorer(profile: ProfessionalProfile): ProfessionalArticleScorer {
  const prepareTerm = (term: string): PreparedTerm => ({ term, normalized: normalizeToken(term) });
  const concepts = profile.retrieval?.concepts?.length ? profile.retrieval.concepts : fallbackConcepts(profile);
  const directConcepts = concepts.filter((concept) => concept.relevanceType === 'direct').map((concept) => ({ concept, normalized: normalizeToken(concept.concept) }));
  const adjacentConcepts = concepts.filter((concept) => concept.relevanceType === 'adjacent').map((concept) => ({ concept, normalized: normalizeToken(concept.concept) }));
  const exclusions = (profile.excludedConcepts?.length ? profile.excludedConcepts : profile.retrieval?.exclusions ?? []).map(prepareTerm);
  const roleConcepts = concepts.filter((concept) => concept.source === 'role');
  const companyTerms = tokenize(`${profile.companyName ?? ''} ${profile.companyDomain}`).map(prepareTerm);
  const companyLabel = normalizeToken(profile.companyName ?? profile.companyDomain);
  return (article, fields = professionalFieldIndexes(article)) => scorePreparedProfessionalArticle(article, profile, fields, { directConcepts, adjacentConcepts, exclusions, roleConcepts, companyTerms, companyLabel });
}

/** Version-independent deterministic professional score used by persisted reports. */
export function scoreProfessionalArticle(article: NormalizedArticle, profile: ProfessionalProfile): RelevanceResult {
  return createProfessionalScorer(profile)(article);
}

function scorePreparedProfessionalArticle(article: NormalizedArticle, profile: ProfessionalProfile, fields: ProfessionalFieldIndexes, prepared: { directConcepts: PreparedConcept[]; adjacentConcepts: PreparedConcept[]; exclusions: PreparedTerm[]; roleConcepts: RetrievalConcept[]; companyTerms: PreparedTerm[]; companyLabel: string }): RelevanceResult {
  const { directConcepts, adjacentConcepts, exclusions, roleConcepts, companyTerms, companyLabel } = prepared;
  const directEvidence = evidenceContribution(directConcepts, fields, { title: PROFESSIONAL_SCORE_WEIGHTS.directTitle, metadata: PROFESSIONAL_SCORE_WEIGHTS.directMetadata, body: PROFESSIONAL_SCORE_WEIGHTS.directBody }, 58);
  const adjacentEvidence = evidenceContribution(adjacentConcepts, fields, { title: PROFESSIONAL_SCORE_WEIGHTS.adjacentTitle, metadata: PROFESSIONAL_SCORE_WEIGHTS.adjacentMetadata, body: PROFESSIONAL_SCORE_WEIGHTS.adjacentBody }, 28);
  const directMatches = unique(directEvidence.matches.map((item) => item.concept));
  const adjacentMatches = unique(adjacentEvidence.matches.map((item) => item.concept));
  const negativeTitle = exclusions.filter((term) => normalizedConceptMatches(term.normalized, fields.title)).map((term) => term.term);
  const negativeMetadata = exclusions.filter((term) => normalizedConceptMatches(term.normalized, fields.metadata)).map((term) => term.term);
  const negativeBody = exclusions.filter((term) => normalizedConceptMatches(term.normalized, fields.body)).map((term) => term.term);
  const negativeMatches = unique([...negativeTitle, ...negativeMetadata, ...negativeBody]);
  const roleMatches = unique([...directEvidence.matches, ...adjacentEvidence.matches].filter((match) => roleConcepts.includes(match)).map((match) => match.concept));
  const company = companyEvidence(companyTerms, fields);
  const parsedPublishedAt = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN;
  const hasValidPublishedAt = Number.isFinite(parsedPublishedAt);
  const ageDays = hasValidPublishedAt ? Math.max(0, (Date.now() - parsedPublishedAt) / 86_400_000) : 365;
  const freshness = hasValidPublishedAt ? Math.max(0, PROFESSIONAL_SCORE_WEIGHTS.freshnessMax - Math.min(ageDays / 90, PROFESSIONAL_SCORE_WEIGHTS.freshnessMax)) : 0;
  const directScore = directEvidence.score;
  const adjacentScore = adjacentEvidence.score;
  const roleBonus = Math.min(10, roleMatches.length * PROFESSIONAL_SCORE_WEIGHTS.roleBonus);
  // A company-name match only adds weight in proportion to the article's role evidence: a story that merely
  // mentions the reader's company must not outrank an on-topic story about another company.
  const companyBonus = company.score * Math.min(1, directScore / PROFESSIONAL_SCORE_WEIGHTS.directTitle);
  const negativePenalty = Math.min(45, negativeTitle.length * 28 + negativeMetadata.length * 18 + negativeBody.length * 10);
  const exceptionalBonus = company.matches.length > 0 && directEvidence.matches.filter((match) => match.source === 'role').length >= 3 && normalizedConceptMatches(companyLabel, fields.title) ? 26 : 0;
  const recencyMultiplier = hasValidPublishedAt ? recencyMultiplierForAge(ageDays) : UNKNOWN_DATE_RECENCY_MULTIPLIER;
  const adjacentWeight = 1;
  const baseScore = directScore + adjacentScore * adjacentWeight + roleBonus + companyBonus + exceptionalBonus;
  const preRecencyScore = Math.max(0, Math.round(baseScore - negativePenalty));
  const postRecencyScore = Math.max(0, Math.round(baseScore * recencyMultiplier + freshness - negativePenalty));
  const rawScore = postRecencyScore;
  const meaningfulDirect = directMatches.length > 0 && directScore >= 8 && (directEvidence.matches.some((match) => normalizedConceptMatches(normalizeToken(match.concept), fields.title)) || directMatches.length >= 2 || directEvidence.matches.some((match) => match.source === 'company'));
  const meaningfulAdjacent = adjacentMatches.length > 0 && adjacentScore >= 8;
  const relevanceType: RelevanceResult['relevanceType'] = meaningfulDirect ? 'direct' : meaningfulAdjacent ? 'adjacent' : rawScore > 0 ? 'weak' : 'none';
  const score = calibrateRelevanceScore(rawScore, relevanceType);
  const signals: string[] = [];
  if (meaningfulDirect) signals.push(`directly matches ${directMatches.slice(0, 2).join(' and ')}`);
  if (!meaningfulDirect && meaningfulAdjacent) signals.push(`connects with adjacent themes: ${adjacentMatches.slice(0, 2).join(' and ')}`);
  if (company.matches.length) signals.push(`connects to ${profile.companyName ?? profile.companyDomain}`);
  if (negativeMatches.length) signals.push(`conflicts with excluded topic ${negativeMatches[0]}`);
  if (freshness >= 3 && (meaningfulDirect || meaningfulAdjacent)) signals.push('is recent coverage');
  const confidence = Math.max(0, Math.min(100, Math.round(score * 0.82 + (meaningfulDirect ? 12 : meaningfulAdjacent ? 3 : 0) - negativePenalty * 0.2)));
  const scoreComponents: RelevanceScoreComponents = { direct: Math.round(directScore), adjacent: Math.round(adjacentScore), role: Math.round(roleBonus), company: Math.round(companyBonus), freshness: Math.round(freshness), negative: Math.round(negativePenalty), articleAgeDays: hasValidPublishedAt ? Number(ageDays.toFixed(1)) : undefined, recencyMultiplier: Number(recencyMultiplier.toFixed(3)), preRecencyScore, postRecencyScore, raw: rawScore, calibrated: score };
  return { score, relevanceSignals: unique(signals), scoreComponents, relevanceType, confidence, directMatches, adjacentMatches, negativeMatches };
}

export function calibrateRelevanceScore(score: number, relevanceType?: RelevanceResult['relevanceType']): number {
  const raw = Math.max(0, Math.round(score));
  const calibrated = raw <= 72 ? raw : raw <= 105 ? 72 + Math.round((raw - 72) * 0.62) : 92 + Math.min(8, Math.round((raw - 105) * 0.5));
  const bounded = Math.min(100, calibrated);
  return relevanceType === 'adjacent' ? Math.min(bounded, RELEVANCE_THRESHOLDS.adjacentMaximum) : bounded;
}

export function passesRelevanceThreshold(result: RelevanceResult, featured = false): boolean {
  if (result.relevanceType === 'direct') return result.score >= (featured ? RELEVANCE_THRESHOLDS.featured : Math.max(RELEVANCE_THRESHOLDS.candidate, RELEVANCE_THRESHOLDS.direct));
  if (result.relevanceType === 'adjacent') return !featured && result.score >= Math.max(RELEVANCE_THRESHOLDS.candidate, RELEVANCE_THRESHOLDS.adjacent);
  return false;
}
