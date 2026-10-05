import { createAIConfig } from '../ai/config';
import { OpenAICompatibleProvider } from '../ai/providers/openai-compatible';
import type { AIProvider } from '../ai/types';
import { buildAnalyticsReport } from '../analytics/metrics';
import { MemoryAnalyticsStore } from '../analytics/store';
import type { AnalyticsStore } from '../analytics/types';
import { createPublisherRegistry } from '../publishers/registry';
import { createAIProxy } from './ai-proxy';
import { createAnalyticsIngestionRoute } from './analytics-route';
import { corsHeaders, corsPreflight, originAllowed } from './cors';
import { createGlobalHealthResponse, createPublisherHealthResponse } from './health';
import { createReadinessResponse } from './health';
import { createStructuredLogger, createRequestId, type StructuredLogger } from './logging';
import { requestRateLimitKey, SlidingWindowRateLimiter } from './rate-limit';
import { createPublisherSearchRoute } from './publisher-routes';
import { createRealPublisherProxy } from './real-publisher-proxy';
import { safeRouteId } from './request-validation';
import type { PublisherManifest } from '../publishers/manifest';

export interface ProductionServerOptions {
  environment?: 'development' | 'test' | 'production';
  serverEnvironment?: Record<string, string | undefined>;
  analyticsStore?: AnalyticsStore;
  aiProvider?: AIProvider;
  logger?: StructuredLogger;
  fetchImpl?: typeof fetch;
  rateLimits?: { publisher?: number; ai?: number; analytics?: number };
  trustedProxy?: boolean;
  commitSha?: string;
  analyticsStoreMode?: 'memory' | 'postgres';
}

export { PostgresAnalyticsStore } from '../analytics/postgres-store';

function jsonError(error: string, status: number, requestId: string): Response {
  return Response.json({ error, requestId }, { status, headers: { 'X-Request-ID': requestId } });
}

function withHeaders(response: Response, request: Request, manifest: PublisherManifest | undefined, environment: 'development' | 'test' | 'production', requestId: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(manifest, request, environment).entries()) headers.set(key, value);
  headers.set('X-Request-ID', requestId);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, headers });
}

function allowedOriginsFor(manifest: PublisherManifest | undefined, environment: Record<string, string | undefined>): PublisherManifest | undefined {
  if (!manifest) return undefined;
  const key = `PUBLISHER_${manifest.publisherId.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_ALLOWED_ORIGINS`;
  const configured = environment[key]?.split(',').map((origin) => origin.trim()).filter(Boolean);
  return configured?.length ? { ...manifest, allowedOrigins: configured } : manifest;
}

