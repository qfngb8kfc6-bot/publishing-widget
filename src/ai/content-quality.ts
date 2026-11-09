/**
 * Heuristic writing-quality checks for AI briefing text. They only produce warnings: rejecting text for
 * phrasing would bring back the deterministic template, so the text is kept and the warning is logged.
 */
export type ContentQualityCode = 'meta_opening' | 'banned_phrase' | 'duplicate_opening' | 'too_long' | 'no_specific_fact' | 'too_few_citations' | 'restates_reader' | 'third_person_reader' | 'old_fact_not_dated' | 'unsupported_year' | 'reader_company_subject';

export const BANNED_EXPLANATION_PHRASES = ['this article', 'this matters', 'relevant because', 'relevant to your work', 'your role as', 'maps to', 'aligns with', 'the profile', 'directly relevant'];
export const BANNED_SUMMARY_PHRASES = ['the most relevant articles', 'focus on', 'focuses on', 'the profile', 'this briefing'];
export const MAX_EXPLANATION_WORDS = 45;
/** The prompt asks for at most 90 words; the warning allows a little slack so it marks real overruns only. */
export const MAX_SUMMARY_WORDS = 90;
const SUMMARY_WORD_SLACK = 10;

/** "for a retailer", "for a product manager", "for the head of retail": the summary should say "you" instead. */
const THIRD_PERSON_READER = /\bfor (?:a|an|the) (?:[a-z-]+ ){0,3}(?:retailer|brand|manager|director|head|officer|lead|leader|buyer|executive|professional|specialist|team|planner|analyst)s?\b/i;

