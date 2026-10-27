import { AI_OPERATION_TIMEOUT_CAP_MS, createAIConfig } from '../ai/config';
import { OpenAICompatibleProvider } from '../ai/providers/openai-compatible';
import { validateProfessionalProfileEnhancement } from '../ai/validation';
import type { AIProvider } from '../ai/types';
import { buildAnalyticsReport } from '../analytics/metrics';
import { MemoryAnalyticsStore } from '../analytics/store';
import type { AnalyticsStore } from '../analytics/types';
import { createPublisherRegistry } from '../publishers/registry';
import { MemoryPublisherStore, PostgresPublisherStore, type PublisherStore } from '../publishers/store';
import { PublisherRuntime } from '../publishers/runtime';
import { createRealPublisherApiConfig } from '../publishers/real-publisher/config';
import { createAIProxy } from './ai-proxy';
import { createAnalyticsIngestionRoute } from './analytics-route';
import { corsHeaders, corsPreflight, DEFAULT_PLATFORM_ORIGIN, originAllowed, type OriginPolicyOptions } from './cors';
import { createGlobalHealthResponse, createPublisherHealthResponse } from './health';
import { createReadinessResponse } from './health';
import { createStructuredLogger, createRequestId, logHeapUsage, safeLogText, type StructuredLogger } from './logging';
import { requestRateLimitKey, SlidingWindowRateLimiter } from './rate-limit';
import { createPublisherSearchRoute } from './publisher-routes';
import { createRealPublisherProxy } from './real-publisher-proxy';
import { safeRouteId } from './request-validation';
import type { PublisherManifest } from '../publishers/manifest';
import { MemoryReportStore, PostgresCatalogueSnapshotStore, ReportGenerationService, type CatalogueSnapshotStore, type ReportStore } from '../reports';
import { BoundedCompanyInputResolver, SafeCompanyContextProvider, type CompanyContextProvider, type CompanyInputResolver } from './company';
import { createReportRoutes } from './report-routes';
import { buildProfessionalProfile } from '../core';
import { AdminAuth } from './admin-auth';
import { createAdminRoutes } from './admin-routes';
import { PublisherCatalogueCache } from '../reports/catalogue-cache';
import { GenerationJobs, MemoryGenerationJobStore, type GenerationJobStore } from '../reports/generation-jobs';
import type { ArticleTextStore, WvcCatalogueStore } from '../reports/article-texts';
import { inspectWvcCatalogue, wvcCatalogueConfigErrors, wvcCatalogueFetchConfig, wvcCatalogueParseOptions, type WvcCatalogueSourceConfig } from '../publishers/content';
import { TextEnrichmentSync } from '../reports/text-enrichment';
import { enrichedPublisherIds, enrichmentSourceFor } from '../publishers/enrichment';

export interface ProductionServerOptions {
  environment?: 'development' | 'test' | 'production';
  serverEnvironment?: Record<string, string | undefined>;
  analyticsStore?: AnalyticsStore;
  aiProvider?: AIProvider;
  logger?: StructuredLogger;
  fetchImpl?: typeof fetch;
  rateLimits?: { publisher?: number; ai?: number; analytics?: number; generation?: number; generationStatus?: number };
  trustedProxy?: boolean;
  commitSha?: string;
  analyticsStoreMode?: 'memory' | 'postgres';
  reportStore?: ReportStore;
  companyContextProvider?: CompanyContextProvider;
  companyInputResolver?: CompanyInputResolver;
  publisherStore?: PublisherStore;
  publisherCacheTtlMs?: number;
  catalogueCacheTtlMs?: number;
  catalogueCacheMaxStaleMs?: number;
  catalogueSnapshotStore?: CatalogueSnapshotStore;
  /** Where asynchronous generation status is persisted; in memory when absent. */
  generationJobStore?: GenerationJobStore;
  /** Full-text enrichment store (Postgres). Text is used only when WVC_ENRICHMENT_ENABLED=true. */
  /** Postgres in production; a WVC catalogue source also needs its catalogue methods (migration 010). */
  articleTextStore?: ArticleTextStore & Partial<WvcCatalogueStore>;
}

