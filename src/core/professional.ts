import { normalizeToken, tokenize } from './intent';

export const PROFESSIONAL_PROFILE_VERSION = '1.4';
export const RANKING_VERSION = '1.3';

export interface CompanyContext {
  domain: string;
  canonicalUrl: string;
  name?: string;
  industry?: string;
  description?: string;
  topics: string[];
  entities: string[];
  activities?: string[];
  productsServices?: string[];
  technologies?: string[];
  markets?: string[];
  themes?: string[];
  source: 'submitted-domain' | 'public-website' | 'demo-fixture';
  fetchedAt: string;
  expiresAt: string;
  analysisVersion: string;
}

export interface RoleContext {
  rawTitle: string;
  normalizedTitle: string;
  function: string;
  responsibilities: string[];
  professionalThemes: string[];
  directThemes?: string[];
  adjacentThemes?: string[];
  seniority?: string;
  decisionAreas?: string[];
  technologies?: string[];
  confidence: 'inferred' | 'high';
  /**
   * dedicated: a concept profile written for this kind of role. generic: only the catch-all leadership or
   * professional fallback matched, so the role's own topic comes from its title and AI enrichment.
   */
  roleSource?: 'dedicated' | 'generic';
  /** Subject words from a generic title, e.g. "sustainability" in "Head of Sustainability". */
  titleTopics?: string[];
}

export type RelevanceType = 'direct' | 'adjacent';
export type RetrievalConceptSource = 'role' | 'company';

export interface RetrievalConcept {
  concept: string;
  weight: number;
  relevanceType: RelevanceType;
  source: RetrievalConceptSource;
}

export interface RetrievalConcepts {
  keywordQueries: string[];
  topicConcepts: string[];
  semanticQueries: string[];
  entities: string[];
  industryTerms: string[];
  roleTerms: string[];
  exclusions: string[];
  concepts: RetrievalConcept[];
  recencyPreference?: 'latest' | 'balanced' | 'archive';
}

export interface ProfessionalProfile {
  companyUrl: string;
  companyDomain: string;
  companyName?: string;
  jobTitle: string;
  company: CompanyContext;
  role: RoleContext;
  professionalInterests: string[];
  directInterests: string[];
  adjacentInterests: string[];
  needs: string[];
  entities: string[];
  likelyInformationNeeds: string[];
  searchTerms: string[];
  semanticQueries: string[];
  excludedConcepts: string[];
  retrieval: RetrievalConcepts;
  generatedAt: string;
  profileVersion: string;
}

interface RoleRule {
  test: RegExp;
  /** Catch-all rules match on seniority words, not on what the person works on. */
  generic?: boolean;
  function: string;
  responsibilities: string[];
  direct: string[];
  adjacent: string[];
  exclusions: string[];
}

