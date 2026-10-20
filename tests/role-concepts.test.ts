import { describe, expect, it } from 'vitest';
import { analyzeRole, buildProfessionalProfile, scoreProfessionalArticle, titleTopics, type NormalizedArticle } from '../src/core';
import { mergeProfessionalProfileEnhancement } from '../src/ai/validation';
import { profileForTheme } from '../src/reports/themes';
import { PROFILE_ENRICHMENT_INSTRUCTION, SUBJECT_VOCABULARY_INSTRUCTION } from '../src/ai/providers/openai-compatible';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { company } from './ranking-fixtures';

const sustainabilityEnrichment = {
  person: { responsibilities: ['sustainability strategy', 'reporting on emissions across every supplier tier'], decisionAreas: ['sustainable materials', 'circularity'], themes: ['carbon emissions'] },
  professionalInterests: ['recycled materials'],
  searchTerms: ['traceability', 'PFAS'],
};

function article(id: string, title: string, description: string): NormalizedArticle {
  return { id, title, description, url: `https://www.sgieurope.com/${id}.article`, categories: [], tags: [], publisherId: 'sgi-europe', publishedAt: '2026-09-01T00:00:00.000Z' };
}

describe('title topics for generic roles', () => {
  it.each([
    ['Head of Sustainability', ['sustainability']],
    ['Chief Legal Officer', ['legal']],
    ['Head of Legal & Compliance', ['legal', 'compliance']],
    ['VP, Sustainability and Corporate Affairs', ['sustainability', 'corporate affairs']],
    ['Director of ESG', ['esg']],
    ['CEO', []],
    ['Founder', []],
  ])('%s → %j', (title, expected) => {
    expect(titleTopics(title)).toEqual(expected);
  });

  it('marks catch-all roles as generic and keeps dedicated roles unchanged', () => {
    expect(analyzeRole('Head of Retail')).toMatchObject({ function: 'Retail', roleSource: 'dedicated' });
    expect(analyzeRole('Head of Retail').titleTopics).toBeUndefined();
    expect(analyzeRole('Head of Sustainability')).toMatchObject({ function: 'Leadership', roleSource: 'generic', titleTopics: ['sustainability'], directThemes: ['sustainability'] });
    expect(analyzeRole('Head of Sustainability').adjacentThemes).toEqual(expect.arrayContaining(['strategy', 'markets', 'growth']));
    expect(analyzeRole('CEO')).toMatchObject({ function: 'Leadership', roleSource: 'generic' });
    expect(analyzeRole('CEO').directThemes).toEqual(expect.arrayContaining(['strategy', 'markets']));
  });

  it('makes the title topic the direct concept and moves catch-all leadership concepts to adjacent', () => {
    const profile = buildProfessionalProfile(company('puma.com', 'Puma', 'sporting goods', []), 'Head of Sustainability');
    const direct = profile.retrieval.concepts!.filter((concept) => concept.relevanceType === 'direct').map((concept) => concept.concept);
    const adjacent = profile.retrieval.concepts!.filter((concept) => concept.relevanceType === 'adjacent').map((concept) => concept.concept);
    expect(direct).toContain('sustainability');
    expect(direct).not.toEqual(expect.arrayContaining(['markets']));
    expect(direct).not.toContain('growth');
    expect(adjacent).toEqual(expect.arrayContaining(['markets', 'growth']));
  });
});

// Mimics the production enrichment for Puma / Head of Sustainability (report a15c9ed6): leadership-flavoured
// responsibilities, themes and interests around one subject-flavoured decision area, plus subject vocabulary.
const productionLikeEnrichment = {
  person: { function: 'Leadership', responsibilities: ['strategic planning', 'organisational decisions', 'risk management'], decisionAreas: ['sustainability strategy', 'risk management', 'organizational governance', 'regulatory response'], themes: ['strategy', 'finance', 'leadership'] },
  professionalInterests: ['corporate strategy', 'financial performance', 'growth', 'markets'],
  searchTerms: ['strategy', 'finance', 'growth', 'markets', 'leadership'],
  subjectVocabulary: ['circularity', 'emissions', 'carbon', 'recycled', 'PFAS', 'greenwashing', 'traceability', 'impact report', 'strategy'],
};

function sustainabilityProfile(enrichment: unknown = productionLikeEnrichment) {
  return mergeProfessionalProfileEnhancement(buildProfessionalProfile(company('puma.com', 'Puma', 'sporting goods', []), 'Head of Sustainability'), enrichment)!;
}

