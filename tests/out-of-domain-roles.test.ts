import { describe, expect, it } from 'vitest';
import { analyzeRole, buildProfessionalProfile, isAmbiguousSingleWord, roleSubjectLabel, roleSubjectTerms } from '../src/core';
import { mergeProfessionalProfileEnhancement } from '../src/ai/validation';
import { SUBJECT_VOCABULARY_INSTRUCTION, OpenAICompatibleProvider } from '../src/ai/providers/openai-compatible';
import { publisherDomain } from '../src/publishers/manifest';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { selectReportThemes } from '../src/reports/themes';
import { company } from './ranking-fixtures';

const nike = company('nike.com', 'Nike', 'sporting goods', ['footwear', 'apparel']);
const direct = (profile: ReturnType<typeof buildProfessionalProfile>) => profile.retrieval.concepts.filter((concept) => concept.relevanceType === 'direct').map((concept) => concept.concept);

describe('out-of-domain roles', () => {
  it('recognises software, IT, data, finance and HR roles as outside a trade publisher domain', () => {
    expect(analyzeRole('Software Engineer')).toMatchObject({ function: 'Engineering', outsideDomain: true, subjectLabel: 'software engineering' });
    expect(analyzeRole('Head of IT')).toMatchObject({ function: 'IT', outsideDomain: true });
    expect(analyzeRole('Data Scientist')).toMatchObject({ function: 'Data and analytics', outsideDomain: true });
    expect(analyzeRole('HR Director')).toMatchObject({ function: 'People and HR', outsideDomain: true });
    for (const title of ['Head of Retail', 'Head of Procurement', 'Product Manager', 'Head of Sustainability']) expect(analyzeRole(title).outsideDomain).toBeUndefined();
  });

  it('anchors an out-of-domain role on industry vocabulary, without lone ambiguous words', () => {
    const base = buildProfessionalProfile(nike, 'Software Engineer');
    expect(direct(base)).not.toEqual(expect.arrayContaining(['platforms', 'infrastructure', 'integration']));
    const merged = mergeProfessionalProfileEnhancement(base, { searchTerms: ['programming', 'developer', 'backend', 'testing'], subjectVocabulary: ['digital products', 'mobile apps', 'wearables', 'connected fitness', 'testing', 'backend', 'software testing'] })!;
    expect(roleSubjectTerms(merged.role)).toEqual(['digital products', 'mobile apps', 'wearables', 'connected fitness', 'software testing']);
    expect(roleSubjectLabel(merged.role)).toBe('software engineering');
    expect(direct(merged)).toEqual(expect.arrayContaining(['digital products', 'mobile apps', 'wearables']));
    for (const word of ['programming', 'developer', 'backend', 'testing']) expect(direct(merged)).not.toContain(word);
    const themes = selectReportThemes(merged, [{ title: 'Garmin connected fitness revenue jumps', description: 'wearables and apps' }]);
    expect(themes.length).toBeGreaterThan(0);
    for (const theme of themes) expect(isAmbiguousSingleWord(theme)).toBe(false);
  });

  it('never makes lone ambiguous words themes of a generic role either', () => {
    const generic = buildProfessionalProfile(nike, 'Softere Enginer');
    const merged = mergeProfessionalProfileEnhancement(generic, { subjectVocabulary: ['programming', 'developer', 'backend', 'testing'], searchTerms: ['programming', 'backend'] })!;
    for (const theme of selectReportThemes(merged)) expect(['programming', 'developer', 'backend', 'testing']).not.toContain(theme);
  });

  it('asks for vocabulary for the publisher industry and sends its domain', async () => {
    expect(publisherDomain(sgiEuropeManifest)).toMatch(/sporting goods industry/);
    expect(publisherDomain({ publisherId: 'sgi-europe' })).toMatch(/sporting goods industry/);
    expect(SUBJECT_VOCABULARY_INSTRUCTION).toContain('what a person in this job at this company would look for in news about that industry');
    expect(SUBJECT_VOCABULARY_INSTRUCTION).toContain('Never return a lone word that means something else in that industry (testing, backend, development, platform, programming)');
    let payload: Record<string, unknown> | undefined;
    const provider = new OpenAICompatibleProvider({ endpoint: 'https://ai.example.test/v1', apiKey: 'sk-test-domain-1234', model: 'm', timeoutMs: 1_000 }, async (_input, init) => {
      payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')).payload;
      return Response.json({ choices: [{ message: { content: '{"terms":[]}' }, finish_reason: 'stop' }] });
    });
    await provider.generateSubjectVocabulary({ publisherId: 'sgi-europe', publisherDomain: 'the sporting goods industry', jobTitle: 'Software Engineer', titleTopics: ['software engineering'], companyName: 'Nike' });
    expect(payload).toMatchObject({ publisherDomain: 'the sporting goods industry', jobTitle: 'Software Engineer' });
  });
});

