import { describe, expect, it } from 'vitest';
import { RecommendationService, DeterministicExplanationProvider, type Intent } from '../src/core';
import { manifestToPublisherConfig } from '../src/publishers/manifest';
import { CsvContentAdapter, FeedContentAdapter, RestJsonContentAdapter, SitemapContentAdapter, StaticJsonContentAdapter, assertSafePublicUrl, ContentSourceError, deduplicateArticles, fetchText, normalizeMappedArticle, stableArticleId } from '../src/publishers/content';
import { demoManifest } from '../src/demo/config';

const intent: Intent = { publisherId: 'fixture-publisher', answers: {}, queryText: 'energy engineering', keywords: ['energy', 'engineering'], interests: [], personas: [] };
const response = (body: string, status = 200, headers?: Record<string, string>) => new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('canonical publisher content model', () => {
  it('sanitizes untrusted fields, normalizes tracking URLs and derives stable IDs', () => {
    const article = normalizeMappedArticle({ title: '<b>Useful</b> story<script>alert(1)</script>', url: 'https://news.example.test/story/?utm_source=test&edition=uk', description: '<p>Readable <em>summary</em></p>', tags: 'energy, climate', publishedAt: '2026-10-01' }, { publisherId: 'fixture-publisher', sourceType: 'json', sourceUrl: 'static:fixture-publisher' });
    expect(article).toMatchObject({ title: 'Useful story', url: 'https://news.example.test/story?edition=uk', tags: ['energy', 'climate'], publisherId: 'fixture-publisher' });
    expect(article?.id).toMatch(/^url-/);
    expect(article?.provenance).toMatchObject({ sourceType: 'json', sourceUrl: 'static:fixture-publisher', normalizerVersion: '1.0' });
    expect(article?.searchText).toContain('Readable summary');
    expect(stableArticleId({ canonicalUrl: 'https://news.example.test/story' })).toBe(stableArticleId({ canonicalUrl: 'https://news.example.test/story' }));
  });

  it('deduplicates tracking, protocol and repeated source records without crossing publishers', () => {
    const first = normalizeMappedArticle({ id: 'a-1', title: 'A story', url: 'https://news.example.test/story?utm_campaign=x', publishedAt: '2026-10-01' }, { publisherId: 'one', sourceType: 'rss', sourceUrl: 'https://news.example.test/feed' })!;
    const duplicate = { ...first, url: 'http://news.example.test/story/', canonicalUrl: 'http://news.example.test/story/' };
    const otherPublisher = { ...first, publisherId: 'two' };
    const result = deduplicateArticles([first, duplicate, otherPublisher]);
    expect(result.duplicates).toBe(1);
    expect(result.articles).toHaveLength(2);
  });
});

