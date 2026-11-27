import { describe, expect, it } from 'vitest';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';
import { storiesSectionMarkup } from '../src/hosted-cards';
import { eventDateMs, isEventPreview, isPastEventPreview } from '../src/reports/past-events';
import { RECENCY_FIXTURE_STORIES } from './recency-fixtures';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-11-27T12:00:00Z');
const texworld = {
  title: 'Texworld Apparel Sourcing Paris 2026: Event guide',
  description: 'Everything you need to know about Texworld Apparel Sourcing Paris, which runs from 2-4 February 2026.',
  categories: [] as string[],
  publishedAt: '2026-01-26T09:00:00Z',
};

describe('event preview detection', () => {
  it('detects the Texworld guide and its event end date', () => {
    expect(isEventPreview(texworld)).toBe(true);
    expect(new Date(eventDateMs(texworld)!).toISOString().slice(0, 10)).toBe('2026-02-04');
    expect(isPastEventPreview(texworld, NOW)).toBe(true);
  });

  it('detects the Trade Shows category and preview wording beside an event word', () => {
    expect(isEventPreview({ title: 'Inside the halls', categories: ['Trade Shows'] })).toBe(true);
    expect(isEventPreview({ title: 'ISPO Munich preview: what to expect at the show', categories: [] })).toBe(true);
    expect(isEventPreview({ title: 'Brands gather ahead of the Pitti Uomo fair', categories: [] })).toBe(true);
  });

  it('leaves ordinary news alone', () => {
    expect(isEventPreview({ title: 'Nike shares rise ahead of results', description: 'Analysts expect strong sales.', categories: [] })).toBe(false);
    expect(isEventPreview({ title: 'What to expect from the EU packaging rules', categories: [] })).toBe(false);
    expect(isEventPreview({ title: 'Earnings preview: Adidas margins in focus', categories: [] })).toBe(false);
  });

  it('keeps previews whose event is upcoming or within 30 days', () => {
    expect(isPastEventPreview({ ...texworld, publishedAt: '2026-11-20T00:00:00Z', description: 'The show runs 10-12 December 2026.' }, NOW)).toBe(false);
    expect(isPastEventPreview({ ...texworld, description: 'The show ran 2-4 November 2026.' }, NOW)).toBe(false);
    // An older publication date does not matter while the event itself is ahead.
    expect(isPastEventPreview({ ...texworld, publishedAt: '2026-08-01T00:00:00Z', description: 'Held on December 3, 2026.' }, NOW)).toBe(false);
  });

  it('falls back to the publication date, and keeps an undated preview without an event date', () => {
    const noDate = { title: 'Trade show guide', description: 'An event guide for visitors.', categories: [] };
    expect(isPastEventPreview({ ...noDate, publishedAt: '2026-10-01T00:00:00Z' }, NOW)).toBe(true);
    expect(isPastEventPreview({ ...noDate, publishedAt: '2026-11-10T00:00:00Z' }, NOW)).toBe(false);
    expect(isPastEventPreview(noDate, NOW)).toBe(false);
  });

  it('uses the month end when only a month is given', () => {
    expect(new Date(eventDateMs({ title: 'Event guide: Munich, November 2026' })!).toISOString().slice(0, 10)).toBe('2026-11-30');
  });
});

describe('past event previews in reports', () => {
  const items = [
    ...RECENCY_FIXTURE_STORIES.map(([section, title, description, ageDays], i) => ({ section, title, description, publishedAt: new Date(Date.now() - ageDays * DAY_MS), id: `17000${i}` })),
    { section: 'trade-shows', title: 'Texworld Apparel Sourcing Paris: Event guide for sourcing and procurement teams', description: 'Suppliers and sourcing teams meet at Texworld Apparel Sourcing Paris, 2-4 February 2026, to review supplier contracts and procurement.', publishedAt: new Date('2026-01-26T09:00:00Z'), id: '1799901' },
  ];
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items.map((item) => `<item><title>${item.title}</title><link>https://www.sgieurope.com/${item.section}/s/${item.id}.article</link><guid>https://www.sgieurope.com/${item.section}/s/${item.id}.article</guid><description>${item.description}</description><pubDate>${item.publishedAt.toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;

  it('leaves a past event guide out of the main briefing, logs IDs only, and still finds it in focused reading', async () => {
    if (Date.now() - Date.parse('2026-02-04T00:00:00Z') <= 30 * DAY_MS) return;
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
    expect(report.recommendations.some((item) => item.article.title.startsWith('Texworld'))).toBe(false);
    const logged = events.find((event) => event.message === 'past_event_excluded');
    expect(logged?.fields).toMatchObject({ excludedCount: 1 });
    expect(String(logged?.fields.articleIds)).not.toMatch(/Texworld|guide/i);
    const themes = report.professionalProfile.themes ?? report.professionalProfile.professionalInterests;
    const found: string[] = [];
    for (const theme of themes) {
      const result = await app.handle(new Request(`https://discovery.ldsystems.uk/api/reports/${reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=sgi-europe`, { method: 'POST' }));
      expect(result.status).toBe(200);
      if (JSON.stringify(await result.json()).includes('Texworld Apparel Sourcing Paris')) found.push(theme);
    }
    expect(found.length).toBeGreaterThan(0);
    // The hosted stories section labels the order honestly (relevance and recency, not match % alone).
    const html = storiesSectionMarkup(report.recommendations.map((recommendation) => ({ recommendation })), { publisherName: 'SGI Europe', link: () => '' }, 'Stories');
    expect(html).toContain('Most relevant and recent first');
    expect(html).not.toContain('Strongest match first');
  });
});
