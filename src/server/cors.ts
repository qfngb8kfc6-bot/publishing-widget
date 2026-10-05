import type { PublisherManifest } from '../publishers/manifest';

export function originAllowed(manifest: PublisherManifest | undefined, origin: string | null, environment: 'development' | 'test' | 'production'): boolean {
  if (!origin) return true;
  if (environment !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return Boolean(manifest?.allowedOrigins?.includes(origin));
}

export function corsHeaders(manifest: PublisherManifest | undefined, request: Request, environment: 'development' | 'test' | 'production'): Headers {
  const headers = new Headers({ 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID' });
  const origin = request.headers.get('Origin');
  if (origin && originAllowed(manifest, origin, environment)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

export function corsPreflight(manifest: PublisherManifest | undefined, request: Request, environment: 'development' | 'test' | 'production'): Response {
  if (!originAllowed(manifest, request.headers.get('Origin'), environment)) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(manifest, request, environment) });
}
