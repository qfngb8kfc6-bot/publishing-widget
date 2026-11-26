/**
 * Recency in the report's order, applied after the relevance threshold: age changes which qualifying story comes
 * first, never whether a story qualifies (thresholds and scores are unchanged, so no story is dropped for age).
 */
import type { NormalizedArticle } from '../core';

const DAY_MS = 86_400_000;
/** Stories up to this age count as recent for the lead. */
export const RECENT_LEAD_DAYS = 183;
/** A recent story leads instead of an older first story when its score is at most this many points lower. */
export const LEAD_SCORE_MARGIN = 10;

/**
 * Order weight by age: 1 up to 6 months, 0.9 at 12 months, then a clear step down for older coverage (0.75 at
 * 13 months, 0.6 at 3 years and beyond). An undated story is treated like a 12-month-old one.
 */
const ORDER_CURVE = [
  { ageDays: 0, weight: 1 },
  { ageDays: RECENT_LEAD_DAYS, weight: 1 },
  { ageDays: 365, weight: 0.9 },
  { ageDays: 395, weight: 0.75 },
  { ageDays: 1_095, weight: 0.6 },
] as const;
const UNDATED_WEIGHT = 0.9;

export function articleAgeDays(article: Pick<NormalizedArticle, 'publishedAt'>, now = Date.now()): number | undefined {
  const published = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN;
  return Number.isFinite(published) ? Math.max(0, (now - published) / DAY_MS) : undefined;
}

export function recencyOrderWeight(ageDays: number | undefined): number {
  if (ageDays === undefined) return UNDATED_WEIGHT;
  for (let index = 1; index < ORDER_CURVE.length; index += 1) {
    const previous = ORDER_CURVE[index - 1];
    const current = ORDER_CURVE[index];
    if (ageDays <= current.ageDays) return previous.weight + (current.weight - previous.weight) * ((ageDays - previous.ageDays) / (current.ageDays - previous.ageDays));
  }
  return ORDER_CURVE[ORDER_CURVE.length - 1].weight;
}

interface Orderable { article: Pick<NormalizedArticle, 'publishedAt'>; finalScore: number; relevanceType: 'direct' | 'adjacent' }

/** Direct before adjacent (as before); within each, by score times the order weight. Stable for ties. */
export function orderByRecency<T extends Orderable>(items: readonly T[], now = Date.now()): T[] {
  const key = new Map(items.map((item, index) => [item, { weighted: item.finalScore * recencyOrderWeight(articleAgeDays(item.article, now)), index }]));
  return [...items].sort((left, right) => (left.relevanceType === right.relevanceType
    ? key.get(right)!.weighted - key.get(left)!.weighted || key.get(left)!.index - key.get(right)!.index
    : left.relevanceType === 'direct' ? -1 : 1));
}

/**
 * The lead story prefers the last six months: when the first story is older and a recent story of the same or a
 * stronger relevance type scores within LEAD_SCORE_MARGIN of it, the best such story moves to the front. The
 * others keep their order.
 */
export function preferRecentLead<T extends Orderable>(items: readonly T[], now = Date.now()): T[] {
  const lead = items[0];
  if (!lead) return [...items];
  const leadAge = articleAgeDays(lead.article, now);
  if (leadAge !== undefined && leadAge <= RECENT_LEAD_DAYS) return [...items];
  const candidate = items.slice(1).find((item) => {
    const age = articleAgeDays(item.article, now);
    return age !== undefined && age <= RECENT_LEAD_DAYS && (item.relevanceType === 'direct' || lead.relevanceType === 'adjacent') && item.finalScore >= lead.finalScore - LEAD_SCORE_MARGIN;
  });
  return candidate ? [candidate, ...items.filter((item) => item !== candidate)] : [...items];
}
