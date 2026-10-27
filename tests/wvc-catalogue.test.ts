import { describe, expect, it } from 'vitest';
import { createContentAdapter, firstSentences, parseWvcPage, wvcCatalogueConfigErrors, wvcCatalogueFetchConfig, wvcCatalogueParseOptions, type WvcCatalogueSourceConfig } from '../src/publishers/content';
import { MemoryArticleTextStore, PostgresArticleTextStore } from '../src/reports/article-texts';
import { TextEnrichmentSync } from '../src/reports/text-enrichment';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeEnrichmentSource, sgiEuropeManifest } from '../src/publishers/sgi-europe';
import type { PublisherManifest } from '../src/publishers/manifest';

const KEY = 'wvc-catalogue-test-key';
const BODY_MARKER = 'confidential-third-sentence-marker';
export const acmeSource: WvcCatalogueSourceConfig = { type: 'wvc', baseUrl: 'https://news.acme.example/abaapi/storylistpagination/json', profileName: 'Editorial Finder', pageSize: 50, secretRef: 'env:ACME_WVC_API_KEY', allowedHostnames: ['news.acme.example'], imageHostnames: ['news.acme.example', 'img.acme.example'] };

export function story(code: number, overrides: Record<string, unknown> = {}) {
  return {
    STORYCODE: String(code),
    STORYURL: `https://news.acme.example/retail/store-openings/${code}.article`,
    HEADLINE: `Acme &amp; Partners open ${code} stores`,
    DATEPUBLISHED: '2026-10-0' + ((code % 9) + 1) + 'T09:00:00Z',
    LASTMODIFIED: '2026-10-10T09:00:00Z',
    PRIVATE: code % 2 ? 'true' : 'false',
    STORYTEXT: `<p><img src="https://img.acme.example/photos/${code}.jpg" alt=""></p><p>Acme opened ${code} stores in Europe this quarter. Its omnichannel retail sales rose 4%.</p><p>${BODY_MARKER} about margins and suppliers.</p>`,
    ...overrides,
  };
}

export function page(stories: unknown[], totalPages = 1) {
  return { ErrorsFound: false, Messages: [], PagedData: { TotalNumberOfPages: totalPages, TotalNumberOfRecords: stories.length, Data: stories } };
}

describe('WVC catalogue parsing', () => {
  const options = wvcCatalogueParseOptions(acmeSource);

  it('takes title, URL, date, a 1-2 sentence description and an allowed image from each story', () => {
    const [parsed] = parseWvcPage(page([story(12)]), 1, options).stories;
    expect(parsed.catalogue).toEqual({ title: 'Acme & Partners open 12 stores', url: 'https://news.acme.example/retail/store-openings/12.article', publishedAt: '2026-10-04T09:00:00.000Z', description: 'Acme opened 12 stores in Europe this quarter. Its omnichannel retail sales rose 4%.', imageUrl: 'https://img.acme.example/photos/12.jpg' });
    expect(parsed.catalogue!.description).not.toContain(BODY_MARKER);
  });

  it('keeps no image unless it is the first img, absolute, https and on an allowed host', () => {
    const image = (html: string) => parseWvcPage(page([story(3, { STORYTEXT: `${html}<p>Body text here.</p>` })]), 1, options).stories[0].catalogue?.imageUrl;
    expect(image('<img src="http://img.acme.example/a.jpg">')).toBeUndefined();
    expect(image('<img src="/photos/a.jpg">')).toBeUndefined();
    expect(image('<img src="https://tracker.example/a.jpg">')).toBeUndefined();
    expect(image("<img alt='x' src='https://news.acme.example/a.jpg?w=600&amp;h=400'>")).toBe('https://news.acme.example/a.jpg?w=600&h=400');
    expect(image('<p>No picture.</p>')).toBeUndefined();
  });

  it('rejects story URLs on other hosts and tries the configured title fields in order', () => {
    const [foreign] = parseWvcPage(page([story(4, { STORYURL: 'https://evil.example/x/4.article' })]), 1, options).stories;
    expect(foreign.catalogue?.url).toBeUndefined();
    const [titled] = parseWvcPage(page([story(5, { HEADLINE: undefined, STORYTITLE: '<b>Fallback</b> headline' })]), 1, options).stories;
    expect(titled.catalogue?.title).toBe('Fallback headline');
    const [custom] = parseWvcPage(page([story(6, { HEADLINE: 'Ignored', SHORTHEADLINE: 'Custom field' })]), 1, wvcCatalogueParseOptions({ ...acmeSource, titleFields: ['SHORTHEADLINE'] })).stories;
    expect(custom.catalogue?.title).toBe('Custom field');
  });

  it('cuts a long first sentence at a word with an ellipsis and keeps short pairs', () => {
    expect(firstSentences('One. Two. Three.')).toBe('One. Two.');
    const long = firstSentences(`${'word '.repeat(90)}end.`)!;
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith('…')).toBe(true);
  });

  it('parses no catalogue fields for enrichment-only publishers (SGI)', () => {
    const [parsed] = parseWvcPage(page([story(7)]), 1).stories;
    expect(parsed).not.toHaveProperty('catalogue');
  });
});