describe('REST and import adapters', () => {
  it('maps fields, paginates with a bounded page count and never exposes server secret material', async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const adapter = new RestJsonContentAdapter('fixture-publisher', { type: 'rest-json', baseUrl: 'https://api.example.test', endpoint: '/stories', responsePath: 'data.items', searchQueryParameter: 'query', mappings: { id: 'article_id', title: 'headline', url: 'web' }, pagination: { style: 'page', pageParameter: 'page', limitParameter: 'size', pageSize: 2, maxPages: 2 }, authentication: { mode: 'bearer', secretRef: 'FIXTURE_TOKEN' }, candidateLimit: 4 }, async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      const page = new URL(String(input)).searchParams.get('page');
      return response(JSON.stringify({ data: { items: page === '2' ? [{ article_id: 'r-3', headline: 'Third story', web: 'https://publisher.example.test/three' }] : [{ article_id: 'r-1', headline: 'First story', web: 'https://publisher.example.test/one' }, { article_id: 'r-2', headline: 'Second story', web: 'https://publisher.example.test/two' }] } }));
    }, (reference) => reference === 'FIXTURE_TOKEN' ? 'server-secret' : undefined);
    const events: string[] = [];
    const articles = await adapter.search(intent, { limit: 3, onDebug: (event) => events.push(event.type) });
    expect(articles).toHaveLength(3);
    expect(adapter.normalizeArticle(articles[0])).toMatchObject({ id: 'r-1', title: 'First story' });
    expect(requests).toHaveLength(2);
    expect(events).toContain('content_source');
    expect(requests[0].headers.get('Authorization')).toBe('Bearer server-secret');
    expect(JSON.stringify(adapter.lastDiagnostics)).not.toContain('server-secret');
  });

  it('imports wrapped JSON and CSV rows independently', async () => {
    const json = new StaticJsonContentAdapter('json-publisher', { type: 'json' }, async () => ({ articles: [{ id: 'j-1', title: 'JSON story', url: 'https://publisher.example.test/json' }, { title: 'invalid' }] }));
    const jsonRows = await json.search(intent, { limit: 10 });
    expect(jsonRows).toHaveLength(1);
    expect(json.lastDiagnostics).toMatchObject({ accepted: 1, rejected: 1 });
    const csv = new CsvContentAdapter('csv-publisher', { type: 'csv', mappings: { imageUrl: 'image' } }, async () => '\uFEFFid,title,url,image,publishedAt\n1,"Story, with comma",https://publisher.example.test/csv,https://publisher.example.test/image.jpg,not-a-date\n2,Missing URL,,,');
    const csvRows = await csv.search(intent, { limit: 10 });
    expect(csvRows).toHaveLength(1);
    expect(csv.normalizeArticle(csvRows[0])).toMatchObject({ title: 'Story, with comma', imageUrl: 'https://publisher.example.test/image.jpg' });
    expect(csv.lastDiagnostics?.rejected).toBe(1);
    expect(csv.lastDiagnostics?.warnings).toBe(1);
  });

  it('feeds the existing recommendation service through the same canonical article contract', async () => {
    const adapter = new StaticJsonContentAdapter('fixture-publisher', { type: 'json', sourceName: 'local integration fixture' }, async () => [{ id: 'story-1', title: 'Energy systems for software teams', url: 'https://publisher.example.test/story-1', categories: ['Technology'], tags: ['energy'], description: 'Energy engineering and software systems.' }]);
    const definition = { config: manifestToPublisherConfig({ ...demoManifest, publisherId: 'fixture-publisher', name: 'Fixture Publisher', publisherConfigVersion: 'test', content: { ...demoManifest.content, adapterId: 'json', resultLimit: 1, candidateRetrievalLimit: 1 } }), adapter, explanationProvider: new DeterministicExplanationProvider() };
    const result = await new RecommendationService(definition).recommendIntent({ ...intent, publisherId: 'fixture-publisher' });
    expect(result.results[0].article.id).toBe('story-1');
    expect(result.results[0].article.sourceType).toBe('json');
  });
});

