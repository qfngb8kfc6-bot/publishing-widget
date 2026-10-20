import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProfessionalProfile, calibrateRelevanceScore, createProfessionalScorer, normalizeToken, phraseMatches, PROFESSIONAL_SCORE_WEIGHTS, recencyMultiplierForAge, scoreProfessionalArticle, tokenize, type NormalizedArticle, type ProfessionalProfile, type RelevanceResult, type RelevanceScoreComponents, type RetrievalConcept } from '../src/core';
import { profileForTheme } from '../src/reports/themes';
import { company, normalizedCatalogue, syntheticArchive } from './ranking-fixtures';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';

// ---------------------------------------------------------------------------
// Reference implementation: the pre-optimisation professional scorer, kept
// verbatim so the indexed scorer can be proven to score identically.
// ---------------------------------------------------------------------------
const UNKNOWN_DATE_RECENCY_MULTIPLIER = 0.80;
function referencePhraseMatches(concept: string, value: string): boolean {
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

function professionalFields(article: NormalizedArticle): { title: string; metadata: string; body: string; all: string } {
  const title = article.title;
  // Audience labels describe distribution, not article subject matter. They
  // must not turn "manufacturer" into a direct "manufacturing" match.
  const metadata = [article.description ?? '', ...article.categories, ...article.tags].join(' ');
  const body = [article.contentSnippet ?? '', article.summary ?? '', article.body ?? ''].join(' ');
  return { title, metadata, body, all: `${title} ${metadata} ${body}` };
}

function evidenceContribution(matches: RetrievalConcept[], fields: { title: string; metadata: string; body: string }, amounts: { title: number; metadata: number; body: number }, cap: number): { score: number; matches: RetrievalConcept[] } {
  const seen = new Set<string>();
  const selected: RetrievalConcept[] = [];
  let score = 0;
  for (const match of matches) {
    const key = normalizeToken(match.concept);
    if (!key || seen.has(key)) continue;
    const field = referencePhraseMatches(match.concept, fields.title) ? 'title' : referencePhraseMatches(match.concept, fields.metadata) ? 'metadata' : referencePhraseMatches(match.concept, fields.body) ? 'body' : undefined;
    if (!field) continue;
    seen.add(key);
    selected.push(match);
    score += amounts[field] * Math.max(0.65, Math.min(1.25, match.weight));
  }
  return { score: Math.min(cap, score), matches: selected };
}

function companyEvidence(terms: string[], fields: { title: string; metadata: string; body: string }): { score: number; matches: string[] } {
  const seen = new Set<string>();
  let score = 0;
  for (const term of terms) {
    const key = normalizeToken(term);
    if (!key || seen.has(key)) continue;
    const amount = referencePhraseMatches(term, fields.title) ? PROFESSIONAL_SCORE_WEIGHTS.companyTitle : referencePhraseMatches(term, fields.metadata) ? PROFESSIONAL_SCORE_WEIGHTS.companyMetadata : referencePhraseMatches(term, fields.body) ? PROFESSIONAL_SCORE_WEIGHTS.companyBody : 0;
    if (!amount) continue;
    seen.add(key);
    score += amount;
  }
  return { score: Math.min(14, score), matches: [...seen] };
}

/** Version-independent deterministic professional score used by persisted reports. */
function referenceScoreProfessionalArticle(article: NormalizedArticle, profile: ProfessionalProfile): RelevanceResult {
  const concepts = profile.retrieval?.concepts?.length ? profile.retrieval.concepts : fallbackConcepts(profile);
  const directConcepts = concepts.filter((concept) => concept.relevanceType === 'direct');
  const adjacentConcepts = concepts.filter((concept) => concept.relevanceType === 'adjacent');
  const fields = professionalFields(article);
  const directEvidence = evidenceContribution(directConcepts, fields, { title: PROFESSIONAL_SCORE_WEIGHTS.directTitle, metadata: PROFESSIONAL_SCORE_WEIGHTS.directMetadata, body: PROFESSIONAL_SCORE_WEIGHTS.directBody }, 58);
  const adjacentEvidence = evidenceContribution(adjacentConcepts, fields, { title: PROFESSIONAL_SCORE_WEIGHTS.adjacentTitle, metadata: PROFESSIONAL_SCORE_WEIGHTS.adjacentMetadata, body: PROFESSIONAL_SCORE_WEIGHTS.adjacentBody }, 28);
  const directMatches = unique(directEvidence.matches.map((item) => item.concept));
  const adjacentMatches = unique(adjacentEvidence.matches.map((item) => item.concept));
  const exclusions = profile.excludedConcepts?.length ? profile.excludedConcepts : profile.retrieval?.exclusions ?? [];
  const negativeTitle = exclusions.filter((concept) => referencePhraseMatches(concept, fields.title));
  const negativeMetadata = exclusions.filter((concept) => referencePhraseMatches(concept, fields.metadata));
  const negativeBody = exclusions.filter((concept) => referencePhraseMatches(concept, fields.body));
  const negativeMatches = unique([...negativeTitle, ...negativeMetadata, ...negativeBody]);
  const roleConcepts = concepts.filter((concept) => concept.source === 'role');
  const roleMatches = unique([...directEvidence.matches, ...adjacentEvidence.matches].filter((match) => roleConcepts.includes(match)).map((match) => match.concept));
  const companyTerms = tokenize(`${profile.companyName ?? ''} ${profile.companyDomain}`);
  const company = companyEvidence(companyTerms, fields);
  const parsedPublishedAt = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN;
  const hasValidPublishedAt = Number.isFinite(parsedPublishedAt);
  const ageDays = hasValidPublishedAt ? Math.max(0, (Date.now() - parsedPublishedAt) / 86_400_000) : 365;
  const freshness = hasValidPublishedAt ? Math.max(0, PROFESSIONAL_SCORE_WEIGHTS.freshnessMax - Math.min(ageDays / 90, PROFESSIONAL_SCORE_WEIGHTS.freshnessMax)) : 0;
  const directScore = directEvidence.score;
  const adjacentScore = adjacentEvidence.score;
  const roleBonus = Math.min(10, roleMatches.length * PROFESSIONAL_SCORE_WEIGHTS.roleBonus);
  // Ranking 1.3 deliberately scales the company bonus by role evidence; the reference carries the same rule so
  // this test keeps checking only that indexing does not change results.
  const companyBonus = company.score * Math.min(1, directScore / PROFESSIONAL_SCORE_WEIGHTS.directTitle);
  const negativePenalty = Math.min(45, negativeTitle.length * 28 + negativeMetadata.length * 18 + negativeBody.length * 10);
  const exceptionalBonus = company.matches.length > 0 && directEvidence.matches.filter((match) => match.source === 'role').length >= 3 && referencePhraseMatches(profile.companyName ?? profile.companyDomain, fields.title) ? 26 : 0;
  const recencyMultiplier = hasValidPublishedAt ? recencyMultiplierForAge(ageDays) : UNKNOWN_DATE_RECENCY_MULTIPLIER;
  const adjacentWeight = 1;
  const baseScore = directScore + adjacentScore * adjacentWeight + roleBonus + companyBonus + exceptionalBonus;
  const preRecencyScore = Math.max(0, Math.round(baseScore - negativePenalty));
  const postRecencyScore = Math.max(0, Math.round(baseScore * recencyMultiplier + freshness - negativePenalty));
  const rawScore = postRecencyScore;
  const meaningfulDirect = directMatches.length > 0 && directScore >= 8 && (directEvidence.matches.some((match) => referencePhraseMatches(match.concept, fields.title)) || directMatches.length >= 2 || directEvidence.matches.some((match) => match.source === 'company'));
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const NOW = new Date('2026-10-19T12:00:00.000Z');

function themed(profile: ProfessionalProfile, theme: string): ProfessionalProfile {
  return profileForTheme(profile, theme);
}

const nikeRetail = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', ['retail', 'footwear']), 'Head of Retail', NOW);
const adidasProduct = buildProfessionalProfile(company('adidas.com', 'Adidas', 'sporting goods', ['innovation', 'apparel']), 'Product Manager', NOW);
const ldTechnology = buildProfessionalProfile(company('ldsystems.uk', 'LD Systems', 'software', ['technology']), 'Technology Professional', NOW);

const edgeConcepts: RetrievalConcept[] = [
  { concept: 'retail operations', weight: 1.4, relevanceType: 'direct', source: 'role' },
  { concept: 'e-commerce', weight: 1, relevanceType: 'direct', source: 'role' },
  { concept: 'AI', weight: 0.9, relevanceType: 'direct', source: 'role' },
  { concept: 'uk', weight: 0.5, relevanceType: 'direct', source: 'company' },
  { concept: 'distribution', weight: 1, relevanceType: 'direct', source: 'role' },
  { concept: 'Distribution', weight: 1, relevanceType: 'direct', source: 'role' },
  { concept: 'store', weight: 1, relevanceType: 'direct', source: 'role' },
  { concept: 'café', weight: 1, relevanceType: 'adjacent', source: 'company' },
  { concept: 'click-and-collect', weight: 0.7, relevanceType: 'adjacent', source: 'role' },
  { concept: '---', weight: 1, relevanceType: 'adjacent', source: 'role' },
];
const edgeProfile = { ...nikeRetail, companyName: 'LD Systems', companyDomain: 'ld-systems.co.uk', excludedConcepts: ['esports', 'fantasy league', 'x'], retrieval: { ...nikeRetail.retrieval, concepts: edgeConcepts } } as ProfessionalProfile;
const fallbackProfile = { ...adidasProduct, retrieval: { ...adidasProduct.retrieval, concepts: [] }, excludedConcepts: [] } as ProfessionalProfile;

const profiles: Array<[string, ProfessionalProfile]> = [
  ['Nike / Head of Retail', nikeRetail],
  ['Nike / Head of Retail, theme "retail operations"', themed(nikeRetail, 'retail operations')],
  ['Nike / Head of Retail, theme "stores"', themed(nikeRetail, 'stores')],
  ['Adidas / Product Manager', adidasProduct],
  ['LD Systems / Technology Professional', ldTechnology],
  ['Hand-built edge-case profile', edgeProfile],
  ['Fallback concepts (no retrieval concepts)', fallbackProfile],
];

/** Same ordering the archive-wide theme ranking applies before thresholds. */
function archiveOrder(results: RelevanceResult[], limit: number): number[] {
  return results.map((result, index) => ({ index, score: result.score })).sort((left, right) => right.score - left.score).slice(0, limit).map((item) => item.index);
}

function expectIdenticalScores(articles: NormalizedArticle[], profile: ProfessionalProfile): void {
  // The reference is the slow implementation being replaced, so score once and compare everything from it.
  const expected = articles.map((article) => referenceScoreProfessionalArticle(article, profile));
  const scorer = createProfessionalScorer(profile);
  const actual = articles.map((article) => scorer(article));
  expect(actual).toEqual(expected);
  expect(articles.slice(0, 25).map((article) => scoreProfessionalArticle(article, profile))).toEqual(expected.slice(0, 25));
  expect(archiveOrder(actual, 100)).toEqual(archiveOrder(expected, 100));
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('professional scoring equivalence', () => {
  it.each(profiles)('scores the SGI fixture identically to the reference implementation for %s', async (_label, profile) => {
    const { articles } = await normalizedCatalogue(sgiEuropeRssFixture);
    expect(articles.length).toBeGreaterThan(0);
    expectIdenticalScores(articles, profile);
  });

  // The reference implementation needs ~10s per profile at production scale, so the default suite uses a
  // smaller archive with the same generator; PRESELECTION_FULL_ARCHIVE=1 runs the full 11,500 articles.
  const archiveSize = process.env.PRESELECTION_FULL_ARCHIVE === '1' ? 11_500 : 600;

  it(`scores a synthetic ${archiveSize}-article archive identically, with exact results and order`, async () => {
    const { articles } = await normalizedCatalogue(syntheticArchive(archiveSize));
    expect(articles).toHaveLength(archiveSize);
    expect(articles.some((article) => Boolean(article.body))).toBe(true);
    for (const [, profile] of profiles) expectIdenticalScores(articles, profile);
  }, 900_000);
});

describe('phraseMatches semantics', () => {
  const concepts = ['retail', 'store', 'stores', 'storefront', 'distribution', 'distributor', 'distr', 'e-commerce', 'ecommerce', 'omni-channel', 'omnichannel', 'D2C', 'AI', 'ai', 'uk', 'U.K.', 'u k', 'café', 'cafe', 'ski touring', 'retail operations', 'store openings', 'ail sto', 'q3', '2026', 'x', '', '   ', '---'];
  const values = ['Retail operations: new stores', 'Store openings in the U.K. & EU', 'Omni-channel e-commerce (D2C) growth', 'Distributors expand; distribution grows', 'Café culture meets ski-touring', 'AI-driven storefronts', 'q3 2026 results', 'retail', 'ok', 'x', '', '   ', '—', 'Ecommerce'];

  it('matches the reference implementation for every concept/value combination', () => {
    for (const concept of concepts) {
      for (const value of values) expect(phraseMatches(concept, value), `${JSON.stringify(concept)} in ${JSON.stringify(value)}`).toBe(referencePhraseMatches(concept, value));
    }
  });

  it('keeps the documented edge cases', () => {
    // Unlike archive preselection, short tokens count here.
    expect(phraseMatches('AI', 'AI-driven storefronts')).toBe(true);
    expect(phraseMatches('uk', 'Store openings in the U.K.')).toBe(false);
    expect(phraseMatches('u k', 'Store openings in the U.K.')).toBe(true);
    expect(phraseMatches('x', 'x')).toBe(true);
    // Hyphens and punctuation become spaces, so hyphenated concepts are phrases.
    expect(phraseMatches('e-commerce', 'Omni-channel e-commerce (D2C) growth')).toBe(true);
    expect(phraseMatches('omnichannel', 'Omni-channel e-commerce')).toBe(false);
    // Five-character prefix matching needs both concept and token to have six or more characters.
    expect(phraseMatches('distribution', 'Distributors expand')).toBe(true);
    expect(phraseMatches('distr', 'Distributors expand')).toBe(false);
    expect(phraseMatches('store', 'new stores')).toBe(false);
    // Multi-word concepts are substring phrases, including across word boundaries.
    expect(phraseMatches('retail operations', 'Retail operations: new stores')).toBe(true);
    expect(phraseMatches('ail sto', 'retail stores')).toBe(true);
    // Accents are stripped; empty or punctuation-only input never matches.
    expect(phraseMatches('cafe', 'Café culture')).toBe(true);
    expect(phraseMatches('', 'retail')).toBe(false);
    expect(phraseMatches('---', 'retail')).toBe(false);
    expect(phraseMatches('retail', '—')).toBe(false);
  });
});
