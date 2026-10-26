import { normalizeToken, tokenize } from './intent';

export const PROFESSIONAL_PROFILE_VERSION = '1.8';
export const RANKING_VERSION = '1.5';

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
  /**
   * The title subject and its news vocabulary (title topics plus validated AI subject vocabulary), e.g.
   * sustainability, emissions, recycled, greenwashing. Only concepts anchored to these are direct for a
   * generic role. Set only for generic roles with title topics.
   */
  subjectTerms?: string[];
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
  /** The report's theme cards, chosen once at generation from the subject vocabulary and the report's articles. */
  themes?: string[];
  /** The job title exactly as entered, when the profile uses a corrected one ("Softere Enginer"). */
  submittedJobTitle?: string;
}

interface RoleRule {
  test: RegExp;
  /**
   * A people move (hire, appointment, departure) counts only when its title names this role's own area, e.g. a
   * retail, stores or DTC appointment for Retail; a VP of footwear product strategy is not retail news.
   */
  peopleMovesNeedTitleMatch?: boolean;
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
  // "markets" and "expansion" are adjacent: as single words their five-letter prefixes match "go-to-market",
  // "marketing" and any "expanding into ..." launch, which let product-strategy hires and fragrance launches in.
  { test: /retail|merchandising|store|omnichannel|category|sales/i, peopleMovesNeedTitleMatch: true, function: 'Retail', responsibilities: ['retail operations', 'commercial planning', 'customer and channel performance'], direct: ['retail', 'retail operations', 'stores', 'store openings', 'omnichannel', 'distribution', 'wholesale', 'direct to consumer', 'DTC', 'merchandising', 'sales performance', 'consumer behavior', 'store expansion', 'retail expansion', 'category performance', 'retail strategy'], adjacent: ['markets', 'expansion', 'strategy', 'growth', 'pricing', 'channel strategy', 'market positioning', 'supply chain', 'ecommerce', 'brand', 'customer experience'], exclusions: ['astronomy', 'observatories', 'marine science'] },
  { test: /chief|ceo|cto|cfo|director|vp|vice president|head of|executive|founder/i, generic: true, function: 'Leadership', responsibilities: ['strategic planning', 'organisational decisions', 'risk management'], direct: ['strategy', 'technology', 'markets', 'operations', 'regulation', 'growth', 'leadership', 'risk'], adjacent: ['industry context', 'sustainability', 'AI', 'finance', 'innovation'], exclusions: ['astronomy', 'observatories'] },
];

function unique(values: string[]): string[] {
  return [...new Map<string, string>(values.map((value) => [normalizeToken(value), value.trim()] as const).filter(([key, value]) => Boolean(key && value))).values()];
}

function specific(values: string[]): string[] {
  return unique(values).filter((value) => !GENERIC_CONCEPTS.has(normalizeToken(value)));
}

/**
 * Business-management words a catch-all leadership title brings with it. They describe how a senior person works,
 * not what their title subject is, so they never anchor a concept to that subject.
 */
/** Filler words that describe a kind of coverage, not a subject; never a subject term or theme on their own. */
const FILLER_WORDS = new Set(['benchmark', 'benchmarks', 'developments', 'news', 'program', 'programme', 'report', 'reporting', 'reports', 'trends', 'update', 'updates']);

const LEADERSHIP_WORDS = new Set(['board', 'business', 'corporate', 'decision', 'decisions', 'executive', 'finance', 'financial', 'governance', 'growth', 'leader', 'leaders', 'leadership', 'management', 'market', 'markets', 'operational', 'operations', 'organisation', 'organisational', 'organization', 'organizational', 'performance', 'planning', 'results', 'risk', 'risks', 'strategic', 'strategy']);

/** True when two normalized words are forms of one word: lawsuit/lawsuits, regulation/regulator. */
export function wordsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const shorter = Math.min(left.length, right.length);
  if (shorter < 5) return false;
  let shared = 0;
  while (shared < shorter && left[shared] === right[shared]) shared += 1;
  // Word forms of one subject: lawsuit/lawsuits, sustainable/sustainability, compliance/compliant.
  return shared >= Math.max(5, shorter - 3);
}

/** True when every word of the subject term occurs (in some word form) in the concept. */
function anchoredTo(concept: string, term: string): boolean {
  const conceptWords = normalizeToken(concept).split(' ').filter(Boolean);
  const termWords = normalizeToken(term).split(' ').filter(Boolean);
  return termWords.length > 0 && termWords.every((word) => conceptWords.some((candidate) => wordsMatch(candidate, word)));
}

/** True when a concept is part of a title topic ("marine" in "marine engineer") and not just a leadership word. */
function partOfTopic(concept: string, topic: string): boolean {
  const conceptWords = normalizeToken(concept).split(' ').filter(Boolean);
  const topicWords = normalizeToken(topic).split(' ').filter(Boolean);
  return conceptWords.length > 0 && !conceptWords.every((word) => LEADERSHIP_WORDS.has(word)) && conceptWords.every((word) => topicWords.some((candidate) => wordsMatch(candidate, word)));
}

/**
 * Validated subject vocabulary for a generic titled role: short, specific terms that are not merely leadership
 * words (a title topic itself, e.g. "strategy" in "Head of Strategy", is always kept).
 */
