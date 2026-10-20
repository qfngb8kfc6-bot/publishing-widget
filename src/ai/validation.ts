import { normalizeToken, subjectMatcher, subjectTermsFor, tokenize, type Intent } from '../core';
import type { AIExplanationResult, AIProfessionalProfileEnhancement, AIReportContent, EnrichedIntent, ReportContentRequest, SemanticCandidate } from './types';
import type { ProfessionalProfile } from '../core';
import { normalizeAngle } from './angles';

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

const GENERIC_PROFILE_CONCEPTS = new Set(['business', 'change', 'decision support', 'developments', 'industry', 'innovation', 'professional practice', 'technology']);

function isSpecificConcept(value: string): boolean {
  return !GENERIC_PROFILE_CONCEPTS.has(normalizeToken(value));
}

function overlapsConcept(left: string, right: string): boolean {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
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
    subjectVocabulary: strings(value.subjectVocabulary, 24, 40),
  };
  const hasValues = Boolean(
    result.company && Object.values(result.company).some((item) => item !== undefined && (!Array.isArray(item) || item.length > 0))
      || result.person && Object.values(result.person).some((item) => item !== undefined && (!Array.isArray(item) || item.length > 0))
      || result.professionalInterests?.length || result.likelyInformationNeeds?.length || result.relevantEntities?.length
      || result.searchTerms?.length || result.semanticQueries?.length || result.excludedConcepts?.length || result.subjectVocabulary?.length,
  );
  return hasValues ? result : null;
}

/** Subject vocabulary from its own call: {"terms": [...]}, at most 30 short strings. */
export function validateSubjectVocabulary(raw: unknown): string[] {
  return strings(record(raw)?.terms, 30, 40);
}

