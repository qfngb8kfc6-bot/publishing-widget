import { normalizeToken, tokenize } from './intent';
import type { Intent, NormalizedArticle, RelevanceResult } from './types';

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'your', 'you', 'that', 'what', 'best', 'describes']);

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

export function rankArticles(articles: NormalizedArticle[], intent: Intent, limit: number): RelevanceResult & { article: NormalizedArticle }[] {
  return articles
    .map((article, index) => ({ article, ...scoreArticle(article, intent), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ index: _index, ...result }) => result);
}
