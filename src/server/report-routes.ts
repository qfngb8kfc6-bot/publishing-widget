import { readJsonBody, safeRouteId } from './request-validation';
import type { PublisherRegistry } from '../core';
import type { ReportGenerationService } from '../reports/generate';
import type { ReportStore } from '../reports/types';
import type { ReportPerformanceTiming } from '../reports/types';
import { findReportTheme } from '../reports/themes';

export interface ReportRouteContext { runtimeMs?: number }

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

function uuidLike(value: string | undefined): string | null {
  return value && /^[a-zA-Z0-9_-]{8,160}$/.test(value) ? value : null;
}

export function createReportRoutes(registry: PublisherRegistry, generation: ReportGenerationService, reports: ReportStore) {
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
        const timing: ReportPerformanceTiming = { requestId: requestId ?? request.headers.get('X-Request-ID') ?? undefined, publisherId, cacheHit: false, cacheAgeMs: 0, catalogueItemCount: 0, runtimeMs: context.runtimeMs ?? 0, companyResolutionMs: 0, profileMs: 0, aiProfileMs: 0, catalogueCacheLookupMs: 0, catalogueSnapshotLookupMs: 0, catalogueRefreshMs: 0, sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, preselectionMs: 0, deterministicRankingMs: 0, aiRerankingMs: 0, aiExplanationsMs: 0, briefingSummaryMs: 0, sectionAllocationMs: 0, persistenceMs: 0, totalMs: 0 };
        const report = await generation.generate({ publisherId, companyUrl, jobTitle, sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 160) : undefined, requestId: timing.requestId, performance: timing });
        return withServerTiming(Response.json({ generationId: report.id, status: 'complete', statusUrl: `/api/generations/${report.id}/status?publisherId=${encodeURIComponent(publisherId)}`, generationUrl: `/p/${publisherId}/generate/${report.id}`, reportId: report.id, reportUrl: `/p/${publisherId}/${report.id}` }, { status: 201 }), timing);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'generation_failed';
        const safeCode = ['invalid_publisher', 'company_url_required', 'invalid_company_url', 'unsafe_company_url', 'company_url_credentials_not_allowed', 'company_resolution_failed', 'company_resolution_timeout', 'job_title_required'].includes(code) ? code : 'generation_unavailable';
        return Response.json({ error: safeCode }, { status: safeCode === 'generation_unavailable' ? 503 : 400 });
      }
    }
    const statusMatch = url.pathname.match(/^\/api\/generations\/([^/]+)\/status$/);
    if (statusMatch && request.method === 'GET') {
      const id = uuidLike(statusMatch[1]);
      if (!id) return Response.json({ error: 'invalid_report_id' }, { status: 400 });
      const publisherId = safeRouteId(url.searchParams.get('publisherId') ?? undefined);
      if (!publisherId) return Response.json({ error: 'publisher_id_required' }, { status: 400 });
      const report = await reports.get(id, publisherId);
      if (!report) return Response.json({ error: 'generation_not_found' }, { status: 404 });
      return Response.json({ generationId: id, status: 'complete', reportId: id, companyName: report.companyName, companyDomain: report.companyDomain, jobTitle: report.jobTitle, generationUrl: `/p/${report.publisherId}/generate/${id}`, reportUrl: `/p/${report.publisherId}/${id}` });
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
      try {
        const timing: ReportPerformanceTiming = { requestId, publisherId, theme, cacheHit: false, cacheAgeMs: 0, catalogueItemCount: 0, runtimeMs: context.runtimeMs ?? 0, companyResolutionMs: 0, profileMs: 0, aiProfileMs: 0, catalogueCacheLookupMs: 0, catalogueSnapshotLookupMs: 0, catalogueRefreshMs: 0, sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, preselectionMs: 0, deterministicRankingMs: 0, aiRerankingMs: 0, aiExplanationsMs: 0, briefingSummaryMs: 0, sectionAllocationMs: 0, persistenceMs: 0, totalMs: 0, reportLookupMs: Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - lookupStartedAt) };
        const recommendations = await generation.searchTheme(report, theme, requestId, timing);
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
