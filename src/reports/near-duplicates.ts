/**
 * Collapses near-duplicate stories in a ranked list before the AI calls, so one report never carries the same
 * story twice ("Misto's sustainability report" and "Misto Holdings 2025 sustainability report") or two
 * instalments of a recurring series ("Market Analysis: ... athletic apparel market" for 2024 and 2025).
 * Only removes duplicates: nothing is dropped for its score, and the threshold has already been applied.
 */

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'its', 'it', 'is', 'are', 'be', 'new', 'how', 'why', 'what', 'into', 'over', 'after', 'amid', 'vs', 'year', 'years']);
/** Legal-form and group words that follow a company name ("Misto Holdings"): not topic words. */
const COMPANY_SUFFIXES = new Set(['holdings', 'holding', 'group', 'inc', 'ltd', 'plc', 'ag', 'sa', 'se', 'co', 'corp', 'corporation', 'company', 'brands', 'international', 'industries']);
/** Product and market nouns: a footwear story and an apparel story are different stories, in a series or not. */
const SUBJECT_NOUNS = new Set(['footwear', 'apparel', 'sportswear', 'activewear', 'athleisure', 'outerwear', 'swimwear', 'underwear', 'equipment', 'hardgood', 'accessorie', 'sneaker', 'shoe', 'bike', 'bicycle', 'ski', 'snowboard', 'golf', 'tennis', 'running', 'outdoor', 'fitness', 'cycling', 'textile', 'fabric', 'polyester', 'nylon', 'cotton', 'leather', 'wool']);
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
  /** Capitalised words after the lead company ("Syre", "Loop"): other named companies, places or people. */
  named: Set<string>;
  /** Up to two words before "market" ("athletic apparel", "sports apparel"), when the title has that word. */
  market?: string;
  /** Product and market nouns in the title. */
  subjects: Set<string>;
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
  const marketAt = body.findIndex((word) => fold(word) === 'market');
  const market = marketAt > 0 ? body.slice(0, marketAt).filter((word) => !STOP_WORDS.has(word) && word !== 'global').slice(-2).map(fold).join(' ') : undefined;
  return { lead: words[0] ?? '', ...(series ? { series } : {}), topic, figures, named: namedWords(series ? title.slice(title.indexOf(':') + 1) : title), ...(market ? { market } : {}), subjects: new Set([...topic].filter((word) => SUBJECT_NOUNS.has(word))) };
}

/**
 * Capitalised words after the first word of the title (or of the text after a series colon), skipping the lead
 * company's legal-form suffix ("Misto Holdings"): in a sentence-case headline these are the other companies,
 * places and people it names.
 */
function namedWords(title: string): Set<string> {
  const raw = title.split(/\s+/).map((word) => word.replace(/[’']s?$/, '').replace(/[^A-Za-z0-9&-]/g, '')).filter(Boolean);
  const named = new Set<string>();
  raw.forEach((word, index) => {
    const lower = word.toLowerCase();
    if (index === 0 || !/^[A-Z]/.test(word) || STOP_WORDS.has(lower) || COMPANY_SUFFIXES.has(lower)) return;
    named.add(lower);
  });
  return named;
}

function overlap(left: Set<string>, right: Set<string>): { shared: number; ratio: number } {
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const smaller = Math.min(left.size, right.size);
  return { shared, ratio: smaller ? shared / smaller : 0 };
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

/** Same primary company with high title overlap, or the same series label with high overlap after the colon. */
export function isNearDuplicate(leftTitle: string, rightTitle: string): boolean {
  return shapesMatch(titleShape(leftTitle), titleShape(rightTitle));
}

function shapesMatch(left: TitleShape, right: TitleShape): boolean {
  if (left.figures.size && right.figures.size && ![...left.figures].some((figure) => right.figures.has(figure))) return false;
  // A second company (or place, or person) named in one title and not the other means a different story:
  // "Nike ... with Syre" and "Nike ... with Loop Industries" share a topic, not a story.
  if ([...left.named].some((word) => !right.named.has(word)) || [...right.named].some((word) => !left.named.has(word))) return false;
  // Footwear and apparel are different markets, in a series or not; apparel against apparel across years is fine.
  if (left.market !== undefined && right.market !== undefined && left.market !== right.market) return false;
  if (!sameSet(left.subjects, right.subjects)) return false;
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
