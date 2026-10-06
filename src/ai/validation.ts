import { tokenize, type Intent } from '../core';
import type { AIExplanationResult, AIProfessionalProfileEnhancement, AIReportContent, EnrichedIntent, ReportContentRequest, SemanticCandidate } from './types';
import type { ProfessionalProfile } from '../core';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown, max = 12, maxLength = 80): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().slice(0, maxLength)))].slice(0, max);
}

function optionalString(value: unknown, maxLength = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function appendUnique(existing: string[], additions: string[] | undefined, max = 40): string[] {
  return [...new Set([...existing, ...(additions ?? [])].map((item) => item.trim()).filter(Boolean))].slice(0, max);
}

export function validateProfessionalProfileEnhancement(raw: unknown): AIProfessionalProfileEnhancement | null {
  const value = record(raw);
  if (!value) return null;
  const companyValue = record(value.company);
  const personValue = record(value.person);
  const company = companyValue ? {
    industry: optionalString(companyValue.industry),
    description: optionalString(companyValue.description, 600),
    activities: strings(companyValue.activities, 12, 100),
    productsServices: strings(companyValue.productsServices, 12, 100),
    technologies: strings(companyValue.technologies, 16, 80),
    markets: strings(companyValue.markets, 12, 80),
    themes: strings(companyValue.themes, 16, 80),
  } : undefined;
  const person = personValue ? {
    function: optionalString(personValue.function),
    seniority: optionalString(personValue.seniority),
    responsibilities: strings(personValue.responsibilities, 12, 100),
    decisionAreas: strings(personValue.decisionAreas, 12, 100),
    technologies: strings(personValue.technologies, 16, 80),
    themes: strings(personValue.themes, 16, 80),
  } : undefined;
  const result: AIProfessionalProfileEnhancement = {
    company,
    person,
    professionalInterests: strings(value.professionalInterests, 24, 100),
    likelyInformationNeeds: strings(value.likelyInformationNeeds, 16, 120),
    relevantEntities: strings(value.relevantEntities, 16, 100),
    searchTerms: strings(value.searchTerms, 32, 80),
    semanticQueries: strings(value.semanticQueries, 8, 180),
    excludedConcepts: strings(value.excludedConcepts, 16, 80),
  };
  const hasValues = Boolean(
    result.company && Object.values(result.company).some((item) => item !== undefined && (!Array.isArray(item) || item.length > 0))
      || result.person && Object.values(result.person).some((item) => item !== undefined && (!Array.isArray(item) || item.length > 0))
      || result.professionalInterests?.length || result.likelyInformationNeeds?.length || result.relevantEntities?.length
      || result.searchTerms?.length || result.semanticQueries?.length || result.excludedConcepts?.length,
  );
  return hasValues ? result : null;
}

export function mergeProfessionalProfileEnhancement(profile: ProfessionalProfile, raw: unknown): ProfessionalProfile | null {
  const enhancement = validateProfessionalProfileEnhancement(raw);
  if (!enhancement) return null;
  const companyEnhancement = enhancement.company;
  const personEnhancement = enhancement.person;
  const company = {
    ...profile.company,
    industry: profile.company.industry ?? companyEnhancement?.industry,
    description: profile.company.description ?? companyEnhancement?.description,
    activities: appendUnique(profile.company.activities ?? [], companyEnhancement?.activities),
    productsServices: appendUnique(profile.company.productsServices ?? [], companyEnhancement?.productsServices),
    technologies: appendUnique(profile.company.technologies ?? [], companyEnhancement?.technologies),
    markets: appendUnique(profile.company.markets ?? [], companyEnhancement?.markets),
    themes: appendUnique(profile.company.themes ?? profile.company.topics, companyEnhancement?.themes),
  };
  const role = {
    ...profile.role,
    // Submitted title and deterministic function remain authoritative.
    seniority: profile.role.seniority ?? personEnhancement?.seniority,
    responsibilities: appendUnique(profile.role.responsibilities, personEnhancement?.responsibilities),
    decisionAreas: appendUnique(profile.role.decisionAreas ?? [], personEnhancement?.decisionAreas),
    technologies: appendUnique(profile.role.technologies ?? [], personEnhancement?.technologies),
    professionalThemes: appendUnique(profile.role.professionalThemes, personEnhancement?.themes),
  };
  const companyConcepts = [
    ...(companyEnhancement?.activities ?? []),
    ...(companyEnhancement?.productsServices ?? []),
    ...(companyEnhancement?.technologies ?? []),
    ...(companyEnhancement?.markets ?? []),
  ];
  const roleConcepts = [...(personEnhancement?.decisionAreas ?? []), ...(personEnhancement?.technologies ?? [])];
  const professionalInterests = appendUnique(profile.professionalInterests, [
    ...(enhancement.professionalInterests ?? []),
    ...(companyEnhancement?.themes ?? []),
    ...(personEnhancement?.themes ?? []),
    ...companyConcepts,
    ...roleConcepts,
  ]);
  const searchTerms = appendUnique(profile.searchTerms, [...(enhancement.searchTerms ?? []), ...companyConcepts, ...roleConcepts], 64);
  const semanticQueries = appendUnique(profile.semanticQueries, enhancement.semanticQueries, 12);
  const entities = appendUnique(profile.entities, enhancement.relevantEntities, 32);
  const likelyInformationNeeds = appendUnique(profile.likelyInformationNeeds, enhancement.likelyInformationNeeds, 32);
  const retrieval = {
    ...profile.retrieval,
    keywordQueries: appendUnique(profile.retrieval.keywordQueries, searchTerms, 64),
    topicConcepts: appendUnique(profile.retrieval.topicConcepts, professionalInterests, 48),
    semanticQueries: appendUnique(profile.retrieval.semanticQueries, semanticQueries, 12),
    entities: appendUnique(profile.retrieval.entities, entities, 32),
    industryTerms: appendUnique(profile.retrieval.industryTerms, company.industry ? [company.industry] : [], 16),
    roleTerms: appendUnique(profile.retrieval.roleTerms, [...role.responsibilities, ...(role.decisionAreas ?? []), ...(role.technologies ?? [])], 48),
    exclusions: appendUnique(profile.retrieval.exclusions, enhancement.excludedConcepts, 24),
  };
  return { ...profile, company, role, professionalInterests, entities, likelyInformationNeeds, searchTerms, semanticQueries, excludedConcepts: retrieval.exclusions, retrieval };
}

export function validateReportContent(raw: unknown, request: ReportContentRequest): AIReportContent | null {
  const value = record(raw);
  if (!value) return null;
  const candidateIds = new Set(request.recommendations.map((item) => item.article.id));
  const explanations = validateExplanationResults(value.explanations, candidateIds);
  const summary = optionalString(value.summary, 1200);
  if (!summary && explanations.length === 0) return null;
  return { summary, explanations };
}

export function sanitizeEnrichedIntent(raw: unknown, baseIntent: Intent): EnrichedIntent | null {
  const value = record(raw);
  if (!value) return null;
  const primaryThemes = strings(value.primaryThemes, 8);
  const relatedThemes = strings(value.relatedThemes, 16);
  const searchTerms = strings(value.searchTerms, 20);
  const entities = strings(value.entities, 12);
  const excludedConcepts = strings(value.excludedConcepts, 12);
  const safeSearchTerms = searchTerms.length > 0 ? searchTerms : [...relatedThemes, ...baseIntent.keywords];
  const keywords = [...new Set([...baseIntent.keywords, ...safeSearchTerms.flatMap(tokenize)])];
  return {
    ...baseIntent,
    baseIntent,
    primaryThemes: primaryThemes.length > 0 ? primaryThemes : baseIntent.interests,
    relatedThemes,
    searchTerms: safeSearchTerms,
    entities,
    excludedConcepts,
    // Persona remains answer-derived; the model cannot silently invent a user attribute.
    persona: baseIntent.personas[0] ?? '',
    industry: undefined,
    keywords,
    queryText: [...new Set([baseIntent.queryText, ...safeSearchTerms])].filter(Boolean).join(' '),
  };
}

export interface ValidatedSemanticResult {
  articleId: string;
  semanticScore: number;
  signals: string[];
}

export function validateSemanticResults(raw: unknown, candidates: SemanticCandidate[]): ValidatedSemanticResult[] {
  const value = record(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(value?.results) ? value.results : [];
  const validIds = new Set(candidates.map((candidate) => candidate.articleId));
  const seen = new Set<string>();
  return list.flatMap((item) => {
    const result = record(item);
    const articleId = result?.articleId;
    const semanticScore = result?.semanticScore;
    if (typeof articleId !== 'string' || !validIds.has(articleId) || seen.has(articleId) || typeof semanticScore !== 'number' || !Number.isFinite(semanticScore) || semanticScore < 0 || semanticScore > 100) return [];
    seen.add(articleId);
    return [{ articleId, semanticScore, signals: strings(result?.signals, 3, 100) }];
  });
}

export function validateExplanationResults(raw: unknown, candidateIds: Set<string>): AIExplanationResult[] {
  const value = record(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(value?.results) ? value.results : [];
  const seen = new Set<string>();
  return list.flatMap((item) => {
    const result = record(item);
    const articleId = result?.articleId;
    const explanation = result?.explanation;
    if (typeof articleId !== 'string' || !candidateIds.has(articleId) || seen.has(articleId) || typeof explanation !== 'string' || !explanation.trim() || explanation.length > 600) return [];
    seen.add(articleId);
    return [{ articleId, explanation: explanation.trim() }];
  });
}