const STOP_WORDS = new Set(['about', 'after', 'again', 'against', 'their', 'there', 'these', 'those', 'which', 'while', 'where', 'would', 'could', 'should', 'other', 'under', 'into', 'from', 'with', 'that', 'this', 'than', 'have', 'will', 'more', 'over']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The reader's company as the subject in the third person: a sentence opening "For Nike", "At Nike" or a
 * possessive ("Nike's", "Adidas'", "Adidas's"), or "Nike is/faces/should ..." anywhere. "your Nike stores",
 * "brands competing with Nike" and a possessive later in a sentence ("while Nike's rivals ...") are context.
 */
function readerCompanyAsSubject(summary: string, companyName: string | undefined): boolean {
  const name = companyName?.trim();
  if (!name || name.length < 2) return false;
  const company = escapeRegExp(name);
  const verbs = '(?:is|are|was|has|have|faces?|facing|must|should|needs?|will|can|could|may|risks?|stands?)';
  // A sentence opening on the company's possessive ("Adidas' move into lifestyle ...", "Nike's stores ...") makes
  // the company the subject too.
  const opening = new RegExp(`^(?:(?:for|at) ${company}\\b|${company}(?:['’]s?)(?=\\s))`, 'i');
  const anywhere = new RegExp(`(?<!your |with |than |like |against |beyond |outside )\\b${company} ${verbs}\\b`, 'i');
  return summary.split(/(?<=[.!?;])\s+/).some((sentence) => opening.test(sentence.trim())) || anywhere.test(summary);
}

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

/** A lead about the reader or the briefing instead of the news ("You are seeing ..."): a soft warning only. */
const META_OPENING = /^\s*(?:you(?:'|’| a)re (?:seeing|looking at|reading)|you see\b|here (?:is|are)\b|this (?:week|briefing|report)\b|in this (?:briefing|report)\b)/i;

const YEAR = /\b(?:19[5-9]\d|20\d\d)\b/g;

/** Text an article's figures can be dated from: title, description and lead, plus its year when it is older. */
export interface YearSource {
  text: string;
  olderYear?: string;
}

/**
 * Years in the AI text that none of the given sources state. A market report published in 2025 usually gives
 * 2024 figures, so a "2025" that only matches the publication date is how a figure gets relabelled. An older
 * article's own year is allowed: the DATES rule asks for it ("In 2019, Decathlon ...").
 */
function hasUnsupportedYear(text: string, sources: readonly YearSource[]): boolean {
  if (!sources.length) return false;
  const supported = new Set(sources.flatMap((source) => [...(source.text.match(YEAR) ?? []), ...(source.olderYear ? [source.olderYear] : [])]));
  return (text.match(YEAR) ?? []).some((year) => !supported.has(year));
}

/** Article facts the explanation checks need: its title and, for articles older than the cutoff, its year. */
export interface ExplanationArticleFacts {
  title: string;
  /** Publication year when the article is older than the 18-month cutoff; the explanation should name it. */
  olderYear?: string;
  /** Title, description and lead; when given, every year in the explanation must appear in it (or be olderYear). */
  sourceText?: string;
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
    const { title, olderYear, sourceText } = typeof facts === 'string' ? { title: facts, olderYear: undefined, sourceText: undefined } : facts ?? { title: '', olderYear: undefined, sourceText: undefined };
    if (!hasSpecificFact(explanation, title)) warnings.push({ articleId, code: 'no_specific_fact' });
    if (olderYear && !explanation.includes(olderYear)) warnings.push({ articleId, code: 'old_fact_not_dated' });
    if (sourceText !== undefined && hasUnsupportedYear(explanation, [{ text: sourceText, olderYear }])) warnings.push({ articleId, code: 'unsupported_year' });
  }
  return warnings;
}

/** sources: the cited-articles' year sources by article ID; years in the summary must come from one of them. */
export function summaryQualityWarnings(summary: string, citedArticleIds: readonly string[], reader: { jobTitle?: string; companyName?: string }, sources?: ReadonlyMap<string, YearSource>): ContentQualityCode[] {
  const warnings: ContentQualityCode[] = [];
  if (containsPhrase(summary, BANNED_SUMMARY_PHRASES)) warnings.push('banned_phrase');
  if (citedArticleIds.length < 2) warnings.push('too_few_citations');
  if (reader.jobTitle && reader.companyName && containsPhrase(summary, [`${reader.jobTitle} at ${reader.companyName}`])) warnings.push('restates_reader');
  if (THIRD_PERSON_READER.test(summary) || (reader.jobTitle && containsPhrase(summary, [`for a ${reader.jobTitle}`, `for an ${reader.jobTitle}`, `for the ${reader.jobTitle}`]))) warnings.push('third_person_reader');
  if (words(summary).length > MAX_SUMMARY_WORDS + SUMMARY_WORD_SLACK) warnings.push('too_long');
  if (readerCompanyAsSubject(summary, reader.companyName)) warnings.push('reader_company_subject');
  if (sources && hasUnsupportedYear(summary, citedArticleIds.flatMap((id) => sources.get(id) ?? []))) warnings.push('unsupported_year');
  if (META_OPENING.test(summary)) warnings.push('meta_opening');
  return warnings;
}

/** More than this many consecutive words shared with the headline or excerpt is copying (the LEAD rule's limit). */
export const MAX_SHARED_CONSECUTIVE_WORDS = 5;
/** Share of an explanation's content words found in the headline and excerpt above which it only retells them. */
export const RESTATED_TOKEN_OVERLAP = 0.7;
const MIN_CONTENT_WORDS_FOR_OVERLAP = 6;
const RESTATEMENT_STOP_WORDS = new Set([...STOP_WORDS, 'the', 'and', 'for', 'its', 'has', 'had', 'was', 'are', 'but', 'not', 'into', 'per', 'via', 'new']);

/**
 * Why an explanation only restates the story shown directly above it, or undefined when it does not: it shares
 * more than five consecutive words with the headline or excerpt, or nearly all its content words come from them.
 * A reader-first explanation reuses a company or a number, not the story's own sentence.
 */
export function explanationRestatement(explanation: string, article: { title: string; description?: string }): 'consecutive_words' | 'token_overlap' | undefined {
  const text = words(explanation);
  const sources = [words(article.title), words(article.description ?? '')];
  const run = MAX_SHARED_CONSECUTIVE_WORDS + 1;
  const shingles = new Set(sources.flatMap((source) => source.slice(0, Math.max(0, source.length - run + 1)).map((_, index) => source.slice(index, index + run).join(' '))));
  for (let index = 0; index + run <= text.length; index += 1) if (shingles.has(text.slice(index, index + run).join(' '))) return 'consecutive_words';
  const content = text.filter((word) => word.length >= 3 && !RESTATEMENT_STOP_WORDS.has(word));
  if (content.length < MIN_CONTENT_WORDS_FOR_OVERLAP) return undefined;
  const sourceWords = new Set(sources.flat());
  const shared = content.filter((word) => sourceWords.has(word)).length;
  return shared / content.length >= RESTATED_TOKEN_OVERLAP ? 'token_overlap' : undefined;
}
