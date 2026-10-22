import { describe, expect, it } from 'vitest';
import { PublisherCatalogueCache } from '../src/reports/catalogue-cache';
import { MemoryArticleTextStore } from '../src/reports/article-texts';
import { TextEnrichmentSync } from '../src/reports/text-enrichment';
import { sgiEuropeEnrichmentSource } from '../src/publishers/sgi-europe';
import { createProductionApp } from '../src/server/production';
import type { ServerLogFields, StructuredLogger } from '../src/server/logging';

const KEY = 'sync-test-key-xyz';
const BODY_MARKER = 'confidential-body-sentence';

function wvcFetch(totalPages: number, options: { failPage?: number; failOnce?: boolean; requested?: number[]; lastModified?: string } = {}) {
  let failed = false;
  return (async (input: RequestInfo | URL) => {
    const page = Number(new URL(String(input)).searchParams.get('pagenumber'));
    options.requested?.push(page);
    if (page === options.failPage && !(options.failOnce && failed)) {
      failed = true;
      return Response.json({ ErrorsFound: true, Messages: [`API key ${KEY} invalid`] });
    }
    const stories = [0, 1].map((offset) => ({ STORYCODE: String(page * 10 + offset), STORYURL: `https://www.sgieurope.com/x/y/${page * 10 + offset}.article`, PRIVATE: 'true', LASTMODIFIED: options.lastModified ?? '2026-10-01T00:00:00Z', STORYTEXT: `<p>${BODY_MARKER} ${page}</p>` }));
    return Response.json({ ErrorsFound: false, Messages: [], PagedData: { TotalNumberOfPages: totalPages, TotalNumberOfRecords: totalPages * 2, Data: stories } });
  }) as typeof fetch;
}

function capture(): { logger: StructuredLogger; lines: Array<{ message: string; fields?: ServerLogFields }> } {
  const lines: Array<{ message: string; fields?: ServerLogFields }> = [];
  return { lines, logger: { info: (message, fields) => lines.push({ message, fields }), error: (message, fields) => lines.push({ message, fields }) } };
}

function sync(store: MemoryArticleTextStore, fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof TextEnrichmentSync>[0]> = {}) {
  const sleeps: number[] = [];
  const instance = new TextEnrichmentSync({ publisherId: 'sgi-europe', source: sgiEuropeEnrichmentSource, store, fetchImpl, resolveSecret: (reference) => (reference === 'env:SGI_WVC_API_KEY' ? KEY : undefined), runExclusive: (job) => job(), sleep: async (ms) => { sleeps.push(ms); }, ...extra });
  return { instance, sleeps };
}