describe('AI enrichment for generic roles', () => {
  it('promotes the title subject vocabulary and only on-subject concepts to direct', () => {
    const merged = sustainabilityProfile();
    const direct = merged.retrieval.concepts!.filter((concept) => concept.relevanceType === 'direct').map((concept) => concept.concept);
    expect(direct).toEqual(['sustainability', 'circularity', 'emissions', 'carbon', 'recycled', 'PFAS', 'greenwashing', 'traceability', 'impact report', 'sustainability strategy']);
    for (const generic of ['strategy', 'finance', 'leadership', 'growth', 'markets', 'risk management', 'organizational governance', 'strategic planning']) expect(direct).not.toContain(generic);
    expect(merged.retrieval.concepts!.find((concept) => concept.concept === 'strategy')?.relevanceType).toBe('adjacent');
    expect(merged.role.subjectTerms).not.toContain('strategy');
    expect(merged.role.responsibilities).not.toEqual(expect.arrayContaining(['strategic planning']));
    expect(merged.directInterests).not.toEqual(expect.arrayContaining(['finance']));
  });

  it('promotes on-subject concepts without vocabulary and still keeps leadership concepts adjacent', () => {
    const merged = sustainabilityProfile(sustainabilityEnrichment);
    const promoted = merged.retrieval.concepts!.filter((concept) => concept.source === 'role' && concept.weight === 1.1).map((concept) => concept.concept);
    expect(promoted).toEqual(['sustainable materials', 'sustainability strategy']);
    expect(promoted).not.toContain('reporting on emissions across every supplier tier');
  });

  it('leaves dedicated roles on the existing merge', () => {
    const base = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', []), 'Head of Retail');
    const merged = mergeProfessionalProfileEnhancement(base, productionLikeEnrichment)!;
    expect(merged.retrieval.concepts!.some((concept) => concept.weight === 1.1)).toBe(false);
    expect(merged.retrieval.concepts!.slice(0, base.retrieval.concepts!.length)).toEqual(base.retrieval.concepts);
    expect(merged.role.subjectTerms).toBeUndefined();
  });

  it('ranks on-topic coverage above company strategy and financial results for a generic role', () => {
    const profile = sustainabilityProfile();
    const results = scoreProfessionalArticle(article('results', 'Puma sets out new strategy as finance chief targets growth', 'Puma outlined a strategic plan focused on markets, risk management and growth, its finance chief said.'), profile);
    const onTopic = scoreProfessionalArticle(article('report', 'Brand impact report shows emissions cut across supply chain', 'Scope 3 emissions fell 12% as suppliers switched to recycled inputs.'), profile);
    expect(onTopic.relevanceType).toBe('direct');
    expect(results.relevanceType).toBe('adjacent');
    expect(results.relevanceSignals.join(' ')).not.toContain('directly matches');
    expect(onTopic.score).toBeGreaterThan(results.score);
  });

  it('requires a title-subject match to be direct even when a stored profile has generic direct concepts', () => {
    const profile = sustainabilityProfile();
    const stored = { ...profile, retrieval: { ...profile.retrieval, concepts: [...profile.retrieval.concepts!, { concept: 'finance', weight: 1.1, relevanceType: 'direct' as const, source: 'role' as const }, { concept: 'footwear', weight: 0.7, relevanceType: 'direct' as const, source: 'company' as const }] } };
    const result = scoreProfessionalArticle(article('fy', 'Puma finance chief says footwear finance improved', 'Footwear revenue and finance costs.'), stored);
    expect(result.relevanceType).not.toBe('direct');
    expect(result.directMatches).toEqual([]);
  });

  it('keeps a strong title-subject match above a thin one carried by many generic concepts', () => {
    const profile = sustainabilityProfile();
    // Strong: subject in title + description (22×1.1 + 12×1.1 ≈ 37). Generic: subject twice in the description
    // (≈ 26) plus five generic concepts in the title (adjacent evidence 28). At full weight the generic article
    // would win (26 + 28 = 54 > 37); weighted at a quarter it adds 7 and stays below.
    const strong = scoreProfessionalArticle(article('strong', 'Greenwashing complaint filed against running shoe claims', 'A consumer group said the carbon claims were unproven.'), profile);
    const generic = scoreProfessionalArticle(article('generic', 'Strategy, finance, growth and markets: leadership outlook', 'Executives see recycled packaging and carbon as minor issues.'), profile);
    expect(strong.relevanceType).toBe('direct');
    expect(generic.relevanceType).toBe('direct');
    expect(generic.scoreComponents!.adjacent).toBeGreaterThan(20);
    expect(strong.score).toBeGreaterThan(generic.score);
  });
});

