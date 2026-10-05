import type { PublisherRegistry } from '../core';
import { safeRouteId } from './request-validation';

export type PublisherRouteHandler = (request: Request) => Promise<Response>;

/** Platform-neutral route boundary for /api/publishers/:publisherId/search. */
export function createPublisherSearchRoute(registry: PublisherRegistry, resolve: (publisherId: string) => PublisherRouteHandler | undefined): PublisherRouteHandler {
  return async (request) => {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const url = new URL(request.url);
    const publisherId = safeRouteId(url.pathname.match(/^\/api\/publishers\/([^/]+)\/search$/)?.[1]);
    if (!publisherId || !registry.has(publisherId)) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
    const query = url.searchParams.get('q') ?? '';
    const limit = Number(url.searchParams.get('limit') ?? 30);
    const page = Number(url.searchParams.get('page') ?? 1);
    if (query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(page) || page < 1) return Response.json({ error: 'invalid_search_parameters' }, { status: 400 });
    const handler = resolve(publisherId);
    if (!handler) return Response.json({ error: 'publisher_not_configured' }, { status: 503 });
    return handler(request);
  };
}
