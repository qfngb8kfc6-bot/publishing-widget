import { describe, expect, it } from 'vitest';
import { cleanStoryText, fetchWvcPage, parseWvcDate, parseWvcPage, storyCodeFromUrl, WvcError, wvcPageUrl, type WvcEnrichmentSourceConfig } from '../src/publishers/content';
import { sgiEuropeEnrichmentSource } from '../src/publishers/sgi-europe';
import { enrichmentSourceFor } from '../src/publishers/enrichment';
import { leadExcerpt, MemoryArticleTextStore, PostgresArticleTextStore } from '../src/reports/article-texts';

const KEY = 'test-wvc-key-123';
const config: WvcEnrichmentSourceConfig = { ...sgiEuropeEnrichmentSource };
const resolveSecret = (reference: string) => (reference === 'env:SGI_WVC_API_KEY' ? KEY : undefined);

function story(code: number, overrides: Record<string, unknown> = {}) {
  return { STORYCODE: String(code), STORYURL: `https://www.sgieurope.com/retail/some-headline/${code}.article`, HEADLINE: `Story ${code}`, PRIVATE: 'true', STATUS: 'Live', LASTMODIFIED: '2026-10-01T09:30:00', DATEPUBLISHED: '2026-09-30T08:00:00', STORYTEXT: `<p>Body of <b>${code}</b> &amp; more&nbsp;text.</p>`, ...overrides };
}

function page(stories: unknown[], totalPages = 230) {
  return { ErrorsFound: false, Messages: [], PagedData: { TotalNumberOfPages: totalPages, TotalNumberOfRecords: 11_500, Next: 'https://www.sgieurope.com/next', Data: stories } };
}

/** The confirmed live shape: stories at Data.seq.STORY, paging metadata in PagedData. */
function livePage(story: unknown, totalPages = 231) {
  return { Domain: 'www.sgieurope.com', ErrorsFound: false, Messages: [], PagedData: { PageNumber: totalPages, PageSize: 50, TotalNumberOfPages: totalPages, TotalNumberOfRecords: 11_523, Next: null, Previous: 'https://www.sgieurope.com/prev', More: false }, Data: { seq: { STORY: story } } };
}

describe('WVC enrichment client', () => {
  it('reads stories from Data.seq.STORY, as an array or a single object', () => {
    const parsed = parseWvcPage(livePage([story(9775), story(9776, { PRIVATE: 'false' })]), 231);
    expect(parsed).toMatchObject({ page: 231, totalPages: 231, totalRecords: 11_523 });
    expect(parsed.stories.map((item) => [item.storyCode, item.isPrivate])).toEqual([['9775', true], ['9776', false]]);
    expect(parseWvcPage(livePage(story(9777)), 231).stories.map((item) => item.storyCode)).toEqual(['9777']);
    expect(parseWvcPage({ ...livePage(undefined), Data: { seq: {} } }, 231).stories).toEqual([]);
    // Data.seq.STORY wins over any other list in the payload.
    const decoy = { ...livePage([story(9778)]), Other: [story(1)] };
    expect(parseWvcPage(decoy, 231).stories.map((item) => item.storyCode)).toEqual(['9778']);
  });


  it('cleans HTML to capped plain text with entities decoded and whitespace collapsed', () => {
    expect(cleanStoryText('<p>Nike&rsquo;s  <script>alert(1)</script>growth</p>\n<p>rose&nbsp;12%&#8212;fast &amp; wide.</p>')).toBe('Nike’s growth rose 12%—fast & wide.');
    const long = cleanStoryText(`<p>${'word '.repeat(10_000)}</p>`);
    expect(long.length).toBeLessThanOrEqual(20_000);
    expect(long.endsWith('word')).toBe(true);
  });

  it('derives the join key from the numeric id before .article', () => {
    expect(storyCodeFromUrl('https://www.sgieurope.com/retail/nike-opens/1234567.article')).toBe('1234567');
    expect(storyCodeFromUrl('https://www.sgieurope.com/retail/nike-opens/1234567.article?utm=x')).toBe('1234567');
    expect(storyCodeFromUrl('https://www.sgieurope.com/retail/')).toBeUndefined();
    expect(parseWvcDate('/Date(1700000000000)/')).toBe(new Date(1_700_000_000_000).toISOString());
    expect(parseWvcDate('not a date')).toBeUndefined();
  });

  it('parses a page and turns HTTP-200 error payloads into safe codes without upstream text', () => {
    const parsed = parseWvcPage(page([story(11), story(12, { PRIVATE: 'false' }), story(13, { STORYTEXT: '' })]), 5);
    expect(parsed).toMatchObject({ page: 5, totalPages: 230, totalRecords: 11_500 });
    expect(parsed.stories.map((item) => [item.storyCode, item.isPrivate, item.text])).toEqual([['11', true, 'Body of 11 & more text.'], ['12', false, 'Body of 12 & more text.']]);
    try {
      parseWvcPage({ ErrorsFound: true, Messages: [`API key ${KEY} invalid`] }, 1);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(WvcError);
      expect((error as WvcError).code).toBe('wvc_auth_invalid');
      expect(String((error as Error).message)).not.toContain(KEY);
    }
    expect(() => parseWvcPage({ ErrorsFound: true, Messages: ['Something else'] }, 1)).toThrow('wvc_api_error');
    expect(() => parseWvcPage({ hello: 'world' }, 1)).toThrow('wvc_invalid_response');
  });

  it('sends the verified request: GET, underscore header, profile with %20, page size ≥ 50', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json(page([story(21)], 3));
    }) as typeof fetch;
    const result = await fetchWvcPage({ ...config, pageSize: 10 }, 3, { fetchImpl, resolveSecret });
    expect(result.stories).toHaveLength(1);
    expect(calls[0].url).toBe('https://www.sgieurope.com/abaapi/storylistpagination/json?profilename=Editorial%20Finder&pagesize=50&dataconstraint=4&pagenumber=3');
    expect(calls[0].init?.method).toBe('GET');
    expect(new Headers(calls[0].init?.headers).get('API_ACCESS_TOKEN')).toBe(KEY);
    expect(wvcPageUrl({ ...config, dataConstraint: 9 }, 1)).toContain('dataconstraint=4');
  });

  it('refuses without a key, off-allowlist hosts, private hosts and redirects', async () => {
    const fetchImpl = (async () => Response.json(page([]))) as typeof fetch;
    await expect(fetchWvcPage(config, 1, { fetchImpl, resolveSecret: () => undefined })).rejects.toThrow('wvc_not_configured');
    await expect(fetchWvcPage({ ...config, baseUrl: 'https://evil.example/abaapi' }, 1, { fetchImpl, resolveSecret })).rejects.toThrow('wvc_unsafe_url');
    await expect(fetchWvcPage({ ...config, baseUrl: 'http://127.0.0.1/abaapi', allowedHostnames: [] }, 1, { fetchImpl, resolveSecret })).rejects.toThrow('wvc_unsafe_url');
    const redirecting = (async () => new Response(null, { status: 302, headers: { Location: 'https://www.sgieurope.com/elsewhere' } })) as typeof fetch;
    await expect(fetchWvcPage(config, 1, { fetchImpl: redirecting, resolveSecret })).rejects.toThrow('wvc_unavailable');
    const htmlPage = (async () => new Response('<html>404</html>', { status: 200 })) as typeof fetch;
    await expect(fetchWvcPage(config, 1, { fetchImpl: htmlPage, resolveSecret })).rejects.toThrow('wvc_invalid_response');
  });

  it('is configured for SGI only, with the key referenced by name', () => {
    expect(enrichmentSourceFor('sgi-europe')).toMatchObject({ type: 'wvc', secretRef: 'env:SGI_WVC_API_KEY', profileName: 'Editorial Finder', dataConstraint: 4 });
    expect(enrichmentSourceFor('ibi')).toBeUndefined();
    expect(enrichmentSourceFor('__proto__')).toBeUndefined();
    expect(JSON.stringify(sgiEuropeEnrichmentSource)).not.toMatch(/key"\s*:\s*"[^e]/i);
  });
});

