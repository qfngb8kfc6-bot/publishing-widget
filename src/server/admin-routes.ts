import { buildAnalyticsReport } from '../analytics/metrics';
import type { AnalyticsStore } from '../analytics/types';
import { validateAllowedOrigins, validatePublisherManifest } from '../core/config';
import type { PublisherRegistry } from '../core';
import type { PublisherManifest } from '../publishers/manifest';
import type { ContentImportDiagnostics, ContentSourceConfig } from '../publishers/content';
import { PublisherStoreError } from '../publishers/store';
import type { PublisherRuntime, PublisherRuntimeCapabilities } from '../publishers/runtime';
import { ContentSourceError } from '../publishers/content/security';
import type { ReportGenerationService } from '../reports/generate';
import { AdminAuth, adminOriginAllowed } from './admin-auth';
import { readJsonBody, safeRouteId } from './request-validation';
import { safeLogText, type StructuredLogger } from './logging';

interface AdminRoutesOptions {
  registry: PublisherRegistry;
  publisherRuntime: PublisherRuntime;
  analyticsStore: AnalyticsStore;
  generation: ReportGenerationService;
  auth: AdminAuth;
  environment: 'development' | 'test' | 'production';
  logger?: StructuredLogger;
}

interface ContentCheckResult {
  checkedAt: string;
  sourceType: string;
  reachable: boolean;
  recordsFetched: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  warnings: string[];
  elapsedMs: number;
  sampleTitles: string[];
  coverage: { image: number; publishedAt: number; description: number };
  error?: { code: string; status?: number; message: string };
}

const sensitiveHeader = /authorization|api[-_]?key|token|secret|password|cookie|set-cookie/i;

function safeText(value: unknown, limit = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) || undefined;
}

function safeError(error: unknown): { code: string; status?: number; message: string } {
  if (error instanceof ContentSourceError) return { code: error.code, status: error.status, message: safeText(error.message) ?? 'Content source check failed.' };
  return { code: 'source_check_failed', message: 'Content source check failed without exposing upstream details.' };
}

function safeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !sensitiveHeader.test(name)).map(([name, value]) => [name, safeText(value, 200) ?? '']));
}

function safeSource(source: ContentSourceConfig | undefined): Record<string, unknown> | undefined {
  if (!source) return undefined;
  const copy = { ...source } as Record<string, unknown>;
  if ('headers' in copy) copy.headers = safeHeaders(copy.headers as Record<string, string> | undefined);
  if ('authentication' in copy && copy.authentication && typeof copy.authentication === 'object') {
    const authentication = { ...(copy.authentication as Record<string, unknown>) };
    delete authentication.secret;
    authentication.secretConfigured = Boolean(authentication.secretRef);
    return { ...copy, authentication };
  }
  return copy;
}

export function safeManifest(manifest: PublisherManifest, capabilities: PublisherRuntimeCapabilities = { persistenceMode: 'static', writable: false, databaseBacked: false, createAllowed: false, editAllowed: false }): Record<string, unknown> {
  return {
    ...manifest,
    branding: { ...manifest.branding },
    content: { ...manifest.content },
    contentSource: safeSource(manifest.contentSource),
    api: manifest.api ? { ...manifest.api } : undefined,
    allowedOrigins: manifest.allowedOrigins ? [...manifest.allowedOrigins] : [],
    admin: { ...capabilities, persistence: capabilities.persistenceMode === 'postgres' ? 'publisher-store' : capabilities.persistenceMode, secretHandling: 'server-side-references-only' },
  };
}

function sourceType(definition: ReturnType<PublisherRegistry['get']>): string | null {
  const adapter = definition?.adapter as unknown as { sourceType?: unknown } | undefined;
  const configured = definition?.manifest?.contentSource?.type;
  if (typeof configured === 'string' && configured) return configured;
  if (typeof adapter?.sourceType === 'string' && adapter.sourceType) return adapter.sourceType;
  const adapterId = definition?.manifest?.content?.adapterId ?? definition?.config?.content?.adapterType;
  return typeof adapterId === 'string' && adapterId ? adapterId : null;
}

