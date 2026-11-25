import { describe, expect, it } from 'vitest';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';
import { displayStories } from '../src/hosted-cards';
import type { ReportRecommendation } from '../src/reports';
import { articleAgeDays, orderByRecency, preferRecentLead, recencyOrderWeight } from '../src/reports/recency';
import { RECENCY_FIXTURE_STORIES } from './recency-fixtures';

const DAY_MS = 86_400_000;
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${RECENCY_FIXTURE_STORIES.map(([section, title, description, ageDays], i) => `<item><title>${title}</title><link>https://www.sgieurope.com/${section}/s-${i}/17000${i}.article</link><guid>https://www.sgieurope.com/${section}/s-${i}/17000${i}.article</guid><description>${description}</description><pubDate>${new Date(Date.now() - ageDays * DAY_MS).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const contexts: Record<string, [string, string, string[]]> = { 'decathlon.com': ['Decathlon', 'sporting goods retail', ['retail', 'sporting goods']], 'nike.com': ['Nike', 'sporting goods', ['footwear', 'apparel']] };

export async function generateDated(domain: string, jobTitle: string) {
  const app = createProductionApp({
    environment: 'test',
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async () => new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
    companyContextProvider: { getContext: async (d: string) => ({ domain: d, canonicalUrl: `https://${d}/`, name: contexts[d][0], industry: contexts[d][1], topics: contexts[d][2], entities: [contexts[d][0]], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: () => undefined, error: () => undefined },
  });
  const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: domain, jobTitle }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  const report = (await app.reportStore.get(reportId, 'sgi-europe'))!;
  return report.recommendations.map((item) => ({ title: item.article.title, ageDays: Math.round((Date.now() - Date.parse(item.article.publishedAt!)) / DAY_MS) }));
}

describe('report recency (dated SGI fixture)', () => {
  it('prints story ages for three profiles', async () => {
    const rows: string[] = [];
    for (const [domain, title] of [['decathlon.com', 'CEO'], ['nike.com', 'Head of Retail'], ['nike.com', 'Head of Procurement']] as const) {
      const stories = await generateDated(domain, title);
      rows.push(`## ${title} @ ${domain}`, ...stories.map((story, index) => `${index + 1}. [${story.ageDays}d] ${story.title}`));
    }
    if (process.env.RECENCY_OUT) (await import('node:fs')).writeFileSync(process.env.RECENCY_OUT, `${rows.join('\n')}\n`);
  });
});

describe('recency order weight and lead preference', () => {
  const item = (ageDays: number | undefined, finalScore: number, relevanceType: 'direct' | 'adjacent' = 'direct') => ({ article: { publishedAt: ageDays === undefined ? undefined : new Date(Date.now() - ageDays * DAY_MS).toISOString() }, finalScore, relevanceType, ageDays });

  it('keeps the last six months at full weight and clearly down-weights stories older than 12 months', () => {
    expect(recencyOrderWeight(10)).toBe(1);
    expect(recencyOrderWeight(183)).toBe(1);
    expect(recencyOrderWeight(365)).toBeCloseTo(0.9, 5);
    expect(recencyOrderWeight(395)).toBeCloseTo(0.75, 5);
    expect(recencyOrderWeight(2_000)).toBe(0.6);
    expect(recencyOrderWeight(undefined)).toBe(0.9);
    expect(articleAgeDays({ publishedAt: 'not a date' })).toBeUndefined();
  });

  it('reorders without removing anything, direct stories still before adjacent ones', () => {
    const items = [item(500, 60), item(20, 52), item(700, 40, 'adjacent'), item(10, 30, 'adjacent'), item(undefined, 45)];
    const ordered = orderByRecency(items);
    expect(ordered).toHaveLength(items.length);
    expect(ordered.map((entry) => entry.ageDays)).toEqual([20, 500, undefined, 10, 700]);
  });

  it('a recent story leads when it is within 10 points of an older first story, else the order stays', () => {
    expect(preferRecentLead([item(400, 70), item(200, 69), item(30, 62)]).map((entry) => entry.ageDays)).toEqual([30, 400, 200]);
    expect(preferRecentLead([item(400, 70), item(30, 59)]).map((entry) => entry.ageDays)).toEqual([400, 30]);
    expect(preferRecentLead([item(400, 70), item(30, 69, 'adjacent')]).map((entry) => entry.ageDays)).toEqual([400, 30]);
    expect(preferRecentLead([item(100, 50), item(10, 60)]).map((entry) => entry.ageDays)).toEqual([100, 10]);
  });

  it('report: the Head of Procurement lead is recent and the 900-day story is still shown', async () => {
    const stories = await generateDated('nike.com', 'Head of Procurement');
    expect(stories[0].ageDays).toBeLessThanOrEqual(183);
    expect(stories.map((story) => story.title)).toContain('Nike cuts supplier base as sourcing shifts to Vietnam');
    expect(stories).toHaveLength(4);
  });
});

describe('hosted display order follows the same recency rules', () => {
  const rec = (id: string, displayScore: number, ageDays: number) => ({ articleId: id, displayScore, article: { id, publishedAt: new Date(Date.now() - ageDays * DAY_MS).toISOString() } }) as unknown as ReportRecommendation;
  it('an older top match no longer leads the page when a comparable recent story exists', () => {
    const ids = displayStories([{ recommendations: [rec('old-80', 80, 430), rec('new-74', 74, 40), rec('new-60', 60, 10)] }]).map((story) => story.recommendation.articleId);
    expect(ids).toEqual(['new-74', 'new-60', 'old-80']);
    // Within 6 months nothing changes: highest match first.
    expect(displayStories([{ recommendations: [rec('a', 70, 150), rec('b', 80, 20)] }]).map((story) => story.recommendation.articleId)).toEqual(['b', 'a']);
  });
});
