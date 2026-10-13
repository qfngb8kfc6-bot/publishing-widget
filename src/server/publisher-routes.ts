import type { PublisherRegistry } from '../core';
import { safeRouteId } from './request-validation';

export type PublisherRouteHandler = (request: Request) => Promise<Response>;

/** Platform-neutral route boundary for /api/publishers/:publisherId/search. */
export function createPublisherSearchRoute(registry: PublisherRegistry, resolve: (publisherId: string) => PublisherRouteHandler | undefined): PublisherRouteHandler {
  return async (request) => {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const url = new URL(request.url);
    const publisherId = safeRouteId(url.pathname.match(/^\/api\/publishers\/([^/]+)\/search$/)?.[1]);
    const definition = publisherId ? registry.get(publisherId) : undefined;
    if (!publisherId || !definition || definition.manifest?.enabled === false) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
    const query = url.searchParams.get('q') ?? '';
    const limit = Number(url.searchParams.get('limit') ?? 30);
    const page = Number(url.searchParams.get('page') ?? 1);
    if (query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(page) || page < 1) return Response.json({ error: 'invalid_search_parameters' }, { status: 400 });
    const handler = resolve(publisherId);
    if (handler) return handler(request);
    if (!definition) return Response.json({ error: 'publisher_not_configured' }, { status: 503 });
    try {
      const keywords = query.toLowerCase().split(/\s+/).map((value) => value.trim()).filter(Boolean).slice(0, 32);
      const records = await definition.adapter.search({ publisherId, answers: { query }, queryText: query, keywords, interests: keywords, personas: [] }, { limit });
      return Response.json({ results: records, publisherId, page, limit });
    } catch {
      return Response.json({ error: 'publisher_unavailable' }, { status: 503 });
    }
  };
}
