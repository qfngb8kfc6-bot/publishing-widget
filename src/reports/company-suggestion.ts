import type { NormalizedArticle } from '../core';

/**
 * "Did you mean Nike?" for a typed company that is one edit away from a company the publisher writes about
 * often. Names come from catalogue headlines: capitalised words (and pairs of them) that never appear in lower
 * case as often as they do capitalised mid-headline, so "Sales" or "New" never become company names.
 */

/** A company must head at least this many catalogue headlines to be suggested. */
export const SUGGESTION_MIN_MENTIONS = 10;
/** The typed name counts as weakly resolved when it appears in fewer headlines than this… */
export const WEAK_MAX_MENTIONS = 2;
/** …and the suggested company appears at least this many times more often. */
export const SUGGESTION_MIN_RATIO = 5;

export interface CompanyNameIndex {
  /** Lower-cased name → the name as headlines spell it and the number of headlines naming it (frequent names only). */
  frequent: Map<string, { name: string; count: number }>;
  /** Lower-cased headline words, kept by reference to count the typed name when a near match exists. */
  titles: readonly string[];
}

const NAME_TOKEN = /^[A-Z\d][\p{L}\d&'’.-]*$/u;
const TOKEN_SPLIT = /[\s,:;!?"“”()[\]|/]+/u;

function clean(token: string): string {
  return token.replace(/^['’.-]+|['’.-]+$/g, '').replace(/['’]s$/i, '');
}

export function buildCompanyNameIndex(articles: readonly Pick<NormalizedArticle, 'title'>[]): CompanyNameIndex {
  const capitalised = new Map<string, { spellings: Map<string, number>; count: number; inner: number }>();
  const lower = new Map<string, number>();
  const titles: string[] = [];
  for (const article of articles) {
    const tokens = (article.title ?? '').split(TOKEN_SPLIT).map(clean).filter(Boolean);
    titles.push(` ${tokens.join(' ').toLowerCase()} `);
    const seen = new Set<string>();
    const add = (name: string, inner: boolean) => {
      const key = name.toLowerCase();
      const entry = capitalised.get(key) ?? { spellings: new Map(), count: 0, inner: 0 };
      if (!seen.has(key)) { entry.count += 1; seen.add(key); }
      if (inner) entry.inner += 1;
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
      capitalised.set(key, entry);
    };
    tokens.forEach((token, index) => {
      if (!NAME_TOKEN.test(token) || token.length < 2) {
        if (/^[a-z]/.test(token)) lower.set(token, (lower.get(token) ?? 0) + 1);
        return;
      }
      add(token, index > 0);
      const next = tokens[index + 1];
      if (next && NAME_TOKEN.test(next)) add(`${token} ${next}`, index > 0);
    });
  }
  const frequent = new Map<string, { name: string; count: number }>();
  for (const [key, entry] of capitalised) {
    if (entry.count < SUGGESTION_MIN_MENTIONS) continue;
    // A common word capitalised only at the start of headlines ("Sales rise…") is not a company name.
    if ((lower.get(key) ?? 0) >= Math.max(1, entry.inner)) continue;
    const name = [...entry.spellings].sort((left, right) => right[1] - left[1])[0][0];
    frequent.set(key, { name, count: entry.count });
  }
  return { frequent, titles };
}

/** True when the two strings are one insertion, deletion, substitution or adjacent swap apart. */
export function oneEditApart(left: string, right: string): boolean {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const diffs = [...left].map((character, index) => (character === right[index] ? -1 : index)).filter((index) => index >= 0);
    if (diffs.length === 1) return true;
    return diffs.length === 2 && diffs[1] === diffs[0] + 1 && left[diffs[0]] === right[diffs[1]] && left[diffs[1]] === right[diffs[0]];
  }
  const [short, long] = left.length < right.length ? [left, right] : [right, left];
  for (let index = 0; index < long.length; index += 1) if (long.slice(0, index) + long.slice(index + 1) === short) return true;
  return false;
}

/** The frequent catalogue company one edit from the typed name, when the typed name itself is rarely or never named. */
export function suggestCompany(index: CompanyNameIndex, typed: string): string | undefined {
  const key = typed.replace(/\s+/g, ' ').trim().toLowerCase();
  if (key.length < 3 || key.length > 60 || index.frequent.has(key)) return undefined;
  const near = [...index.frequent].filter(([candidate]) => oneEditApart(key, candidate)).map(([, entry]) => entry).sort((left, right) => right.count - left.count)[0];
  if (!near) return undefined;
  const needle = ` ${key} `;
  let typedCount = 0;
  for (const title of index.titles) if (title.includes(needle) && (typedCount += 1) >= WEAK_MAX_MENTIONS) return undefined;
  return near.count >= Math.max(SUGGESTION_MIN_MENTIONS, typedCount * SUGGESTION_MIN_RATIO) ? near.name : undefined;
}