describe('WVC catalogue configuration', () => {
  it('only accepts a dedicated *_WVC_API_KEY secret, https and an allowed API host', () => {
    expect(wvcCatalogueConfigErrors(acmeSource)).toEqual([]);
    expect(wvcCatalogueConfigErrors({ ...acmeSource, secretRef: 'env:DATABASE_URL' })).toContain('wvc_secret_ref_invalid');
    expect(wvcCatalogueConfigErrors({ ...acmeSource, secretRef: 'env:AI_API_KEY' })).toContain('wvc_secret_ref_invalid');
    expect(wvcCatalogueConfigErrors({ ...acmeSource, baseUrl: 'https://attacker.example/api' })).toContain('wvc_base_url_not_allowed');
    expect(wvcCatalogueConfigErrors({ ...acmeSource, baseUrl: 'http://news.acme.example/api' })).toContain('wvc_base_url_not_allowed');
    expect(wvcCatalogueConfigErrors({ ...acmeSource, pageSize: 20 })).toContain('wvc_page_size_too_small');
    expect(wvcCatalogueFetchConfig(acmeSource)).toMatchObject({ dataConstraint: 4, secretRef: 'env:ACME_WVC_API_KEY' });
  });

  it('refuses to store a manifest with an unsafe WVC source', async () => {
    const store = new MemoryPublisherStore();
    const manifest = { ...sgiEuropeManifest, publisherId: 'acme', contentSource: { ...acmeSource, secretRef: 'env:DATABASE_URL' } } as PublisherManifest;
    await expect(store.create(manifest)).rejects.toThrow(/wvc_secret_ref_invalid/);
  });
});

describe('WVC catalogue store', () => {
  it('lists only rows with a title and URL, and never returns the text', async () => {
    const store = new MemoryArticleTextStore();
    const stories = parseWvcPage(page([story(11), story(12, { HEADLINE: undefined }), story(13)]), 1, wvcCatalogueParseOptions(acmeSource)).stories;
    expect(await store.upsertCatalogue('acme', stories, '2026-10-20T00:00:00Z')).toEqual(['11', '12', '13']);
    const rows = await store.cataloguePage('acme', '', 10);
    expect(rows.map((row) => row.storyCode)).toEqual(['11', '13']);
    expect(JSON.stringify(rows)).not.toContain(BODY_MARKER);
    expect((await store.leads('acme', ['12'], 2000))[0].lead).toContain(BODY_MARKER);
  });

  it('keeps the enrichment upsert SQL unchanged and reads catalogue fields without the text column', async () => {
    const sql: string[] = [];
    const store = new PostgresArticleTextStore({ query: async (text: string) => { sql.push(text); return { rows: [] }; } });
    const stories = parseWvcPage(page([story(21)]), 1, wvcCatalogueParseOptions(acmeSource)).stories;
    await store.upsert('sgi-europe', stories, '2026-10-20T00:00:00Z');
    await store.upsertCatalogue('acme', stories, '2026-10-20T00:00:00Z');
    await store.cataloguePage('acme', '', 10);
    expect(sql[0]).not.toMatch(/title|image_url|description/);
    expect(sql[1]).toMatch(/title, url, published_at, description, image_url/);
    expect(sql[2]).not.toMatch(/plain_text/);
  });
});

describe('WVC catalogue adapter', () => {
  async function seeded() {
    const store = new MemoryArticleTextStore();
    await store.upsertCatalogue('acme', parseWvcPage(page([story(31), story(32, { STORYTEXT: '<p>No image here. Second sentence.</p>' })]), 1, wvcCatalogueParseOptions(acmeSource)).stories, '2026-10-20T00:00:00Z');
    return store;
  }

  it('builds the catalogue from stored rows with the URL-section category and the story image', async () => {
    const store = await seeded();
    const adapter = createContentAdapter('acme', acmeSource, { wvcCatalogueStore: store, fetchImpl: async () => { throw new Error('no network in API-only mode'); } });
    const articles = (await adapter.loadCatalogue!()).map((record) => adapter.normalizeArticle(record)!);
    expect(articles.map((article) => [article.title, article.categories, article.imageUrl])).toEqual([
      ['Acme & Partners open 31 stores', ['Retail'], 'https://img.acme.example/photos/31.jpg'],
      ['Acme & Partners open 32 stores', ['Retail'], undefined],
    ]);
    expect(articles[1].description).toBe('No image here. Second sentence.');
  });

  it('WVC API + RSS: the feed supplies images and categories for the stories it carries', async () => {
    const store = await seeded();
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Feed title</title><link>https://news.acme.example/retail/store-openings/32.article</link><description>Feed teaser.</description><category>Retail</category><enclosure url="https://img.acme.example/feed/32.jpg" type="image/jpeg"/></item></channel></rss>`;
    const adapter = createContentAdapter('acme', { ...acmeSource, rss: { feedUrl: 'https://news.acme.example/feed.rss' } }, { wvcCatalogueStore: store, fetchImpl: async () => new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }) });
    const articles = (await adapter.loadCatalogue!()).map((record) => adapter.normalizeArticle(record)!);
    const second = articles.find((article) => article.url.endsWith('/32.article'))!;
    expect(second.title).toBe('Acme & Partners open 32 stores');
    expect(second.imageUrl).toBe('https://img.acme.example/feed/32.jpg');
    expect(second.categories).toContain('Retail');
    expect(second.description).toBe('No image here. Second sentence.');
  });

  it('reports an empty catalogue before the first sync', async () => {
    const adapter = createContentAdapter('acme', acmeSource, { wvcCatalogueStore: new MemoryArticleTextStore() });
    await expect(adapter.loadCatalogue!()).rejects.toThrow(/no synced stories/);
  });
});

