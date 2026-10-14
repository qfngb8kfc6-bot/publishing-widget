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
  const contextTerms = unique([
    ...profile.role.professionalThemes,
    ...profile.role.responsibilities,
    ...retrieval.roleTerms,
    ...profile.directInterests,
    ...profile.adjacentInterests,
  ]).filter((value) => normalizeToken(value) !== normalizeToken(theme));
  const expandedTerms = unique([theme, ...contextTerms]).slice(0, 48);
  const themeConcept = { concept: theme, weight: 1.25, relevanceType: 'direct' as const, source: 'role' as const };
  return {
    ...profile,
    professionalInterests: add(profile.professionalInterests, theme),
    directInterests: add(profile.directInterests, theme),
    likelyInformationNeeds: add(profile.likelyInformationNeeds, theme),
    searchTerms: unique([...profile.searchTerms, ...expandedTerms]),
    semanticQueries: add(profile.semanticQueries, theme),
    role: { ...profile.role, professionalThemes: add(profile.role.professionalThemes, theme) },
    retrieval: {
      ...retrieval,
      keywordQueries: unique([...retrieval.keywordQueries, ...expandedTerms]),
      topicConcepts: add(retrieval.topicConcepts, theme),
      semanticQueries: unique([...retrieval.semanticQueries, expandedTerms.join(' ')]),
      roleTerms: add(retrieval.roleTerms, theme),
      concepts: [themeConcept, ...retrieval.concepts.filter((concept) => normalizeToken(concept.concept) !== normalizeToken(theme))],
    },
  };
}