export { PostgresAnalyticsStore } from '../analytics/postgres-store';
export { PostgresReportStore } from '../reports/store';
export { PostgresPublisherStore } from '../publishers/store';
export { PostgresCatalogueSnapshotStore } from '../reports/catalogue-snapshot';
export { PostgresGenerationJobStore } from '../reports/generation-jobs';
export { PostgresArticleTextStore } from '../reports/article-texts';
// Used by scripts/wvc-check.mjs (read-only diagnostics).
export { inspectWvcLastPage, storyCodeFromUrl } from '../publishers/content/wvc';
export { sgiEuropeEnrichmentSource, sgiEuropeFeedUrl } from '../publishers/sgi-europe/config';
export { resolveCommitSha } from './health';
export { explanationQualityWarnings, summaryQualityWarnings } from '../ai/content-quality';

/** Characters of each article's full text added to its match index, as hashes: ~1.2 KB per article (~14 MB for 11.5k). */
const LEAD_MATCH_CHARS = 1500;

function jsonError(error: string, status: number, requestId: string): Response {
  return Response.json({ error, requestId }, { status, headers: { 'X-Request-ID': requestId } });
}

function withHeaders(response: Response, request: Request, manifest: PublisherManifest | undefined, environment: 'development' | 'test' | 'production', requestId: string, originPolicy?: OriginPolicyOptions): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(manifest, request, environment, originPolicy).entries()) headers.set(key, value);
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
  const platformOrigin = serverEnvironment.PLATFORM_ORIGIN ?? DEFAULT_PLATFORM_ORIGIN;
  const hostedOriginPolicy: OriginPolicyOptions = { platformOrigin, allowPlatformOrigin: true };
  const serverRealToken = serverEnvironment.REAL_PUBLISHER_API_TOKEN ?? serverEnvironment.PUBLISHER_REAL_PUBLISHER_API_KEY;
  const serverRealUpstream = serverEnvironment.REAL_PUBLISHER_UPSTREAM_BASE_URL ?? serverEnvironment.REAL_PUBLISHER_API_BASE_URL;
  const realServerConfig = serverRealToken && serverRealUpstream ? { ...createRealPublisherApiConfig(serverEnvironment), baseUrl: serverRealUpstream, requestHeaders: { Accept: 'application/json', Authorization: `Bearer ${serverRealToken}` } } : undefined;
  const registry = createPublisherRegistry(realServerConfig, options.fetchImpl);
  const publisherStore = options.publisherStore ?? (environment === 'production' ? undefined : new MemoryPublisherStore(registry.list().flatMap((definition) => definition.manifest ? [definition.manifest] : [])));
  const resolveSecret = (reference: string): string | undefined => {
    const key = reference.replace(/^env:/, '');
    return /^[A-Z][A-Z0-9_]{1,100}$/.test(key) ? serverEnvironment[key] : undefined;
  };
  /** The publisher's WVC catalogue source, when its content source is the WVC API. */
  const wvcCatalogueSource = (publisherId: string): WvcCatalogueSourceConfig | undefined => {
    const source = registry.get(publisherId)?.manifest?.contentSource;
    return source?.type === 'wvc' ? source : undefined;
  };
  const publisherRuntime = new PublisherRuntime(registry, {
    store: publisherStore,
    fetchImpl: options.fetchImpl,
    cacheTtlMs: options.publisherCacheTtlMs ?? Number(serverEnvironment.PUBLISHER_CACHE_TTL_MS ?? 5000),
    resolveSecret,
    ...(options.articleTextStore?.cataloguePage ? { wvcCatalogueStore: options.articleTextStore as WvcCatalogueStore } : {}),
  });
  const analyticsStore = options.analyticsStore ?? new MemoryAnalyticsStore();
  const analyticsStoreMode: 'memory' | 'postgres' = options.analyticsStoreMode ?? (options.analyticsStore ? 'postgres' : 'memory');
  const reportStore = options.reportStore ?? new MemoryReportStore();
  const logger = options.logger ?? createStructuredLogger(environment);
  const publisherLimiter = new SlidingWindowRateLimiter({ limit: options.rateLimits?.publisher ?? 60 });
  const aiLimiter = new SlidingWindowRateLimiter({ limit: options.rateLimits?.ai ?? 10 });
  const analyticsLimiter = new SlidingWindowRateLimiter({ limit: options.rateLimits?.analytics ?? 120 });
  const generationLimiter = new SlidingWindowRateLimiter({ limit: options.rateLimits?.generation ?? 12 });
  // The loading page polls about every 600 ms, so status gets its own, larger budget.
  const generationStatusLimiter = new SlidingWindowRateLimiter({ limit: options.rateLimits?.generationStatus ?? 240 });
  const adminAuth = new AdminAuth(environment, serverEnvironment);
  const aiConfig = createAIConfig(serverEnvironment);
  const aiProvider = options.aiProvider ?? (environment !== 'production' && aiConfig.provider === 'mock' ? undefined : aiConfig.enabled && aiConfig.apiKey ? new OpenAICompatibleProvider({ endpoint: aiConfig.endpoint, apiKey: aiConfig.apiKey, model: aiConfig.model, timeoutMs: Math.min(aiConfig.timeoutMs, AI_OPERATION_TIMEOUT_CAP_MS), maxTokens: aiConfig.maxTokens, stageMaxTokens: aiConfig.stageMaxTokens, temperature: aiConfig.temperature, reasoningEffort: aiConfig.reasoningEffort }, options.fetchImpl) : undefined);
  const analyticsRoute = createAnalyticsIngestionRoute(analyticsStore, { isPublisherAllowed: (publisherId) => registry.has(publisherId) });
  const realToken = serverRealToken;
  const realUpstream = serverRealUpstream;
  const realProxy = realToken && realUpstream ? createRealPublisherProxy({ upstreamBaseUrl: realUpstream, searchEndpoint: serverEnvironment.REAL_PUBLISHER_SEARCH_ENDPOINT ?? '/search', articleEndpoint: serverEnvironment.REAL_PUBLISHER_ARTICLE_ENDPOINT ?? '/articles/:id', apiToken: realToken, timeoutMs: Number(serverEnvironment.REAL_PUBLISHER_TIMEOUT_MS ?? 8000), allowedQueryParameters: ['q', 'page', 'limit'] }, options.fetchImpl) : undefined;
  const publisherSearchRoute = createPublisherSearchRoute(registry, (publisherId) => {
    const source = registry.get(publisherId)?.manifest?.contentSource;
    return publisherId === 'real-publisher' && source?.type === 'rest-json' && source.baseUrl.startsWith('/api/') ? realProxy : undefined;
  });
  const aiRoute = aiProvider ? createAIProxy(aiProvider) : undefined;
  const companyContextProvider = options.companyContextProvider ?? new SafeCompanyContextProvider(options.fetchImpl ?? fetch);
  const companyInputResolver = options.companyInputResolver ?? new BoundedCompanyInputResolver(options.fetchImpl ?? fetch);
  const reportAI = aiProvider ? { config: aiConfig, provider: aiProvider } : undefined;
  // Kill switch: without WVC_ENRICHMENT_ENABLED=true nothing is fetched and stored text is never used.
  const articleTextStore = options.articleTextStore;
  const textEnrichmentEnabled = serverEnvironment.WVC_ENRICHMENT_ENABLED === 'true' && Boolean(articleTextStore);
  const catalogueCache = new PublisherCatalogueCache({
    ttlMs: options.catalogueCacheTtlMs ?? Number(serverEnvironment.PUBLISHER_CATALOGUE_CACHE_TTL_MS ?? 5 * 60 * 1000),
    maxStaleMs: options.catalogueCacheMaxStaleMs ?? Number(serverEnvironment.PUBLISHER_CATALOGUE_MAX_STALE_MS ?? 24 * 60 * 60 * 1000),
    snapshotStore: options.catalogueSnapshotStore,
    // Match indexes are built in the background after every catalogue load so first requests do not pay for them.
    prebuildIndexes: serverEnvironment.PUBLISHER_INDEX_PREBUILD !== 'false',
    onStage: (publisherId, stage) => logHeapUsage(logger, stage, publisherId),
    // Lead excerpts of the full text join the match indexes as hashes; the text stays in Postgres.
    leadExcerpts: textEnrichmentEnabled && articleTextStore ? {
      covers: (publisherId) => Boolean(enrichmentSourceFor(publisherId) ?? wvcCatalogueSource(publisherId)),
      page: (publisherId, after, limit) => articleTextStore.leadPage(publisherId, after, limit, LEAD_MATCH_CHARS),
      forStoryCodes: (publisherId, storyCodes) => articleTextStore.leads(publisherId, storyCodes, LEAD_MATCH_CHARS),
    } : undefined,
    onLeadsAttached: (publisherId, stats) => logger.info('lead_index_update', { publisherId, stage: stats.trigger, leadCount: stats.leadCount, durationMs: Math.round(stats.durationMs) }),
    onRefreshComplete: (publisherId, report) => logger.info('catalogue_refresh_complete', {
      publisherId,
      durationMs: Math.round(report.refreshMs),
      articleCount: report.articleCount,
      operation: `snapshot_${report.snapshot}`,
      snapshotSaveMs: Math.round(report.snapshotSaveMs),
    }),
    onIndexPrebuilt: (publisherId, stats) => logger.info('index_prebuild_complete', {
      publisherId,
      stage: stats.trigger,
      durationMs: Math.round(stats.durationMs),
      busyMs: Math.round(stats.busyMs),
      articleCount: stats.articleCount,
      slices: stats.slices,
    }),
    onRefreshError: (publisherId, error, background) => logger.error('catalogue_refresh_failed', {
      publisherId,
      stage: 'catalogue_refresh',
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: safeLogText(error instanceof Error ? error.message : 'Catalogue refresh failed.'),
      operation: background ? 'background' : 'foreground',
    }),
  });
  const textSyncs = new Map<string, TextEnrichmentSync>();
  if (articleTextStore) {
    for (const publisherId of enrichedPublisherIds()) {
      const source = enrichmentSourceFor(publisherId)!;
      textSyncs.set(publisherId, new TextEnrichmentSync({ publisherId, source, store: articleTextStore, resolveSecret, fetchImpl: options.fetchImpl, logger, runExclusive: (job) => catalogueCache.runExclusive(job), onTextsChanged: (id, storyCodes) => { if (textEnrichmentEnabled) void catalogueCache.updateLeads(id, storyCodes); } }));
    }
  }
  // WVC catalogue sources: the API is the catalogue, so their sync runs whenever a Postgres store exists (the
  // WVC_ENRICHMENT_ENABLED switch still governs using full text for matching and AI). Publishers can be added in
  // the admin, so the registry is rescanned periodically.
  const catalogueSyncs = new Map<string, TextEnrichmentSync>();
  const ensureCatalogueSyncs = async (): Promise<string[]> => {
    if (!articleTextStore?.upsertCatalogue) return [];
    await publisherRuntime.ensureLoaded();
    const started: string[] = [];
    for (const definition of registry.list()) {
      const publisherId = definition.config.publisherId;
      const source = wvcCatalogueSource(publisherId);
      if (!source || catalogueSyncs.has(publisherId) || wvcCatalogueConfigErrors(source).length) continue;
      const sync = new TextEnrichmentSync({ publisherId, source: wvcCatalogueFetchConfig(source), catalogue: wvcCatalogueParseOptions(source), store: articleTextStore, resolveSecret, fetchImpl: options.fetchImpl, logger, runExclusive: (job) => catalogueCache.runExclusive(job), onTextsChanged: (id, storyCodes) => { if (textEnrichmentEnabled) void catalogueCache.updateLeads(id, storyCodes); } });
      catalogueSyncs.set(publisherId, sync);
      textSyncs.set(publisherId, sync);
      sync.start();
      started.push(publisherId);
    }
    if (started.length) logger.info('wvc_catalogue_sync_started', { operation: started.join(',') });
    return started;
  };
  let catalogueRescan: ReturnType<typeof setInterval> | undefined;
  const textEnrichmentStatus = async (publisherId: string) => textSyncs.get(publisherId)?.status(catalogueSyncs.has(publisherId) || textEnrichmentEnabled);
  const reportGeneration = new ReportGenerationService(registry, companyContextProvider, reportStore, analyticsStore, reportAI, logger, (publisherId) => { const diagnostics = publisherRuntime.describe(publisherId); return { ...diagnostics, maxResponseBytes: diagnostics.maxBytes }; }, companyInputResolver, catalogueCache, textEnrichmentEnabled && articleTextStore ? { covers: (publisherId) => Boolean(enrichmentSourceFor(publisherId)), leads: (publisherId, storyCodes, maxChars) => articleTextStore.leads(publisherId, storyCodes, maxChars) } : undefined);
  const generationJobs = new GenerationJobs({
    store: options.generationJobStore ?? new MemoryGenerationJobStore(),
    onPersistError: (error) => logger.error('generation_status_write_failed', { errorName: error instanceof Error ? error.name : 'unknown', errorMessage: safeLogText(error instanceof Error ? error.message : 'Generation status write failed.', 240) }),
  });
  const reportRoutes = createReportRoutes(registry, reportGeneration, reportStore, generationJobs);
  const adminRoutes = createAdminRoutes({ registry, publisherRuntime, analyticsStore, generation: reportGeneration, auth: adminAuth, environment, logger, textEnrichmentStatus, inspectWvcSource: (source) => inspectWvcCatalogue(source, { fetchImpl: options.fetchImpl, resolveSecret }) });

  const trustedProxy = options.trustedProxy ?? false;
  const handle = async (request: Request): Promise<Response> => {
    const started = Date.now();
    const runtimeStarted = Date.now();
    const requestId = request.headers.get('X-Request-ID') || createRequestId();
    const url = new URL(request.url);
    let publisherId: string | null = null;
    let manifest: PublisherManifest | undefined;
    try {
      await publisherRuntime.ensureLoaded();
      publisherId = safeRouteId(url.pathname.match(/^\/api\/publishers\/([^/]+)/)?.[1] ?? url.pathname.match(/^\/api\/analytics\/([^/]+)/)?.[1]);
      const runtimeDefinition = publisherId ? await publisherRuntime.get(publisherId) : undefined;
      manifest = allowedOriginsFor(runtimeDefinition?.manifest, serverEnvironment);
      if (url.pathname.startsWith('/api/admin/')) return await adminRoutes(request, requestId);
      if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
        const hostedApiRoute = url.pathname === '/api/analytics/events' || url.pathname.startsWith('/api/analytics/') || url.pathname.startsWith('/api/reports/') || url.pathname.startsWith('/api/generations/') || url.pathname === '/api/reports/generate';
        const preflightManifest = hostedApiRoute && !manifest && request.headers.get('Origin')
          ? registry.list().map((definition) => allowedOriginsFor(definition.manifest, serverEnvironment)).find((candidate) => originAllowed(candidate, request.headers.get('Origin'), environment))
          : manifest;
        return withHeaders(corsPreflight(preflightManifest, request, environment, hostedApiRoute ? hostedOriginPolicy : undefined), request, preflightManifest, environment, requestId, hostedApiRoute ? hostedOriginPolicy : undefined);
      }
      if (url.pathname === '/health' && request.method === 'GET') return withHeaders(createGlobalHealthResponse(environment, options.commitSha), request, undefined, environment, requestId);
      if ((url.pathname === '/ready' || url.pathname === '/readiness') && request.method === 'GET') return withHeaders(createReadinessResponse(environment, analyticsStoreMode, options.commitSha), request, undefined, environment, requestId);
      if (url.pathname.match(/^\/api\/publishers\/[^/]+\/health$/) && request.method === 'GET' && publisherId) {
        if (!manifest || !originAllowed(manifest, request.headers.get('Origin'), environment)) return jsonError('origin_not_allowed', 403, requestId);
        if (registry.get(publisherId)?.manifest?.enabled === false) return jsonError('publisher_not_found', 404, requestId);
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
        let analyticsManifest: PublisherManifest | undefined;
        if (environment === 'production' && request.headers.get('Origin')) {
          const origin = request.headers.get('Origin');
          if (!registry.list().some((definition) => originAllowed(allowedOriginsFor(definition.manifest, serverEnvironment), origin, environment, hostedOriginPolicy))) return jsonError('origin_not_allowed', 403, requestId);
          try {
            const body = await raw.json() as { events?: Array<{ publisherId?: string }> };
            const ids = Array.isArray(body.events) ? [...new Set(body.events.map((event) => event.publisherId).filter((id): id is string => Boolean(id)))] : [];
            if (ids.length === 0 || ids.some((id) => !originAllowed(allowedOriginsFor(registry.get(id)?.manifest, serverEnvironment), request.headers.get('Origin'), environment, hostedOriginPolicy))) return jsonError('origin_not_allowed', 403, requestId);
            analyticsManifest = ids[0] ? allowedOriginsFor(registry.get(ids[0])?.manifest, serverEnvironment) : undefined;
          } catch { return jsonError('invalid_json', 400, requestId); }
        }
        return withHeaders(await analyticsRoute(request), request, analyticsManifest, environment, requestId, hostedOriginPolicy);
      }
      if (url.pathname === '/api/reports/generate' || url.pathname.startsWith('/api/reports/') || url.pathname.startsWith('/api/generations/')) {
        let reportManifest = manifest;
        if (url.pathname === '/api/reports/generate') {
          try {
            const body = await request.clone().json() as Record<string, unknown>;
            const requestedPublisher = typeof body.publisherId === 'string' ? safeRouteId(body.publisherId) : null;
            reportManifest = requestedPublisher ? allowedOriginsFor(registry.get(requestedPublisher)?.manifest, serverEnvironment) : undefined;
          } catch { reportManifest = undefined; }
          if (!reportManifest || !originAllowed(reportManifest, request.headers.get('Origin'), environment, hostedOriginPolicy)) return jsonError('origin_not_allowed', 403, requestId);
          const decision = generationLimiter.check(requestRateLimitKey(request, 'report-generation', reportManifest.publisherId, trustedProxy));
          if (!decision.allowed) return withHeaders(new Response(JSON.stringify({ error: 'rate_limited', requestId }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(decision.retryAfterSeconds) } }), request, reportManifest, environment, requestId);
        } else {
          const requestedPublisher = safeRouteId(url.searchParams.get('publisherId') ?? undefined);
          reportManifest = requestedPublisher ? allowedOriginsFor(registry.get(requestedPublisher)?.manifest, serverEnvironment) : undefined;
          if (request.headers.get('Origin') && (!reportManifest || !originAllowed(reportManifest, request.headers.get('Origin'), environment, hostedOriginPolicy))) return jsonError('origin_not_allowed', 403, requestId);
          if (url.pathname.startsWith('/api/generations/') && url.pathname.endsWith('/retry')) {
            // A retry starts a new generation, so it shares the generation budget.
            const decision = generationLimiter.check(requestRateLimitKey(request, 'report-generation', reportManifest?.publisherId ?? 'unknown', trustedProxy));
            if (!decision.allowed) return withHeaders(new Response(JSON.stringify({ error: 'rate_limited', requestId }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(decision.retryAfterSeconds) } }), request, reportManifest, environment, requestId, hostedOriginPolicy);
          } else if (url.pathname.startsWith('/api/generations/')) {
            const decision = generationStatusLimiter.check(requestRateLimitKey(request, 'generation-status', reportManifest?.publisherId ?? 'unknown', trustedProxy));
            if (!decision.allowed) return withHeaders(new Response(JSON.stringify({ error: 'rate_limited', requestId }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(decision.retryAfterSeconds) } }), request, reportManifest, environment, requestId, hostedOriginPolicy);
          }
        }
        return withHeaders(await reportRoutes(request, requestId, { runtimeMs: Date.now() - runtimeStarted }), request, reportManifest, environment, requestId, hostedOriginPolicy);
      }
      const overviewMatch = url.pathname.match(/^\/api\/analytics\/([^/]+)\/overview$/);
      if (overviewMatch && request.method === 'GET' && publisherId) {
        if (!manifest || !originAllowed(manifest, request.headers.get('Origin'), environment, hostedOriginPolicy)) return jsonError('origin_not_allowed', 403, requestId);
        if (registry.get(publisherId)?.manifest?.enabled === false) return jsonError('publisher_not_found', 404, requestId);
        const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
        const range = from && to ? { from, to } : undefined;
        const events = await analyticsStore.query({ publisherId, range });
        const report = buildAnalyticsReport(Array.isArray(events) ? events : [], publisherId, range);
        return withHeaders(Response.json({ ...report, publisherName: manifest.name }), request, manifest, environment, requestId, hostedOriginPolicy);
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
            const input = body.input && typeof body.input === 'object' ? body.input as Record<string, unknown> : undefined;
            const recommendations = Array.isArray(input?.recommendations) ? input.recommendations as Array<Record<string, unknown>> : [];
            const firstArticle = recommendations[0]?.article && typeof recommendations[0].article === 'object' ? recommendations[0].article as Record<string, unknown> : undefined;
            const aiPublisherId = typeof intent?.publisherId === 'string' ? intent.publisherId : typeof baseIntent?.publisherId === 'string' ? baseIntent.publisherId : typeof input?.publisherId === 'string' ? input.publisherId : typeof firstArticle?.publisherId === 'string' ? firstArticle.publisherId : undefined;
            aiManifestForResponse = aiPublisherId ? allowedOriginsFor(registry.get(aiPublisherId)?.manifest, serverEnvironment) : undefined;
            if (!aiManifestForResponse || !originAllowed(aiManifestForResponse, request.headers.get('Origin'), environment)) return jsonError('origin_not_allowed', 403, requestId);
          } catch { return jsonError('invalid_json', 400, requestId); }
        }
        return withHeaders(await aiRoute(request), request, aiManifestForResponse, environment, requestId);
      }
      return jsonError('not_found', 404, requestId);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'unknown';
      const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      const adminPublisherId = safeRouteId(url.pathname.match(/^\/api\/admin\/publishers\/([^/]+)/)?.[1]);
      const operation = url.pathname === '/api/admin/publishers' ? 'admin_publisher_list' : url.pathname.startsWith('/api/admin/') ? 'admin_request' : undefined;
      logger.error('request_failed', {
        requestId,
        publisherId: publisherId ?? adminPublisherId ?? undefined,
        route: url.pathname,
        operation,
        durationMs: Date.now() - started,
        status: 500,
        errorType: errorName,
        errorName,
        errorMessage: safeLogText(errorMessage),
        errorStack: safeLogText(errorStack, 6_000),
      });
      return jsonError('internal_error', 500, requestId);
    } finally {
      logger.info('request_completed', { requestId, publisherId: publisherId ?? undefined, route: url.pathname, durationMs: Date.now() - started });
    }
  };
  return { handle, registry, publisherRuntime, publisherStore, analyticsStore, analyticsStoreMode, reportStore, generationJobs, adminAuth, flushAnalytics: () => reportGeneration.flushAnalytics(), flushEnrichmentRetries: () => reportGeneration.flushEnrichmentRetries(), logHeapUsage: (stage: string) => logHeapUsage(logger, stage), catalogueIdle: () => catalogueCache.idle(), prewarmCatalogues: async () => { await publisherRuntime.ensureLoaded(); return reportGeneration.prewarmCatalogues(); }, startTextEnrichment: (): string[] => {
    void ensureCatalogueSyncs().catch((error) => logger.error('wvc_catalogue_sync_failed', { errorName: error instanceof Error ? error.name : 'unknown' }));
    if (!catalogueRescan) { catalogueRescan = setInterval(() => { void ensureCatalogueSyncs().catch(() => undefined); }, 5 * 60 * 1000); (catalogueRescan as { unref?: () => void }).unref?.(); }
    if (!textEnrichmentEnabled) return [];
    const enrichment = [...textSyncs.entries()].filter(([publisherId]) => !catalogueSyncs.has(publisherId));
    for (const [, sync] of enrichment) sync.start();
    return enrichment.map(([publisherId]) => publisherId);
  }, stopTextEnrichment: () => { if (catalogueRescan) clearInterval(catalogueRescan); catalogueRescan = undefined; for (const sync of textSyncs.values()) sync.stop(); }, ensureCatalogueSyncs, textEnrichmentStatus };
}

