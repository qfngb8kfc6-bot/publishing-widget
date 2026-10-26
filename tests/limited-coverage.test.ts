import { describe, expect, it } from 'vitest';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { REPORT_SUMMARY_LIMITED_COVERAGE_INSTRUCTIONS, REPORT_SUMMARY_ONLY_INSTRUCTIONS } from '../src/ai/providers/openai-compatible';
import { STRONG_FIT_SCORE, themeResultFloor } from '../src/reports/generate';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const item = ([title, description]: string[], index: number) => `<item><title>${title}</title><link>https://www.sgieurope.com/news/c-${index}/2200${index}.article</link><guid>https://www.sgieurope.com/news/c-${index}/2200${index}.article</guid><description>${description}</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`;

function app(stories: string[][], vocabulary: string[]) {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${stories.map(item).join('')}</channel></rss>`;
  const summaryPrompts: string[] = [];
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-coverage-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '200' },
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const { operation } = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      if (operation === 'report-content' && body.messages[0].content.includes('Do not write explanations')) summaryPrompts.push(body.messages[0].content);
      const content = operation === 'subject-vocabulary' ? { terms: vocabulary } : operation === 'professional-profile-enrichment' ? { professionalInterests: ['sporting goods'] } : {};
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
  });
  const generate = async (jobTitle: string) => {
    const response = await instance.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle }) }));
    const { reportId } = await response.json() as { reportId: string };
    return (await instance.reportStore.get(reportId, 'sgi-europe'))!;
  };
  return { instance, summaryPrompts, generate };
}

describe('limited coverage', () => {
  it('flags a thin report, hedges the summary prompt and writes an honest note', async () => {
    const target = app([
      ['Garmin connected fitness revenue jumps', 'Garmin fitness segment grew.'],
      ['Decathlon revenue rises 4%', 'Decathlon said revenue grew.'],
      ['Nike and Dove team up on girls in sport', 'A programme with coaching resources.'],
    ], ['connected fitness', 'wearables', 'mobile apps']);
    const report = await target.generate('Software Engineer');
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.professionalProfile.coverage).toEqual({ limited: true, note: expect.stringMatching(/^SGI Europe’s coverage for software engineering is limited\. These are the closest stories on .+\.$/) });
    expect(target.summaryPrompts[0]).toContain('SUMMARY (LIMITED COVERAGE)');
    expect(target.summaryPrompts[0]).not.toContain('Open with the strongest pattern');
  });

  it('leaves a well-covered report alone', async () => {
    const stores = Array.from({ length: 6 }, (_, index) => [`Retailer ${String.fromCharCode(65 + index)} opens ${index + 10} stores in an omnichannel retail push`, 'Retail stores, omnichannel distribution and merchandising across Europe.']);
    const target = app(stores, []);
    const report = await target.generate('Head of Retail');
    expect(report.recommendations.filter((item) => item.rankingMetadata.relevanceType === 'direct').length).toBeGreaterThanOrEqual(3);
    expect(report.professionalProfile.coverage).toBeUndefined();
    expect(target.summaryPrompts[0]).toContain('Open with the strongest pattern');
  });

  it('keeps the hedged prompt short and free of pattern claims', () => {
    expect(REPORT_SUMMARY_LIMITED_COVERAGE_INSTRUCTIONS).toContain('at most 60 words');
    expect(REPORT_SUMMARY_LIMITED_COVERAGE_INSTRUCTIONS).toContain('Never call them a pattern, trend or shift');
    expect(REPORT_SUMMARY_LIMITED_COVERAGE_INSTRUCTIONS).toContain('Never claim the theme is a trend');
    expect(REPORT_SUMMARY_ONLY_INSTRUCTIONS).not.toContain('LIMITED COVERAGE');
  });
});

describe('theme result floor', () => {
  it('is the weakest main-report score, between the relevance threshold and a strong fit', () => {
    const report = (scores: number[]) => ({ recommendations: scores.map((displayScore) => ({ displayScore })) }) as never;
    expect(themeResultFloor(report([67, 44, 32]))).toBe(32);
    expect(themeResultFloor(report([90, 80, 70]))).toBe(STRONG_FIT_SCORE);
    expect(themeResultFloor(report([20]))).toBe(24);
    expect(themeResultFloor(report([]))).toBe(24);
  });

  it('drops theme results weaker than the report’s own stories', async () => {
    const target = app([
      ['Garmin connected fitness and wearables revenue jumps', 'Garmin wearables and connected fitness apps grew strongly.'],
      ['Whoop wearables raise funding for connected fitness', 'Whoop wearables and connected fitness subscriptions.'],
      ['Sport 2000 tests a new wearables corner', 'A store corner.'],
      ['Intersport stocks a wearables brand', 'Intersport adds a brand.'],
    ], ['connected fitness', 'wearables']);
    const report = await target.generate('Software Engineer');
    const floor = themeResultFloor(report);
    const theme = report.professionalProfile.themes![0];
    const response = await target.instance.handle(new Request(`https://discovery.ldsystems.uk/api/reports/${report.id}/themes/${encodeURIComponent(theme)}/search?publisherId=sgi-europe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    const { recommendations } = await response.json() as { recommendations: Array<{ displayScore: number }> };
    for (const result of recommendations) expect(result.displayScore).toBeGreaterThanOrEqual(floor);
  });
});