export function mergeProfessionalProfileEnhancement(profile: ProfessionalProfile, raw: unknown): ProfessionalProfile | null {
  const enhancement = validateProfessionalProfileEnhancement(raw);
  if (!enhancement) return null;
  const companyEnhancement = enhancement.company;
  const personEnhancement = enhancement.person;
  // A generic titled role is anchored on its title subject: the subject plus its validated news vocabulary.
  const subjectTerms = profile.role.roleSource === 'generic' && profile.role.titleTopics?.length ? subjectTermsFor(profile.role, enhancement.subjectVocabulary) : undefined;
  const subjectTest = subjectTerms ? subjectMatcher({ ...profile.role, subjectTerms }) : undefined;
  const onSubject = (concept: string) => !subjectTest || subjectTest(concept);
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
    // Leadership duties ("strategic planning") do not describe an anchored role; only on-subject ones are kept.
    responsibilities: appendUnique(profile.role.responsibilities, personEnhancement?.responsibilities?.filter(onSubject)),
    decisionAreas: appendUnique(profile.role.decisionAreas ?? [], personEnhancement?.decisionAreas?.filter(onSubject)),
    technologies: appendUnique(profile.role.technologies ?? [], personEnhancement?.technologies),
    // The deterministic role foundation is stable. AI themes are classified
    // below as bounded direct/adjacent additions instead of replacing it.
    professionalThemes: profile.role.professionalThemes,
    ...(subjectTerms ? { subjectTerms } : {}),
  };
  const companyConcepts = [
    ...(companyEnhancement?.activities ?? []),
    ...(companyEnhancement?.productsServices ?? []),
    ...(companyEnhancement?.technologies ?? []),
    ...(companyEnhancement?.markets ?? []),
  ];
  const roleConcepts = [...(personEnhancement?.decisionAreas ?? []), ...(personEnhancement?.technologies ?? [])];
  const aiConcepts = [
    ...(enhancement.professionalInterests ?? []),
    ...(companyEnhancement?.themes ?? []),
    ...(personEnhancement?.themes ?? []),
    ...companyConcepts,
    ...roleConcepts,
  ].filter(isSpecificConcept);
  // Roles without a dedicated concept profile take their core retrieval concepts from validated enrichment:
  // short, specific role themes, decision areas, search terms, interests and responsibilities, concise first.
  // A titled generic role promotes its subject vocabulary first and only concepts anchored to its subject;
  // leadership-flavoured ones (strategy, finance, governance) stay adjacent at most.
  const exclusionKeys = new Set([...(profile.retrieval?.exclusions ?? []), ...(enhancement.excludedConcepts ?? [])].map(normalizeToken));
  const aiRoleConcepts = profile.role.roleSource === 'generic'
    ? [...new Map([...(subjectTerms ?? []), ...(personEnhancement?.themes ?? []), ...(personEnhancement?.decisionAreas ?? []), ...(enhancement.searchTerms ?? []), ...(enhancement.professionalInterests ?? []), ...(personEnhancement?.responsibilities ?? [])]
      .map((concept) => concept.replace(/\s+/g, ' ').trim())
      .filter((concept) => isSpecificConcept(concept) && concept.length <= 40 && concept.split(' ').length <= 3 && !exclusionKeys.has(normalizeToken(concept)) && onSubject(concept))
      .map((concept) => [normalizeToken(concept), concept] as const)).values()].slice(0, 24)
    : [];
  const deterministicDirect = appendUnique(profile.directInterests?.length ? profile.directInterests : profile.professionalInterests, aiRoleConcepts, 48);
  const verifiedCompanySignals = [...profile.company.topics, ...(profile.company.technologies ?? []), ...(companyEnhancement?.technologies ?? [])];
  const aiDirect = [...new Set([
    ...companyConcepts.filter((concept) => isSpecificConcept(concept)),
    ...aiConcepts.filter((concept) => deterministicDirect.some((base) => overlapsConcept(base, concept)) || verifiedCompanySignals.some((base) => overlapsConcept(base, concept))),
  ])].filter(onSubject).slice(0, 16);
  const aiAdjacent = [...new Set(aiConcepts.filter((concept) => !aiDirect.some((direct) => overlapsConcept(direct, concept)) && !aiRoleConcepts.some((roleConcept) => normalizeToken(roleConcept) === normalizeToken(concept))))].slice(0, 16);
  const directInterests = appendUnique(deterministicDirect, aiDirect, 32);
  const adjacentInterests = appendUnique(profile.adjacentInterests ?? [], aiAdjacent, 32);
  // Deterministic direct concepts always lead the profile. This prevents a
  // vague or reordered model response from changing the user's core identity.
  const professionalInterests = appendUnique([], [...directInterests, ...adjacentInterests, ...profile.professionalInterests], 48);
  const searchTerms = appendUnique(profile.searchTerms, [...directInterests, ...adjacentInterests, ...(enhancement.searchTerms ?? [])].filter(isSpecificConcept), 64);
  const semanticQueries = appendUnique(profile.semanticQueries, enhancement.semanticQueries, 12);
  const entities = appendUnique(profile.entities, enhancement.relevantEntities, 32);
  const likelyInformationNeeds = appendUnique(profile.likelyInformationNeeds, enhancement.likelyInformationNeeds, 32);
  const existingConcepts = profile.retrieval.concepts ?? [];
  const roleConceptAdditions = aiRoleConcepts.map((concept) => ({ concept, weight: 1.1, relevanceType: 'direct' as const, source: 'role' as const }));
  const additions = [
    ...aiDirect.map((concept) => ({ concept, weight: 0.7, relevanceType: 'direct' as const, source: 'company' as const })),
    ...aiAdjacent.map((concept) => ({ concept, weight: 0.45, relevanceType: 'adjacent' as const, source: 'company' as const })),
  ];
  // Promoted role concepts come first so they win over the same concept already present as adjacent.
  const ordered = roleConceptAdditions.length ? [...existingConcepts.filter((item) => item.relevanceType === 'direct'), ...roleConceptAdditions, ...existingConcepts.filter((item) => item.relevanceType !== 'direct')] : existingConcepts;
  const concepts = [...ordered, ...additions]
    .filter((item, index, values) => values.findIndex((candidate) => normalizeToken(candidate.concept) === normalizeToken(item.concept)) === index)
    .slice(0, 64);
  const retrieval = {
    ...profile.retrieval,
    keywordQueries: appendUnique(profile.retrieval.keywordQueries, searchTerms, 64),
    topicConcepts: appendUnique(profile.retrieval.topicConcepts, professionalInterests, 48),
    semanticQueries: appendUnique(profile.retrieval.semanticQueries, semanticQueries, 12),
    entities: appendUnique(profile.retrieval.entities, entities, 32),
    industryTerms: appendUnique(profile.retrieval.industryTerms, company.industry ? [company.industry] : [], 16),
    roleTerms: appendUnique(profile.retrieval.roleTerms, [...role.responsibilities, ...(role.decisionAreas ?? []), ...(role.technologies ?? [])], 48),
    exclusions: appendUnique(profile.retrieval.exclusions, enhancement.excludedConcepts, 24),
    concepts,
  };
  return { ...profile, company, role, professionalInterests, directInterests, adjacentInterests, entities, likelyInformationNeeds, searchTerms, semanticQueries, excludedConcepts: retrieval.exclusions, retrieval };
}

