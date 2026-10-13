import { buildAnalyticsReport } from '../analytics/metrics';
import type { AnalyticsStore } from '../analytics/types';
import { validateAllowedOrigins, validatePublisherManifest } from '../core/config';
import type { PublisherRegistry } from '../core';
import type { PublisherManifest } from '../publishers/manifest';
import type { ContentImportDiagnostics, ContentSourceConfig } from '../publishers/content';
import { ContentSourceError } from '../publishers/content/security';
import type { ReportGenerationService } from '../reports/generate';
import { AdminAuth, adminOriginAllowed } from './admin-auth';
import { readJsonBody, safeRouteId } from './request-validation';

interface AdminRoutesOptions {
  registry: PublisherRegistry;
  analyticsStore: AnalyticsStore;
  generation: ReportGenerationService;
  auth: AdminAuth;
  environment: 'development' | 'test' | 'production';
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

export function safeManifest(manifest: PublisherManifest): Record<string, unknown> {
  return {
    ...manifest,
    branding: { ...manifest.branding },
    content: { ...manifest.content },
    contentSource: safeSource(manifest.contentSource),
    api: manifest.api ? { ...manifest.api } : undefined,
    allowedOrigins: manifest.allowedOrigins ? [...manifest.allowedOrigins] : [],
    admin: { persistence: 'static-source', editable: false, secretHandling: 'server-side-references-only' },
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

async function runContentCheck(definition: NonNullable<ReturnType<PublisherRegistry['get']>>): Promise<ContentCheckResult> {
  const started = Date.now();
  const adapter = definition.adapter;
  try {
    const records = await adapter.search(checkIntent(definition.config.publisherId), { limit: Math.min(100, Math.max(30, definition.config.content.candidateRetrievalLimit)) });
    const articles = records.flatMap((record) => { const normalized = adapter.normalizeArticle(record); return normalized ? [normalized] : []; });
    const diagnostics = contentDiagnostics(definition);
    const denominator = Math.max(1, articles.length);
    return {
      checkedAt: new Date().toISOString(), sourceType: sourceType(definition) ?? 'unknown', reachable: true, recordsFetched: records.length,
      accepted: diagnostics?.accepted ?? articles.length, rejected: diagnostics?.rejected ?? Math.max(0, records.length - articles.length), duplicates: diagnostics?.duplicates ?? 0,
      warnings: diagnostics?.issues.filter((issue) => issue.status === 'warning').map((issue) => safeText(issue.message) ?? 'Source warning.').slice(0, 10) ?? [], elapsedMs: Date.now() - started,
      sampleTitles: articles.map((article) => article.title).filter(Boolean).slice(0, 5), coverage: {
        image: Math.round((articles.filter((article) => article.imageUrl).length / denominator) * 100),
        publishedAt: Math.round((articles.filter((article) => article.publishedAt).length / denominator) * 100),
        description: Math.round((articles.filter((article) => article.description || article.contentSnippet).length / denominator) * 100),
      },
    };
  } catch (error) {
    return { checkedAt: new Date().toISOString(), sourceType: sourceType(definition) ?? 'unknown', reachable: false, recordsFetched: 0, accepted: 0, rejected: 0, duplicates: 0, warnings: [], elapsedMs: Date.now() - started, sampleTitles: [], coverage: { image: 0, publishedAt: 0, description: 0 }, error: safeError(error) };
  }
}

function analyticsSummary(report: ReturnType<typeof buildAnalyticsReport>) {
  return { widgetOpens: report.overview.widgetOpens, reportsGenerated: report.overview.reportsGenerated, storyClicks: report.overview.storyClicks, generationSuccessRate: report.generationHealth.generationSuccessRate };
}

function invalidMethod(): Response { return Response.json({ error: 'method_not_allowed' }, { status: 405 }); }

export function createAdminRoutes(options: AdminRoutesOptions) {
  const lastContentChecks = new Map<string, ContentCheckResult>();
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
      const publishers = options.registry.list().map((definition) => ({
        ...safePublisherSummary(definition, lastContentChecks.get(definition.config.publisherId)),
        environment: definition.manifest?.environment ?? 'development',
        allowedOrigins: Array.isArray(definition.manifest?.allowedOrigins) ? [...definition.manifest.allowedOrigins] : [],
      }));
      return Response.json({ publishers, persistence: 'static-source' });
    }
    const match = url.pathname.match(/^\/api\/admin\/publishers\/([^/]+)(?:\/(content-check|test-report|validate|export|config))?$/);
    if (!match) return Response.json({ error: 'not_found' }, { status: 404 });
    const publisherId = safeRouteId(match[1]);
    if (!publisherId) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
    const definition = publisherId ? options.registry.get(publisherId) : undefined;
    if (!definition) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
    const action = match[2];
    const manifest = definition.manifest ?? manifestFromDefinition(definition);
    if (!action && request.method === 'GET') return Response.json({ publisher: safeManifest(manifest), analytics: analyticsSummary(buildAnalyticsReport(await options.analyticsStore.query({ publisherId }), publisherId)), lastContentCheck: lastContentChecks.get(publisherId) ?? null, embed: `<script src="/widget.js" data-publisher="${publisherId}" defer></script>`, links: { analytics: `/analytics?publisher=${encodeURIComponent(publisherId)}`, publicDemo: `/?publisher=${encodeURIComponent(publisherId)}` }, persistence: 'static-source' });
    if (action === 'content-check' && request.method === 'POST') { const result = await runContentCheck(definition); lastContentChecks.set(publisherId, result); return Response.json(result, { status: result.reachable ? 200 : 502 }); }
    if (action === 'export' && request.method === 'GET') return Response.json(safeManifest(definition.manifest ?? manifestFromDefinition(definition)));
    if (action === 'validate' && request.method === 'POST') {
      try {
        const draft = await readJsonBody(request, 64_000) as PublisherManifest;
        validatePublisherManifest(draft, { allowDisabled: true }); validateAllowedOrigins(draft.allowedOrigins);
        return Response.json({ valid: true, publisherId: draft.publisherId, message: 'Draft is valid. Export it and update the static manifest source to persist it.' });
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
      } catch { return Response.json({ error: 'generation_unavailable' }, { status: 503 }); }
    }
    if (action === 'config' && (request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT')) return Response.json({ error: 'config_static_read_only', message: 'Publisher manifests are static source files. Validate and export the draft, then deploy the source change.' }, { status: 409 });
    return invalidMethod();
  };
}

function manifestFromDefinition(definition: NonNullable<ReturnType<PublisherRegistry['get']>>): PublisherManifest {
  return { publisherId: definition.config.publisherId, name: definition.config.publisherName, enabled: true, environment: 'development', publisherConfigVersion: 'legacy', branding: definition.config.branding, content: { adapterId: definition.config.content.adapterType, resultLimit: definition.config.content.resultLimit, candidateRetrievalLimit: definition.config.content.candidateRetrievalLimit }, results: definition.config.results };
}
