import type { PublisherManifest } from '../publishers/manifest';

export const DEFAULT_PLATFORM_ORIGIN = 'https://discovery.ldsystems.uk';

export interface OriginPolicyOptions {
  /** Explicit first-party hosted application origin. Never derived from request Host. */
  platformOrigin?: string;
  allowPlatformOrigin?: boolean;
}

function normalizedOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function originAllowed(manifest: PublisherManifest | undefined, origin: string | null, environment: 'development' | 'test' | 'production', options: OriginPolicyOptions = {}): boolean {
  if (!origin) return true;
  if (environment !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  if (options.allowPlatformOrigin && origin === normalizedOrigin(options.platformOrigin ?? DEFAULT_PLATFORM_ORIGIN)) return true;
  return Boolean(manifest?.allowedOrigins?.includes(origin));
}

export function corsHeaders(manifest: PublisherManifest | undefined, request: Request, environment: 'development' | 'test' | 'production', options: OriginPolicyOptions = {}): Headers {
  const headers = new Headers({ 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID' });
  const origin = request.headers.get('Origin');
  if (origin && originAllowed(manifest, origin, environment, options)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

export function corsPreflight(manifest: PublisherManifest | undefined, request: Request, environment: 'development' | 'test' | 'production', options: OriginPolicyOptions = {}): Response {
  if (!originAllowed(manifest, request.headers.get('Origin'), environment, options)) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(manifest, request, environment, options) });
}
