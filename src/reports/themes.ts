import { normalizeToken, roleSubjectTerms, wordsMatch } from '../core';
import type { ProfessionalProfile } from '../core';
import type { ReportRecord } from './types';

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
];

/** Two articles in four or more matching both candidates mark them as one subtopic in this report. */
const THEME_ARTICLE_OVERLAP = 0.75;

const words = (value: string): string[] => normalizeToken(value).split(' ').filter(Boolean);

/** True when every word of the term occurs, in some word form, among the given words. */
function containsTerm(haystack: string[], term: string): boolean {
  const termWords = words(term);
  return termWords.length > 0 && termWords.every((word) => haystack.some((candidate) => wordsMatch(candidate, word)));
}

function themeFamily(theme: string): number {
  const themeWords = words(theme);
  return THEME_FAMILIES.findIndex((family) => family.some((member) => containsTerm(themeWords, member)));
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
  const articleWords = articles.map((article) => words(`${article.title} ${article.description ?? ''}`));
  const coverage = (theme: string): Set<number> => {
    const family = themeFamily(theme);
    const terms = family >= 0 ? [theme, ...THEME_FAMILIES[family]] : [theme];
    return new Set(articleWords.flatMap((text, index) => (terms.some((term) => containsTerm(text, term)) ? [index] : [])));
  };
  const vocabulary = unique(subjectTerms).filter((term) => !topicKeys.has(normalizeToken(term)));
  const grounded = vocabulary.filter((term) => coverage(term).size > 0);
  const candidates = [...grounded, ...vocabulary.filter((term) => !grounded.includes(term)), ...unique(topics)];
  const chosen: Array<{ theme: string; family: number; articles: Set<number> }> = [];
  for (const theme of candidates) {
    if (chosen.length === 4) break;
    const family = themeFamily(theme);
    const articleSet = coverage(theme);
    const nearSynonym = chosen.some((other) => {
      if (family >= 0 && family === other.family) return true;
      const [shorter, longer] = words(theme).length <= words(other.theme).length ? [theme, other.theme] : [other.theme, theme];
      if (containsTerm(words(longer), shorter)) return true;
      const shared = [...articleSet].filter((index) => other.articles.has(index)).length;
      const union = new Set([...articleSet, ...other.articles]).size;
      return shared >= 2 && shared / union >= THEME_ARTICLE_OVERLAP;
    });
    if (!nearSynonym) chosen.push({ theme, family, articles: articleSet });
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
  return unique([...profile.professionalInterests, ...profile.likelyInformationNeeds, ...profile.role.professionalThemes]).slice(0, 4);
}

/** The same bounded theme list is used by the report UI and the focused-search API. */
export function reportThemes(report: Pick<ReportRecord, 'professionalProfile'>): string[] {
  return report.professionalProfile.themes ?? selectReportThemes(report.professionalProfile);
}

export function findReportTheme(report: Pick<ReportRecord, 'professionalProfile'>, requestedTheme: string): string | undefined {
  const normalized = normalizeToken(requestedTheme);
  return reportThemes(report).find((theme) => normalizeToken(theme) === normalized);
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
