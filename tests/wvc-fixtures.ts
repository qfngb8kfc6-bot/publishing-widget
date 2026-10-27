import type { WvcCatalogueSourceConfig } from '../src/publishers/content';

/** Shared WVC catalogue fixtures. Not a test file itself. */
export const BODY_MARKER = 'confidential-third-sentence-marker';
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

