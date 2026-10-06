import { normalizeToken, tokenize } from './intent';

export const PROFESSIONAL_PROFILE_VERSION = '1.1';
export const RANKING_VERSION = '1.0';

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
  seniority?: string;
  decisionAreas?: string[];
  technologies?: string[];
  confidence: 'inferred' | 'high';
}

export interface RetrievalConcepts {
  keywordQueries: string[];
  topicConcepts: string[];
  semanticQueries: string[];
  entities: string[];
  industryTerms: string[];
  roleTerms: string[];
  exclusions: string[];
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

const ROLE_RULES: Array<{ test: RegExp; function: string; responsibilities: string[]; themes: string[] }> = [
  { test: /software|developer|engineering|architect|devops|platform|technical/i, function: 'Engineering', responsibilities: ['software development', 'system architecture', 'technical implementation'], themes: ['AI', 'developer technology', 'APIs', 'infrastructure', 'security', 'platforms', 'automation'] },
  { test: /procurement|purchasing|supply|sourcing|buyer/i, function: 'Procurement', responsibilities: ['supplier evaluation', 'commercial planning', 'operational resilience'], themes: ['supply chains', 'manufacturing', 'cost', 'sustainability', 'risk', 'vendors'] },
  { test: /investment|investor|portfolio|finance|bank|analyst/i, function: 'Finance and investment', responsibilities: ['market analysis', 'risk assessment', 'capital allocation'], themes: ['markets', 'financial technology', 'regulation', 'risk', 'AI', 'economic change'] },
  { test: /marketing|brand|communications|audience/i, function: 'Marketing and communications', responsibilities: ['audience strategy', 'positioning', 'campaign planning'], themes: ['audiences', 'content', 'brands', 'technology', 'culture', 'growth'] },
  { test: /research|scientist|academic|laboratory|lab/i, function: 'Research', responsibilities: ['research design', 'evidence review', 'knowledge development'], themes: ['science', 'evidence', 'technology', 'climate', 'innovation', 'research'] },
  { test: /chief|ceo|cto|cfo|director|vp|vice president|head of|executive|founder/i, function: 'Leadership', responsibilities: ['strategic planning', 'organisational decisions', 'risk management'], themes: ['strategy', 'technology', 'markets', 'operations', 'regulation', 'growth'] },
];

export function normalizeJobTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function analyzeRole(jobTitle: string): RoleContext {
  const rawTitle = normalizeJobTitle(jobTitle);
  const rule = ROLE_RULES.find((candidate) => candidate.test.test(rawTitle));
  const fallback = { function: 'Professional', responsibilities: ['professional development', 'decision support'], themes: ['business', 'technology', 'industry developments'] };
  const match = rule ?? fallback;
  return { rawTitle, normalizedTitle: normalizeToken(rawTitle), function: match.function, responsibilities: match.responsibilities, professionalThemes: match.themes, confidence: rule ? 'high' : 'inferred' };
}

export function buildProfessionalProfile(company: CompanyContext, jobTitle: string, now = new Date()): ProfessionalProfile {
  const role = analyzeRole(jobTitle);
  const companySignals = [...company.topics, ...(company.industry ? [company.industry] : []), ...company.entities];
  const professionalInterests = [...new Set([...companySignals, ...role.professionalThemes])].filter(Boolean);
  const searchTerms = [...new Set([...professionalInterests.flatMap(tokenize), ...role.responsibilities.flatMap(tokenize), ...tokenize(company.name ?? company.domain)])];
  const semanticQueries = [
    `${role.function} developments relevant to ${company.name ?? company.domain}`,
    `${role.professionalThemes.slice(0, 4).join(', ')} for ${role.rawTitle}`,
  ];
  const retrieval: RetrievalConcepts = {
    keywordQueries: searchTerms.slice(0, 40),
    topicConcepts: professionalInterests,
    semanticQueries,
    entities: [...new Set(company.entities)],
    industryTerms: company.industry ? [company.industry] : [],
    roleTerms: [...new Set([role.function, ...role.responsibilities, ...role.professionalThemes])],
    exclusions: [],
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
    needs: role.responsibilities,
    entities: [...new Set(company.entities)],
    likelyInformationNeeds: [...new Set([...role.responsibilities, ...role.professionalThemes])],
    searchTerms,
    semanticQueries,
    excludedConcepts: [],
    retrieval,
    generatedAt,
    profileVersion: PROFESSIONAL_PROFILE_VERSION,
  };
}

export function displayRelevanceScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