describe('full-text sync job', () => {
  it('backfills every page once, oldest first, one request at a time with a pause between pages', async () => {
    const store = new MemoryArticleTextStore();
    const requested: number[] = [];
    const changed: string[][] = [];
    const { instance, sleeps } = sync(store, wvcFetch(3, { requested }), { onTextsChanged: (_publisherId, codes) => changed.push(codes) });
    expect(await instance.runCycle()).toEqual({ backfillComplete: true, failed: false });
    expect(requested).toEqual([1, 2, 3]);
    expect(sleeps).toEqual([1000, 1000]);
    expect(await store.count('sgi-europe')).toBe(6);
    expect(changed).toEqual([['10', '11'], ['20', '21'], ['30', '31']]);
    expect(await store.syncState('sgi-europe')).toMatchObject({ backfillLastPage: 3, backfillComplete: true, totalPages: 3 });
  });

  it('resumes the backfill from the last completed page after a failure and records only a safe code', async () => {
    const store = new MemoryArticleTextStore();
    const requested: number[] = [];
    const { lines, logger } = capture();
    const { instance } = sync(store, wvcFetch(4, { failPage: 3, failOnce: true, requested }), { logger });
    expect(await instance.runCycle()).toEqual({ backfillComplete: false, failed: true });
    expect(await store.syncState('sgi-europe')).toMatchObject({ backfillLastPage: 2, backfillComplete: false, lastErrorCode: 'wvc_auth_invalid' });
    expect(await instance.runCycle()).toEqual({ backfillComplete: true, failed: false });
    expect(requested).toEqual([1, 2, 3, 3, 4]);
    expect((await store.syncState('sgi-europe'))?.lastErrorCode).toBeUndefined();
    const logged = JSON.stringify(lines);
    expect(lines.find((line) => line.message === 'wvc_sync_failed')?.fields).toMatchObject({ publisherId: 'sgi-europe', stage: 'backfill', page: 3, errorCode: 'wvc_auth_invalid' });
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(BODY_MARKER);
  });

  it('fetches only the last two pages once the backfill is complete and skips unchanged stories', async () => {
    const store = new MemoryArticleTextStore();
    await store.saveSyncState('sgi-europe', { backfillLastPage: 230, backfillComplete: true, totalPages: 230 });
    await store.upsert('sgi-europe', [{ storyCode: '2300', isPrivate: true, lastModified: '2026-10-01T00:00:00.000Z', text: 'existing' }]);
    const requested: number[] = [];
    const changed: string[][] = [];
    const { instance } = sync(store, wvcFetch(231, { requested }), { onTextsChanged: (_publisherId, codes) => changed.push(codes) });
    await instance.runCycle();
    expect(requested).toEqual([230, 231]);
    expect(changed).toEqual([['2301'], ['2310', '2311']]);
    expect((await store.leads('sgi-europe', ['2300'], 100))[0].lead).toBe('existing');
    expect(await store.syncState('sgi-europe')).toMatchObject({ totalPages: 231 });
  });

  it('runs each page on the catalogue background queue, never alongside other queued work', async () => {
    const cache = new PublisherCatalogueCache();
    const events: string[] = [];
    let release!: () => void;
    const blocker = cache.runExclusive(() => new Promise<void>((resolve) => { events.push('refresh-start'); release = () => { events.push('refresh-end'); resolve(); }; }));
    const fetchImpl = (async (input: RequestInfo | URL) => { events.push('wvc-page'); return wvcFetch(1)(input); }) as typeof fetch;
    const { instance } = sync(new MemoryArticleTextStore(), fetchImpl, { runExclusive: (job) => cache.runExclusive(job) });
    const cycle = instance.runCycle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(['refresh-start']);
    release();
    await Promise.all([blocker, cycle]);
    expect(events).toEqual(['refresh-start', 'refresh-end', 'wvc-page']);
  });

  it('is off unless WVC_ENRICHMENT_ENABLED=true, and reports status for SGI only', async () => {
    const store = new MemoryArticleTextStore();
    const disabled = createProductionApp({ environment: 'test', serverEnvironment: { SGI_WVC_API_KEY: KEY }, articleTextStore: store });
    expect(disabled.startTextEnrichment()).toEqual([]);
    expect(await disabled.textEnrichmentStatus('sgi-europe')).toMatchObject({ enabled: false, recordsSynced: 0 });
    expect(await disabled.textEnrichmentStatus('ibi')).toBeUndefined();
    const enabled = createProductionApp({ environment: 'test', serverEnvironment: { SGI_WVC_API_KEY: KEY, WVC_ENRICHMENT_ENABLED: 'true' }, articleTextStore: store });
    expect(enabled.startTextEnrichment()).toEqual(['sgi-europe']);
    enabled.stopTextEnrichment();
    const withoutStore = createProductionApp({ environment: 'test', serverEnvironment: { WVC_ENRICHMENT_ENABLED: 'true' } });
    expect(withoutStore.startTextEnrichment()).toEqual([]);
  });

  it('shows sync status in the admin publisher list without text or keys', async () => {
    const store = new MemoryArticleTextStore();
    await store.upsert('sgi-europe', [{ storyCode: '1', isPrivate: true, text: BODY_MARKER }]);
    await store.saveSyncState('sgi-europe', { backfillLastPage: 12, backfillComplete: false, totalPages: 230, lastSyncAt: '2026-10-22T10:00:00.000Z', lastErrorCode: 'wvc_timeout', lastErrorAt: '2026-10-22T09:00:00.000Z' });
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password', SGI_WVC_API_KEY: KEY }, articleTextStore: store });
    const login = await app.handle(new Request('https://admin.example/api/admin/login', { method: 'POST', headers: { Origin: 'https://admin.example' }, body: JSON.stringify({ password: 'test-admin-password' }) }));
    const cookie = login.headers.get('Set-Cookie')!.split(';', 1)[0];
    const response = await app.handle(new Request('https://admin.example/api/admin/publishers', { headers: { Origin: 'https://admin.example', Cookie: cookie } }));
    const text = await response.text();
    const body = JSON.parse(text) as { publishers: Array<{ publisherId: string; textEnrichment?: Record<string, unknown> }> };
    expect(body.publishers.find((publisher) => publisher.publisherId === 'sgi-europe')?.textEnrichment).toMatchObject({ enabled: false, recordsSynced: 1, backfillLastPage: 12, totalPages: 230, lastErrorCode: 'wvc_timeout' });
    expect(body.publishers.find((publisher) => publisher.publisherId === 'ibi')?.textEnrichment).toBeUndefined();
    expect(text).not.toContain(BODY_MARKER);
    expect(text).not.toContain(KEY);
  });
});