function sourceConfigured(manifest: PublisherManifest | undefined): boolean {
  const source = manifest?.contentSource as (ContentSourceConfig & { feed?: unknown; url?: unknown }) | undefined;
  if (!source || typeof source !== 'object' || typeof source.type !== 'string') return false;
  if (source.type === 'rss' || source.type === 'atom') return [source.feedUrl, source.feed, source.url].some((value) => typeof value === 'string' && value.trim().length > 0);
  if (source.type === 'sitemap') return typeof source.sitemapUrl === 'string' && source.sitemapUrl.trim().length > 0;
  if (source.type === 'rest-json') return typeof source.baseUrl === 'string' && typeof source.endpoint === 'string' && Boolean(source.baseUrl.trim() && source.endpoint.trim());
  return source.type === 'json' || source.type === 'csv' || source.type === 'static-demo';
}

function generationFailureStage(error: unknown): string {
  if (error instanceof ContentSourceError && error.code === 'source_response_too_large') return 'source_response_size';
  if (error instanceof ContentSourceError) return 'source_retrieval';
  if (error instanceof PublisherStoreError) return 'publisher_runtime';
  if (error instanceof Error && error.message === 'invalid_publisher') return 'publisher_resolution';
  if (error instanceof Error && /company|domain/i.test(error.message)) return 'company_context';
  return 'generation';
}

function safeBrandingSummary(definition: ReturnType<PublisherRegistry['get']>): { primaryColor: string | null; logo: string | null } | null {
  const branding = definition?.manifest?.branding ?? definition?.config?.branding;
  if (!branding || typeof branding !== 'object') return null;
  const primaryColor = 'primaryAccent' in branding && typeof branding.primaryAccent === 'string' ? branding.primaryAccent : 'primaryColor' in branding && typeof branding.primaryColor === 'string' ? branding.primaryColor : null;
  const logo = 'logo' in branding && typeof branding.logo === 'string' ? branding.logo : null;
  return { primaryColor, logo };
}

function safePublisherSummary(definition: ReturnType<PublisherRegistry['get']>, lastCheck: ContentCheckResult | undefined): Record<string, unknown> {
  const id = definition?.manifest?.publisherId ?? definition?.config?.publisherId ?? 'unknown';
  const origins = definition?.manifest?.allowedOrigins;
  const primaryOrigin = Array.isArray(origins) && typeof origins[0] === 'string' ? origins[0] : null;
  return {
    id,
    publisherId: id,
    name: typeof definition?.manifest?.name === 'string' ? definition.manifest.name : definition?.config?.publisherName ?? 'Unknown publisher',
    enabled: definition?.manifest?.enabled !== false,
    primaryOrigin,
    sourceType: sourceType(definition),
    brandingSummary: safeBrandingSummary(definition),
    healthStatus: lastCheck ? (lastCheck.reachable ? 'reachable' : 'unavailable') : 'unknown',
    contentCheck: lastCheck ?? null,
  };
}

function contentDiagnostics(definition: NonNullable<ReturnType<PublisherRegistry['get']>>): ContentImportDiagnostics | undefined {
  const adapter = definition.adapter as { lastDiagnostics?: ContentImportDiagnostics };
  return adapter.lastDiagnostics;
}

function checkIntent(publisherId: string) {
  return { publisherId, answers: { companyUrl: 'https://ldsystems.uk/', jobTitle: 'Technology professional' }, queryText: 'technology professional company developments', keywords: ['technology', 'professional', 'company', 'developments'], interests: ['technology', 'business'], personas: ['professional'] };
}