const GENERIC_CONCEPTS = new Set(['business', 'change', 'developments', 'decision support', 'industry', 'industry developments', 'innovation', 'professional practice', 'technology']);
const ROLE_RULES: RoleRule[] = [
  { test: /software|developer|engineering|architect|devops|platform|technical|technology/i, function: 'Engineering', responsibilities: ['software development', 'system architecture', 'technical implementation'], direct: ['software engineering', 'developer technology', 'APIs', 'infrastructure', 'cloud', 'security', 'AI', 'machine learning', 'language models', 'automation', 'integration', 'data systems', 'platforms', 'systems architecture'], adjacent: ['robotics', 'manufacturing automation', 'IoT', 'embedded systems', 'operational technology', 'sensors', 'digital twins'], exclusions: ['astronomy', 'observatories', 'ecology', 'marine transport'] },
  { test: /procurement|purchasing|supply|sourcing|buyer/i, function: 'Procurement', responsibilities: ['supplier evaluation', 'commercial planning', 'operational resilience'], direct: ['procurement', 'suppliers', 'sourcing', 'vendors', 'supply chains', 'materials', 'lifecycle', 'manufacturing', 'cost', 'resilience', 'risk'], adjacent: ['sustainability', 'logistics', 'automation', 'operations', 'regulation'], exclusions: ['astronomy', 'observatories', 'marine science'] },
  { test: /investment|investor|portfolio|finance|financial|bank|analyst|accounting|controller/i, function: 'Finance and investment', responsibilities: ['market analysis', 'risk assessment', 'capital allocation'], direct: ['finance', 'markets', 'investment', 'capital allocation', 'financial performance', 'financial technology', 'cost', 'risk', 'forecasting', 'regulation', 'accounting', 'data'], adjacent: ['AI', 'automation', 'operations', 'strategy', 'sustainability'], exclusions: ['astronomy', 'marine transport', 'ecology'] },
  { test: /product manager|product management|product owner|head of product|vp product|chief product/i, function: 'Product management', responsibilities: ['product strategy', 'roadmap planning', 'product development', 'user and customer needs', 'product launches', 'category performance'], direct: ['product strategy', 'product development', 'roadmap', 'innovation', 'user needs', 'customer needs', 'product launches', 'product performance', 'competition', 'design', 'consumer products', 'merchandising', 'technology', 'materials', 'footwear', 'apparel'], adjacent: ['marketing', 'brand', 'sustainability', 'data', 'operations', 'manufacturing', 'retail'], exclusions: ['astronomy', 'marine engineering'] },
  { test: /marketing|brand|communications|audience/i, function: 'Marketing and communications', responsibilities: ['audience strategy', 'positioning', 'campaign planning'], direct: ['audiences', 'content', 'brands', 'communications', 'growth', 'customer research', 'digital marketing'], adjacent: ['technology', 'AI', 'culture', 'data', 'sustainability'], exclusions: ['astronomy', 'marine engineering'] },
  { test: /research|scientist|academic|laboratory|lab/i, function: 'Research', responsibilities: ['research design', 'evidence review', 'knowledge development'], direct: ['science', 'evidence', 'methodology', 'measurement', 'data', 'research'], adjacent: ['technology', 'climate', 'ecology', 'health', 'innovation'], exclusions: ['generic finance', 'generic marketing'] },
  { test: /operations|operational|delivery|process|supply chain/i, function: 'Operations', responsibilities: ['process improvement', 'delivery planning', 'operational resilience'], direct: ['operations', 'processes', 'delivery', 'systems', 'workflow', 'efficiency', 'supply chain'], adjacent: ['automation', 'manufacturing', 'logistics', 'technology', 'resilience'], exclusions: ['astronomy', 'observatories', 'marine science'] },
  { test: /retail|merchandising|store|omnichannel|category|sales/i, function: 'Retail', responsibilities: ['retail operations', 'commercial planning', 'customer and channel performance'], direct: ['retail operations', 'stores', 'omnichannel', 'distribution', 'merchandising', 'sales performance', 'consumer behavior', 'markets', 'expansion', 'category performance', 'retail strategy'], adjacent: ['strategy', 'growth', 'pricing', 'channel strategy', 'market positioning', 'supply chain', 'ecommerce', 'brand', 'customer experience'], exclusions: ['astronomy', 'observatories', 'marine science'] },
  { test: /chief|ceo|cto|cfo|director|vp|vice president|head of|executive|founder/i, generic: true, function: 'Leadership', responsibilities: ['strategic planning', 'organisational decisions', 'risk management'], direct: ['strategy', 'technology', 'markets', 'operations', 'regulation', 'growth', 'leadership', 'risk'], adjacent: ['industry context', 'sustainability', 'AI', 'finance', 'innovation'], exclusions: ['astronomy', 'observatories'] },
];

function unique(values: string[]): string[] {
  return [...new Map<string, string>(values.map((value) => [normalizeToken(value), value.trim()] as const).filter(([key, value]) => Boolean(key && value))).values()];
}

function specific(values: string[]): string[] {
  return unique(values).filter((value) => !GENERIC_CONCEPTS.has(normalizeToken(value)));
}

export function normalizeJobTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

