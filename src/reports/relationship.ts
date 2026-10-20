import type { NormalizedArticle, ProfessionalProfile } from '../core';
import type { ArticleRelationship } from '../ai/types';

const SUPPLY_TERMS = /\b(suppliers?|supply chains?|vendors?|factor(?:y|ies)|manufacturers?|contract manufactur\w*|sourcing partners?|partners?|partnerships?|licensees?|joint ventures?)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(name.toLowerCase())}($|[^a-z0-9])`).test(text);
}

function ownCompanyNames(profile: ProfessionalProfile): string[] {
  const domainLabel = profile.companyDomain?.replace(/^www\./i, '').split('.')[0];
  return [...new Set([profile.companyName, profile.company?.name, domainLabel].filter((name): name is string => Boolean(name && name.trim().length >= 2)).map((name) => name.trim().toLowerCase()))];
}

/**
 * Deterministic hint for the content prompt: is this article about the reader's own company, a supplier or
 * partner relationship, another company the profile knows about (a likely competitor), or the wider market.
 * Uses only profile and company data already gathered; the model is told to confirm it from the article text.
 */
/** Own-company articles make up at most about this share of a main report while alternatives exist. */
export const OWN_COMPANY_MAX_SHARE = 0.6;

/**
 * Takes the first `limit` items of a ranked list, holding articles about the reader's own company to about 60%
 * of the result while other articles that already passed the normal threshold are available. Thresholds are
 * never lowered: when there are not enough alternatives the best own-company articles fill the remaining slots.
 * Rank order is preserved. `deferred` counts own-company articles moved out of the plain top `limit`.
 */
export function limitOwnCompanyShare<T>(ranked: T[], limit: number, isOwnCompany: (item: T) => boolean): { selected: T[]; deferred: number } {
  const size = Math.min(limit, ranked.length);
  const maxOwn = Math.round(size * OWN_COMPANY_MAX_SHARE);
  const own = ranked.map(isOwnCompany);
  const chosen = new Set<number>();
  let ownCount = 0;
  for (let index = 0; index < ranked.length && chosen.size < size; index += 1) {
    if (!own[index]) chosen.add(index);
    else if (ownCount < maxOwn) { chosen.add(index); ownCount += 1; }
  }
  for (let index = 0; index < ranked.length && chosen.size < size; index += 1) chosen.add(index);
  const deferred = own.slice(0, size).filter((isOwn, index) => isOwn && !chosen.has(index)).length;
  return { selected: ranked.filter((_, index) => chosen.has(index)), deferred };
}

export function articleRelationship(article: Pick<NormalizedArticle, 'title' | 'description'>, profile: ProfessionalProfile): ArticleRelationship {
  const text = `${article.title} ${article.description ?? ''}`.toLowerCase();
  const own = ownCompanyNames(profile);
  if (SUPPLY_TERMS.test(text)) return 'supplier_partner';
  if (own.some((name) => mentions(text, name))) return 'own_company';
  const peers = [...new Set([...(profile.entities ?? []), ...(profile.company?.entities ?? [])].map((name) => name.trim().toLowerCase()))].filter((name) => name.length >= 3 && !own.includes(name));
  if (peers.some((name) => mentions(text, name))) return 'likely_competitor';
  return 'wider_market';
}
