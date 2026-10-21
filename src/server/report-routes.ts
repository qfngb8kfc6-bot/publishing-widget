import { readJsonBody, safeRouteId } from './request-validation';
import type { PublisherRegistry } from '../core';
import type { ReportGenerationService } from '../reports/generate';
import type { ReportStore } from '../reports/types';
import type { ReportPerformanceTiming } from '../reports/types';
import { findReportTheme, MAX_SHOWN_THEME_ARTICLE_IDS } from '../reports/themes';
import { GENERATION_STAGES, SAFE_GENERATION_ERROR_CODES, type GenerationJob, type GenerationJobs } from '../reports/generation-jobs';

export interface ReportRouteContext { runtimeMs?: number }

const MAX_SHOWN_ARTICLE_ID_LENGTH = 512;

/**
 * Article IDs already shown in other theme results this session, from an optional JSON body
 * {"shownArticleIds": [...]}. An empty body is accepted; at most MAX_SHOWN_THEME_ARTICLE_IDS strings are kept.
 * They are only used as exclusion keys, so an unknown ID matches nothing.
 */
async function readShownArticleIds(request: Request): Promise<string[]> {
  const text = await request.text();
  if (!text.trim()) return [];
  if (new TextEncoder().encode(text).byteLength > 40_000) throw new Error('payload_too_large');
  const body = JSON.parse(text) as unknown;
  const value = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).shownArticleIds : undefined;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('invalid_shown_article_ids');
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_SHOWN_ARTICLE_ID_LENGTH))].slice(0, MAX_SHOWN_THEME_ARTICLE_IDS);
}

function timingValue(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : 0;
}

function withServerTiming(response: Response, timing: ReportPerformanceTiming): Response {
  const headers = new Headers(response.headers);
  const parts = [
    ['runtime', timing.runtimeMs],
    ['company', timing.companyResolutionMs],
    ['company-context', timing.companyContextMs ?? 0],
    ['analytics', timing.analyticsMs ?? 0],
    ['report-lookup', timing.reportLookupMs ?? 0],
    ['catalogue', timing.catalogueCacheLookupMs + timing.sourceFetchMs + timing.sourceReadMs + timing.sourceParseMs],
    ['catalogue-snapshot', timing.catalogueSnapshotLookupMs],
    ['catalogue-refresh', timing.catalogueRefreshMs],
    ['catalogue-select', timing.catalogueSelectionMs ?? 0],
    ['exclusion', timing.exclusionMs ?? 0],
    ['ranking', timing.preselectionMs + timing.deterministicRankingMs],
    ['ai-profile', timing.aiProfileMs],
    ['ai-rerank', timing.aiRerankingMs],
    ['ai-content', timing.aiExplanationsMs],
    ['sections', timing.sectionAllocationMs],
    ['persist', timing.persistenceMs],
    ['total', timing.totalMs],
  ].map(([name, value]) => `${name};dur=${timingValue(value as number)}`);
  headers.set('Server-Timing', parts.join(', '));
  return new Response(response.body, { status: response.status, headers });
}

/** Errors reported to the caller before a job exists: bad input or a company that cannot be resolved. */
const INPUT_ERROR_CODES = ['invalid_publisher', 'company_url_required', 'invalid_company_url', 'unsafe_company_url', 'company_url_credentials_not_allowed', 'company_resolution_failed', 'company_resolution_timeout', 'job_title_required'];

function inputErrorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : 'generation_failed';
  const safeCode = INPUT_ERROR_CODES.includes(code) ? code : 'generation_unavailable';
  return Response.json({ error: safeCode }, { status: safeCode === 'generation_unavailable' ? 503 : 400 });
}

function generationLinks(publisherId: string, generationId: string) {
  return { statusUrl: `/api/generations/${generationId}/status?publisherId=${encodeURIComponent(publisherId)}`, generationUrl: `/p/${publisherId}/generate/${generationId}` };
}

