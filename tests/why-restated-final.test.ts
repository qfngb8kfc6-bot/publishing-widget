import { describe, expect, it } from 'vitest';
import { explanationRestatement, whyRestatesStory } from '../src/ai/content-quality';
import { cardMarkup } from '../src/hosted-cards';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { factualLine } from '../src/reports/generate';
import type { ReportRecommendation } from '../src/reports';
import { createProductionApp } from '../src/server/production';
import { RECENCY_FIXTURE_STORIES } from './recency-fixtures';

const DAY_MS = 86_400_000;
// Live card (Head of Procurement at Nike): the "why" box showed the excerpt word for word.
const HEADLINE = 'Global Sources Hong Kong Shows spotlight pickleball';
const EXCERPT = 'Pickleball took centre stage at the Global Sources Hong Kong Shows, where suppliers showcased paddles, balls and court equipment for sourcing teams.';

describe('final "why" restatement check', () => {
  it('flags the excerpt copied verbatim, a short copied piece and the headline', () => {
    const article = { title: HEADLINE, description: EXCERPT };
    expect(whyRestatesStory(EXCERPT, article)).toBeDefined();
    expect(whyRestatesStory(factualLine(article), article)).toBeDefined();
    expect(explanationRestatement('Pickleball took centre stage.', article)).toBe('copied');
    expect(explanationRestatement(HEADLINE, article)).toBeDefined();
    expect(explanationRestatement('Spotlight pickleball', article)).toBe('copied');
    expect(whyRestatesStory('Pickleball took centre stage at the show.', { title: 'Other headline', summary: 'Pickleball took centre stage at the show. More text follows here.' })).toBeDefined();
  });

  it('leaves a reader-first explanation alone', () => {
    expect(whyRestatesStory('Your sourcing team can use the show to compare paddle suppliers before pickleball demand peaks.', { title: HEADLINE, description: EXCERPT })).toBeUndefined();
  });

  it('never renders a copied "why", even on a stored report without the flag', () => {
    const recommendation = { articleId: 'a1', displayScore: 62, explanation: EXCERPT, rankingMetadata: {}, article: { id: 'a1', title: HEADLINE, description: EXCERPT, url: 'https://www.sgieurope.com/x/1.article', categories: [], tags: [], publisherId: 'sgi-europe' } } as unknown as ReportRecommendation;
    const context = { publisherName: 'SGI Europe', link: () => '' };
    expect(cardMarkup(recommendation, context)).not.toContain('Why this matters');
    const reader = { ...recommendation, explanation: 'Your sourcing team can use the show to compare paddle suppliers before pickleball demand peaks.' };
    expect(cardMarkup(reader, context)).toContain('Why this matters');
  });

  it('marks first-sentence fallbacks restated at generation and logs them (IDs only)', async () => {
    const items = [
      ...RECENCY_FIXTURE_STORIES.map(([section, title, description, ageDays], i) => ({ section, title, description, ageDays, id: `17000${i}` })),
      { section: 'trade-shows', title: HEADLINE, description: EXCERPT, ageDays: 5, id: '1799902' },
    ];
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items.map((item) => `<item><title>${item.title}</title><link>https://www.sgieurope.com/${item.section}/s/${item.id}.article</link><guid>https://www.sgieurope.com/${item.section}/s/${item.id}.article</guid><description>${item.description}</description><pubDate>${new Date(Date.now() - item.ageDays * DAY_MS).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
    const events: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const app = createProductionApp({
      environment: 'test',
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async () => new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
      companyContextProvider: { getContext: async (d: string) => ({ domain: d, canonicalUrl: `https://${d}/`, name: 'Nike', industry: 'sporting goods', topics: ['footwear', 'apparel'], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: (message, fields) => events.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Procurement' }) }));
    expect(response.status).toBe(201);
    const { reportId } = await response.json() as { reportId: string };
    const report = (await app.reportStore.get(reportId, 'sgi-europe'))!;
    expect(report.recommendations.length).toBeGreaterThan(0);
    // No AI here: every "why" is the article's own first sentence, so every box is hidden.
    for (const item of report.recommendations) {
      expect(item.rankingMetadata?.explanationRestated).toBe(true);
      expect(cardMarkup(item, { publisherName: 'SGI Europe', link: () => '' })).not.toContain('Why this matters');
    }
    const logged = events.filter((event) => event.message === 'explanation_restated' && event.fields.part === 'final');
    expect(logged.length).toBe(report.recommendations.length);
    expect(logged.every((event) => event.fields.outcome === 'hidden' && !JSON.stringify(event.fields).includes('ickleball'))).toBe(true);
  });
});