async function runContentCheck(definition: NonNullable<ReturnType<PublisherRegistry['get']>>, logger?: StructuredLogger, registryMode?: string): Promise<ContentCheckResult> {
  const started = Date.now();
  const adapter = definition.adapter;
  try {
    const records = await adapter.search(checkIntent(definition.config.publisherId), { limit: Math.min(100, Math.max(30, definition.config.content.candidateRetrievalLimit)) });
    const articles = records.flatMap((record) => { const normalized = adapter.normalizeArticle(record); return normalized ? [normalized] : []; });
    const diagnostics = contentDiagnostics(definition);
    const denominator = Math.max(1, articles.length);
    return {
      checkedAt: new Date().toISOString(), sourceType: sourceType(definition) ?? 'unknown', reachable: true, recordsFetched: diagnostics?.sourceStats?.feedItemsFetched ?? records.length,
      accepted: diagnostics?.accepted ?? articles.length, rejected: diagnostics?.rejected ?? Math.max(0, records.length - articles.length), duplicates: diagnostics?.duplicates ?? 0,
      warnings: diagnostics?.issues.filter((issue) => issue.status === 'warning').map((issue) => safeText(issue.message) ?? 'Source warning.').slice(0, 10) ?? [], elapsedMs: Date.now() - started,
      sampleTitles: articles.map((article) => article.title).filter(Boolean).slice(0, 5), coverage: {
        image: Math.round((articles.filter((article) => article.imageUrl).length / denominator) * 100),
        publishedAt: Math.round((articles.filter((article) => article.publishedAt).length / denominator) * 100),
        description: Math.round((articles.filter((article) => article.description || article.contentSnippet).length / denominator) * 100),
      },
    };
  } catch (error) {
    const sourceError = error instanceof ContentSourceError ? error : undefined;
    logger?.error('content_check_failed', {
      publisherId: definition.config.publisherId,
      registryMode,
      sourceType: sourceType(definition) ?? undefined,
      sourceConfigured: sourceConfigured(definition.manifest),
      adapterResolved: Boolean(definition.adapter),
      failureStage: generationFailureStage(error),
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: safeLogText(error instanceof Error ? error.message : 'Content source check failed.'),
      errorStack: safeLogText(error instanceof Error ? error.stack : undefined, 6_000),
      contentLength: sourceError?.contentLength,
      maxResponseBytes: sourceError?.maxBytes,
    });
    return { checkedAt: new Date().toISOString(), sourceType: sourceType(definition) ?? 'unknown', reachable: false, recordsFetched: 0, accepted: 0, rejected: 0, duplicates: 0, warnings: [], elapsedMs: Date.now() - started, sampleTitles: [], coverage: { image: 0, publishedAt: 0, description: 0 }, error: safeError(error) };
  }
}

async function readOptionalJsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const text = await request.text();
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    throw new Error('invalid_json');
  }
}

function manifestBody(body: Record<string, unknown>): PublisherManifest {
  const value = body.manifest && typeof body.manifest === 'object' && !Array.isArray(body.manifest) ? body.manifest : body;
  return value as unknown as PublisherManifest;
}

function mutationError(error: unknown): Response {
  if (error instanceof PublisherStoreError && error.code === 'already_exists') return Response.json({ error: 'publisher_already_exists' }, { status: 409 });
  if (error instanceof PublisherStoreError && error.code === 'not_found') return Response.json({ error: 'publisher_not_found' }, { status: 404 });
  if (error instanceof PublisherStoreError && error.code === 'invalid_record') return Response.json({ error: 'publisher_configuration_invalid' }, { status: 400 });
  if (error instanceof PublisherStoreError && error.code === 'unavailable') return Response.json({ error: 'publisher_persistence_unavailable' }, { status: 503 });
  return Response.json({ error: 'publisher_persistence_unavailable' }, { status: 503 });
}

function analyticsSummary(report: ReturnType<typeof buildAnalyticsReport>) {
  return { widgetOpens: report.overview.widgetOpens, reportsGenerated: report.overview.reportsGenerated, storyClicks: report.overview.storyClicks, generationSuccessRate: report.generationHealth.generationSuccessRate };
}

function invalidMethod(): Response { return Response.json({ error: 'method_not_allowed' }, { status: 405 }); }