/** The status payload: stages, safe display details and, when complete, the report URL. No scores or internals. */
function statusBody(job: GenerationJob) {
  const stage = job.completedStages[job.completedStages.length - 1] ?? 'started';
  return {
    generationId: job.id,
    status: job.status,
    stage,
    completedStages: job.completedStages,
    stages: GENERATION_STAGES,
    details: job.details,
    generationUrl: `/p/${job.publisherId}/generate/${job.id}`,
    ...(job.status === 'complete' && job.reportId ? { reportId: job.reportId, reportUrl: `/p/${job.publisherId}/${job.reportId}` } : {}),
    ...(job.input?.sessionId ? { sessionId: job.input.sessionId } : {}),
    ...(job.status === 'failed' ? { error: job.errorCode && SAFE_GENERATION_ERROR_CODES.has(job.errorCode) ? job.errorCode : 'generation_unavailable', retryable: true } : {}),
  };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

function uuidLike(value: string | undefined): string | null {
  return value && /^[a-zA-Z0-9_-]{8,160}$/.test(value) ? value : null;
}

/**
 * POST /api/reports/generate is asynchronous: it validates the input, resolves the company, creates a generation
 * job and returns 202 with its status and loading-page URLs while the report is built in the background.
 * ?mode=sync keeps the original behaviour (201 once the report is persisted) for scripts and tests.
 */
export function createReportRoutes(registry: PublisherRegistry, generation: ReportGenerationService, reports: ReportStore, jobs: GenerationJobs) {
  /** Resolves the company, creates the job and builds the report in the background; returns the 202 response. */
  async function startGeneration(publisherId: string, companyUrl: string, jobTitle: string, sessionId: string | undefined, requestId: string | undefined): Promise<Response> {
    const resolvedCompany = await generation.resolveCompanyInput({ publisherId, companyUrl, requestId });
    const job = await jobs.create(publisherId, { companyName: resolvedCompany.displayName, jobTitle }, { companyUrl, jobTitle, ...(sessionId ? { sessionId } : {}) });
    void generation.generate({ publisherId, companyUrl, jobTitle, sessionId, requestId, resolvedCompany, onProgress: (update) => jobs.progress(job.id, update) })
      .then((report) => jobs.complete(job.id, report.id))
      .catch((error: unknown) => jobs.fail(job.id, error instanceof Error ? error.message : 'generation_unavailable'));
    return Response.json({ generationId: job.id, status: 'running', ...generationLinks(publisherId, job.id) }, { status: 202, headers: NO_STORE });
  }

  return async function handle(request: Request, requestId?: string, context: ReportRouteContext = {}): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/reports/generate') {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      try {
        const body = await readJsonBody(request, 16_000) as Record<string, unknown>;
        const publisherId = safeRouteId(typeof body.publisherId === 'string' ? body.publisherId : undefined);
        const companyUrl = typeof body.companyUrl === 'string' ? body.companyUrl : '';
        const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle : '';
        if (!publisherId || !registry.get(publisherId) || registry.get(publisherId)?.manifest?.enabled === false) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
        if (companyUrl.length > 253 || jobTitle.length > 160 || !companyUrl.trim() || !jobTitle.trim()) return Response.json({ error: 'invalid_generation_input' }, { status: 400 });
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 160) : undefined;
        if (url.searchParams.get('mode') !== 'sync') return await startGeneration(publisherId, companyUrl, jobTitle, sessionId, requestId ?? request.headers.get('X-Request-ID') ?? undefined);
        const timing: ReportPerformanceTiming = { requestId: requestId ?? request.headers.get('X-Request-ID') ?? undefined, publisherId, cacheHit: false, cacheAgeMs: 0, catalogueItemCount: 0, runtimeMs: context.runtimeMs ?? 0, companyResolutionMs: 0, profileMs: 0, aiProfileMs: 0, catalogueCacheLookupMs: 0, catalogueSnapshotLookupMs: 0, catalogueRefreshMs: 0, sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, preselectionMs: 0, deterministicRankingMs: 0, aiRerankingMs: 0, aiExplanationsMs: 0, briefingSummaryMs: 0, sectionAllocationMs: 0, persistenceMs: 0, totalMs: 0 };
        const report = await generation.generate({ publisherId, companyUrl, jobTitle, sessionId, requestId: timing.requestId, performance: timing });
        return withServerTiming(Response.json({ generationId: report.id, status: 'complete', ...generationLinks(publisherId, report.id), reportId: report.id, reportUrl: `/p/${publisherId}/${report.id}` }, { status: 201 }), timing);
      } catch (error) {
        return inputErrorResponse(error);
      }
    }
    // Retry of a failed, lost or slow generation from its stored input: the loading page needs no company or role.
    const retryMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/retry$/);
    if (retryMatch) {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      const id = uuidLike(retryMatch[1]);
      const publisherId = safeRouteId(url.searchParams.get('publisherId') ?? undefined);
      if (!id || !publisherId) return Response.json({ error: 'invalid_request' }, { status: 400 });
      const job = await jobs.get(id, publisherId);
      if (!job) return Response.json({ error: 'generation_not_found' }, { status: 404 });
      if (job.status === 'complete') return Response.json({ error: 'generation_complete', ...statusBody(job) }, { status: 409 });
      if (!job.input) return Response.json({ error: 'retry_unavailable' }, { status: 409 });
      if (!registry.get(publisherId) || registry.get(publisherId)?.manifest?.enabled === false) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
      try {
        return await startGeneration(publisherId, job.input.companyUrl, job.input.jobTitle, job.input.sessionId, requestId);
      } catch (error) {
        return inputErrorResponse(error);
      }
    }
    const statusMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/status$/);
    if (statusMatch && request.method === 'GET') {
      const id = uuidLike(statusMatch[1]);
      if (!id) return Response.json({ error: 'invalid_report_id' }, { status: 400 });
      const publisherId = safeRouteId(url.searchParams.get('publisherId') ?? undefined);
      if (!publisherId) return Response.json({ error: 'publisher_id_required' }, { status: 400 });
      const job = await jobs.get(id, publisherId);
      if (job) return Response.json(statusBody(job), { headers: NO_STORE });
      // Links from synchronous generation use the report ID as the generation ID.
      const report = await reports.get(id, publisherId);
      if (!report) return Response.json({ error: 'generation_not_found' }, { status: 404, headers: NO_STORE });
      return Response.json(statusBody({ id, publisherId: report.publisherId, status: 'complete', completedStages: [...GENERATION_STAGES], details: { companyName: report.companyName, jobTitle: report.jobTitle }, reportId: id, instanceId: '', createdAt: report.createdAt, updatedAt: report.updatedAt }), { headers: NO_STORE });
    }
    const themeMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/themes\/([^/]+)\/search$/);
    if (themeMatch) {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      const id = uuidLike(themeMatch[1]);
      if (!id) return Response.json({ error: 'invalid_report_id' }, { status: 400 });
      const publisherId = safeRouteId(url.searchParams.get('publisherId') ?? undefined);
      if (!publisherId) return Response.json({ error: 'publisher_id_required' }, { status: 400 });
      const lookupStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const report = await reports.get(id, publisherId);
      const definition = registry.get(publisherId);
      if (!report || !definition || definition.manifest?.enabled === false || report.publisherId !== publisherId) return Response.json({ error: 'report_not_found' }, { status: 404 });
      let requestedTheme = '';
      try { requestedTheme = decodeURIComponent(themeMatch[2]); } catch { return Response.json({ error: 'invalid_theme' }, { status: 400 }); }
      const theme = findReportTheme(report, requestedTheme);
      if (!theme) return Response.json({ error: 'invalid_theme' }, { status: 400 });
      let shownArticleIds: string[] = [];
      try { shownArticleIds = await readShownArticleIds(request); } catch { return Response.json({ error: 'invalid_request' }, { status: 400 }); }
      try {
        const timing: ReportPerformanceTiming = { requestId, publisherId, theme, cacheHit: false, cacheAgeMs: 0, catalogueItemCount: 0, runtimeMs: context.runtimeMs ?? 0, companyResolutionMs: 0, profileMs: 0, aiProfileMs: 0, catalogueCacheLookupMs: 0, catalogueSnapshotLookupMs: 0, catalogueRefreshMs: 0, sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, preselectionMs: 0, deterministicRankingMs: 0, aiRerankingMs: 0, aiExplanationsMs: 0, briefingSummaryMs: 0, sectionAllocationMs: 0, persistenceMs: 0, totalMs: 0, reportLookupMs: Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lookupStartedAt) };
        const recommendations = await generation.searchTheme(report, theme, requestId, timing, shownArticleIds);
        return withServerTiming(Response.json({ reportId: report.id, publisherId, theme, recommendations }), timing);
      } catch {
        return Response.json({ error: 'theme_search_unavailable' }, { status: 503 });
      }
    }
    const reportMatch = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
    if (reportMatch && request.method === 'GET') {
      const id = uuidLike(reportMatch[1]);
      if (!id) return Response.json({ error: 'invalid_report_id' }, { status: 400 });
      const publisherId = safeRouteId(url.searchParams.get('publisherId') ?? undefined);
      if (!publisherId) return Response.json({ error: 'publisher_id_required' }, { status: 400 });
      const report = await reports.get(id, publisherId);
      if (!report) return Response.json({ error: 'report_not_found' }, { status: 404 });
      return Response.json(report);
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  };
}