describe('article text store', () => {
  it('upserts only newer LASTMODIFIED values and returns bounded leads', async () => {
    const store = new MemoryArticleTextStore();
    expect(await store.upsert('sgi-europe', [{ storyCode: '1', isPrivate: true, lastModified: '2026-10-01T00:00:00.000Z', text: 'first version text' }], '2026-10-02T00:00:00.000Z')).toEqual(['1']);
    expect(await store.upsert('sgi-europe', [{ storyCode: '1', isPrivate: true, lastModified: '2026-09-01T00:00:00.000Z', text: 'older' }], '2026-10-02T00:00:00.000Z')).toEqual([]);
    expect(await store.upsert('sgi-europe', [{ storyCode: '1', isPrivate: false, lastModified: '2026-10-05T00:00:00.000Z', text: 'second version text' }], '2026-10-06T00:00:00.000Z')).toEqual(['1']);
    expect(await store.leads('sgi-europe', ['1', '2'], 6)).toEqual([{ storyCode: '1', lead: 'second', isPrivate: false }]);
    expect(await store.leads('ibi', ['1'], 100)).toEqual([]);
    expect(leadExcerpt('alpha beta gamma delta', 13)).toBe('alpha beta');
  });

  it('writes Postgres rows in one statement guarded by LASTMODIFIED and reads leads for selected codes only', async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
    const client = { query: async <Row>(sql: string, parameters?: unknown[]) => { queries.push({ sql, parameters }); return { rows: (sql.includes('RETURNING') ? [{ story_code: '7' }] : sql.startsWith('SELECT story_code') ? [{ story_code: '7', lead: 'Lead text here', is_private: true }] : []) as Row[] }; } };
    const store = new PostgresArticleTextStore(client);
    expect(await store.upsert('sgi-europe', [{ storyCode: '7', isPrivate: true, text: 'a' }, { storyCode: '7', isPrivate: true, text: 'b' }], '2026-10-01T00:00:00.000Z')).toEqual(['7']);
    expect(queries[0].sql).toContain('EXCLUDED.last_modified > publisher_article_texts.last_modified');
    expect(queries[0].parameters?.[1]).toEqual(['7']);
    expect(await store.leads('sgi-europe', ['7', '7', '8'], 800)).toEqual([{ storyCode: '7', lead: 'Lead text here', isPrivate: true }]);
    expect(queries[1].sql).toContain('left(plain_text, $3)');
    expect(queries[1].parameters?.slice(0, 2)).toEqual(['sgi-europe', ['7', '8']]);
  });
});
