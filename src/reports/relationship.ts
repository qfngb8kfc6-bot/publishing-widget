import type { NormalizedArticle, ProfessionalProfile } from '../core';
import type { ArticleRelationship } from '../ai/types';

const SUPPLY_TERMS = /\b(suppliers?|supply chains?|vendors?|factor(?:y|ies)|manufacturers?|contract manufactur\w*|sourcing partners?|partners?|partnerships?|licensees?|joint ventures?)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(name.toLowerCase())}($|[^a-z0-9])`).test(text);
}

/** Legal-form and filler words dropped to get the name a headline uses ("Nike, Inc." → "Nike"). */
const NAME_SUFFIXES = new Set(['inc', 'incorporated', 'ltd', 'limited', 'llc', 'plc', 'corp', 'corporation', 'co', 'company', 'group', 'holdings', 'sa', 'se', 'ag', 'gmbh', 'nv', 'bv', 'spa', 'ab', 'as', 'oy']);

function nameVariants(name: string): string[] {
  const words = name.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  const core = words.filter((word, index) => !(index === 0 && word === 'the')).filter((word, index, all) => index === 0 || !NAME_SUFFIXES.has(word) || all.length === 1);
  return [words.join(' '), core.join(' ')];
}

/**
 * The names a story may use for the reader's company: the entered or resolved name with and without its legal
 * form, and the resolved domain's label ("decathlon" for decathlon.co.uk). Works from the name alone.
 */
export function ownCompanyNames(profile: ProfessionalProfile): string[] {
  const domainLabel = profile.companyDomain?.replace(/^www\./i, '').split('.')[0];
  const names = [profile.companyName, profile.company?.name].filter((name): name is string => Boolean(name?.trim())).flatMap(nameVariants);
  return [...new Set([...names, domainLabel?.toLowerCase()].map((name) => name?.trim() ?? '').filter((name) => name.length >= 2))];
}

/** Words that, right before the name, make it a passing mention ("a veteran of Nike Golf", "orders for Nike"). */
const PASSING_MENTION_BEFORE = new Set(['of', 'at', 'from', 'with', 'for', 'by', 'to', 'than', 'including', 'like', 'via', 'versus', 'vs', 'against', 'into', 'on', 'over', 'ex', 'former']);
/** How far into the excerpt's first sentence the name may start and still be its actor ("French retailer Decathlon has"). */
const ACTOR_MAX_LEADING_WORDS = 5;

function firstSentence(text: string): string {
  const match = text.trim().match(/^[\s\S]*?[.!?](?=\s+["“‘'(]?[A-Z0-9]|\s*$)/);
  return (match ? match[0] : text).trim();
}

/** True when the name opens the sentence's subject: within its first few words and not after a preposition. */
function isActor(sentence: string, name: string): boolean {
  const words = sentence.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const nameWords = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (!nameWords.length) return false;
  for (let index = 0; index <= Math.min(ACTOR_MAX_LEADING_WORDS, words.length - nameWords.length); index += 1) {
    if (!nameWords.every((word, offset) => words[index + offset] === word)) continue;
    return index === 0 || !PASSING_MENTION_BEFORE.has(words[index - 1]);
  }
  return false;
}

/** The name only qualifies a supply noun ("Nike supplier adds a factory", "Nike's factories"): a supplier story. */
const SUPPLY_NOUN_AFTER = /^(?:['’]s\s+)?(?:suppliers?|vendors?|factor(?:y|ies)|manufacturers?|contract manufactur\w*|licensees?)\b/;

function modifiesSupplyNoun(text: string, name: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}(?=$|[^a-z0-9])`, 'g');
  const positions = [...text.matchAll(pattern)].map((match) => match.index! + match[1].length + name.length);
  return positions.length > 0 && positions.every((end) => SUPPLY_NOUN_AFTER.test(text.slice(end).trimStart()));
}

/**
 * A story is about the reader's own company only when the company is its subject: named in the headline, or the
 * actor of the excerpt's first sentence. A passing mention ("a veteran of Nike Golf") does not count, nor a headline
 * where the name only qualifies a supplier ("Nike supplier adds a factory"). Whole-word
 * and case-insensitive; supplier or partner words elsewhere in the story do not change it.
 */
export function isOwnCompanyStory(article: Pick<NormalizedArticle, 'title' | 'description'>, profile: ProfessionalProfile): boolean {
  const names = ownCompanyNames(profile);
  if (!names.length) return false;
  const title = article.title.toLowerCase();
  if (names.some((name) => mentions(title, name) && !modifiesSupplyNoun(title, name))) return true;
  const sentence = firstSentence(article.description ?? '');
  return Boolean(sentence) && names.some((name) => isActor(sentence, name));
}

/**
 * Deterministic hint for the content prompt: is this article about the reader's own company, a supplier or
 * partner relationship, another company the profile knows about (a likely competitor), or the wider market.
 * Uses only profile and company data already gathered; the model is told to confirm it from the article text.
 */
/** Own-company articles make up at most this share of a main report while alternatives exist. */
export const OWN_COMPANY_MAX_SHARE = 0.6;

/** Below this many stories a report is thin: held-back own-company stories come back before it is shown. */
export const THIN_REPORT_STORIES = 5;

/**
 * Takes the first `limit` items of a ranked list, holding articles about the reader's own company to at most 60%
 * of the result (rounded down: 4 of 8, 3 of 5, never 5 of 8). Only when fewer than five other articles passed the
 * threshold may own-company articles fill the remaining places (`capExceeded`); thresholds are never lowered.
 * Rank order is preserved. `deferred` counts own-company articles moved out of the plain top `limit`; `heldBack`
 * lists them, best first. `nonOwnEligible` counts the other articles in the input.
 */
