import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, normalizeToken, tokenize, type CompanyContext, type Intent, type NormalizedArticle } from '../src/core';
import { archiveAwareFeedPreselection, feedPreselectionScores, phraseOrTokenMatch } from '../src/publishers/content/adapters';
import { createSgiEuropeDefinition } from '../src/publishers/sgi-europe';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';

// ---------------------------------------------------------------------------
// Reference implementation: the pre-optimisation preselection, kept verbatim
// so the indexed implementation can be proven to rank identically.
// ---------------------------------------------------------------------------
function referenceUniqueTerms(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => tokenize(value)))];
}

function referencePhraseOrTokenMatch(term: string, value: string): boolean {
  const normalizedTerm = normalizeToken(term);
  const normalizedValue = normalizeToken(value);
  if (!normalizedTerm || !normalizedValue) return false;
  if (normalizedTerm.includes(' ')) return normalizedValue.includes(normalizedTerm);
  return tokenize(normalizedValue).some((token) => token === normalizedTerm || (normalizedTerm.length >= 6 && token.length >= 6 && token.slice(0, 5) === normalizedTerm.slice(0, 5)));
}

function referenceArticlePreselectionScore(article: NormalizedArticle, intent: Intent): number {
  const title = article.title;
  const metadata = [article.description ?? '', article.author ?? '', article.category ?? '', ...article.categories, ...article.tags].join(' ');
  const body = [article.contentSnippet ?? '', article.summary ?? '', article.searchText ?? ''].join(' ');
  const all = `${title} ${metadata} ${body}`;
  const direct = referenceUniqueTerms([...(intent.directInterests ?? []), ...intent.interests, ...intent.personas, ...intent.keywords]);
  const adjacent = referenceUniqueTerms(intent.adjacentInterests ?? []);
  const query = referenceUniqueTerms([intent.queryText]);
  const answerValues = Object.entries(intent.answers ?? {}).flatMap(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return /company|domain|url/i.test(key) ? values : values.filter((candidate) => /\.[a-z]{2,}$/i.test(String(candidate)));
  });
  const company = referenceUniqueTerms(answerValues.map(String));
  const exclusions = referenceUniqueTerms(intent.excludedConcepts ?? []);
  let score = 0;
  const addMatches = (terms: string[], weight: number) => {
    for (const term of terms) {
      if (referencePhraseOrTokenMatch(term, title)) score += 7 * weight;
      else if (referencePhraseOrTokenMatch(term, metadata)) score += 3 * weight;
      else if (referencePhraseOrTokenMatch(term, body)) score += 1 * weight;
    }
  };
  addMatches(direct, 1);
  addMatches(adjacent, 0.65);
  addMatches(query, 0.35);
  addMatches(company, 1.25);
  for (const term of exclusions) if (referencePhraseOrTokenMatch(term, all)) score -= 6;
  return score;
}

function referenceCompareFeedDates(left: NormalizedArticle, right: NormalizedArticle): number {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : Number.NaN;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
  if (Number.isFinite(rightTime)) return 1;
  if (Number.isFinite(leftTime)) return -1;
  return 0;
}

function referenceOrder(articles: NormalizedArticle[], scores: number[], limit: number): NormalizedArticle[] {
  const scored = articles.map((article, index) => ({ article, index, score: scores[index] }));
  const ordered = [...scored].sort((left, right) => right.score - left.score || referenceCompareFeedDates(left.article, right.article) || left.index - right.index);
  return ordered.slice(0, limit).map(({ article }) => article);
}

