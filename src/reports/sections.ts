import type { ReportRecommendation } from './types';

export const EDITORIAL_SECTION_IDS = [
  'top-developments',
  'companies-to-watch',
  'market-moves',
  'technology-developments',
  'sustainability-developments',
  'what-to-watch-next',
  'from-the-archive',
  'more-relevant-stories',
] as const;

export type EditorialSectionId = typeof EDITORIAL_SECTION_IDS[number];

const editorialSectionSet = new Set<string>(EDITORIAL_SECTION_IDS);

const SECTION_SIGNALS: Record<Exclude<EditorialSectionId, 'more-relevant-stories'>, string[]> = {
  'top-developments': ['development', 'innovation', 'launch', 'new', 'strategy', 'research', 'breakthrough', 'technology', 'ai', 'platform', 'app'],
  'companies-to-watch': ['case study', 'company', 'companies', 'brand', 'brands', 'ceo', 'chief', 'executive', 'holdings'],
  'market-moves': ['deal', 'partnership', 'acquisition', 'merger', 'expansion', 'investment', 'growth', 'distribution', 'sales', 'market', 'moves', 'agreement'],
  'technology-developments': ['technology', 'tech', 'ai', 'artificial intelligence', 'app', 'platform', 'software', 'digital', 'automation', 'innovation'],
  'sustainability-developments': ['sustainability', 'sustainable', 'circular', 'recycling', 'climate', 'carbon', 'environment', 'renewable', 'materials'],
  'what-to-watch-next': ['outlook', 'forecast', 'future', 'next', 'trend', 'watch'],
  'from-the-archive': ['archive', 'history', 'anniversary', 'retrospective'],
};

function canonicalUrl(article: ReportRecommendation['article']): string | undefined {
  const value = article.canonicalUrl ?? article.url;
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase() || undefined;
  }
}

export function articleIdentityKeys(article: ReportRecommendation['article']): string[] {
  const keys = [`id:${article.id}`];
  const url = canonicalUrl(article);
  if (url) keys.push(`url:${url}`);
  return keys;
}

function uniqueRecommendations(recommendations: ReportRecommendation[]): ReportRecommendation[] {
  const seen = new Set<string>();
  return recommendations.filter((recommendation) => {
    const keys = articleIdentityKeys(recommendation.article);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function searchableRecommendation(recommendation: ReportRecommendation): { title: string; metadata: string; all: string } {
  const article = recommendation.article;
  const title = article.title.toLowerCase();
  const metadata = [article.description, article.category, ...article.categories, ...article.tags].filter(Boolean).join(' ').toLowerCase();
  return { title, metadata, all: `${title} ${metadata} ${(article.searchText ?? '').toLowerCase()}` };
}

function signalScore(recommendation: ReportRecommendation, signal: string): number {
  const fields = searchableRecommendation(recommendation);
  const normalized = signal.toLowerCase();
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:\\d+)?(?=$|[^a-z0-9])`, 'i');
  return (pattern.test(fields.title) ? 4 : 0) + (pattern.test(fields.metadata) ? 2 : 0) + (pattern.test(fields.all) ? 1 : 0);
}

function chooseSection(recommendation: ReportRecommendation, configured: EditorialSectionId[]): EditorialSectionId | undefined {
  const candidates = configured.filter((section): section is Exclude<EditorialSectionId, 'more-relevant-stories'> => section !== 'more-relevant-stories' && section in SECTION_SIGNALS);
  let selected: EditorialSectionId | undefined;
  let bestScore = 0;
  for (const section of candidates) {
    const score = SECTION_SIGNALS[section].reduce((total, signal) => total + signalScore(recommendation, signal), 0);
    const companyLed = section === 'companies-to-watch' && /case study|company|companies|brand|brands|ceo|chief|executive|holdings/i.test(searchableRecommendation(recommendation).title + ' ' + searchableRecommendation(recommendation).metadata);
    const marketLed = section === 'market-moves' && /deal|partnership|acquisition|merger|expansion|investment|growth|distribution|sales|market|moves|agreement/i.test(searchableRecommendation(recommendation).title + ' ' + searchableRecommendation(recommendation).metadata);
    const adjustedScore = score + (companyLed ? 6 : 0) + (marketLed ? 6 : 0);
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      selected = section;
    }
  }
  return selected;
}

export interface EditorialSection {
  id: EditorialSectionId;
  recommendations: ReportRecommendation[];
}

export interface EditorialAllocation {
  recommendations: ReportRecommendation[];
  featured?: ReportRecommendation;
  additional: ReportRecommendation[];
  sections: EditorialSection[];
}

export function sectionsFromRecommendations(recommendations: ReportRecommendation[]): EditorialSection[] {
  const grouped = new Map<EditorialSectionId, ReportRecommendation[]>();
  for (const recommendation of recommendations) {
    const section = recommendation.rankingMetadata.editorialSection;
    if (!section || !editorialSectionSet.has(section)) continue;
    const id = section as EditorialSectionId;
    const existing = grouped.get(id) ?? [];
    existing.push(recommendation);
    grouped.set(id, existing);
  }
  return [...grouped.entries()].map(([id, sectionRecommendations]) => ({ id, recommendations: sectionRecommendations }));
}

export function allocateEditorialSections(recommendations: ReportRecommendation[], configuredSections: string[] = []): EditorialAllocation {
  const unique = uniqueRecommendations(recommendations).map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
  const featured = unique[0];
  const configured = configuredSections.filter((section): section is EditorialSectionId => editorialSectionSet.has(section));
  const additional = unique.slice(1).map((recommendation) => {
    const editorialSection = chooseSection(recommendation, configured);
    return editorialSection ? { ...recommendation, rankingMetadata: { ...recommendation.rankingMetadata, editorialSection } } : recommendation;
  });
  const fallbackSection = configured.includes('more-relevant-stories') ? 'more-relevant-stories' as const : undefined;
  const allocated = additional.map((recommendation) => {
    if (recommendation.rankingMetadata.editorialSection || !fallbackSection) return recommendation;
    return { ...recommendation, rankingMetadata: { ...recommendation.rankingMetadata, editorialSection: fallbackSection } };
  });
  const ordered = featured ? [featured, ...allocated] : allocated;
  const assignedKeys = new Set(sectionsFromRecommendations(ordered).flatMap((section) => section.recommendations.flatMap((recommendation) => articleIdentityKeys(recommendation.article))));
  const unassigned = ordered.slice(featured ? 1 : 0).filter((recommendation) => articleIdentityKeys(recommendation.article).every((key) => !assignedKeys.has(key)));
  return { recommendations: ordered, featured, additional: unassigned, sections: sectionsFromRecommendations(ordered) };
}
