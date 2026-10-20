import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile } from '../src/core';
import { mergeProfessionalProfileEnhancement, validateReportContent } from '../src/ai/validation';
import { factualLine } from '../src/reports/generate';
import { reportThemes } from '../src/reports/themes';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { company } from './ranking-fixtures';

const legalEnrichment = {
  person: { responsibilities: ['strategic planning', 'organisational decisions', 'risk management'], decisionAreas: ['legal strategy', 'risk management', 'organizational governance'], themes: ['strategy', 'finance', 'leadership'] },
  professionalInterests: ['corporate strategy', 'growth', 'markets'],
  subjectVocabulary: ['litigation', 'lawsuit', 'trademark', 'patent', 'regulator', 'settlement'],
};

const themesFor = (profile: ReturnType<typeof buildProfessionalProfile>) => reportThemes({ professionalProfile: profile });

describe('report themes', () => {
  it('gives a generic titled role subject themes only, never strategy, markets or operations', () => {
    const base = buildProfessionalProfile(company('lululemon.com', 'Lululemon', 'sporting goods', []), 'Head of Legal');
    const withoutAI = themesFor(base);
    expect(withoutAI[0]).toBe('legal');
    expect(withoutAI.join(' ')).not.toMatch(/strategy|markets|operations|growth/);
    const withAI = themesFor(mergeProfessionalProfileEnhancement(base, legalEnrichment)!);
    expect(withAI).toEqual(['legal', 'litigation', 'lawsuit', 'trademark']);
  });

  it('keeps dedicated roles on their existing themes', () => {
    const profile = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', []), 'Head of Retail');
    const previous = [...new Set([...profile.professionalInterests, ...profile.likelyInformationNeeds, ...profile.role.professionalThemes])].slice(0, 4);
    expect(themesFor(profile)).toEqual(previous);
  });
});

describe('theme descriptions from content call A', () => {
  const profile = buildProfessionalProfile(company('puma.com', 'Puma', 'sporting goods', []), 'Head of Sustainability');
  const request = { publisherId: 'sgi-europe', profile, themes: ['sustainability', 'emissions'], recommendations: [] };

  it('keeps one single-line description per supplied theme and drops unknown, empty or over-long ones', () => {
    const content = validateReportContent({ summary: 'S.', themeDescriptions: [
      { theme: 'Sustainability', description: 'Puma and Adidas both tied leather to\n deforestation-free supply chains.' },
      { theme: 'emissions', description: 'x'.repeat(161) },
      { theme: 'finance', description: 'Invented theme.' },
      { theme: 'emissions', description: '' },
    ] }, request)!;
    expect(content.themeDescriptions).toEqual({ sustainability: 'Puma and Adidas both tied leather to deforestation-free supply chains.' });
    expect(validateReportContent({ summary: 'S.', themeDescriptions: [{ theme: 'emissions', description: 'Line.' }] }, { ...request, themes: undefined })!.themeDescriptions).toBeUndefined();
  });

  it('asks part A for the report themes, stores the lines and falls back when AI fails', async () => {
    const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    const items = Array.from({ length: 12 }, (_, index) => `<item><title>Brand sustainability report: carbon emissions cut ${index}</title><link>https://www.sgieurope.com/csr/e-${index}/1300${index}.article</link><guid>https://www.sgieurope.com/csr/e-${index}/1300${index}.article</guid><description>Sustainability report: emissions and recycled materials ${index}.</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('');
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;
    const run = async (failContent: boolean) => {
      const contentPayloads: Array<Record<string, any>> = [];
      const app = createProductionApp({
        environment: 'test',
        serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-theme-key', AI_MODEL: 'test-model', AI_ENDPOINT },
        publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
        fetchImpl: async (input, init) => {
          if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
          const body = JSON.parse(String(init?.body));
          const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
          if (ref.operation !== 'report-content') return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
          contentPayloads.push(ref.payload);
          if (failContent) return new Response('upstream error', { status: 500 });
          const themes: string[] = ref.payload.themes ?? [];
          return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'S.', explanations: [], themeDescriptions: themes.map((theme) => ({ theme, description: `Brands cut ${theme} across 12 reports.` })) }) }, finish_reason: 'stop' }] });
        },
        companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Puma', industry: 'sporting goods', topics: [], entities: ['Puma'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      });
      const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'puma.com', jobTitle: 'Head of Sustainability' }) }));
      const { reportId } = await response.json() as { reportId: string };
      return { report: (await app.reportStore.get(reportId, 'sgi-europe'))!, contentPayloads };
    };
    const { report, contentPayloads } = await run(false);
    const themes = reportThemes(report);
    expect(contentPayloads).toHaveLength(2);
    expect(contentPayloads.filter((payload) => payload.themes).map((payload) => payload.themes)).toEqual([themes]);
    expect(report.themeDescriptions).toEqual(Object.fromEntries(themes.map((theme) => [theme, `Brands cut ${theme} across 12 reports.`])));
    expect((await run(true)).report.themeDescriptions).toBeUndefined();
  });
});

describe('factual line for theme results', () => {
  it('uses the first sentence of the description, clipped at a word', () => {
    expect(factualLine({ title: 'T', description: 'Adidas cut emissions 15%. It also said more.' })).toBe('Adidas cut emissions 15%.');
    expect(factualLine({ title: 'Title only' })).toBe('Title only');
    const long = factualLine({ title: 'T', description: `${'word '.repeat(60)}end.` });
    expect(long.length).toBeLessThanOrEqual(221);
    expect(long.endsWith('…')).toBe(true);
  });
});
