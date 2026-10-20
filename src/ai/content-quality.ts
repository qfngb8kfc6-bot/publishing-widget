/**
 * Heuristic writing-quality checks for AI briefing text. They only produce warnings: rejecting text for
 * phrasing would bring back the deterministic template, so the text is kept and the warning is logged.
 */
export type ContentQualityCode = 'banned_phrase' | 'duplicate_opening' | 'too_long' | 'no_specific_fact' | 'too_few_citations' | 'restates_reader' | 'third_person_reader' | 'old_fact_not_dated';

export const BANNED_EXPLANATION_PHRASES = ['this article', 'this matters', 'relevant because', 'relevant to your work', 'your role as', 'maps to', 'aligns with', 'the profile', 'directly relevant'];
export const BANNED_SUMMARY_PHRASES = ['the most relevant articles', 'focus on', 'focuses on', 'the profile', 'this briefing'];
export const MAX_EXPLANATION_WORDS = 45;

/** "for a retailer", "for a product manager", "for the head of retail": the summary should say "you" instead. */
const THIRD_PERSON_READER = /\bfor (?:a|an|the) (?:[a-z-]+ ){0,3}(?:retailer|brand|manager|director|head|officer|lead|leader|buyer|executive|professional|specialist|team|planner|analyst)s?\b/i;

const STOP_WORDS = new Set(['about', 'after', 'again', 'against', 'their', 'there', 'these', 'those', 'which', 'while', 'where', 'would', 'could', 'should', 'other', 'under', 'into', 'from', 'with', 'that', 'this', 'than', 'have', 'will', 'more', 'over']);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9%\s-]/g, ' ').split(/\s+/).filter(Boolean);
}

function containsPhrase(text: string, phrases: readonly string[]): boolean {
  const normalized = ` ${words(text).join(' ')} `;
  return phrases.some((phrase) => normalized.includes(` ${words(phrase).join(' ')} `));
}

/** A number, a capitalised name after the first word of a sentence, or a distinctive word from the article title. */
function hasSpecificFact(text: string, title: string): boolean {
  if (/\d/.test(text)) return true;
  const properNoun = text.split(/(?<=[.!?;:])\s+/).some((sentence) => sentence.trim().split(/\s+/).slice(1).some((word) => /^[A-Z][a-zA-Z&'-]{1,}/.test(word)));
  if (properNoun) return true;
  const titleWords = new Set(words(title).filter((word) => word.length >= 5 && !STOP_WORDS.has(word)));
  return words(text).some((word) => titleWords.has(word));
}

/** Article facts the explanation checks need: its title and, for articles older than the cutoff, its year. */
export interface ExplanationArticleFacts {
  title: string;
  /** Publication year when the article is older than the 18-month cutoff; the explanation should name it. */
  olderYear?: string;
}

export function explanationQualityWarnings(explanations: ReadonlyArray<{ articleId: string; explanation: string }>, articles: ReadonlyMap<string, string | ExplanationArticleFacts>): Array<{ articleId: string; code: ContentQualityCode }> {
  const warnings: Array<{ articleId: string; code: ContentQualityCode }> = [];
  const openings = new Set<string>();
  for (const { articleId, explanation } of explanations) {
    if (containsPhrase(explanation, BANNED_EXPLANATION_PHRASES)) warnings.push({ articleId, code: 'banned_phrase' });
    const opening = words(explanation).slice(0, 3).join(' ');
    if (opening && openings.has(opening)) warnings.push({ articleId, code: 'duplicate_opening' });
    openings.add(opening);
    if (words(explanation).length > MAX_EXPLANATION_WORDS) warnings.push({ articleId, code: 'too_long' });
    const facts = articles.get(articleId);
    const { title, olderYear } = typeof facts === 'string' ? { title: facts, olderYear: undefined } : facts ?? { title: '', olderYear: undefined };
    if (!hasSpecificFact(explanation, title)) warnings.push({ articleId, code: 'no_specific_fact' });
    if (olderYear && !explanation.includes(olderYear)) warnings.push({ articleId, code: 'old_fact_not_dated' });
  }
  return warnings;
}

export function summaryQualityWarnings(summary: string, citedArticleIds: readonly string[], reader: { jobTitle?: string; companyName?: string }): ContentQualityCode[] {
  const warnings: ContentQualityCode[] = [];
  if (containsPhrase(summary, BANNED_SUMMARY_PHRASES)) warnings.push('banned_phrase');
  if (citedArticleIds.length < 2) warnings.push('too_few_citations');
  if (reader.jobTitle && reader.companyName && containsPhrase(summary, [`${reader.jobTitle} at ${reader.companyName}`])) warnings.push('restates_reader');
  if (THIRD_PERSON_READER.test(summary) || (reader.jobTitle && containsPhrase(summary, [`for a ${reader.jobTitle}`, `for an ${reader.jobTitle}`, `for the ${reader.jobTitle}`]))) warnings.push('third_person_reader');
  return warnings;
}