function referencePreselection(articles: NormalizedArticle[], intent: Intent, limit: number): NormalizedArticle[] {
  return referenceOrder(articles, articles.map((article) => referenceArticlePreselectionScore(article, intent)), limit);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function company(domain: string, name: string, industry: string, topics: string[]): CompanyContext {
  return { domain, canonicalUrl: `https://${domain}/`, name, industry, description: `${name} ${industry}`, topics, entities: [name], source: 'submitted-domain', fetchedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z', analysisVersion: 'test' };
}

/** Mirrors ReportGenerationService's createIntent so the real profile vocabulary is exercised. */
function profileIntent(context: CompanyContext, jobTitle: string): Intent {
  const profile = buildProfessionalProfile(context, jobTitle, new Date('2026-10-01T00:00:00.000Z'));
  return {
    publisherId: 'sgi-europe',
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

const intents: Array<[string, Intent]> = [
  ['Nike / Head of Retail', profileIntent(company('nike.com', 'Nike', 'sporting goods', ['retail', 'footwear']), 'Head of Retail')],
  ['Adidas / Product Manager', profileIntent(company('adidas.com', 'Adidas', 'sporting goods', ['innovation', 'apparel']), 'Product Manager')],
  ['LD Systems / Technology Professional', profileIntent(company('ldsystems.uk', 'LD Systems', 'software', ['technology']), 'Technology Professional')],
  ['Hand-built edge-case intent', {
    publisherId: 'sgi-europe',
    answers: { companyUrl: 'https://www.decathlon.co.uk', jobTitle: 'Head of E-Commerce (EMEA)', region: ['eu.example', 'UK'] },
    queryText: 'omni-channel D2C store openings, e-commerce & wholesale!',
    keywords: ['café', 'ski-touring', 'AI', 'uk', 'distribution', 'store'],
    interests: ['retail operations', 'merchandising'],
    personas: ['retail'],
    directInterests: ['stores', 'omnichannel', 'click-and-collect'],
    adjacentInterests: ['supply chain', 'logistics'],
    excludedConcepts: ['esports', 'fantasy-league'],
  }],
];

const VOCABULARY = [
  'retail', 'stores', 'store', 'storefront', 'omnichannel', 'omni-channel', 'distribution', 'distributor', 'distributing', 'wholesale',
  'merchandising', 'merchandise', 'e-commerce', 'ecommerce', 'D2C', 'DTC', 'click-and-collect', 'flagship', 'Nike', 'Adidas', 'Decathlon',
  'footwear', 'apparel', 'running', 'ski-touring', 'café', 'Café', 'AI', 'U.K.', 'EU', 'supply', 'chain', 'logistics', 'esports',
  'fantasy-league', 'product', 'development', 'innovation', 'launch', 'materials', 'technology', 'software', 'pricing', 'consumer',
  'growth', 'Europe', 'markets', 'sales', 'category', 'operations', 'q3', '2026', 'x', 'of', 'the', '&', '—', 'openings',
];

function word(seed: number): string {
  return VOCABULARY[seed % VOCABULARY.length];
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Deterministic synthetic archive at production scale, including date ties, missing dates and punctuation. */
function syntheticArchive(count: number): string {
  const items = Array.from({ length: count }, (_, index) => {
    const title = Array.from({ length: 6 + (index % 5) }, (_, offset) => word(index * 7 + offset * 13)).join(' ');
    const description = Array.from({ length: 25 + (index % 30) }, (_, offset) => word(index * 11 + offset * 17)).join(index % 3 === 0 ? ', ' : ' ');
    const category = word(index * 3);
    const pubDate = index % 97 === 0 ? '' : `<pubDate>${new Date(Date.UTC(2005 + (index % 22), index % 12, 1 + (index % 28))).toUTCString()}</pubDate>`;
    return `<item><guid>synthetic-${index}</guid><title>${escapeXml(title)}</title><link>https://www.sgieurope.com/${category.replace(/[^a-z]/gi, '') || 'news'}/synthetic-${index}.article</link><description>${escapeXml(description)}</description><category>${escapeXml(category)}</category>${pubDate}</item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;
}

async function normalizedCatalogue(xml: string): Promise<{ definition: ReturnType<typeof createSgiEuropeDefinition>; articles: NormalizedArticle[] }> {
  const definition = createSgiEuropeDefinition(async () => new Response(xml, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }));
  const records = await definition.adapter.loadCatalogue!({ limit: 100 });
  const articles = records.flatMap((record) => {
    const article = definition.adapter.normalizeArticle(record);
    return article ? [article] : [];
  });
  return { definition, articles };
}

function expectIdenticalPreselection(articles: NormalizedArticle[], intent: Intent, limits: number[], selectCatalogue?: (articles: NormalizedArticle[], intent: Intent, options: { limit: number }) => NormalizedArticle[]): void {
  // The reference is the slow implementation being replaced, so score once and derive every ordering from it.
  const expectedScores = articles.map((article) => referenceArticlePreselectionScore(article, intent));
  expect(feedPreselectionScores(articles, intent)).toEqual(expectedScores);
  for (const limit of limits) {
    const expected = referenceOrder(articles, expectedScores, limit).map((article) => article.id);
    expect(archiveAwareFeedPreselection(articles, intent, limit).map((article) => article.id)).toEqual(expected);
    if (selectCatalogue) expect(selectCatalogue(articles, intent, { limit }).map((article) => article.id)).toEqual(expected);
  }
}

describe('archive preselection equivalence', () => {
  it.each(intents)('ranks the SGI fixture identically to the reference implementation for %s', async (_label, intent) => {
    const { articles } = await normalizedCatalogue(sgiEuropeRssFixture);
    expect(articles.length).toBeGreaterThan(0);
    expectIdenticalPreselection(articles, intent, [100, 2]);
    expect(archiveAwareFeedPreselection(articles, intent, 100).map((article) => article.id)).toEqual(referencePreselection(articles, intent, 100).map((article) => article.id));
  });

  // The reference implementation needs ~3 minutes at production scale, so the default suite uses a
  // smaller archive with the same generator; PRESELECTION_FULL_ARCHIVE=1 runs the full 11,500 articles.
  const archiveSize = process.env.PRESELECTION_FULL_ARCHIVE === '1' ? 11_500 : 600;

  it(`ranks a synthetic ${archiveSize}-article archive identically, with exact scores, IDs and order`, async () => {
    const { definition, articles } = await normalizedCatalogue(syntheticArchive(archiveSize));
    expect(articles).toHaveLength(archiveSize);
    for (const [, intent] of intents) expectIdenticalPreselection(articles, intent, [100], (items, current, options) => definition.adapter.selectCatalogue!(items, current, options));
  }, 600_000);
});

describe('phraseOrTokenMatch semantics', () => {
  const terms = ['retail', 'store', 'stores', 'storefront', 'distribution', 'distributor', 'distr', 'e-commerce', 'ecommerce', 'E-Commerce', 'omni-channel', 'omnichannel', 'D2C', 'd2c', 'AI', 'ai', 'uk', 'U.K.', 'café', 'cafe', 'ski-touring', 'ski touring', 'retail operations', 'store openings', 'ail sto', 'click-and-collect', 'q3', '2026', '', '   ', '---', 'x'];
  const values = ['Retail operations: new stores', 'Store openings in the U.K. & EU', 'Omni-channel e-commerce (D2C) growth', 'Distributors expand; distribution grows', 'Café culture meets ski-touring', 'AI-driven storefronts', 'q3 2026 results', 'retail', 'ok', '', '   ', '—', 'click-and-collect pilots', 'distr.', 'Ecommerce', 'Click & collect'];

  it('matches the reference implementation for every term/value combination', () => {
    for (const term of terms) {
      for (const value of values) expect(phraseOrTokenMatch(term, value), `${JSON.stringify(term)} in ${JSON.stringify(value)}`).toBe(referencePhraseOrTokenMatch(term, value));
    }
  });

  it('keeps the documented edge cases', () => {
    // Punctuation and hyphens normalize to spaces, so hyphenated terms become phrases.
    expect(phraseOrTokenMatch('e-commerce', 'Omni-channel e-commerce (D2C) growth')).toBe(true);
    expect(phraseOrTokenMatch('ecommerce', 'Omni-channel e-commerce (D2C) growth')).toBe(false);
    expect(phraseOrTokenMatch('omnichannel', 'Omni-channel e-commerce')).toBe(false);
    // Tokens of two characters or fewer never match as single terms.
    expect(phraseOrTokenMatch('AI', 'AI-driven storefronts')).toBe(false);
    expect(phraseOrTokenMatch('uk', 'Store openings in the U.K.')).toBe(false);
    expect(phraseOrTokenMatch('D2C', 'Omni-channel e-commerce (D2C) growth')).toBe(true);
    // Five-character prefix matching applies only when term and token are both six or more characters.
    expect(phraseOrTokenMatch('distribution', 'Distributors expand')).toBe(true);
    expect(phraseOrTokenMatch('distr', 'Distributors expand')).toBe(false);
    expect(phraseOrTokenMatch('store', 'new stores')).toBe(false);
    expect(phraseOrTokenMatch('stores', 'new storefronts')).toBe(true);
    // Multi-word phrases match as normalized substrings, including across word boundaries.
    expect(phraseOrTokenMatch('retail operations', 'Retail operations: new stores')).toBe(true);
    expect(phraseOrTokenMatch('ail sto', 'retail stores')).toBe(true);
    expect(phraseOrTokenMatch('store openings', 'Store openings in the U.K.')).toBe(true);
    // Accents are stripped; empty or punctuation-only input never matches.
    expect(phraseOrTokenMatch('cafe', 'Café culture')).toBe(true);
    expect(phraseOrTokenMatch('', 'retail')).toBe(false);
    expect(phraseOrTokenMatch('---', 'retail')).toBe(false);
    expect(phraseOrTokenMatch('retail', '—')).toBe(false);
  });
});
