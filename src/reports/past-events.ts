/**
 * Past event previews: a trade-show guide or preview is useful before the event and stale after it. The main
 * briefing leaves out previews whose event (or, without an event date, whose publication) is more than
 * PAST_EVENT_GRACE_DAYS in the past; focused reading (theme search) still lists them.
 */
import type { NormalizedArticle } from '../core';

const DAY_MS = 86_400_000;
/** A preview stays eligible until this many days after its event (or publication when no event date is found). */
export const PAST_EVENT_GRACE_DAYS = 30;

type PreviewArticle = Pick<NormalizedArticle, 'title'> & Partial<Pick<NormalizedArticle, 'description' | 'excerpt' | 'category' | 'categories' | 'publishedAt'>>;

const TRADE_SHOW_CATEGORY = /^trade[\s-]?shows?$/i;
/** Specific enough on their own. */
const PREVIEW_PHRASE = /\bevent guide\b/i;
/** Common in ordinary news ("ahead of results", "what to expect from the Budget"): count only beside an event word. */
const SOFT_PREVIEW_PHRASE = /\b(?:previews?|what to expect|ahead of)\b/i;
const EVENT_WORD = /\b(?:trade ?shows?|show|fairs?|exhibitions?|expos?|conferences?|summits?|congress|events?|festivals?|fashion week)\b/i;

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const RANGE = '(?:\\s*(?:-|–|—|to)\\s*' + DAY + ')?';
/** "2-4 February 2026", "2 Feb 2026" (the range's last day). */
const DAY_MONTH_YEAR = new RegExp(`\\b${DAY}${RANGE}\\s+${MONTH}\\.?,?\\s+(20\\d{2})\\b`, 'gi');
/** "February 2-4, 2026", "Feb 2 2026". */
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTH}\\.?\\s+${DAY}${RANGE},?\\s+(20\\d{2})\\b`, 'gi');
/** "February 2026" (the month's last day). */
const MONTH_YEAR = new RegExp(`\\b${MONTH}\\.?,?\\s+(20\\d{2})\\b`, 'gi');

function monthIndex(name: string): number | undefined { return MONTHS[name.toLowerCase().slice(0, 3)]; }

function utc(year: number, month: number, day: number): number | undefined {
  const time = Date.UTC(year, month, day);
  return new Date(time).getUTCMonth() === month ? time : undefined;
}

function articleText(article: PreviewArticle): string {
  return [article.title, article.description, article.excerpt].filter(Boolean).join(' \n ');
}

/** True for an event preview or guide: a "Trade Shows" category, "event guide", or preview wording beside an event word. */
export function isEventPreview(article: PreviewArticle): boolean {
  if ([article.category, ...(article.categories ?? [])].some((value) => typeof value === 'string' && TRADE_SHOW_CATEGORY.test(value.trim()))) return true;
  const text = articleText(article);
  if (PREVIEW_PHRASE.test(text)) return true;
  return SOFT_PREVIEW_PHRASE.test(text) && EVENT_WORD.test(text);
}

/** The latest event date written in the headline or excerpt (end of a range, end of a month without a day). */
export function eventDateMs(article: PreviewArticle): number | undefined {
  const text = articleText(article);
  let latest: number | undefined;
  const keep = (time: number | undefined) => { if (time !== undefined && (latest === undefined || time > latest)) latest = time; };
  for (const match of text.matchAll(DAY_MONTH_YEAR)) {
    const month = monthIndex(match[3]);
    if (month !== undefined) keep(utc(Number(match[4]), month, Number(match[2] ?? match[1])));
  }
  for (const match of text.matchAll(MONTH_DAY_YEAR)) {
    const month = monthIndex(match[1]);
    if (month !== undefined) keep(utc(Number(match[4]), month, Number(match[3] ?? match[2])));
  }
  if (latest === undefined) {
    for (const match of text.matchAll(MONTH_YEAR)) {
      const month = monthIndex(match[1]);
      if (month !== undefined) keep(Date.UTC(Number(match[2]), month + 1, 0));
    }
  }
  return latest;
}

/**
 * True when the article is an event preview whose event is more than PAST_EVENT_GRACE_DAYS ago; without an event
 * date, when it was published more than that ago. A preview with neither date is kept.
 */
export function isPastEventPreview(article: PreviewArticle, now = Date.now()): boolean {
  if (!isEventPreview(article)) return false;
  const eventAt = eventDateMs(article);
  const published = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN;
  const reference = eventAt ?? (Number.isFinite(published) ? published : undefined);
  return reference !== undefined && now - reference > PAST_EVENT_GRACE_DAYS * DAY_MS;
}
