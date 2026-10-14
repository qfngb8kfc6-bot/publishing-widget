import { normalizeToken } from '../core';
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

/** The same bounded theme list is used by the report UI and the focused-search API. */
export function reportThemes(report: Pick<ReportRecord, 'professionalProfile'>): string[] {
  const profile = report.professionalProfile;
  return unique([...profile.professionalInterests, ...profile.likelyInformationNeeds, ...profile.role.professionalThemes]).slice(0, 4);
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
  return {
    ...profile,
    professionalInterests: unique([...profile.professionalInterests, ...themeTerms]),
    directInterests: unique([...profile.directInterests, ...themeTerms]),
    likelyInformationNeeds: add(profile.likelyInformationNeeds, theme),
    searchTerms: unique([...profile.searchTerms, ...expandedTerms]),
    semanticQueries: add(profile.semanticQueries, theme),
    role: { ...profile.role, professionalThemes: add(profile.role.professionalThemes, theme) },
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