describe('RSS, Atom and sitemap adapters', () => {
  it('normalizes RSS and Atom entries including encoded content and media', async () => {
    const rss = new FeedContentAdapter('rss-publisher', { type: 'rss', feedUrl: 'https://publisher.example.test/feed.xml' }, async () => new Response('<rss><channel><item><guid>rss-1</guid><title>RSS story</title><link>https://publisher.example.test/rss</link><description><![CDATA[<p>RSS summary</p>]]></description><content:encoded><![CDATA[<p>RSS body</p>]]></content:encoded><category>Energy</category><enclosure url="https://publisher.example.test/rss.jpg" type="image/jpeg" /></item></channel></rss>', { status: 200 }));
    const rssRows = await rss.search(intent, { limit: 10 });
    expect(rss.normalizeArticle(rssRows[0])).toMatchObject({ id: 'rss-1', title: 'RSS story', imageUrl: 'https://publisher.example.test/rss.jpg', categories: ['Energy'] });
    const atom = new FeedContentAdapter('atom-publisher', { type: 'atom', feedUrl: 'https://publisher.example.test/feed.atom' }, async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:publisher.example.test,2026:atom-1</id><title>Atom story</title><link href="https://publisher.example.test/atom" /><summary>Atom summary</summary><author><name>Author</name></author><published>2026-10-01T00:00:00Z</published></entry></feed>', { status: 200 }));
    const atomRows = await atom.search(intent, { limit: 10 });
    expect(atom.normalizeArticle(atomRows[0])).toMatchObject({ id: 'tag:publisher.example.test,2026:atom-1', title: 'Atom story', author: 'Author' });
  });

  it('records source fetch and body-read timing separately', async () => {
    const adapter = new FeedContentAdapter('timed-rss', { type: 'rss', feedUrl: 'https://publisher.example.test/feed.xml' }, async () => new Response('<rss><channel><item><guid>timed-1</guid><title>Timed story</title><link>https://publisher.example.test/timed</link></item></channel></rss>', { status: 200 }));
    await adapter.loadCatalogue();
    expect(adapter.sourceTimings?.sourceFetchMs).toEqual(expect.any(Number));
    expect(adapter.sourceTimings?.sourceReadMs).toEqual(expect.any(Number));
    expect(adapter.sourceTimings?.sourceParseMs).toEqual(expect.any(Number));
  });

  it('keeps content health as a real upstream check rather than a catalogue-cache read', async () => {
    let fetches = 0;
    const adapter = new FeedContentAdapter('health-rss', { type: 'rss', feedUrl: 'https://publisher.example.test/feed.xml' }, async () => {
      fetches += 1;
      return new Response('<rss><channel><item><guid>health-1</guid><title>Health story</title><link>https://publisher.example.test/health</link></item></channel></rss>', { status: 200 });
    });
    await adapter.loadCatalogue();
    const health = await adapter.healthCheck();
    expect(health.reachable).toBe(true);
    expect(fetches).toBe(2);
  });

  it('discovers bounded sitemap pages and extracts JSON-LD/OpenGraph metadata', async () => {
    const adapter = new SitemapContentAdapter('sitemap-publisher', { type: 'sitemap', sitemapUrl: 'https://publisher.example.test/sitemap.xml', maxUrls: 2 }, async (input) => {
      if (String(input).endsWith('sitemap.xml')) return new Response('<urlset><url><loc>https://publisher.example.test/story</loc></url></urlset>', { status: 200 });
      return new Response('<html><head><meta property="og:image" content="https://publisher.example.test/story.jpg" /><script type="application/ld+json">{"@type":"NewsArticle","headline":"Sitemap story","datePublished":"2026-10-01","author":{"name":"Sitemap author"},"articleBody":"Useful body"}</script></head><body>Page body</body></html>', { status: 200 });
    });
    const rows = await adapter.search(intent, { limit: 2 });
    expect(adapter.normalizeArticle(rows[0])).toMatchObject({ title: 'Sitemap story', imageUrl: 'https://publisher.example.test/story.jpg', author: 'Sitemap author', sourceType: 'sitemap' });
  });

  it('follows a bounded sitemap index without crawling arbitrary URLs', async () => {
    const adapter = new SitemapContentAdapter('indexed-publisher', { type: 'sitemap', sitemapUrl: 'https://publisher.example.test/index.xml', maxSitemaps: 2, maxUrls: 1 }, async (input) => {
      if (String(input).endsWith('index.xml')) return new Response('<sitemapindex><sitemap><loc>https://publisher.example.test/child.xml</loc></sitemap></sitemapindex>', { status: 200 });
      if (String(input).endsWith('child.xml')) return new Response('<urlset><url><loc>https://publisher.example.test/indexed-story</loc></url></urlset>', { status: 200 });
      return new Response('<html><head><title>Indexed story</title></head><body>Indexed body</body></html>', { status: 200 });
    });
    const rows = await adapter.search(intent, { limit: 1 });
    expect(adapter.normalizeArticle(rows[0])?.title).toBe('Indexed story');
  });

  it('selects recently modified sitemap articles before applying the URL bound', async () => {
    const adapter = new SitemapContentAdapter('dated-publisher', { type: 'sitemap', sitemapUrl: 'https://publisher.example.test/index.xml', maxSitemaps: 2, maxUrls: 1 }, async (input) => {
      if (String(input).endsWith('index.xml')) return new Response('<sitemapindex><sitemap><loc>https://publisher.example.test/articles.xml</loc></sitemap></sitemapindex>', { status: 200 });
      if (String(input).endsWith('articles.xml')) return new Response('<urlset><url><loc>https://publisher.example.test/old</loc><lastmod>2026-01-02T00:00:00Z</lastmod></url><url><loc>https://publisher.example.test/current</loc><lastmod>2026-10-13T00:00:00Z</lastmod></url></urlset>', { status: 200 });
      return new Response('<html><head><title>Current story</title><link rel="canonical" href="https://publisher.example.test/current" /></head><body>Current body</body></html>', { status: 200 });
    });
    const rows = await adapter.search(intent, { limit: 1 });
    expect(adapter.normalizeArticle(rows[0])).toMatchObject({ title: 'Current story', url: 'https://publisher.example.test/current' });
  });

  it('prioritizes the newest year child sitemap within the sitemap bound', async () => {
    const adapter = new SitemapContentAdapter('dated-publisher', { type: 'sitemap', sitemapUrl: 'https://publisher.example.test/index.xml', maxSitemaps: 2, maxUrls: 1 }, async (input) => {
      const url = String(input);
      if (url.endsWith('index.xml')) return new Response('<sitemapindex><sitemap><loc>https://publisher.example.test/googlesitemap.aspx</loc></sitemap><sitemap><loc>https://publisher.example.test/googlesitemap.aspx?year=2026</loc></sitemap></sitemapindex>', { status: 200 });
      if (url.includes('year=2026')) return new Response('<urlset><url><loc>https://publisher.example.test/current.article</loc><lastmod>2026-10-13</lastmod></url></urlset>', { status: 200 });
      if (url.endsWith('.article')) return new Response('<html><head><title>Current story</title></head><body>Current body</body></html>', { status: 200 });
      return new Response('<urlset><url><loc>https://publisher.example.test/old.article</loc><lastmod>2025-01-01</lastmod></url></urlset>', { status: 200 });
    });
    const rows = await adapter.search(intent, { limit: 1 });
    expect(adapter.normalizeArticle(rows[0])?.url).toBe('https://publisher.example.test/current.article');
  });
});

describe('content source security and operational errors', () => {
  it('keeps the 5 MB default for RSS and rejects oversized Content-Length values before reading', async () => {
    const adapter = new FeedContentAdapter('publisher', { type: 'rss', feedUrl: 'https://publisher.example.test/feed.xml' }, async () => new Response('<rss />', { status: 200, headers: { 'Content-Length': '5000001' } }));
    await expect(adapter.search(intent, { limit: 1 })).rejects.toMatchObject({ code: 'source_response_too_large', contentLength: 5_000_001, maxBytes: 5_000_000 });
  });

  it('keeps a missing Content-Length response bounded while reading', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const fetchImpl = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 6; index += 1) controller.enqueue(chunk);
        controller.close();
      },
    }), { status: 200 });
    await expect(fetchText('https://publisher.example.test/feed.xml', {}, { maxBytes: 5_000_000, fetchImpl })).rejects.toMatchObject({ code: 'source_response_too_large', maxBytes: 5_000_000 });
  });

  it('rejects private, unsafe and redirected-private URLs', async () => {
    expect(() => assertSafePublicUrl('http://127.0.0.1/private')).toThrow('Private');
    expect(() => assertSafePublicUrl('ftp://publisher.example.test/archive')).toThrow('public HTTP(S)');
    const adapter = new FeedContentAdapter('publisher', { type: 'rss', feedUrl: 'https://publisher.example.test/feed.xml' }, async () => new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } }));
    await expect(adapter.search(intent, { limit: 1 })).rejects.toMatchObject({ code: 'unsafe-url' });
  });

  it('maps 401 and 429 without including response bodies or credentials', async () => {
    const auth = new RestJsonContentAdapter('publisher', { type: 'rest-json', baseUrl: 'https://api.example.test', endpoint: '/stories' }, async () => new Response('token=server-secret', { status: 401 }));
    await expect(auth.search(intent, { limit: 1 })).rejects.toMatchObject({ code: 'authentication-failure' });
    const limited = new RestJsonContentAdapter('publisher', { type: 'rest-json', baseUrl: 'https://api.example.test', endpoint: '/stories' }, async () => new Response('secret-body', { status: 429, headers: { 'Retry-After': '1' } }));
    await expect(limited.search(intent, { limit: 1 })).rejects.toMatchObject({ code: 'rate-limit' });
  });

  it('maps bounded source timeouts to a safe diagnostic', async () => {
    const timeout = new RestJsonContentAdapter('publisher', { type: 'rest-json', baseUrl: 'https://api.example.test', endpoint: '/stories', timeoutMs: 1 }, async (_input, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await expect(timeout.search(intent, { limit: 1 })).rejects.toMatchObject({ code: 'timeout' });
  });
});