export function limitOwnCompanyShare<T>(ranked: T[], limit: number, isOwnCompany: (item: T) => boolean): { selected: T[]; deferred: number; heldBack: T[]; nonOwnEligible: number; capExceeded: boolean } {
  const size = Math.min(limit, ranked.length);
  const maxOwn = Math.floor(size * OWN_COMPANY_MAX_SHARE);
  const own = ranked.map(isOwnCompany);
  const nonOwnEligible = own.filter((isOwn) => !isOwn).length;
  const chosen = new Set<number>();
  let ownCount = 0;
  for (let index = 0; index < ranked.length && chosen.size < size; index += 1) {
    if (!own[index]) chosen.add(index);
    else if (ownCount < maxOwn) { chosen.add(index); ownCount += 1; }
  }
  // Too few alternatives: the best remaining own-company articles fill the places rather than leave them empty.
  // With five or more alternatives the cap holds, even if that leaves the report shorter.
  if (nonOwnEligible < THIN_REPORT_STORIES) for (let index = 0; index < ranked.length && chosen.size < size; index += 1) chosen.add(index);
  const selected = ranked.filter((_, index) => chosen.has(index));
  const deferred = own.slice(0, size).filter((isOwn, index) => isOwn && !chosen.has(index)).length;
  // Own-company articles the cap moved out of the plain top `limit`, best first: restored when the report thins out.
  const heldBack = ranked.slice(0, size).filter((_, index) => own[index] && !chosen.has(index));
  const selectedOwn = selected.filter(isOwnCompany).length;
  return { selected, deferred, heldBack, nonOwnEligible, capExceeded: selectedOwn > selected.length * OWN_COMPANY_MAX_SHARE };
}

/**
 * Restores held-back own-company articles (best first) until the report has `minimum` stories, keeping the
 * pool's rank order. Held-back articles already passed the threshold and the rerank; nothing else is added.
 */
export function restoreHeldBack<T>(kept: T[], heldBack: readonly T[], pool: readonly T[], minimum = THIN_REPORT_STORIES): { kept: T[]; restored: T[] } {
  const restored = heldBack.filter((item) => !kept.includes(item)).slice(0, Math.max(0, minimum - kept.length));
  if (!restored.length) return { kept, restored };
  const position = new Map(pool.map((item, index) => [item, index]));
  const rank = (item: T) => position.get(item) ?? Number.MAX_SAFE_INTEGER;
  return { kept: [...kept, ...restored].sort((left, right) => rank(left) - rank(right)), restored };
}

/** A briefing always carries at least this many stories that are not about the reader's own company, when any qualify. */
export const MIN_MARKET_CONTEXT_STORIES = 2;

/** Market context counts stories whose subject is not the reader's company (see isOwnCompanyStory). */
export const namesOwnCompany = isOwnCompanyStory;

/**
 * How good a market-context story is for this reader: 0 names a competitor or peer the profile knows about,
 * 1 is in the reader's sector (matches a company-derived concept or names the company's industry or topics),
 * 2 is other market coverage.
 */
export function marketContextTier(article: Pick<NormalizedArticle, 'title' | 'description'>, profile: ProfessionalProfile, matchedConcepts: readonly string[] = []): 0 | 1 | 2 {
  if (articleRelationship(article, profile) === 'likely_competitor') return 0;
  const text = `${article.title} ${article.description ?? ''}`.toLowerCase();
  const companyConcepts = new Set((profile.retrieval?.concepts ?? []).filter((concept) => concept.source === 'company').map((concept) => concept.concept.toLowerCase()));
  if (matchedConcepts.some((concept) => companyConcepts.has(concept.toLowerCase()))) return 1;
  const sectorTerms = [profile.company?.industry, ...(profile.company?.topics ?? []), ...(profile.company?.productsServices ?? [])]
    .filter((term): term is string => Boolean(term && term.trim().length >= 4))
    .map((term) => term.trim().toLowerCase());
  return sectorTerms.some((term) => mentions(text, term)) ? 1 : 2;
}

/** Market-context candidates best first: competitors, then same sector, then the rest; by score within each. */
export function orderMarketContext<T extends { article: Pick<NormalizedArticle, 'title' | 'description'>; finalScore: number; directMatches?: string[]; adjacentMatches?: string[] }>(candidates: readonly T[], profile: ProfessionalProfile): T[] {
  const tiers = new Map(candidates.map((item) => [item, marketContextTier(item.article, profile, [...(item.directMatches ?? []), ...(item.adjacentMatches ?? [])])]));
  return [...candidates].sort((left, right) => tiers.get(left)! - tiers.get(right)! || right.finalScore - left.finalScore);
}

export function articleRelationship(article: Pick<NormalizedArticle, 'title' | 'description'>, profile: ProfessionalProfile): ArticleRelationship {
  const text = `${article.title} ${article.description ?? ''}`.toLowerCase();
  const own = ownCompanyNames(profile);
  // The company as subject comes first: a "partners" or "suppliers" word in the excerpt used to turn every
  // own-company story into supplier_partner, so the own-company count (and the cap) saw none.
  if (isOwnCompanyStory(article, profile)) return 'own_company';
  if (SUPPLY_TERMS.test(text)) return 'supplier_partner';
  const peers = [...new Set([...(profile.entities ?? []), ...(profile.company?.entities ?? [])].map((name) => name.trim().toLowerCase()))].filter((name) => name.length >= 3 && !own.includes(name));
  if (peers.some((name) => mentions(text, name))) return 'likely_competitor';
  return 'wider_market';
}
