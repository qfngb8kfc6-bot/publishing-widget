import { isAmbiguousSingleWord, normalizeToken, roleSubjectTerms, wordsMatch } from '../core';
import type { ProfessionalProfile } from '../core';
import type { ReportRecord, ReportRecommendation } from './types';

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map((value) => value.replace(/\s+/g, ' ').trim()).filter((value) => {
    const key = normalizeToken(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** At most this many already-shown theme-result article IDs are sent with, and excluded from, a theme search. */
export const MAX_SHOWN_THEME_ARTICLE_IDS = 60;

/** Generic vocabulary expansion for focused professional themes. */
const THEME_EXPANSIONS: Record<string, string[]> = {
  stores: ['store', 'store openings', 'retail locations', 'physical retail', 'flagship', 'shop', 'retail footprint'],
  omnichannel: ['online and store', 'digital retail', 'e-commerce', 'click and collect', 'DTC', 'channel strategy', 'digital commerce'],
  distribution: ['distribution centre', 'logistics', 'supply chain', 'fulfilment', 'wholesale', 'dealer', 'channel distribution'],
  'retail operations': ['stores', 'distribution', 'merchandising', 'sales', 'retail execution', 'customer experience', 'fulfilment', 'store performance'],
};

function expandedThemeTerms(theme: string): string[] {
  const normalized = normalizeToken(theme);
  return unique([theme, ...(THEME_EXPANSIONS[normalized] ?? [])]);
}

/**
 * Concept families: two theme candidates in one family are near-synonyms ("litigation" and "lawsuit") and would
 * produce near-identical theme cards and searches, so only the first is shown.
 */
const THEME_FAMILIES: string[][] = [
  ['litigation', 'lawsuit', 'legal action', 'court case', 'court', 'class action', 'legal dispute', 'dispute', 'judge', 'ruling', 'trial', 'settlement', 'sue'],
  ['intellectual property', 'trademark', 'patent', 'copyright', 'counterfeit', 'infringement', 'brand protection'],
  ['regulation', 'regulator', 'compliance', 'legislation', 'directive'],
  ['consumer protection', 'consumer law', 'greenwashing', 'misleading claims', 'advertising standards', 'product safety', 'product recall'],
  ['competition law', 'antitrust', 'competition authority', 'merger control', 'cartel'],
  ['data protection', 'privacy', 'gdpr'],
  ['emissions', 'carbon', 'decarbonisation', 'decarbonization', 'climate', 'net zero', 'greenhouse gas'],
  ['circularity', 'circular economy', 'recycling', 'recycled materials', 'resale', 'reuse'],
  ['due diligence', 'human rights', 'forced labour', 'forced labor', 'supply chain transparency'],
  ['chemicals', 'pfas', 'hazardous substances'],
  // Physical retail: "stores" and "store openings" are one theme card, not two.
  ['stores', 'store openings', 'store opening', 'store closures', 'retail locations', 'physical retail', 'flagship', 'retail footprint'],
  // Buying from suppliers: "suppliers" and "vendors" are one card unless their own stories clearly differ.
  ['procurement', 'suppliers', 'supplier', 'vendors', 'vendor', 'sourcing', 'purchasing'],
];

/**
 * Families whose members are matched by exact word (plural or singular) rather than shared prefix, so "supply
 * chains" is not read as "suppliers", and where a second member may still be chosen when its own stories (those
 * naming that member, not the whole family) clearly differ from the first's: both have some, and under 75% of
 * them are shared. Keyed by the family's first member.
 */
const STORY_SPLIT_FAMILIES = new Set(['procurement']);

/** Two articles in four or more matching both candidates mark them as one subtopic in this report. */
const THEME_ARTICLE_OVERLAP = 0.75;

const words = (value: string): string[] => normalizeToken(value).split(' ').filter(Boolean);

/** True when every word of the term occurs, in some word form, among the given words. */
function containsTerm(haystack: string[], term: string): boolean {
  const termWords = words(term);
  return termWords.length > 0 && termWords.every((word) => haystack.some((candidate) => wordsMatch(candidate, word)));
}

const singular = (word: string): string => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);

/** True when every word of the term occurs among the given words as the same word, singular or plural. */
function containsExactTerm(haystack: string[], term: string): boolean {
  const termWords = words(term);
  return termWords.length > 0 && termWords.every((word) => haystack.some((candidate) => singular(candidate) === singular(word)));
}

const isStorySplitFamily = (family: number): boolean => family >= 0 && STORY_SPLIT_FAMILIES.has(THEME_FAMILIES[family][0]);

function themeFamily(theme: string): number {
  const themeWords = words(theme);
  return THEME_FAMILIES.findIndex((family) => family.some((member) => (STORY_SPLIT_FAMILIES.has(family[0]) ? containsExactTerm(themeWords, member) : containsTerm(themeWords, member))));
}

type ThemeArticle = { title: string; description?: string };

/**
 * Picks up to four semantically distinct themes for a role anchored on its title subject. Vocabulary subtopics
 * come first (the bare title topic is the umbrella over all of them, so it only fills spare places); subtopics
 * the report's own articles cover are preferred; and a candidate is rejected as a near-synonym of one already
 * chosen when it is a word form of it or contains it ("trademark law"), sits in the same concept family
 * ("lawsuit" after "litigation"), or matches nearly the same report articles.
 */
function distinctSubjectThemes(topics: string[], subjectTerms: string[], articles: ThemeArticle[]): string[] {
  const topicKeys = new Set(topics.map(normalizeToken));
  const vocabulary = unique(subjectTerms).filter((term) => !topicKeys.has(normalizeToken(term)) && !isAmbiguousSingleWord(term));
  const coverage = themeCoverage(articles);
  const grounded = vocabulary.filter((term) => coverage(term).size > 0);
  return distinctThemes([...grounded, ...vocabulary.filter((term) => !grounded.includes(term)), ...unique(topics)], articles);
}

/** The indexes of the articles whose title or description names the theme or a member of its concept family. */
function themeCoverage(articles: ThemeArticle[], ownTermsOnly = false): (theme: string) => Set<number> {
  const articleWords = articles.map((article) => words(`${article.title} ${article.description ?? ''}`));
  return (theme: string): Set<number> => {
    const themeFamilyIndex = themeFamily(theme);
    const family = ownTermsOnly ? -1 : themeFamilyIndex;
    const terms = family >= 0 ? [theme, ...THEME_FAMILIES[family]] : [theme];
    const contains = isStorySplitFamily(themeFamilyIndex) ? containsExactTerm : containsTerm;
    return new Set(articleWords.flatMap((text, index) => (terms.some((term) => contains(text, term)) ? [index] : [])));
  };
}

/** Both themes have stories of their own and under 75% of them are shared. */
function storiesClearlyDiffer(left: Set<number>, right: Set<number>): boolean {
  if (!left.size || !right.size) return false;
  const shared = [...left].filter((index) => right.has(index)).length;
  return shared / new Set([...left, ...right]).size < THEME_ARTICLE_OVERLAP;
}

/**
 * Up to four candidates in order, each rejected as a near-synonym of one already chosen when it is a word form of
 * it or contains it ("retail operations" after "retail", "trademark law" after "trademark"), sits in the same
 * concept family ("store openings" after "stores", "lawsuit" after "litigation"), or matches nearly the same
 * report articles.
 */
function distinctThemes(candidates: string[], articles: ThemeArticle[]): string[] {
  const coverage = themeCoverage(articles);
  const ownCoverage = themeCoverage(articles, true);
  const chosen: Array<{ theme: string; family: number; articles: Set<number>; own: Set<number> }> = [];
  for (const theme of candidates) {
    if (chosen.length === 4) break;
    const family = themeFamily(theme);
    const articleSet = coverage(theme);
    const own = ownCoverage(theme);
    const nearSynonym = chosen.some((other) => {
      if (family >= 0 && family === other.family) return !(isStorySplitFamily(family) && storiesClearlyDiffer(own, other.own));
      const [shorter, longer] = words(theme).length <= words(other.theme).length ? [theme, other.theme] : [other.theme, theme];
      if (containsTerm(words(longer), shorter)) return true;
      const shared = [...articleSet].filter((index) => other.articles.has(index)).length;
      const union = new Set([...articleSet, ...other.articles]).size;
      return shared >= 2 && shared / union >= THEME_ARTICLE_OVERLAP;
    });
    if (!nearSynonym) chosen.push({ theme, family, articles: articleSet, own });
  }
  return chosen.map(({ theme }) => theme);
}

/**
 * Chooses a report's themes at generation; the report's own articles (title and description) help keep them
 * distinct. Dedicated roles keep their profile themes.
 */
export function selectReportThemes(profile: ProfessionalProfile, articles: ThemeArticle[] = []): string[] {
  const subjectTerms = roleSubjectTerms(profile.role);
  if (subjectTerms) {
    // A role anchored on its title subject gets only genuine subject terms as themes: the title topic and the
    // validated AI vocabulary. Without vocabulary that is just the topic; fewer themes beat compounds like
    // "legal reporting" or generic words (risk, growth, reporting) driving a theme search.
    return distinctSubjectThemes(profile.role.titleTopics ?? [], subjectTerms, articles);
  }
  // A lone ambiguous word ("infrastructure", "platforms") would search for the wrong sense in trade coverage.
  // Dedicated roles get the same near-synonym check: "retail" and "retail operations" are one card.
  return distinctThemes(unique([...profile.professionalInterests, ...profile.likelyInformationNeeds, ...profile.role.professionalThemes]).filter((theme) => !isAmbiguousSingleWord(theme)), articles);
}

/**
 * The themes a report shows, once each has its supporting stories: a theme whose stories are the same as another
 * theme's, or all among them and at least 75% of them, is merged into it (the theme with more stories stays; on a
 * tie the earlier one), and there are never more themes than stories. A small subtopic inside an umbrella theme
 * that backs every story ("omnichannel": 2 of the 8 "stores" stories) stays its own card. Members of the
 * procurement family merge whenever 75% or more of their stories are shared, subset or not. Order is kept; themes with no supporting story are left to
 * reportThemes, which hides them.
 */
export function consolidateThemes(themes: readonly string[], support: Readonly<Record<string, readonly string[]>>, storyCount: number): { themes: string[]; support: Record<string, string[]>; merged: number } {
  const supported = themes.filter((theme) => support[theme]?.length);
  const sets = new Map(supported.map((theme) => [theme, new Set(support[theme])]));
  const within = (inner: Set<string>, outer: Set<string>) => [...inner].every((id) => outer.has(id));
  const kept = supported.filter((theme, index) => !supported.some((other, otherIndex) => {
    if (other === theme) return false;
    const mine = sets.get(theme)!;
    const theirs = sets.get(other)!;
    // Two members of a story-split family ("suppliers", "vendors") are one card unless their supporting stories
    // clearly differ: 75% or more shared merges them (more stories stays; on a tie the earlier one).
    const family = themeFamily(theme);
    if (isStorySplitFamily(family) && family === themeFamily(other)) {
      const shared = [...mine].filter((id) => theirs.has(id)).length;
      if (shared / new Set([...mine, ...theirs]).size >= THEME_ARTICLE_OVERLAP) return theirs.size > mine.size || (theirs.size === mine.size && otherIndex < index);
    }
    if (!within(mine, theirs)) return false;
    // Equal sets: the earlier theme stays. A strict subset merges into the larger theme when it is most of it.
    if (mine.size === theirs.size) return otherIndex < index;
    return mine.size / theirs.size >= THEME_ARTICLE_OVERLAP;
  })).slice(0, Math.max(0, storyCount));
  const keptSet = new Set(kept);
  return {
    themes: [...kept, ...themes.filter((theme) => !support[theme]?.length)],
    support: Object.fromEntries(kept.map((theme) => [theme, [...support[theme]]])),
    merged: supported.length - keptSet.size,
  };
}

type ThemeReport = Pick<ReportRecord, 'professionalProfile' | 'recommendations'>;
type SupportArticle = Pick<ReportRecommendation['article'], 'title' | 'description' | 'categories'> & Partial<Pick<ReportRecommendation['article'], 'summary' | 'tags'>>;

/**
 * Standard synonyms that show a story is about a theme without naming it ("supplier" for procurement). Used only to
 * decide whether a story supports a theme, never for theme selection or ranking.
 */
const THEME_RELATED_TERMS: Record<string, string[]> = {
  procurement: ['sourcing', 'supplier', 'vendor', 'purchasing', 'buying', 'tender'],
  sourcing: ['supplier', 'vendor', 'procurement', 'manufacturer', 'factory', 'factories'],
  suppliers: ['supplier', 'vendor', 'sourcing', 'procurement', 'manufacturer', 'factory', 'factories'],
  vendors: ['vendor', 'supplier', 'sourcing', 'procurement'],
  wearables: ['wearable', 'smartwatch', 'smart ring', 'fitness tracker', 'fitness band'],
};

/** The theme, its focused-search expansions, related terms and, for a theme in a concept family, its members. */
function themeMatchTerms(theme: string): string[] {
  const family = themeFamily(theme);
  return unique([...expandedThemeTerms(theme), ...(THEME_RELATED_TERMS[normalizeToken(theme)] ?? []), ...(family >= 0 ? THEME_FAMILIES[family] : [])]);
}

/**
 * True when the article's own text (title, description, categories, tags) or the concepts the scorer matched in it
 * name the theme, one of its expansions or a member of its concept family, in some word form.
 */
export function articleSupportsTheme(theme: string, article: SupportArticle, matchedConcepts: readonly string[] = []): boolean {
  const text = words([article.title, article.description ?? article.summary ?? '', ...(article.categories ?? []), ...(article.tags ?? [])].join(' '));
  const terms = themeMatchTerms(theme);
  if (terms.some((term) => containsTerm(text, term))) return true;
  return matchedConcepts.some((concept) => terms.some((term) => containsTerm(words(concept), term)));
}

/**
 * The report stories that support each theme, as article IDs. A theme the AI linked to report stories (the
 * articles its theme line was written from) keeps those links; otherwise, or when none of them is still in the
 * report, the stories whose text names the theme. Themes with no supporting story get no entry.
 */
export function themeSupport(themes: readonly string[], recommendations: ReadonlyArray<{ articleId: string; article: SupportArticle; matchedConcepts?: readonly string[] }>, aiLinks: Readonly<Record<string, readonly string[]>> = {}): Record<string, string[]> {
  const inReport = new Set(recommendations.map((item) => item.articleId));
  const support: Record<string, string[]> = {};
  for (const theme of themes) {
    const linked = [...new Set(aiLinks[theme] ?? [])].filter((id) => inReport.has(id));
    const ids = linked.length ? linked : recommendations.filter((item) => articleSupportsTheme(theme, item.article, item.matchedConcepts)).map((item) => item.articleId);
    if (ids.length) support[theme] = ids;
  }
  return support;
}

/** Article IDs of the report stories supporting a theme: stored at generation, else matched by text (older reports). */
function supportingIds(report: ThemeReport, theme: string): string[] {
  const stored = report.professionalProfile.themeArticleIds;
  if (stored) return stored[theme] ?? [];
  return themeSupport([theme], report.recommendations)[theme] ?? [];
}

/** The report stories that support the theme, strongest match first. */
export function themeSupportingRecommendations(report: ThemeReport, theme: string): ReportRecommendation[] {
  const ids = new Set(supportingIds(report, theme));
  const seen = new Set<string>();
  return report.recommendations
    .filter((item) => ids.has(item.articleId) && !seen.has(item.articleId) && Boolean(seen.add(item.articleId)))
    .sort((left, right) => right.displayScore - left.displayScore || left.rank - right.rank);
}

/**
 * The same bounded theme list is used by the report UI and the focused-search API. A theme no report story
 * supports is not shown: its card would promise stories that focused reading cannot list.
 */
export function reportThemes(report: ThemeReport): string[] {
  const themes = report.professionalProfile.themes ?? selectReportThemes(report.professionalProfile);
  return themes.filter((theme) => supportingIds(report, theme).length > 0);
}

/**
 * Focused search accepts any theme chosen for the report, shown or not: a hidden theme has no card to click, and
 * accepting it keeps links from older report pages working.
 */
export function findReportTheme(report: Pick<ReportRecord, 'professionalProfile'>, requestedTheme: string): string | undefined {
  const normalized = normalizeToken(requestedTheme);
  return (report.professionalProfile.themes ?? selectReportThemes(report.professionalProfile)).find((theme) => normalizeToken(theme) === normalized);
}

/** Acronyms and brand spellings kept as written when a theme is shown in sentence case. */
const DISPLAY_WORDS: Record<string, string> = Object.fromEntries([
  'AI', 'AR', 'VR', 'RFID', 'ESG', 'EU', 'UK', 'USA', 'DTC', 'D2C', 'B2B', 'B2C', 'B2B2C', 'IoT', 'GDPR', 'PFAS', 'CSRD', 'CSDDD', 'ESPR', 'DPP',
  'KPI', 'KPIs', 'SKU', 'SKUs', 'ERP', 'CRM', 'API', 'APIs', 'NFT', 'NFTs', 'GPS', 'CEO', 'CFO', 'CTO', 'M&A', 'IPO', 'ROI', 'SaaS', 'SEO',
  'GenAI', 'eBay', 'iPhone', 'iOS', 'TikTok', 'YouTube', 'LinkedIn', 'PayPal', 'WhatsApp',
].map((word) => [word.toLowerCase(), word]));

function displayWord(word: string): string {
  // A word written with capitals ("AI", "eBay", "Nike") is already as its source spelled it.
  if (/[A-Z]/.test(word)) return word;
  return word.split(/(?<=[-/])/).map((part) => {
    const match = part.match(/^(.*?)([-/]?)$/)!;
    return `${DISPLAY_WORDS[match[1]] ?? match[1]}${match[2]}`;
  }).join('');
}

/** A theme for inline text ("stories that touch on AI coaching"): acronyms and brands restored, nothing else. */
export function themeInlineText(theme: string): string {
  return theme.replace(/\s+/g, ' ').trim().split(' ').map(displayWord).join(' ');
}

/** A theme as a heading in sentence case: "connected fitness" → "Connected fitness", "ai in retail" → "AI in retail". */
export function themeDisplayTitle(theme: string): string {
  const [first = '', ...rest] = theme.replace(/\s+/g, ' ').trim().split(' ');
  const shown = displayWord(first);
  // An acronym or brand opening the theme keeps its spelling ("eBay marketplace", "AI coaching").
  const opening = shown !== first || /[A-Z]/.test(first) ? shown : `${first.charAt(0).toUpperCase()}${first.slice(1)}`;
  return [opening, ...rest.map(displayWord)].filter(Boolean).join(' ');
}

/** Add a selected theme to the persisted profile only in memory for focused retrieval. */
export function profileForTheme(profile: ProfessionalProfile, theme: string): ProfessionalProfile {
  const add = (values: string[], value: string): string[] => unique([...values, value]);
  const retrieval = profile.retrieval;
  const themeTerms = expandedThemeTerms(theme);
  const contextTerms = unique([
    ...profile.role.professionalThemes,
    ...profile.role.responsibilities,
    ...retrieval.roleTerms,
    ...profile.directInterests,
    ...profile.adjacentInterests,
  ]).filter((value) => normalizeToken(value) !== normalizeToken(theme));
  const expandedTerms = unique([...themeTerms, ...contextTerms]).slice(0, 48);
  const themeConcepts = themeTerms.map((concept, index) => ({ concept, weight: index === 0 ? 1.25 : 1.05, relevanceType: 'direct' as const, source: 'role' as const }));
  // A role anchored on its title subject treats the chosen theme as part of that subject for this search.
  const subjectTerms = roleSubjectTerms(profile.role);
  return {
    ...profile,
    professionalInterests: unique([...profile.professionalInterests, ...themeTerms]),
    directInterests: unique([...profile.directInterests, ...themeTerms]),
    likelyInformationNeeds: add(profile.likelyInformationNeeds, theme),
    searchTerms: unique([...profile.searchTerms, ...expandedTerms]),
    semanticQueries: add(profile.semanticQueries, theme),
    role: { ...profile.role, professionalThemes: add(profile.role.professionalThemes, theme), ...(subjectTerms ? { subjectTerms: unique([...subjectTerms, ...themeTerms]) } : {}) },
    retrieval: {
      ...retrieval,
      keywordQueries: unique([...retrieval.keywordQueries, ...expandedTerms]),
      topicConcepts: unique([...retrieval.topicConcepts, ...themeTerms]),
      semanticQueries: unique([...retrieval.semanticQueries, expandedTerms.join(' ')]),
      roleTerms: unique([...retrieval.roleTerms, ...themeTerms]),
      concepts: [...themeConcepts, ...retrieval.concepts.filter((concept) => !themeTerms.some((term) => normalizeToken(concept.concept) === normalizeToken(term)))],
    },
  };
}
