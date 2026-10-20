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
export function articleRelationship(article: Pick<NormalizedArticle, 'title' | 'description'>, profile: ProfessionalProfile): ArticleRelationship {
  const text = `${article.title} ${article.description ?? ''}`.toLowerCase();
  const own = ownCompanyNames(profile);
  if (SUPPLY_TERMS.test(text)) return 'supplier_partner';
  if (own.some((name) => mentions(text, name))) return 'own_company';
  const peers = [...new Set([...(profile.entities ?? []), ...(profile.company?.entities ?? [])].map((name) => name.trim().toLowerCase()))].filter((name) => name.length >= 3 && !own.includes(name));
  if (peers.some((name) => mentions(text, name))) return 'likely_competitor';
  return 'wider_market';
}
