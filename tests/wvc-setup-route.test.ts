import { describe, expect, it } from 'vitest';
import { createProductionApp } from '../src/server/production';
import { MemoryPublisherStore } from '../src/publishers/store';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { acmeSource, page, story } from './wvc-fixtures';

const KEY = 'setup-test-key-0123456789';

function request(path: string, init: RequestInit = {}, cookie?: string): Request {
  const headers = new Headers(init.headers);
  headers.set('Origin', 'https://admin.example');
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`https://admin.example${path}`, { ...init, headers });
}

function draft(contentSource: Record<string, unknown>) {
  return { publisherId: 'acme', name: 'Acme News', enabled: true, environment: 'production', publisherConfigVersion: '1', branding: { primaryAccent: '#36566c' }, content: { adapterId: String(contentSource.type), resultLimit: 8, candidateRetrievalLimit: 30 }, contentSource, results: { heading: 'Stories', description: 'x', maximumRecommendations: 8, openArticleInNewTab: true }, allowedOrigins: ['https://news.acme.example'] };
}

describe('guided setup Test step', () => {
  async function setup() {
    const requested: Array<{ url: string; key: string | null }> = [];
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password', ACME_WVC_API_KEY: KEY, DATABASE_URL: 'postgres://user:db-secret@db.example/x' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        requested.push({ url: url.toString(), key: new Headers(init?.headers).get('API_ACCESS_TOKEN') });
        const pageNumber = Number(url.searchParams.get('pagenumber'));
        if (url.searchParams.get('dataconstraint') === '0') return Response.json({ ...page([{ STORYCODE: '1' }], 7), PagedData: { TotalNumberOfPages: 7, TotalNumberOfRecords: 340, Data: [{ STORYCODE: '1' }] } });
        return Response.json(page([story(pageNumber * 10 + 1), story(pageNumber * 10 + 2, { STORYTEXT: '<p>No picture. Second.</p>' })], 7));
      }) as typeof fetch,
    });
    const login = await app.handle(request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'test-admin-password' }) }));
    return { app, requested, cookie: login.headers.get('Set-Cookie')!.split(';', 1)[0] };
  }

  it('reports pages, newest date, text lengths and field coverage without exposing the key', async () => {
    const { app, requested, cookie } = await setup();
    const response = await app.handle(request('/api/admin/source-test', { method: 'POST', body: JSON.stringify(draft({ ...acmeSource })) }, cookie));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('confidential');
    const { wvc } = JSON.parse(text);
    expect(wvc).toMatchObject({ reachable: true, totalPages: 7, totalRecords: 340, lastPage: { page: 7, stories: 2, privateCount: 1, coverage: { title: 100, url: 100, publishedAt: 100, description: 50, image: 50 }, titleField: 'HEADLINE' } });
    expect(wvc.lastPage.textLength.min).toBeGreaterThan(0);
    expect(wvc.lastPage.sampleTitles).toEqual(['Acme & Partners open 71 stores', 'Acme & Partners open 72 stores']);
    expect(requested.map((entry) => new URL(entry.url).searchParams.get('pagenumber'))).toEqual(['1', '7']);
    // dataconstraint 0 only for the page-count probe; the story fetch asks for HEADLINE and STORYTEXT (4).
    expect(requested.map((entry) => new URL(entry.url).searchParams.get('dataconstraint'))).toEqual(['0', '4']);
    expect(requested.every((entry) => entry.key === KEY)).toBe(true);
  });

  it('counts subscriber-only descriptions only when the publisher shows private excerpts', async () => {
    const { app, cookie } = await setup();
    const response = await app.handle(request('/api/admin/source-test', { method: 'POST', body: JSON.stringify(draft({ ...acmeSource, showPrivateExcerpts: true })) }, cookie));
    expect((await response.json()).wvc.lastPage.coverage.description).toBe(100);
  });

  it('never sends another server secret: a secretRef outside *_WVC_API_KEY is refused before any request', async () => {
    const { app, requested, cookie } = await setup();
    const response = await app.handle(request('/api/admin/source-test', { method: 'POST', body: JSON.stringify(draft({ ...acmeSource, secretRef: 'env:DATABASE_URL' })) }, cookie));
    expect(response.status).toBe(502);
    expect((await response.json()).wvc).toMatchObject({ reachable: false, errorCode: 'wvc_secret_ref_invalid' });
    expect(requested).toEqual([]);
  });

  it('requires an admin session', async () => {
    const { app } = await setup();
    expect((await app.handle(request('/api/admin/source-test', { method: 'POST', body: JSON.stringify(draft({ ...acmeSource })) }))).status).toBe(401);
  });
});