/** Report-level shape problems with the explanations list, reported with the response's top-level field names. */
export interface ExplanationShapeIssue {
  reason: 'explanations_missing' | 'explanations_not_array';
  presentFields: string[];
}

export function validateReportContent(raw: unknown, request: ReportContentRequest, onReject?: (rejection: ExplanationRejection | ExplanationShapeIssue) => void): AIReportContent | null {
  const value = record(raw);
  if (!value) return null;
  const candidateIds = new Set(request.recommendations.map((item) => item.article.id));
  // {"articleId", "fit": "weak"} is an honest "this does not help the reader", not a missing explanation.
  const isWeakFit = (item: unknown) => { const entry = record(item); return entry?.fit === 'weak' && typeof entry.articleId === 'string' && candidateIds.has(entry.articleId); };
  const weakArticleIds = Array.isArray(value.explanations) ? [...new Set(value.explanations.filter(isWeakFit).map((item) => record(item)!.articleId as string))] : [];
  if (value.explanations === undefined) onReject?.({ reason: 'explanations_missing', presentFields: fieldNames(value) });
  else if (!Array.isArray(value.explanations)) onReject?.({ reason: 'explanations_not_array', presentFields: fieldNames(value) });
  const explanations = validateExplanationResults(Array.isArray(value.explanations) ? value.explanations.filter((item) => !isWeakFit(item)) : value.explanations, candidateIds, onReject);
  const summary = optionalString(value.summary, 1200);
  if (!summary && explanations.length === 0 && weakArticleIds.length === 0) return null;
  const citedArticleIds = summary && Array.isArray(value.citedArticleIds) ? [...new Set(value.citedArticleIds.filter((id): id is string => typeof id === 'string' && candidateIds.has(id)))] : [];
  const themeDescriptions = validThemeDescriptions(value.themeDescriptions, request.themes ?? []);
  return { summary, explanations, ...(summary ? { citedArticleIds } : {}), ...(weakArticleIds.length ? { weakArticleIds } : {}), ...(themeDescriptions ? { themeDescriptions } : {}) };
}

const THEME_DESCRIPTION_MAX_LENGTH = 160;

