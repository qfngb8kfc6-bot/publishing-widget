import type { PublisherRegistry } from '../core';

export type PublisherRouteHandler = (request: Request) => Promise<Response>;

/** Platform-neutral route boundary for /api/publishers/:publisherId/search. */
export function createPublisherSearchRoute(registry: PublisherRegistry, resolve: (publisherId: string) => PublisherRouteHandler | undefined): PublisherRouteHandler {
  return async (request) => {
    if (request.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const publisherId = new URL(request.url).pathname.match(/^\/api\/publishers\/([^/]+)\/search$/)?.[1];
    if (!publisherId || !registry.has(publisherId)) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
    const handler = resolve(publisherId);
    if (!handler) return Response.json({ error: 'publisher_not_configured' }, { status: 503 });
    return handler(request);
  };
}