const SENIORITY_WORDS = /\b(global|group|regional|senior|sr|junior|jr|deputy|associate|assistant|interim|acting|head|heads|director|directors|vp|svp|evp|vice|president|chief|lead|leader|manager|officer|executive|specialist|coordinator|partner|principal|of|for|and|the|at|in|ceo|cfo|cto|coo|founder|co)\b/gi;

/**
 * Subject words from a title that matched only a catch-all rule: "Head of Sustainability" → sustainability,
 * "Chief Legal Officer" → legal, "Head of Legal & Compliance" → legal, compliance. Seniority words are removed;
 * what remains is what the person works on.
 */
export function titleTopics(title: string): string[] {
  return unique(title.split(/[&,/+|]|\band\b/i)
    .map((part) => part.replace(SENIORITY_WORDS, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((part) => part.length >= 3 && part.split(' ').length <= 3 && !GENERIC_CONCEPTS.has(normalizeToken(part))));
}

export function analyzeRole(jobTitle: string): RoleContext {
  const rawTitle = normalizeJobTitle(jobTitle);
  const rule = ROLE_RULES.find((candidate) => candidate.test.test(rawTitle));
  const fallback: RoleRule = { test: /.*/, generic: true, function: 'Professional', responsibilities: ['professional development', 'decision support'], direct: ['decision support', 'professional practice'], adjacent: ['business', 'technology'], exclusions: [] };
  const match = rule ?? fallback;
  const generic = Boolean(match.generic);
  const topics = generic ? titleTopics(rawTitle) : [];
  // A generic role with a subject in its title ("Head of Sustainability") is about that subject; the catch-all
  // leadership concepts become adjacent context rather than the role's core.
  const directThemes = topics.length ? topics : match.direct;
  const adjacentThemes = topics.length ? unique([...match.direct, ...match.adjacent]) : match.adjacent;
  return { rawTitle, normalizedTitle: normalizeToken(rawTitle), function: match.function, responsibilities: match.responsibilities, professionalThemes: [...directThemes, ...adjacentThemes], directThemes, adjacentThemes, confidence: rule ? 'high' : 'inferred', roleSource: generic ? 'generic' : 'dedicated', ...(topics.length ? { titleTopics: topics } : {}) };
}

function ruleFor(role: RoleContext): RoleRule {
  const rule = ROLE_RULES.find((candidate) => candidate.function === role.function) ?? { test: /.*/, function: role.function, responsibilities: role.responsibilities, direct: role.professionalThemes.slice(0, 6), adjacent: role.professionalThemes.slice(6), exclusions: [] };
  // Title topics replace a generic rule's direct concepts; its own direct concepts move to adjacent.
  if (role.titleTopics?.length) return { ...rule, direct: role.titleTopics, adjacent: unique([...rule.direct, ...rule.adjacent]) };
  return rule;
}

function companyConcepts(company: CompanyContext, rule: RoleRule, title: string): { direct: string[]; adjacent: string[] } {
  const companySignals = specific([...company.topics, ...(company.industry ? [company.industry] : []), ...(company.technologies ?? []), ...(company.activities ?? []), ...(company.productsServices ?? []), ...(company.themes ?? [])]);
  const titleText = normalizeToken(title);
  const direct: string[] = [];
  const adjacent: string[] = [];
  for (const signal of companySignals) {
    const signalText = normalizeToken(signal);
    const roleDirect = rule.direct.some((item) => signalText.includes(normalizeToken(item)) || normalizeToken(item).includes(signalText));
    const titleMatch = titleText.includes(signalText) || signalText.includes(titleText);
    if (roleDirect || titleMatch) direct.push(signal);
    else adjacent.push(signal);
  }
  return { direct: unique(direct), adjacent: unique(adjacent) };
}

function buildConcepts(role: RoleContext, company: CompanyContext, directInterests: string[], adjacentInterests: string[], exclusions: string[]): RetrievalConcept[] {
  const rule = ruleFor(role);
  // For a titled generic role the catch-all responsibilities (strategic planning, ...) are context, not core.
  const roleDirect = specific(role.titleTopics?.length ? rule.direct : [...rule.direct, ...role.responsibilities]);
  const roleAdjacent = specific(rule.adjacent);
  const roleConcepts = [
    ...roleDirect.map((concept) => ({ concept, weight: 1.25, relevanceType: 'direct' as const, source: 'role' as const })),
    ...roleAdjacent.map((concept) => ({ concept, weight: 0.75, relevanceType: 'adjacent' as const, source: 'role' as const })),
  ];
  const companyConceptsForProfile = [
    ...directInterests.filter((concept) => !roleDirect.some((item) => normalizeToken(item) === normalizeToken(concept))).map((concept) => ({ concept, weight: 0.9, relevanceType: 'direct' as const, source: 'company' as const })),
    ...adjacentInterests.map((concept) => ({ concept, weight: 0.55, relevanceType: 'adjacent' as const, source: 'company' as const })),
  ];
  const excluded = new Set(exclusions.map(normalizeToken));
  return [...roleConcepts, ...companyConceptsForProfile].filter((item, index, values) => !excluded.has(normalizeToken(item.concept)) && values.findIndex((candidate) => normalizeToken(candidate.concept) === normalizeToken(item.concept)) === index);
}

export function buildProfessionalProfile(company: CompanyContext, jobTitle: string, now = new Date()): ProfessionalProfile {
  const role = analyzeRole(jobTitle);
  const rule = ruleFor(role);
  const companySignals = companyConcepts(company, rule, role.rawTitle);
  const titleSpecificDirect = /cto|technology officer|technical director|technology professional/i.test(role.rawTitle) ? ['technology'] : [];
  const roleSpecificDirect = [...specific(rule.direct), ...(role.function === 'Product management' ? ['innovation'] : [])];
  const directInterests = unique([...roleSpecificDirect, ...titleSpecificDirect, ...companySignals.direct]);
  const adjacentInterests = unique([...specific(rule.adjacent), ...companySignals.adjacent]);
  const excludedConcepts = specific(rule.exclusions);
  const concepts = buildConcepts(role, company, directInterests, adjacentInterests, excludedConcepts);
  // Keep publisher/company labels available for profile display and compatibility;
  // generic labels are excluded from weighted retrieval concepts and search terms.
  const professionalInterests = unique([...directInterests, ...adjacentInterests, ...company.topics]);
  const searchTerms = unique([...concepts.flatMap((item) => tokenize(item.concept)), ...role.responsibilities.flatMap(tokenize), ...tokenize(company.name ?? company.domain)]).filter((term) => !GENERIC_CONCEPTS.has(term));
  const semanticQueries = [
    `${role.function} developments relevant to ${company.name ?? company.domain}`,
    `${directInterests.slice(0, 4).join(', ')} for ${role.rawTitle}`,
  ];
  const retrieval: RetrievalConcepts = {
    keywordQueries: searchTerms.slice(0, 48),
    topicConcepts: professionalInterests,
    semanticQueries,
    entities: unique(company.entities),
    industryTerms: company.industry ? [company.industry] : [],
    roleTerms: unique([role.function, ...role.responsibilities, ...role.professionalThemes]),
    exclusions: excludedConcepts,
    concepts,
    recencyPreference: 'balanced',
  };
  const generatedAt = now.toISOString();
  return {
    companyUrl: company.canonicalUrl,
    companyDomain: company.domain,
    companyName: company.name,
    jobTitle: role.rawTitle,
    company,
    role,
    professionalInterests,
    directInterests,
    adjacentInterests,
    needs: role.responsibilities,
    entities: unique(company.entities),
    likelyInformationNeeds: unique([...role.responsibilities, ...directInterests.slice(0, 8)]),
    searchTerms,
    semanticQueries,
    excludedConcepts,
    retrieval,
    generatedAt,
    profileVersion: PROFESSIONAL_PROFILE_VERSION,
  };
}

export function displayRelevanceScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
