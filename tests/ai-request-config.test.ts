import { describe, expect, it } from 'vitest';
import { createAIConfig } from '../src/ai/config';
import { OpenAICompatibleProvider } from '../src/ai/providers/openai-compatible';
import { validateSemanticResults } from '../src/ai/validation';
import type { SemanticCandidate } from '../src/ai/types';

type Captured = { body: Record<string, unknown>; system: string };

function providerFor(environment: Record<string, string>) {
  const config = createAIConfig({ AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-key-123456', AI_MODEL: 'test-model', AI_ENDPOINT: 'https://ai.example.test/v1/chat/completions', ...environment });
  const captured: Captured[] = [];
  const provider = new OpenAICompatibleProvider({ endpoint: config.endpoint, apiKey: config.apiKey!, model: config.model, timeoutMs: 1_000, maxTokens: config.maxTokens, stageMaxTokens: config.stageMaxTokens, temperature: config.temperature, reasoningEffort: config.reasoningEffort }, async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown> & { messages: Array<{ content: string }> };
    captured.push({ body, system: body.messages[0].content });
    return Response.json({ choices: [{ message: { content: '{"results":[]}' }, finish_reason: 'stop' }] });
  });
  return { provider, captured };
}

async function callAllStages(provider: OpenAICompatibleProvider): Promise<void> {
  await provider.enhanceProfessionalProfile({ publisherId: 'sgi-europe', submittedCompanyUrl: 'https://nike.com/', submittedJobTitle: 'Head of Retail', company: {} as never, role: {} as never, profile: {} as never });
  await provider.rerank({} as never, []);
  await provider.generateReportContent({ publisherId: 'sgi-europe', profile: {} as never, recommendations: [] });
}

describe('AI request parameters', () => {
  it('omits temperature and reasoning_effort by default and keeps the 900-token budget for every stage', async () => {
    const { provider, captured } = providerFor({});
    await callAllStages(provider);
    expect(captured).toHaveLength(3);
    for (const { body } of captured) {
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body.max_completion_tokens).toBe(900);
    }
  });

  it('sends temperature and reasoning_effort only when configured', async () => {
    const { provider, captured } = providerFor({ AI_TEMPERATURE: '0', AI_REASONING_EFFORT: 'Low' });
    await callAllStages(provider);
    for (const { body } of captured) expect(body).toMatchObject({ temperature: 0, reasoning_effort: 'low' });
  });

  it('ignores invalid temperature and reasoning-effort values instead of sending them', async () => {
    const { provider, captured } = providerFor({ AI_TEMPERATURE: 'hot', AI_REASONING_EFFORT: 'low"; drop' });
    await callAllStages(provider);
    for (const { body } of captured) {
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('reasoning_effort');
    }
  });

  it('applies per-stage token budgets and keeps the shared budget ceiling unchanged', async () => {
    const { provider, captured } = providerFor({ AI_MAX_TOKENS: '3000', AI_PROFILE_MAX_TOKENS: '1500', AI_CONTENT_MAX_TOKENS: '4000' });
    await callAllStages(provider);
    expect(captured.map(({ body }) => body.max_completion_tokens)).toEqual([1500, 1200, 4000]);
  });

  it('asks the reranker for {"results":[...]} and accepts that shape or a bare array', async () => {
    const { provider, captured } = providerFor({});
    await provider.rerank({} as never, []);
    expect(captured[0].system).toContain('{"results": [...]}');
    const candidates = [{ articleId: 'a1', title: 'Nike stores' }] as SemanticCandidate[];
    const result = { articleId: 'a1', semanticScore: 80, keep: true };
    expect(validateSemanticResults({ results: [result] }, candidates)).toHaveLength(1);
    expect(validateSemanticResults([result], candidates)).toHaveLength(1);
    expect(validateSemanticResults({ rankings: [result] }, candidates)).toHaveLength(0);
  });
});

describe('AI article payloads', () => {
  const longText = `${'Nike is expanding owned stores across Europe while trimming wholesale accounts. '.repeat(20)}TAILSENTINEL`;
  const article = { id: 'a1', title: 'Nike reshapes European distribution', description: longText, url: 'https://www.sgieurope.com/a1.article', canonicalUrl: 'https://www.sgieurope.com/a1.article', categories: ['Retail', 'Distribution'], tags: ['nike'], contentSnippet: longText, summary: longText, searchText: `${longText} ${longText}`, publishedAt: '2026-09-01T10:00:00.000Z', category: 'Retail', publisherId: 'sgi-europe', provenance: { sourceType: 'rss' } };
  const allowed = ['articleId', 'title', 'description', 'publishedAt', 'category', 'matchedConcepts', 'score'];

  function payload(captured: Captured[]) {
    const user = (captured[0].body.messages as Array<{ content: string }>)[1].content;
    return JSON.parse(user.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')).payload;
  }

  it('sends the content call a minimal projection per article', async () => {
    const { provider, captured } = providerFor({});
    await provider.generateReportContent({ publisherId: 'sgi-europe', profile: {} as never, recommendations: [{ article: article as never, deterministicExplanation: 'Directly matches stores, relevant to your work.', relevanceSignals: ['directly matches stores'], semanticSignals: [], matchedConcepts: ['stores', 'distribution', 'stores'], score: 82 }] });
    const [projected] = payload(captured).articles;
    expect(Object.keys(projected).every((key) => allowed.includes(key))).toBe(true);
    expect(projected).toMatchObject({ articleId: 'a1', title: article.title, publishedAt: article.publishedAt, category: 'Retail', matchedConcepts: ['stores', 'distribution'], score: 82 });
    expect(projected.description.length).toBeLessThanOrEqual(601);
    const sent = (captured[0].body.messages as Array<{ content: string }>)[1].content;
    for (const absent of ['searchText', 'provenance', 'canonicalUrl', 'https://www.sgieurope.com', 'deterministicExplanation', 'TAILSENTINEL']) expect(sent).not.toContain(absent);
  });

  it('sends the rerank call the same projection plus the deterministic relevance type', async () => {
    const { provider, captured } = providerFor({});
    await provider.rerank({} as never, [{ articleId: 'a1', title: article.title, description: longText, categories: article.categories, tags: article.tags, contentSnippet: longText, deterministicScore: 74, deterministicRelevanceType: 'direct', relevanceSignals: ['directly matches stores'], publishedAt: article.publishedAt, category: 'Retail', matchedConcepts: ['stores'] }]);
    const [projected] = payload(captured).candidates;
    expect(Object.keys(projected).every((key) => [...allowed, 'relevanceType'].includes(key))).toBe(true);
    expect(projected).toMatchObject({ articleId: 'a1', score: 74, relevanceType: 'direct', matchedConcepts: ['stores'] });
    expect(projected.description.length).toBeLessThanOrEqual(601);
  });
});