describe('theme search for an anchored role', () => {
  it('treats the chosen theme as part of the subject', () => {
    const profile = profileForTheme(sustainabilityProfile(), 'packaging');
    const result = scoreProfessionalArticle(article('pack', 'Brands cut plastic packaging', 'Packaging changes across footwear brands.'), profile);
    expect(result.relevanceType).toBe('direct');
    expect(result.directMatches).toContain('packaging');
  });
});

describe('anchored profile in AI calls', () => {
  it('asks for subject vocabulary and sends the subject to rerank and content calls', async () => {
    const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    const titles = ['Brand impact report shows emissions cut', 'Puma sets out new strategy as finance chief targets growth', 'Greenwashing complaint filed against running shoe claims', 'Recycled polyester share rises at Adidas'];
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${titles.map((title, index) => `<item><title>${title}</title><link>https://www.sgieurope.com/csr/a-${index}/1200${index}.article</link><guid>https://www.sgieurope.com/csr/a-${index}/1200${index}.article</guid><description>${title}. Emissions, carbon and sustainability coverage.</description><pubDate>Mon, 0${index + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
    const seen: Record<string, { system: string; payload: Record<string, any> }> = {};
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-anchor-key', AI_MODEL: 'test-model', AI_ENDPOINT },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async (input, init) => {
        if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
        const body = JSON.parse(String(init?.body));
        const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
        seen[ref.operation] = { system: body.messages[0].content, payload: ref.payload };
        const { subjectVocabulary: terms, ...main } = productionLikeEnrichment;
        const content = ref.operation === 'professional-profile-enrichment' ? main : ref.operation === 'subject-vocabulary' ? { terms } : {};
        return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
      },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Puma', industry: 'sporting goods', topics: [], entities: ['Puma'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'puma.com', jobTitle: 'Head of Sustainability' }) }));
    expect(response.status).toBe(201);
    expect(seen['professional-profile-enrichment'].system).toContain(PROFILE_ENRICHMENT_INSTRUCTION);
    expect(seen['subject-vocabulary'].system).toContain(SUBJECT_VOCABULARY_INSTRUCTION);
    expect(seen['subject-vocabulary'].payload).toMatchObject({ jobTitle: 'Head of Sustainability', subject: ['sustainability'] });
    const intent = seen['semantic-reranking'].payload.enrichedIntent;
    expect(intent).toMatchObject({ subject: 'sustainability', persona: 'sustainability' });
    expect(intent.subjectTerms).toEqual(expect.arrayContaining(['sustainability', 'emissions', 'greenwashing']));
    expect(intent.primaryThemes).not.toEqual(expect.arrayContaining(['finance']));
    expect(intent.personas).toEqual(['sustainability']);
    const reader = seen['report-content'].payload.reader;
    expect(reader.roleFunction).toBe('sustainability');
    expect(reader.responsibilities).not.toEqual(expect.arrayContaining(['strategic planning']));
    expect(reader.priorities).not.toEqual(expect.arrayContaining(['strategy', 'finance']));
  });
});

describe('company bonus', () => {
  it('scales with role evidence so a company mention cannot outrank on-topic coverage of another company', () => {
    const profile = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', []), 'Head of Procurement');
    const companyMention = scoreProfessionalArticle(article('mention', 'Nike unveils new campaign with athletes', 'The campaign features athletes. Separately, analysts noted suppliers in the body text.'), profile);
    const onTopic = scoreProfessionalArticle(article('other', 'Brand consolidates suppliers', 'A rival brand cut its suppliers and sourcing partners to reduce cost.'), profile);
    expect(companyMention.scoreComponents!.company).toBeLessThan(8);
    expect(onTopic.score).toBeGreaterThan(companyMention.score);
    const strongMention = scoreProfessionalArticle(article('strong', 'Nike consolidates suppliers', 'Nike cut suppliers and sourcing partners.'), profile);
    expect(strongMention.scoreComponents!.company).toBe(8);
  });
});
