import { DiscoveryError, type Intent, type PublisherAdapter, type SearchOptions } from '../../core';
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

function extractResults(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  for (const key of ['results', 'articles', 'items', 'hits']) if (Array.isArray(value[key])) return value[key];
  if (value.data && typeof value.data === 'object') return extractResults(value.data);
  return null;
}

export function buildRealSearchRequest(intent: Intent, config: RealPublisherApiConfig, limit = config.candidateLimit): RealSearchRequest {
  const query: Record<string, string | number> = {
    ...config.queryParameters,
    [config.searchQueryParameter]: intent.queryText || intent.keywords.join(' '),
    [config.pageParameter]: config.firstPage,
    [config.limitParameter]: limit,
  };
  const url = new URL(joinUrl(config.baseUrl, config.searchEndpoint));
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return { url: url.toString(), method: 'GET', query };
}

export class RealPublisherAdapter implements PublisherAdapter<RealPublisherRawArticle> {
  readonly publisherId = 'real-publisher';
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: RealPublisherApiConfig, fetchImpl?: FetchLike) {
    const nativeFetch = globalThis.fetch;
    if (!fetchImpl && !nativeFetch) throw new Error('A fetch implementation is required for the real publisher adapter.');
    this.fetchImpl = fetchImpl ?? nativeFetch.bind(globalThis);
  }

  async search(intent: Intent, options: SearchOptions): Promise<RealPublisherRawArticle[]> {
    options.onProgress?.('searching');
    const request = buildRealSearchRequest(intent, this.config, Math.min(options.limit, this.config.candidateLimit));
    options.onDebug?.({ type: 'publisher_search_request', publisherId: this.publisherId, url: request.url, method: request.method, query: request.query });
    const payload = await this.requestJson(request.url);
    const results = extractResults(payload);
    if (!results) throw new DiscoveryError('invalid-response');
    const candidates = results.filter((item): item is RealPublisherRawArticle => item !== null && typeof item === 'object' && !Array.isArray(item));
    options.onDebug?.({ type: 'candidate_retrieval', publisherId: this.publisherId, count: candidates.length });
    return candidates;
  }

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
    return normalizeRealPublisherArticle(raw, this.publisherId, this.config.retrievalSource);
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
      try { return await response.json(); } catch { throw new DiscoveryError('invalid-response'); }
    } catch (error) {
      if (error instanceof DiscoveryError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new DiscoveryError('search-timeout');
      throw new DiscoveryError('api-unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}
