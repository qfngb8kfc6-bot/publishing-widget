import { DiscoveryError } from '../core';
import { isPublisherOriginAllowed } from './origin';
import type { PublisherManifest } from '../publishers/manifest';

export interface RealPublisherProxyConfig {
  upstreamBaseUrl: string;
  searchEndpoint: string;
  articleEndpoint?: string;
  apiToken: string;
  tokenHeader?: string;
  timeoutMs?: number;
  allowedOrigins?: string[];
}

/**
 * Platform-neutral server handler. Mount this at the configured proxy route in
 * the host application; it is intentionally never imported by widget.ts.
 */
export function createRealPublisherProxy(config: RealPublisherProxyConfig, fetchImpl: typeof fetch = fetch) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    if (config.allowedOrigins && !isPublisherOriginAllowed({ allowedOrigins: config.allowedOrigins } as PublisherManifest, request.headers.get('Origin'))) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
    const incoming = new URL(request.url);
    const articleId = incoming.pathname.match(/\/articles\/([^/]+)$/)?.[1];
    const isArticleRequest = Boolean(articleId && config.articleEndpoint);
    const upstreamPath = isArticleRequest ? config.articleEndpoint?.replace(':id', encodeURIComponent(decodeURIComponent(articleId as string))) : config.searchEndpoint;
    if (!upstreamPath) return Response.json({ error: 'not_configured' }, { status: 503 });
    const upstreamUrl = new URL(/^https?:\/\//i.test(upstreamPath) ? upstreamPath : `${config.upstreamBaseUrl.replace(/\/+$/, '')}/${upstreamPath.replace(/^\/+/, '')}`);
    incoming.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 8000);
    try {
      const response = await fetchImpl(upstreamUrl, {
        headers: { Accept: 'application/json', [config.tokenHeader ?? 'Authorization']: `Bearer ${config.apiToken}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        const status = response.status === 401 || response.status === 403 ? 502 : response.status === 429 ? 429 : 503;
        return Response.json({ error: status === 429 ? 'rate_limited' : 'publisher_unavailable' }, { status });
      }
      const body = await response.text();
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      if (error instanceof DiscoveryError) throw error;
      return Response.json({ error: 'publisher_unavailable' }, { status: 503 });
    } finally {
      clearTimeout(timeout);
    }
  };
}