export function subjectTermsFor(role: RoleContext, vocabulary: string[] = []): string[] {
  const topics = role.titleTopics ?? [];
  const topicKeys = new Set(topics.map(normalizeToken));
  const accepted = vocabulary
    .map((term) => term.replace(/\s+/g, ' ').trim())
    .filter((term) => {
      const key = normalizeToken(term);
      if (!key || key.length > 40 || key.split(' ').length > 3 || GENERIC_CONCEPTS.has(key)) return false;
      return topicKeys.has(key) || !key.split(' ').every((word) => LEADERSHIP_WORDS.has(word) || FILLER_WORDS.has(word));
    });
  return unique([...topics, ...accepted]).slice(0, 32);
}

/** The subject terms that anchor a generic titled role, or undefined when the role is not anchored. */
export function roleSubjectTerms(role: RoleContext): string[] | undefined {
  if (role.roleSource !== 'generic' || !role.titleTopics?.length) return undefined;
  return role.subjectTerms?.length ? role.subjectTerms : role.titleTopics;
}

/**
 * For a generic titled role, a test for whether a concept is about the title subject: "sustainability strategy",
 * "emissions" (subject vocabulary) and "marine" (part of "marine engineer") are; "strategy" and "finance" are not.
 * Undefined for every other role, which is not anchored.
 */
export function subjectMatcher(role: RoleContext): ((concept: string) => boolean) | undefined {
  const terms = roleSubjectTerms(role);
  if (!terms) return undefined;
  const topics = role.titleTopics ?? [];
  return (concept) => terms.some((term) => anchoredTo(concept, term)) || topics.some((topic) => partOfTopic(concept, topic));
}

/** True when the role's people-move stories must name its own area in the title (see RoleRule). */
export function peopleMovesNeedTitleMatch(role: RoleContext): boolean {
  return role.roleSource !== 'generic' && Boolean(ROLE_RULES.find((rule) => rule.function === role.function)?.peopleMovesNeedTitleMatch);
}

/** "sustainability" or "legal and compliance": the reader-facing subject of a generic titled role. */
export function roleSubjectLabel(role: RoleContext): string | undefined {
  return role.roleSource === 'generic' && role.titleTopics?.length ? role.titleTopics.join(' and ') : undefined;
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
  // Its responsibility is the subject itself, not the catch-all "strategic planning, organisational decisions"
  // and not invented compounds ("legal reporting") that would surface as themes.
  const responsibilities = topics.length ? topics : match.responsibilities;
  return { rawTitle, normalizedTitle: normalizeToken(rawTitle), function: match.function, responsibilities, professionalThemes: [...directThemes, ...adjacentThemes], directThemes, adjacentThemes, confidence: rule ? 'high' : 'inferred', roleSource: generic ? 'generic' : 'dedicated', ...(topics.length ? { titleTopics: topics, subjectTerms: topics } : {}) };
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

/** "nike" → "Nike": an all-lowercase company name is shown title-cased; any other casing is the company's own. */
export function displayCompanyName(name: string | undefined): string | undefined {
  const trimmed = name?.replace(/\s+/g, ' ').trim();
  if (!trimmed || /[A-Z]/.test(trimmed)) return trimmed || undefined;
  return trimmed.replace(/(^|[\s-])([a-z])/g, (_match, separator: string, letter: string) => `${separator}${letter.toUpperCase()}`);
}

/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps ("Haed"). */
function editDistance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, i) => Array.from({ length: right.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[left.length][right.length];
}

/**
 * Accepts an AI spelling correction of a job title only when it is plainly the same title: the same number of
 * words, each one equal or a near spelling of the original (same first letter, at most ~40% of its letters
 * changed). "Softere Enginer" → "Software Engineer" passes; "Head of IT" → "Head of Information Technology" and
 * "Dev" → "Developer Relations Lead" do not. When unsure, the user's wording stays.
 */
export function acceptTitleCorrection(submitted: string, corrected: string | undefined): string | undefined {
  const original = normalizeJobTitle(submitted);
  const candidate = corrected ? normalizeJobTitle(corrected) : '';
  if (!candidate || candidate === original) return undefined;
  const before = original.split(' ');
  const after = candidate.split(' ');
  if (before.length !== after.length) return undefined;
  const sameWords = before.every((word, index) => {
    const left = word.toLowerCase();
    const right = after[index].toLowerCase();
    if (left === right) return true;
    if (!/^[a-z]+$/.test(left) || !/^[a-z]+$/.test(right) || left[0] !== right[0] || Math.min(left.length, right.length) < 4) return false;
    return editDistance(left, right) <= Math.max(1, Math.floor(Math.max(left.length, right.length) * 0.4));
  });
  return sameWords ? candidate : undefined;
}

export function buildProfessionalProfile(company: CompanyContext, jobTitle: string, now = new Date(), submittedJobTitle?: string): ProfessionalProfile {
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
  // A titled generic role's responsibilities restate its subject; their filler words are not search terms.
  const responsibilityTerms = role.titleTopics?.length ? [] : role.responsibilities.flatMap(tokenize);
  const searchTerms = unique([...concepts.flatMap((item) => tokenize(item.concept)), ...responsibilityTerms, ...tokenize(company.name ?? company.domain)]).filter((term) => !GENERIC_CONCEPTS.has(term));
  const semanticQueries = [
    `${roleSubjectLabel(role) ?? role.function} developments relevant to ${company.name ?? company.domain}`,
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
    companyName: displayCompanyName(company.name),
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
    ...(submittedJobTitle && normalizeJobTitle(submittedJobTitle) !== role.rawTitle ? { submittedJobTitle: normalizeJobTitle(submittedJobTitle) } : {}),
  };
}

export function displayRelevanceScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
