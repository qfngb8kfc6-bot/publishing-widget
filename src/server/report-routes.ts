import { readJsonBody, safeRouteId } from './request-validation';
import type { PublisherRegistry } from '../core';
import type { ReportGenerationService } from '../reports/generate';
import type { ReportStore } from '../reports/types';
import { findReportTheme } from '../reports/themes';

function uuidLike(value: string | undefined): string | null {
  return value && /^[a-zA-Z0-9_-]{8,160}$/.test(value) ? value : null;
}

export function createReportRoutes(registry: PublisherRegistry, generation: ReportGenerationService, reports: ReportStore) {
  return async function handle(request: Request, requestId?: string): Promise<Response> {
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
        const report = await generation.generate({ publisherId, companyUrl, jobTitle, sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 160) : undefined, requestId: requestId ?? request.headers.get('X-Request-ID') ?? undefined });
        return Response.json({ generationId: report.id, status: 'complete', statusUrl: `/api/generations/${report.id}/status?publisherId=${encodeURIComponent(publisherId)}`, generationUrl: `/p/${publisherId}/generate/${report.id}`, reportId: report.id, reportUrl: `/p/${publisherId}/${report.id}` }, { status: 201 });
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
      const report = await reports.get(id, publisherId);
      const definition = registry.get(publisherId);
      if (!report || !definition || definition.manifest?.enabled === false || report.publisherId !== publisherId) return Response.json({ error: 'report_not_found' }, { status: 404 });
      let requestedTheme = '';
      try { requestedTheme = decodeURIComponent(themeMatch[2]); } catch { return Response.json({ error: 'invalid_theme' }, { status: 400 }); }
      const theme = findReportTheme(report, requestedTheme);
      if (!theme) return Response.json({ error: 'invalid_theme' }, { status: 400 });
      try {
        const recommendations = await generation.searchTheme(report, theme);
        return Response.json({ reportId: report.id, publisherId, theme, recommendations });
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
