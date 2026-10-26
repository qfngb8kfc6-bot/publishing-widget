/**
 * Collapses near-duplicate stories in a ranked list before the AI calls, so one report never carries the same
 * story twice ("Misto's sustainability report" and "Misto Holdings 2025 sustainability report") or two
 * instalments of a recurring series ("Market Analysis: ... athletic apparel market" for 2024 and 2025).
 * Only removes duplicates: nothing is dropped for its score, and the threshold has already been applied.
 */

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'its', 'it', 'is', 'are', 'be', 'new', 'how', 'why', 'what', 'into', 'over', 'after', 'amid', 'vs', 'year', 'years']);
/** Legal-form and group words that follow a company name ("Misto Holdings"): not topic words. */
const COMPANY_SUFFIXES = new Set(['holdings', 'holding', 'group', 'inc', 'ltd', 'plc', 'ag', 'sa', 'se', 'co', 'corp', 'corporation', 'company', 'brands', 'international']);
/** Share of the shorter title's topic words the other title must contain. */
const TITLE_OVERLAP = 0.75;
const MIN_SHARED_TOPIC_WORDS = 2;
/** The older story is kept only when it is clearly stronger: direct against adjacent, or this many points ahead. */
const CLEARLY_STRONGER_POINTS = 15;

export interface DuplicateCandidate {
  article: { id: string; title: string; publishedAt?: string };
  deterministicScore: number;
  relevanceType: 'direct' | 'adjacent';
}

interface TitleShape {
  /** First word of the title, possessive removed: the story's primary company in news headlines. */
  lead: string;
  /** "market analysis" for "Market Analysis: ...": a recurring series label, when the title has one. */
  series?: string;
  /** Topic words: no stop words, years, numbers or company suffixes; plurals folded. */
  topic: Set<string>;
  /** Figures other than years ("12" stores, "7" %): different figures mean different stories. */
  figures: Set<string>;
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[’']s\b/g, '').replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
}

function fold(word: string): string {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

function titleShape(title: string): TitleShape {
  const words = tokens(title);
  const colon = title.indexOf(':');
  const series = colon > 0 && colon <= 40 ? tokens(title.slice(0, colon)).join(' ') : undefined;
  const body = series ? tokens(title.slice(colon + 1)) : words;
  const topic = new Set(body.filter((word, index) => !STOP_WORDS.has(word) && !/\d/.test(word) && !COMPANY_SUFFIXES.has(word) && !(index === 0 && !series)).map(fold));
  const figures = new Set(body.filter((word) => /\d/.test(word) && !/^(?:19|20)\d\d$/.test(word)));
  return { lead: words[0] ?? '', ...(series ? { series } : {}), topic, figures };
}

function overlap(left: Set<string>, right: Set<string>): { shared: number; ratio: number } {
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const smaller = Math.min(left.size, right.size);
  return { shared, ratio: smaller ? shared / smaller : 0 };
}

/** Same primary company with high title overlap, or the same series label with high overlap after the colon. */
export function isNearDuplicate(leftTitle: string, rightTitle: string): boolean {
  return shapesMatch(titleShape(leftTitle), titleShape(rightTitle));
}

function shapesMatch(left: TitleShape, right: TitleShape): boolean {
  if (left.figures.size && right.figures.size && ![...left.figures].some((figure) => right.figures.has(figure))) return false;
  const { shared, ratio } = overlap(left.topic, right.topic);
  if (shared < MIN_SHARED_TOPIC_WORDS || ratio < TITLE_OVERLAP) return false;
  if (left.series || right.series) return left.series === right.series;
  return left.lead.length >= 2 && left.lead === right.lead && !STOP_WORDS.has(left.lead);
}

function publishedTime(candidate: DuplicateCandidate): number {
  const time = candidate.article.publishedAt ? Date.parse(candidate.article.publishedAt) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** The newer story wins unless the older one is clearly stronger. */
function preferred<T extends DuplicateCandidate>(left: T, right: T): T {
  const [newer, older] = publishedTime(left) >= publishedTime(right) ? [left, right] : [right, left];
  const olderClearlyStronger = (older.relevanceType === 'direct' && newer.relevanceType === 'adjacent') || (older.relevanceType === newer.relevanceType && older.deterministicScore >= newer.deterministicScore + CLEARLY_STRONGER_POINTS);
  return olderClearlyStronger ? older : newer;
}

/**
 * Keeps one story per near-duplicate group, at the position of the group's best-ranked member so the ranking
 * order is otherwise unchanged. `collapsed` lists each removed article with the one kept in its place.
 */
export function collapseNearDuplicates<T extends DuplicateCandidate>(ranked: readonly T[], limit = ranked.length): { kept: T[]; collapsed: Array<{ removedId: string; keptId: string }> } {
  const groups: Array<{ winner: T; shapes: TitleShape[] }> = [];
  const collapsed: Array<{ removedId: string; keptId: string }> = [];
  // Only the head of the list can reach a report; comparing the long tail would cost time for nothing.
  const head = ranked.slice(0, limit);
  for (const item of head) {
    const shape = titleShape(item.article.title);
    const group = groups.find((existing) => existing.shapes.some((member) => shapesMatch(member, shape)));
    if (!group) { groups.push({ winner: item, shapes: [shape] }); continue; }
    group.shapes.push(shape);
    const winner = preferred(group.winner, item);
    collapsed.push({ removedId: (winner === item ? group.winner : item).article.id, keptId: winner.article.id });
    group.winner = winner;
  }
  return { kept: [...groups.map((group) => group.winner), ...ranked.slice(limit)], collapsed };
}