/** One single-line description per supplied theme; unknown themes and over-long or empty lines are dropped. */
function validThemeDescriptions(raw: unknown, themes: string[]): Record<string, string> | undefined {
  if (!Array.isArray(raw) || themes.length === 0) return undefined;
  const byKey = new Map(themes.map((theme) => [normalizeToken(theme), theme]));
  const descriptions: Record<string, string> = {};
  for (const item of raw) {
    const entry = record(item);
    const theme = typeof entry?.theme === 'string' ? byKey.get(normalizeToken(entry.theme)) : undefined;
    const description = typeof entry?.description === 'string' ? entry.description.replace(/\s+/g, ' ').trim() : '';
    if (!theme || !description || description.length > THEME_DESCRIPTION_MAX_LENGTH || descriptions[theme]) continue;
    descriptions[theme] = description;
  }
  return Object.keys(descriptions).length ? descriptions : undefined;
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
  keep?: boolean;
  relevanceType?: 'direct' | 'adjacent';
  confidence?: number;
  rationale?: string;
  /** The reranker judged that this article does not genuinely help the reader. */
  weak?: boolean;
}

/**
 * Rerank output is compact: {"results":[{"id":"…","score":0-100}]}. Only supplied IDs and in-range numeric scores
 * are accepted; any other fields are ignored. A bare array and the legacy articleId/semanticScore keys are
 * still accepted for safety.
 */
export function validateSemanticResults(raw: unknown, candidates: SemanticCandidate[]): ValidatedSemanticResult[] {
  const value = record(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(value?.results) ? value.results : [];
  const validIds = new Set(candidates.map((candidate) => candidate.articleId));
  const seen = new Set<string>();
  return list.flatMap((item) => {
    const result = record(item);
    const articleId = typeof result?.id === 'string' ? result.id : result?.articleId;
    const semanticScore = result?.score ?? result?.semanticScore;
    if (typeof articleId !== 'string' || !validIds.has(articleId) || seen.has(articleId) || typeof semanticScore !== 'number' || !Number.isFinite(semanticScore) || semanticScore < 0 || semanticScore > 100) return [];
    seen.add(articleId);
    return [{ articleId, semanticScore, signals: [], ...(result?.weak === true ? { weak: true } : {}) }];
  });
}

export type ExplanationRejectReason = 'not_object' | 'missing_article_id' | 'unknown_article_id' | 'duplicate_article_id' | 'missing_explanation' | 'empty_explanation' | 'explanation_too_long';

/** Why one returned explanation was discarded. Carries IDs and field names only, never explanation text. */
export interface ExplanationRejection {
  reason: ExplanationRejectReason;
  articleId?: string;
  /** Field names present on the rejected item, to diagnose shape mismatches. */
  presentFields?: string[];
}

/** An angle is one of ALLOWED_ANGLES: other labels map to the closest one, or are dropped without rejecting the explanation. */
function validAngle(value: unknown): string | undefined {
  return normalizeAngle(value);
}

/** Model-chosen field names are logged only when they look like identifiers, so free text can never leak through a key. */
function fieldNames(value: Record<string, unknown>): string[] {
  return [...new Set(Object.keys(value).map((key) => (/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(key) ? key : '<other>')))].sort();
}

export function validateExplanationResults(raw: unknown, candidateIds: Set<string>, onReject?: (rejection: ExplanationRejection) => void): AIExplanationResult[] {
  const value = record(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(value?.results) ? value.results : [];
  const seen = new Set<string>();
  return list.flatMap((item) => {
    const result = record(item);
    const reject = (reason: ExplanationRejectReason, articleId?: string) => { onReject?.({ reason, articleId, presentFields: result ? fieldNames(result) : undefined }); return []; };
    if (!result) return reject('not_object');
    const articleId = result.articleId;
    const explanation = result.explanation;
    if (typeof articleId !== 'string' || !articleId) return reject('missing_article_id');
    if (!candidateIds.has(articleId)) return reject('unknown_article_id', articleId);
    if (seen.has(articleId)) return reject('duplicate_article_id', articleId);
    if (typeof explanation !== 'string') return reject('missing_explanation', articleId);
    if (!explanation.trim()) return reject('empty_explanation', articleId);
    if (explanation.length > 600) return reject('explanation_too_long', articleId);
    seen.add(articleId);
    const angle = validAngle(result.angle);
    return [{ articleId, explanation: explanation.trim(), ...(angle ? { angle } : {}) }];
  });
}
