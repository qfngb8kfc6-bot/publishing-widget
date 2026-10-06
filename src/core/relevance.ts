import { normalizeToken, tokenize } from './intent';
import type { Intent, NormalizedArticle, RelevanceResult } from './types';
import type { ProfessionalProfile } from './professional';

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'your', 'you', 'that', 'what', 'best', 'describes']);

export const HYBRID_SCORE_WEIGHTS = {
  deterministic: 0.7,
  semantic: 0.3,
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

/** Version-independent deterministic professional score used by persisted reports. */
export function scoreProfessionalArticle(article: NormalizedArticle, profile: ProfessionalProfile): RelevanceResult {
  const intent: Intent = {
    publisherId: article.publisherId,
    answers: { companyUrl: profile.companyUrl, jobTitle: profile.jobTitle },
    queryText: profile.semanticQueries.join(' '),
    keywords: profile.searchTerms,
    interests: profile.professionalInterests,
    personas: [profile.role.function, ...profile.role.professionalThemes],
  };
  const base = scoreArticle(article, intent);
  const searchable = normalizeToken([article.title, article.description ?? '', article.categories.join(' '), article.tags.join(' '), article.contentSnippet ?? ''].join(' '));
  const companyTerms = tokenize(`${profile.companyName ?? ''} ${profile.companyDomain}`);
  const roleTerms = profile.retrieval.roleTerms.flatMap(tokenize);
  const companyMatches = companyTerms.filter((term) => searchable.includes(term));
  const roleMatches = roleTerms.filter((term) => searchable.includes(term));
  const ageDays = article.publishedAt ? Math.max(0, (Date.now() - Date.parse(article.publishedAt)) / 86_400_000) : 365;
  const freshness = Number.isFinite(ageDays) ? Math.max(0, 10 - Math.min(ageDays / 30, 10)) : 0;
  const score = Math.min(100, Math.round(base.score * 0.65 + Math.min(companyMatches.length * 8, 16) + Math.min(roleMatches.length * 3, 12) + freshness));
  const signals = [...base.relevanceSignals];
  if (companyMatches.length) signals.push(`connects to ${profile.companyName ?? profile.companyDomain}`);
  if (roleMatches.length) signals.push(`relates to your work in ${profile.role.function.toLowerCase()}`);
  if (freshness >= 7) signals.push('is recent coverage');
  return { score, relevanceSignals: [...new Set(signals)] };
}