export function createProductionApp(options: ProductionServerOptions = {}) {
  const environment = options.environment ?? 'development';
  const serverEnvironment = options.serverEnvironment ?? {};
  const registry = createPublisherRegistry();
  const analyticsStore = options.analyticsStore ?? new MemoryAnalyticsStore();
  const analyticsStoreMode: 'memory' | 'postgres' = options.analyticsStoreMode ?? (options.analyticsStore ? 'postgres' : 'memory');
  const logger = options.logger ?? createStructuredLogger(environment);
  const publisherLimiter = new SlidingWindowRateLimiter({ limit: options.rateLimits?.publisher ?? 60 });
  const aiLimiter = new SlidingWindowRateLimiter({ limit: options.rateLimits?.ai ?? 10 });
  const analyticsLimiter = new SlidingWindowRateLimiter({ limit: options.rateLimits?.analytics ?? 120 });
  const aiConfig = createAIConfig(serverEnvironment);
  const aiProvider = options.aiProvider ?? (environment !== 'production' && aiConfig.provider === 'mock' ? undefined : aiConfig.enabled && aiConfig.apiKey ? new OpenAICompatibleProvider({ endpoint: aiConfig.endpoint, apiKey: aiConfig.apiKey, model: aiConfig.model, timeoutMs: aiConfig.timeoutMs, maxTokens: aiConfig.maxTokens }, options.fetchImpl) : undefined);
  const analyticsRoute = createAnalyticsIngestionRoute(analyticsStore, { isPublisherAllowed: (publisherId) => registry.has(publisherId) });
  const realToken = serverEnvironment.REAL_PUBLISHER_API_TOKEN ?? serverEnvironment.PUBLISHER_REAL_PUBLISHER_API_KEY;
  const realUpstream = serverEnvironment.REAL_PUBLISHER_UPSTREAM_BASE_URL ?? serverEnvironment.REAL_PUBLISHER_API_BASE_URL;
  const realProxy = realToken && realUpstream ? createRealPublisherProxy({ upstreamBaseUrl: realUpstream, searchEndpoint: serverEnvironment.REAL_PUBLISHER_SEARCH_ENDPOINT ?? '/search', articleEndpoint: serverEnvironment.REAL_PUBLISHER_ARTICLE_ENDPOINT ?? '/articles/:id', apiToken: realToken, timeoutMs: Number(serverEnvironment.REAL_PUBLISHER_TIMEOUT_MS ?? 8000), allowedOrigins: registry.get('real-publisher')?.manifest?.allowedOrigins, allowedQueryParameters: ['q', 'page', 'limit'] }, options.fetchImpl) : undefined;
  const publisherSearchRoute = createPublisherSearchRoute(registry, (publisherId) => publisherId === 'real-publisher' ? realProxy : undefined);
  const aiRoute = aiProvider ? createAIProxy(aiProvider) : undefined;

  const trustedProxy = options.trustedProxy ?? false;
  const handle = async (request: Request): Promise<Response> => {
    const started = Date.now();
    const requestId = request.headers.get('X-Request-ID') || createRequestId();
    const url = new URL(request.url);
    const publisherId = safeRouteId(url.pathname.match(/^\/api\/publishers\/([^/]+)/)?.[1] ?? url.pathname.match(/^\/api\/analytics\/([^/]+)/)?.[1]);
    const manifest = allowedOriginsFor(publisherId ? registry.get(publisherId)?.manifest : undefined, serverEnvironment);
    try {
      if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') return withHeaders(corsPreflight(manifest, request, environment), request, manifest, environment, requestId);
      if (url.pathname === '/health' && request.method === 'GET') return withHeaders(createGlobalHealthResponse(environment, options.commitSha), request, undefined, environment, requestId);
      if ((url.pathname === '/ready' || url.pathname === '/readiness') && request.method === 'GET') return withHeaders(createReadinessResponse(environment, analyticsStoreMode, options.commitSha), request, undefined, environment, requestId);
      if (url.pathname.match(/^\/api\/publishers\/[^/]+\/health$/) && request.method === 'GET' && publisherId) {
        if (!manifest || !originAllowed(manifest, request.headers.get('Origin'), environment)) return jsonError('origin_not_allowed', 403, requestId);
        return withHeaders(createPublisherHealthResponse(registry, publisherId, environment, serverEnvironment), request, manifest, environment, requestId);
      }
      if (url.pathname.match(/^\/api\/publishers\/[^/]+\/search$/)) {
        if (!publisherId || !manifest || !originAllowed(manifest, request.headers.get('Origin'), environment)) return jsonError('origin_not_allowed', 403, requestId);
        const decision = publisherLimiter.check(requestRateLimitKey(request, 'publisher-search', publisherId, trustedProxy));
        if (!decision.allowed) return new Response(JSON.stringify({ error: 'rate_limited', requestId }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(decision.retryAfterSeconds) } });
        if ((url.searchParams.get('q') ?? '').length > 500) return jsonError('invalid_query', 400, requestId);
        return withHeaders(await publisherSearchRoute(request), request, manifest, environment, requestId);
      }
      if (url.pathname === '/api/analytics/events') {
        const decision = analyticsLimiter.check(requestRateLimitKey(request, 'analytics', 'global', trustedProxy));
        if (!decision.allowed) return withHeaders(new Response(JSON.stringify({ error: 'rate_limited', requestId }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(decision.retryAfterSeconds) } }), request, undefined, environment, requestId);
        const raw = request.clone();
        if (environment === 'production' && request.headers.get('Origin')) {
          const origin = request.headers.get('Origin');
          if (!registry.list().some((definition) => originAllowed(allowedOriginsFor(definition.manifest, serverEnvironment), origin, environment))) return jsonError('origin_not_allowed', 403, requestId);
          try {
            const body = await raw.json() as { events?: Array<{ publisherId?: string }> };
            const ids = Array.isArray(body.events) ? [...new Set(body.events.map((event) => event.publisherId).filter((id): id is string => Boolean(id)))] : [];
            if (ids.length === 0 || ids.some((id) => !originAllowed(allowedOriginsFor(registry.get(id)?.manifest, serverEnvironment), request.headers.get('Origin'), environment))) return jsonError('origin_not_allowed', 403, requestId);
          } catch { return jsonError('invalid_json', 400, requestId); }
        }
        return withHeaders(await analyticsRoute(request), request, undefined, environment, requestId);
      }
      const overviewMatch = url.pathname.match(/^\/api\/analytics\/([^/]+)\/overview$/);
      if (overviewMatch && request.method === 'GET' && publisherId) {
        if (!manifest || !originAllowed(manifest, request.headers.get('Origin'), environment)) return jsonError('origin_not_allowed', 403, requestId);
        const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
        const range = from && to ? { from, to } : undefined;
        return withHeaders(Response.json(buildAnalyticsReport(await analyticsStore.query({ publisherId, range }), publisherId, range)), request, manifest, environment, requestId);
      }
      if (url.pathname.startsWith('/api/ai/')) {
        const decision = aiLimiter.check(requestRateLimitKey(request, 'ai', 'global', trustedProxy));
        if (!decision.allowed) return withHeaders(new Response(JSON.stringify({ error: 'rate_limited', requestId }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(decision.retryAfterSeconds) } }), request, undefined, environment, requestId);
        if (!aiRoute) return jsonError('ai_unavailable', 503, requestId);
        let aiManifestForResponse: PublisherManifest | undefined;
        if (environment === 'production' && request.headers.get('Origin')) {
          try {
            const body = await request.clone().json() as Record<string, unknown>;
            const intent = body.intent && typeof body.intent === 'object' ? body.intent as Record<string, unknown> : undefined;
            const requestList = Array.isArray(body.requests) ? body.requests[0] as Record<string, unknown> | undefined : undefined;
            const requestIntent = requestList?.intent && typeof requestList.intent === 'object' ? requestList.intent as Record<string, unknown> : undefined;
            const baseIntent = requestIntent?.baseIntent && typeof requestIntent.baseIntent === 'object' ? requestIntent.baseIntent as Record<string, unknown> : undefined;
            const aiPublisherId = typeof intent?.publisherId === 'string' ? intent.publisherId : typeof baseIntent?.publisherId === 'string' ? baseIntent.publisherId : undefined;
            aiManifestForResponse = aiPublisherId ? allowedOriginsFor(registry.get(aiPublisherId)?.manifest, serverEnvironment) : undefined;
            if (!aiManifestForResponse || !originAllowed(aiManifestForResponse, request.headers.get('Origin'), environment)) return jsonError('origin_not_allowed', 403, requestId);
          } catch { return jsonError('invalid_json', 400, requestId); }
        }
        return withHeaders(await aiRoute(request), request, aiManifestForResponse, environment, requestId);
      }
      return jsonError('not_found', 404, requestId);
    } catch (error) {
      logger.error('request_failed', { requestId, publisherId: publisherId ?? undefined, route: url.pathname, durationMs: Date.now() - started, status: 500, errorType: error instanceof Error ? error.name : 'unknown' });
      return jsonError('internal_error', 500, requestId);
    } finally {
      logger.info('request_completed', { requestId, publisherId: publisherId ?? undefined, route: url.pathname, durationMs: Date.now() - started });
    }
  };
  return { handle, registry, analyticsStore, analyticsStoreMode };
}

export async function runConfiguredAIHealthCheck(serverEnvironment: Record<string, string | undefined> = {}, fetchImpl: typeof fetch = fetch): Promise<{ status: 'disabled' | 'ok'; provider?: string }> {
  const config = createAIConfig(serverEnvironment);
  if (!config.enabled || config.provider === 'none') return { status: 'disabled' };
  if (config.provider !== 'openai-compatible' || !config.apiKey) throw new Error('AI provider is enabled but server configuration is incomplete');
  const provider = new OpenAICompatibleProvider({ endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs, maxTokens: config.maxTokens }, fetchImpl);
  const result = await provider.enhanceIntent({ publisherId: '__health_check__', answers: { interest: 'technology' }, queryText: 'technology', keywords: ['technology'], interests: ['technology'], personas: ['reader'] });
  if (!result || typeof result !== 'object') throw new Error('AI provider returned an invalid health-check response');
  const fields = ['primaryThemes', 'relatedThemes', 'searchTerms', 'entities', 'excludedConcepts'];
  if (fields.some((field) => !Array.isArray((result as Record<string, unknown>)[field]))) throw new Error('AI provider returned an invalid structured response');
  return { status: 'ok', provider: provider.providerName };
}