export async function runConfiguredAIHealthCheck(serverEnvironment: Record<string, string | undefined> = {}, fetchImpl: typeof fetch = fetch): Promise<{ status: 'disabled' | 'ok'; provider?: string }> {
  const config = createAIConfig(serverEnvironment);
  if (!config.enabled || config.provider === 'none') return { status: 'disabled' };
  if (config.provider !== 'openai-compatible' || !config.apiKey) throw new Error('AI provider is enabled but server configuration is incomplete');
  const provider = new OpenAICompatibleProvider({ endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs, maxTokens: config.maxTokens, temperature: config.temperature, reasoningEffort: config.reasoningEffort }, fetchImpl);
  const company = { domain: 'health-check.example', canonicalUrl: 'https://health-check.example/', name: 'Health Check', industry: 'technology', description: 'A synthetic health-check company context.', topics: ['technology'], entities: ['Health Check'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'health-check' };
  const profile = buildProfessionalProfile(company, 'Technology professional');
  const result = await provider.enhanceProfessionalProfile({ publisherId: '__health_check__', submittedCompanyUrl: company.canonicalUrl, submittedJobTitle: profile.jobTitle, company, role: profile.role, profile });
  if (!validateProfessionalProfileEnhancement(result)) throw new Error('AI provider returned an invalid professional profile response');
  return { status: 'ok', provider: provider.providerName };
}
