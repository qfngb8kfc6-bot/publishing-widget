import { AIProviderError } from '../ai/provider';
import type { AIProvider } from '../ai/types';

/** Mount this handler at the own-backend AI route. It never exposes provider credentials. */
export function createAIProxy(provider: AIProvider) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const operation = new URL(request.url).pathname.split('/').filter(Boolean).pop();
    try {
      const body = await request.json() as Record<string, unknown>;
      if (operation === 'enrich' && body.intent) return Response.json(await provider.enhanceIntent(body.intent as Parameters<AIProvider['enhanceIntent']>[0]));
      if (operation === 'rerank' && body.intent && Array.isArray(body.candidates)) return Response.json(await provider.rerank(body.intent as Parameters<AIProvider['rerank']>[0], body.candidates as Parameters<AIProvider['rerank']>[1]));
      if (operation === 'explain' && Array.isArray(body.requests)) return Response.json(await provider.explainMany(body.requests as Parameters<AIProvider['explainMany']>[0]));
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    } catch (error) {
      const status = error instanceof AIProviderError && error.code === 'rate-limit' ? 429 : 503;
      return Response.json({ error: 'ai_unavailable' }, { status });
    }
  };
}
