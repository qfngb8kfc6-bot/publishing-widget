import type { NormalizedArticle } from '../core';

/** The only angle labels a report stores. The content prompt lists them; anything else is mapped onto them. */
export const ALLOWED_ANGLES = [
  'competitor benchmark',
  'market signal',
  'demand signal',
  'channel shift',
  'supplier risk',
  'sourcing shift',
  'cost signal',
  'capacity signal',
  'regulatory exposure',
  'compliance pressure',
  'legal risk',
  'sustainability pressure',
  'product innovation',
  'partnership signal',
  'leadership move',
] as const;

export type Angle = typeof ALLOWED_ANGLES[number];

/**
 * Keyword rules from a free-text label to the closest allowed angle, most specific first: "supplier
 * consolidation" is supplier risk and "pricing pressure" a cost signal before either reads as a market signal.
 */
const ANGLE_RULES: Array<[RegExp, Angle]> = [
  [/legal|lawsuit|litigation|court|patent|trademark|counterfeit|\bip\b|dispute|settlement/, 'legal risk'],
  [/complian|audit|certif|standard|disclosure|reporting/, 'compliance pressure'],
  [/regulat|legislat|\blaw\b|policy|ban\b|government|\beu\b|tariff rule/, 'regulatory exposure'],
  [/sustainab|climate|carbon|emission|esg|circular|recycl|environment|green/, 'sustainability pressure'],
  [/collab|partner|alliance|joint venture|licens|sponsor|co-brand|deal/, 'partnership signal'],
  [/launch|product|innovation|design|technolog|material|range|collection/, 'product innovation'],
  [/hire|hiring|appoint|executive|ceo|leadership|management|succession|departure|people|talent|board/, 'leadership move'],
  [/supplier|supply|vendor/, 'supplier risk'],
  [/sourcing|nearshor|reshor|offshor|relocat/, 'sourcing shift'],
  [/capacity|factory|factories|production|manufactur|output/, 'capacity signal'],
  [/cost|price|pricing|margin|tariff|freight|inflation|currency|profit/, 'cost signal'],
  [/channel|retail|store|wholesale|dtc|direct-to-consumer|omnichannel|e-?commerce|distribution/, 'channel shift'],
  [/competit|rival|benchmark|peer|share/, 'competitor benchmark'],
  [/demand|consumer|shopper|sales|traffic/, 'demand signal'],
  [/market|growth|trend|outlook|signal|forecast/, 'market signal'],
];

/** An allowed angle for a model-supplied label: itself when allowed, else the closest by keyword, else none. */
export function normalizeAngle(value: unknown): Angle | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!label || label.length > 60) return undefined;
  const exact = ALLOWED_ANGLES.find((angle) => angle === label);
  if (exact) return exact;
  return ANGLE_RULES.find(([pattern]) => pattern.test(label))?.[1];
}

const PEOPLE_MOVE = /\b(appoint\w*|hire[sd]?|hiring|names|named|ceo|chief|president|director|steps? down|resign\w*|succeed\w*|successor|promot\w*|joins? as|depart\w*)\b/i;
const COLLABORATION = /\b(collab\w*|partner\w*|team(?:s|ed)? up|alliance|joint venture|licens\w*|co-?brand\w*|capsule)\b|\sx\s/i;
const LAUNCH = /\b(launch\w*|unveil\w*|introduc\w*|debut\w*|releas\w*|new (?:shoe|collection|range|line|product|model)|collection)\b/i;

/**
 * A collaboration or product launch is never a leadership move. When the model labels such an article a
 * leadership move and the article describes no people change, the angle becomes partnership signal or
 * product innovation.
 */
export function angleForArticle(angle: Angle | undefined, article: Pick<NormalizedArticle, 'title' | 'description'>): Angle | undefined {
  if (angle !== 'leadership move') return angle;
  const text = `${article.title} ${article.description ?? ''}`;
  if (PEOPLE_MOVE.test(text)) return angle;
  if (COLLABORATION.test(text)) return 'partnership signal';
  if (LAUNCH.test(text)) return 'product innovation';
  return angle;
}
