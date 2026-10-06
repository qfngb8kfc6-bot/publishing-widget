import { AIProviderError } from '../ai/provider';
import type { AIProvider, ProfessionalAIProvider } from '../ai/types';
import { readJsonBody } from './request-validation';

/** Mount this handler at the own-backend AI route. It never exposes provider credentials. */
export function createAIProxy(provider: AIProvider) {
  const professionalProvider = provider as Partial<ProfessionalAIProvider>;
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const operation = new URL(request.url).pathname.split('/').filter(Boolean).pop();
    try {
      const body = await readJsonBody(request, 48_000) as Record<string, unknown>;
      if (operation === 'enrich' && body.intent && typeof body.intent === 'object') return Response.json(await provider.enhanceIntent(body.intent as Parameters<AIProvider['enhanceIntent']>[0]));
      if (operation === 'profile' && body.input && typeof body.input === 'object' && typeof professionalProvider.enhanceProfessionalProfile === 'function') return Response.json(await professionalProvider.enhanceProfessionalProfile(body.input as Parameters<ProfessionalAIProvider['enhanceProfessionalProfile']>[0]));
      if (operation === 'rerank' && body.intent && typeof body.intent === 'object' && Array.isArray(body.candidates) && body.candidates.length <= 20) return Response.json(await provider.rerank(body.intent as Parameters<AIProvider['rerank']>[0], body.candidates as Parameters<AIProvider['rerank']>[1]));
      if (operation === 'explain' && Array.isArray(body.requests) && body.requests.length <= 20) return Response.json(await provider.explainMany(body.requests as Parameters<AIProvider['explainMany']>[0]));
      if (operation === 'content' && body.input && typeof body.input === 'object' && typeof professionalProvider.generateReportContent === 'function') return Response.json(await professionalProvider.generateReportContent(body.input as Parameters<ProfessionalAIProvider['generateReportContent']>[0]));
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    } catch (error) {
      const status = error instanceof AIProviderError && error.code === 'rate-limit' ? 429 : 503;
      return Response.json({ error: 'ai_unavailable' }, { status });
    }
  };
}
