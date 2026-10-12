import { DiscoveryError, type ContentSourceHealth, type Intent, type PublisherContentAdapter, type SearchOptions } from '../../core';
import { normalizeRealPublisherArticle } from './normalizer';
import type { RealPublisherApiConfig, RealPublisherRawArticle } from './types';

export interface RealSearchRequest {
  url: string;
  method: 'GET';
  query: Record<string, string | number>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function joinUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const joined = `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
  if (/^https?:\/\//i.test(joined)) return new URL(joined).toString();
  const origin = typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : 'http://localhost';
  return new URL(joined, origin).toString();
}

function getPath(value: unknown, path?: string): unknown {
  if (!path) return undefined;
  let current = value;
  for (const key of path.split('.')) { if (!current || typeof current !== 'object' || !(key in current)) return undefined; current = (current as Record<string, unknown>)[key]; }
  return current;
}

function safeRequestDebug(url: string): { url: string; query: Record<string, string | number> } {
  const safe = new URL(url);
  const query: Record<string, string | number> = {};
  safe.searchParams.forEach((value, key) => {
    const redacted = /token|secret|api[-_]?key|authorization|password/i.test(key) ? '[redacted]' : value;
    query[key] = redacted;
    safe.searchParams.set(key, redacted);
  });
  return { url: safe.toString(), query };
}

function extractResults(payload: unknown, responsePath?: string): unknown[] | null {
  const mapped = getPath(payload, responsePath);
  if (Array.isArray(mapped)) return mapped;
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  for (const key of ['results', 'articles', 'items', 'hits']) if (Array.isArray(value[key])) return value[key];
  if (value.data && typeof value.data === 'object') return extractResults(value.data, responsePath);
  return null;
}

export function buildRealSearchRequest(intent: Intent, config: RealPublisherApiConfig, limit = config.candidateLimit, pageIndex = 0, offset = 0, cursor?: string): RealSearchRequest {
  const pagination = config.pagination ?? { style: 'page' as const, pageParameter: config.pageParameter, limitParameter: config.limitParameter, firstPage: config.firstPage, pageSize: limit, maxPages: 1 };
  const query: Record<string, string | number> = {
    ...config.queryParameters,
    [config.searchQueryParameter]: intent.queryText || intent.keywords.join(' '),
  };
  if (pagination.style === 'offset') {
    query[pagination.offsetParameter ?? 'offset'] = offset;
    query[pagination.limitParameter ?? config.limitParameter] = pagination.pageSize ?? limit;
  } else if (pagination.style === 'cursor') {
    if (cursor) query[pagination.cursorParameter ?? 'cursor'] = cursor;
    query[pagination.limitParameter ?? config.limitParameter] = pagination.pageSize ?? limit;
  } else if (pagination.style !== 'none') {
    query[pagination.pageParameter ?? config.pageParameter] = (pagination.firstPage ?? config.firstPage) + pageIndex;
    query[pagination.limitParameter ?? config.limitParameter] = pagination.pageSize ?? limit;
  }
  const url = new URL(joinUrl(config.baseUrl, config.searchEndpoint));
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return { url: url.toString(), method: 'GET', query };
}

export class RealPublisherAdapter implements PublisherContentAdapter<RealPublisherRawArticle> {
  readonly publisherId = 'real-publisher';
  readonly sourceType = 'rest-json';
  readonly supportsPagination: boolean;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: RealPublisherApiConfig, fetchImpl?: FetchLike) {
    const nativeFetch = globalThis.fetch;
    if (!fetchImpl && !nativeFetch) throw new Error('A fetch implementation is required for the real publisher adapter.');
    this.fetchImpl = fetchImpl ?? nativeFetch.bind(globalThis);
    this.supportsPagination = (config.pagination?.style ?? 'page') !== 'none';
  }

  async search(intent: Intent, options: SearchOptions): Promise<RealPublisherRawArticle[]> {
    options.onProgress?.('searching');
    const startedAt = Date.now();
    const target = Math.min(options.limit, this.config.candidateLimit);
    const pagination = this.config.pagination ?? { style: 'page' as const, pageParameter: this.config.pageParameter, limitParameter: this.config.limitParameter, firstPage: this.config.firstPage, pageSize: target, maxPages: 1 };
    const candidates: RealPublisherRawArticle[] = [];
    let offset = 0;
    let cursor: string | undefined;
    let pagesFetched = 0;
    for (let page = 0; page < Math.max(1, Math.min(pagination.maxPages ?? 1, 20)) && candidates.length < target; page += 1) {
      pagesFetched += 1;
      const request = buildRealSearchRequest(intent, this.config, target, page, offset, cursor);
      const debugRequest = safeRequestDebug(request.url);
      options.onDebug?.({ type: 'publisher_search_request', publisherId: this.publisherId, url: debugRequest.url, method: request.method, query: debugRequest.query });
      const payload = await this.requestJson(request.url);
      const results = extractResults(payload, this.config.responsePath);
      if (!results) throw new DiscoveryError('invalid-response');
      candidates.push(...results.filter((item): item is RealPublisherRawArticle => item !== null && typeof item === 'object' && !Array.isArray(item)));
      if (!results.length || results.length < (pagination.pageSize ?? target)) break;
      if (pagination.style === 'offset') offset += pagination.pageSize ?? target;
      if (pagination.style === 'cursor') { const next = getPath(payload, pagination.nextCursorPath) ?? getPath(payload, 'nextCursor') ?? getPath(payload, 'next_cursor'); cursor = typeof next === 'string' ? next : undefined; if (!cursor) break; }
    }
    options.onDebug?.({ type: 'content_source', publisherId: this.publisherId, sourceType: this.sourceType, durationMs: Date.now() - startedAt, pagesFetched, rawCount: candidates.length, normalizedCount: candidates.filter((candidate) => Boolean(this.normalizeArticle(candidate))).length, rejectedCount: 0, duplicateCount: 0 });
    options.onDebug?.({ type: 'candidate_retrieval', publisherId: this.publisherId, count: candidates.length });
    return candidates;
  }

  fetch(intent: Intent, options: SearchOptions): Promise<RealPublisherRawArticle[]> { return this.search(intent, options); }

  async getArticle(id: string): Promise<RealPublisherRawArticle | null> {
    if (!this.config.articleEndpoint) return null;
    const endpoint = this.config.articleEndpoint.replace(':id', encodeURIComponent(id));
    try {
      const payload = await this.requestJson(joinUrl(this.config.baseUrl, endpoint));
      const results = extractResults(payload);
      if (results?.[0] && typeof results[0] === 'object') return results[0] as RealPublisherRawArticle;
      return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as RealPublisherRawArticle : null;
    } catch (error) {
      if (error instanceof DiscoveryError && error.message === 'not-found') return null;
      throw error;
    }
  }

  normalizeArticle(raw: RealPublisherRawArticle) {
    return normalizeRealPublisherArticle(raw, this.publisherId, this.config.retrievalSource, this.config.searchEndpoint, this.config.fieldMappings);
  }

  async healthCheck(): Promise<ContentSourceHealth> {
    try {
      const records = await this.search({ publisherId: this.publisherId, answers: {}, queryText: 'health check', keywords: ['health'], interests: [], personas: [] }, { limit: 1 });
      return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: true, recordsChecked: records.length, normalized: records.filter((record) => Boolean(this.normalizeArticle(record))).length, warnings: [] };
    } catch (error) {
      return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: false, recordsChecked: 0, normalized: 0, warnings: [error instanceof Error ? error.message : 'Source check failed.'] };
    }
  }

  private async requestJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { method: 'GET', headers: this.config.requestHeaders, signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new DiscoveryError('authentication-failure');
        if (response.status === 429) throw new DiscoveryError('rate-limit');
        if (response.status === 404) throw new DiscoveryError('not-found');
        throw new DiscoveryError('api-unavailable');
      }
      try {
        const body = await response.text();
        if (body.length > 2_000_000) throw new DiscoveryError('invalid-response');
        return JSON.parse(body);
      } catch (error) {
        if (error instanceof DiscoveryError) throw error;
        throw new DiscoveryError('invalid-response');
      }
    } catch (error) {
      if (error instanceof DiscoveryError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new DiscoveryError('search-timeout');
      throw new DiscoveryError('api-unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}