describe('WVC catalogue sync', () => {
  it('writes catalogue rows for a WVC catalogue source and plain text rows for SGI', async () => {
    const calls: string[] = [];
    const store = new MemoryArticleTextStore();
    const spy = Object.assign(store, {
      upsert: ((original) => async (...args: Parameters<MemoryArticleTextStore['upsert']>) => { calls.push(`upsert:${args[0]}`); return original(...args); })(store.upsert.bind(store)),
    });
    const fetchImpl = (async () => Response.json(page([story(41)]))) as typeof fetch;
    const common = { store: spy, fetchImpl, runExclusive: <T,>(job: () => Promise<T>) => job(), sleep: async () => undefined };
    await new TextEnrichmentSync({ ...common, publisherId: 'acme', source: wvcCatalogueFetchConfig(acmeSource), catalogue: wvcCatalogueParseOptions(acmeSource), resolveSecret: (reference) => (reference === 'env:ACME_WVC_API_KEY' ? KEY : undefined) }).runCycle();
    await new TextEnrichmentSync({ ...common, publisherId: 'sgi-europe', source: sgiEuropeEnrichmentSource, resolveSecret: (reference) => (reference === 'env:SGI_WVC_API_KEY' ? KEY : undefined) }).runCycle();
    expect((await store.cataloguePage('acme', '', 10)).map((row) => row.storyCode)).toEqual(['41']);
    // SGI: plain text only, through the unchanged upsert (the catalogue upsert also routes through it in memory).
    expect(await store.cataloguePage('sgi-europe', '', 10)).toEqual([]);
    expect(calls).toContain('upsert:sgi-europe');
  });
});

describe('report from a WVC-only publisher', () => {
  it('ranks stored API rows and never exposes body text beyond the 1-2 sentence description', async () => {
    const { MemoryCatalogueSnapshotStore } = await import('../src/reports/catalogue-snapshot');
    const articleTextStore = new MemoryArticleTextStore();
    const stories = [51, 52, 53, 54].map((code) => story(code));
    await articleTextStore.upsertCatalogue('acme', parseWvcPage(page(stories), 1, wvcCatalogueParseOptions(acmeSource)).stories, '2026-10-20T00:00:00Z');
    const saved: string[] = [];
    const snapshots = new MemoryCatalogueSnapshotStore();
    const save = snapshots.save.bind(snapshots);
    snapshots.save = async (snapshot) => { saved.push(JSON.stringify(snapshot)); return save(snapshot); };
    const manifest = { ...sgiEuropeManifest, publisherId: 'acme', name: 'Acme News', domain: 'the sporting goods industry', contentSource: acmeSource, allowedOrigins: ['https://news.acme.example'], features: { aiEnabled: false, explanationsEnabled: true, analyticsEnabled: false } } as PublisherManifest;
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ACME_WVC_API_KEY: KEY },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest, manifest]),
      articleTextStore,
      catalogueSnapshotStore: snapshots,
      fetchImpl: async () => { throw new Error('API-only: nothing is downloaded at report time'); },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'acme', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
    expect(response.status).toBe(201);
    const { reportId } = await response.json() as { reportId: string };
    const publicReport = await (await app.handle(new Request(`https://discovery.ldsystems.uk/api/reports/${reportId}?publisherId=acme`))).text();
    const report = JSON.parse(publicReport) as { recommendations: Array<{ article: { title: string; description?: string; imageUrl?: string; categories: string[] }; subscriberOnly?: boolean }> };
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations[0].article).toMatchObject({ title: expect.stringMatching(/^Acme & Partners open 5\d stores$/), description: expect.stringMatching(/stores in Europe this quarter\. Its omnichannel retail sales rose 4%\.$/), imageUrl: expect.stringMatching(/^https:\/\/img\.acme\.example\/photos\/5\d\.jpg$/), categories: ['Retail'] });
    expect(publicReport).not.toContain(BODY_MARKER);
    await app.catalogueIdle();
    expect(saved.length).toBeGreaterThan(0);
    for (const snapshot of saved) { expect(snapshot).toContain('Acme & Partners open 51 stores'); expect(snapshot).not.toContain(BODY_MARKER); }
    expect(await app.ensureCatalogueSyncs()).toEqual(['acme']);
    app.stopTextEnrichment();
  });
});