export function createAdminRoutes(options: AdminRoutesOptions) {
  const lastContentChecks = new Map<string, ContentCheckResult>();
  const capabilities = (): PublisherRuntimeCapabilities => options.publisherRuntime.capabilities();
  const legacyPersistence = (current: PublisherRuntimeCapabilities): 'publisher-store' | 'static' => current.persistenceMode === 'static' ? 'static' : 'publisher-store';
  const requireAdmin = (request: Request): Response | undefined => {
    if (!options.auth.isAuthenticated(request)) return Response.json({ error: 'admin_auth_required' }, { status: 401 });
    if (!adminOriginAllowed(request)) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
    return undefined;
  };

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/admin/')) return Response.json({ error: 'not_found' }, { status: 404 });
    if (url.pathname === '/api/admin/session' && request.method === 'GET') return Response.json({ authenticated: options.auth.isAuthenticated(request), configured: options.auth.configured });
    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      if (!adminOriginAllowed(request)) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
      try {
        const body = await readJsonBody(request, 8_000) as Record<string, unknown>;
        const result = await options.auth.verify(typeof body.password === 'string' ? body.password : '', request);
        if (result.retryAfterSeconds) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(result.retryAfterSeconds) } });
        if (!result.ok) return Response.json({ error: options.auth.configured ? 'invalid_admin_credentials' : 'admin_not_configured' }, { status: options.auth.configured ? 401 : 503 });
        return new Response(JSON.stringify({ authenticated: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': result.cookie! } });
      } catch (error) { return Response.json({ error: error instanceof Error && error.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_json' }, { status: 400 }); }
    }
    if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
      if (!options.auth.isAuthenticated(request)) return Response.json({ authenticated: false }, { status: 200 });
      if (!adminOriginAllowed(request)) return Response.json({ error: 'origin_not_allowed' }, { status: 403 });
      return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': options.auth.logout(request) } });
    }
    const denied = requireAdmin(request);
    if (denied) return denied;
    if (url.pathname === '/api/admin/publishers' && request.method === 'GET') {
      const publishers = (await options.publisherRuntime.list()).map((definition) => ({
        ...safePublisherSummary(definition, lastContentChecks.get(definition.config.publisherId)),
        environment: definition.manifest?.environment ?? 'development',
        allowedOrigins: Array.isArray(definition.manifest?.allowedOrigins) ? [...definition.manifest.allowedOrigins] : [],
      }));
      const current = capabilities();
      return Response.json({ publishers, persistence: legacyPersistence(current), capabilities: current });
    }
    if (url.pathname === '/api/admin/publishers' && request.method === 'POST') {
      try {
        const body = await readJsonBody(request, 64_000) as Record<string, unknown>;
        const manifest = manifestBody(body);
        validatePublisherManifest(manifest, { allowDisabled: true });
        validateAllowedOrigins(manifest.allowedOrigins);
        const definition = await options.publisherRuntime.create(manifest);
        const current = capabilities();
        return Response.json({ publisher: safeManifest(definition.manifest!, current), persistence: legacyPersistence(current), capabilities: current }, { status: 201 });
      } catch (error) {
        if (error instanceof Error && ['invalid_json', 'payload_too_large'].includes(error.message)) return Response.json({ error: error.message }, { status: 400 });
        if (error instanceof Error && !(error instanceof PublisherStoreError)) return Response.json({ error: safeText(error.message) ?? 'invalid_publisher' }, { status: 400 });
        return mutationError(error);
      }
    }
    const match = url.pathname.match(/^\/api\/admin\/publishers\/([^/]+)(?:\/(content-check|test-report|validate|export|config))?$/);
    if (!match) return Response.json({ error: 'not_found' }, { status: 404 });
    const publisherId = safeRouteId(match[1]);
    if (!publisherId) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
    const action = match[2];
    let definition: ReturnType<PublisherRegistry['get']> | undefined;
    try {
      definition = publisherId ? await options.publisherRuntime.get(publisherId) : undefined;
    } catch (error) {
      if (action === 'test-report') {
        const fallback = options.registry.get(publisherId);
        const current = capabilities();
        options.logger?.error('admin_generation_unavailable', {
          publisherId,
          registryMode: current.persistenceMode,
          sourceType: sourceType(fallback) ?? undefined,
          sourceConfigured: sourceConfigured(fallback?.manifest),
          adapterResolved: false,
          failureStage: 'publisher_runtime',
          errorName: error instanceof Error ? error.name : 'unknown',
          errorMessage: safeLogText(error instanceof Error ? error.message : 'Publisher runtime could not be resolved.'),
          errorStack: safeLogText(error instanceof Error ? error.stack : undefined, 6_000),
        });
        return Response.json({ error: 'generation_unavailable' }, { status: 503 });
      }
      throw error;
    }
    if (!definition) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
    const manifest = definition.manifest ?? manifestFromDefinition(definition);
    if (!action && request.method === 'GET') {
      const events = await options.analyticsStore.query({ publisherId });
      const report = buildAnalyticsReport(Array.isArray(events) ? events : [], publisherId);
      const current = capabilities();
      return Response.json({ publisher: safeManifest(manifest, current), analytics: analyticsSummary(report), lastContentCheck: lastContentChecks.get(publisherId) ?? null, embed: `<script src="${new URL('/widget.js', request.url).toString()}" data-publisher="${publisherId}" defer></script>`, links: { analytics: `/analytics?publisher=${encodeURIComponent(publisherId)}`, publicDemo: `/?publisher=${encodeURIComponent(publisherId)}` }, persistence: legacyPersistence(current), capabilities: current });
    }
    if (action === 'content-check' && request.method === 'POST') {
      try {
        const body = await readOptionalJsonBody(request);
        let checkDefinition = definition;
        if (body) {
          const draft = manifestBody(body);
          validatePublisherManifest(draft, { allowDisabled: true });
          validateAllowedOrigins(draft.allowedOrigins);
          if (draft.publisherId !== publisherId) return Response.json({ error: 'publisher_id_mismatch' }, { status: 400 });
          checkDefinition = options.publisherRuntime.draft(draft);
        }
        const result = await runContentCheck(checkDefinition, options.logger, capabilities().persistenceMode);
        lastContentChecks.set(publisherId, result);
        return Response.json(result, { status: result.reachable ? 200 : 502 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? safeText(error.message) ?? 'invalid_content_check' : 'invalid_content_check' }, { status: 400 });
      }
    }
    if (action === 'export' && request.method === 'GET') return Response.json(safeManifest(definition.manifest ?? manifestFromDefinition(definition), capabilities()));
    if (action === 'validate' && request.method === 'POST') {
      try {
        const draft = await readJsonBody(request, 64_000) as PublisherManifest;
        validatePublisherManifest(draft, { allowDisabled: true }); validateAllowedOrigins(draft.allowedOrigins);
        return Response.json({ valid: true, publisherId: draft.publisherId, message: 'Draft is valid. Save it to persist the publisher configuration.' });
      } catch (error) { return Response.json({ valid: false, error: error instanceof Error ? safeText(error.message) ?? 'invalid_manifest' : 'invalid_manifest' }, { status: 400 }); }
    }
    if (action === 'test-report' && request.method === 'POST') {
      try {
        const body = await readJsonBody(request, 16_000) as Record<string, unknown>;
        const companyUrl = typeof body.companyUrl === 'string' ? body.companyUrl : '';
        const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle : '';
        if (!companyUrl.trim() || !jobTitle.trim() || companyUrl.length > 253 || jobTitle.length > 160) return Response.json({ error: 'invalid_generation_input' }, { status: 400 });
        const report = await options.generation.generate({ publisherId, companyUrl, jobTitle });
        return Response.json({ generationId: report.id, status: 'complete', generationUrl: `/p/${publisherId}/generate/${report.id}`, reportUrl: `/p/${publisherId}/${report.id}`, reportId: report.id }, { status: 201 });
      } catch (error) {
        const current = capabilities();
        options.logger?.error('admin_generation_unavailable', {
          publisherId,
          registryMode: current.persistenceMode,
          sourceType: sourceType(definition) ?? undefined,
          sourceConfigured: sourceConfigured(definition.manifest),
          adapterResolved: Boolean(definition.adapter),
          failureStage: generationFailureStage(error),
          errorName: error instanceof Error ? error.name : 'unknown',
          errorMessage: safeLogText(error instanceof Error ? error.message : 'Generation failed.'),
          errorStack: safeLogText(error instanceof Error ? error.stack : undefined, 6_000),
        });
        return Response.json({ error: 'generation_unavailable' }, { status: 503 });
      }
    }
    if (action === 'config' && (request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT')) {
      try {
        const body = await readJsonBody(request, 64_000) as Record<string, unknown>;
        const draft = manifestBody(body);
        if (draft.publisherId !== publisherId) return Response.json({ error: 'publisher_id_mismatch' }, { status: 400 });
        validatePublisherManifest(draft, { allowDisabled: true });
        validateAllowedOrigins(draft.allowedOrigins);
        const updated = await options.publisherRuntime.update(draft);
        const current = capabilities();
        return Response.json({ publisher: safeManifest(updated.manifest!, current), persistence: legacyPersistence(current), capabilities: current });
      } catch (error) {
        if (error instanceof Error && ['invalid_json', 'payload_too_large'].includes(error.message)) return Response.json({ error: error.message }, { status: 400 });
        if (error instanceof Error && !(error instanceof PublisherStoreError)) return Response.json({ error: safeText(error.message) ?? 'invalid_publisher' }, { status: 400 });
        return mutationError(error);
      }
    }
    return invalidMethod();
  };
}

function manifestFromDefinition(definition: NonNullable<ReturnType<PublisherRegistry['get']>>): PublisherManifest {
  return { publisherId: definition.config.publisherId, name: definition.config.publisherName, enabled: true, environment: 'development', publisherConfigVersion: 'legacy', branding: definition.config.branding, content: { adapterId: definition.config.content.adapterType, resultLimit: definition.config.content.resultLimit, candidateRetrievalLimit: definition.config.content.candidateRetrievalLimit }, results: definition.config.results };
}
