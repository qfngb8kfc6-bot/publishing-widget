import { readJsonBody, safeRouteId } from './request-validation';
import type { PublisherRegistry } from '../core';
import type { ReportGenerationService } from '../reports/generate';
import type { ReportStore } from '../reports/types';

function uuidLike(value: string | undefined): string | null {
  return value && /^[a-zA-Z0-9_-]{8,160}$/.test(value) ? value : null;
}

export function createReportRoutes(registry: PublisherRegistry, generation: ReportGenerationService, reports: ReportStore) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/reports/generate') {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      try {
        const body = await readJsonBody(request, 16_000) as Record<string, unknown>;
        const publisherId = safeRouteId(typeof body.publisherId === 'string' ? body.publisherId : undefined);
        const companyUrl = typeof body.companyUrl === 'string' ? body.companyUrl : '';
        const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle : '';
        if (!publisherId || !registry.has(publisherId)) return Response.json({ error: 'publisher_not_found' }, { status: 404 });
        if (companyUrl.length > 253 || jobTitle.length > 160 || !companyUrl.trim() || !jobTitle.trim()) return Response.json({ error: 'invalid_generation_input' }, { status: 400 });
        const report = await generation.generate({ publisherId, companyUrl, jobTitle, sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 160) : undefined });
        return Response.json({ generationId: report.id, status: 'complete', statusUrl: `/api/generations/${report.id}/status?publisherId=${encodeURIComponent(publisherId)}`, generationUrl: `/p/${publisherId}/generate/${report.id}`, reportId: report.id, reportUrl: `/p/${publisherId}/${report.id}` }, { status: 201 });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'generation_failed';
        const safeCode = ['invalid_publisher', 'company_url_required', 'invalid_company_url', 'unsafe_company_url', 'company_url_credentials_not_allowed', 'job_title_required'].includes(code) ? code : 'generation_unavailable';
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