describe('software engineer report on a sporting-goods title', () => {
  it('ranks sports-tech stories, not textile testing or gym programmes, for a misspelt software role', async () => {
    const { createProductionApp } = await import('../src/server/production');
    const { MemoryPublisherStore } = await import('../src/publishers/store');
    const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    const stories = [
      ['Fitness First bets on longevity', 'Fitness First is developing longevity programmes, including biomarker testing and a new backend for member data.'],
      ['Testing group Hohenstein joins EMAS', 'The textile testing and certification group Hohenstein has joined the EU eco-management scheme EMAS.'],
      ['Youth football programming gets funding boost', 'A foundation is funding programming for youth football clubs.'],
      ['Nike relaunches its app and e-commerce platform', 'Nike rebuilt its digital experience with a new e-commerce platform.'],
      ['Garmin connected fitness revenue jumps 20%', 'Garmin said its fitness segment, including wearables and the Connect app, grew 20%.'],
      ['Whoop raises $200m for wearable health tracking', 'Sports tech start-up Whoop raised funding for its wearable and app.'],
    ];
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${stories.map(([title, description], index) => `<item><title>${title}</title><link>https://www.sgieurope.com/news/s-${index}/2100${index}.article</link><guid>https://www.sgieurope.com/news/s-${index}/2100${index}.article</guid><description>${description}</description><pubDate>Mon, 0${index + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
    const vocabularyPayloads: Array<Record<string, unknown>> = [];
    const instance = createProductionApp({
      environment: 'test',
      serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-domain-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '200' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async (input, init) => {
        if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
        const { operation, payload } = JSON.parse(JSON.parse(String(init?.body)).messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
        if (operation === 'subject-vocabulary') vocabularyPayloads.push(payload);
        const content = operation === 'professional-profile-enrichment' ? { correctedJobTitle: 'Software Engineer', searchTerms: ['programming', 'developer', 'backend', 'testing'] }
          : operation === 'subject-vocabulary' ? { terms: ['digital experience', 'e-commerce platform', 'wearables', 'connected fitness', 'sports tech', 'testing', 'backend'] } : {};
        return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
      },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    const response = await instance.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Softere Enginer' }) }));
    const { reportId } = await response.json() as { reportId: string };
    const report = (await instance.reportStore.get(reportId, 'sgi-europe'))!;
    const titles = report.recommendations.map((item) => item.article.title);
    expect(vocabularyPayloads[0]).toMatchObject({ publisherDomain: expect.stringContaining('sporting goods industry') });
    expect(titles).toEqual(expect.arrayContaining(['Nike relaunches its app and e-commerce platform', 'Garmin connected fitness revenue jumps 20%']));
    for (const noise of ['Fitness First bets on longevity', 'Testing group Hohenstein joins EMAS', 'Youth football programming gets funding boost']) expect(titles).not.toContain(noise);
    expect(report.professionalProfile.themes).not.toEqual(expect.arrayContaining(['testing']));
    expect(report.professionalProfile.themes).not.toEqual(expect.arrayContaining(['backend']));
  });
});
