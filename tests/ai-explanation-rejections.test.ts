import { describe, expect, it } from 'vitest';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

const API_KEY = 'sk-test-explanations-secret';
const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const items = Array.from({ length: 30 }, (_, index) => `<item><title>Nike expands retail stores and omnichannel distribution in Europe ${index}</title><link>https://www.sgieurope.com/retail/nike-${index}/12000${index}.article</link><guid>https://www.sgieurope.com/retail/nike-${index}/12000${index}.article</guid><description>Nike retail stores omnichannel distribution merchandising flagship wholesale sales growth ${index}</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('');
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;

type Logged = { message: string; fields: Record<string, unknown> };

function reference(body: { messages: Array<{ content: string }> }) {
  return JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')) as { operation: string; payload: { articles?: Array<{ id: string }> } };
}

function app(content: (articleIds: string[], system: string) => unknown) {
  const logs: Logged[] = [];
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: API_KEY, AI_MODEL: 'test-model', AI_ENDPOINT },
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const ref = reference(body);
      const result = ref.operation === 'report-content' ? content((ref.payload.articles ?? []).map((article) => article.id), body.messages[0].content) : {};
      return Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'Nike', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  return { instance, logs };
}

async function generate(target: ReturnType<typeof app>['instance']) {
  const response = await target.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  return (await target.reportStore.get(reportId, 'sgi-europe'))!;
}

describe('AI explanation validation', () => {
  it('reproduces the production symptom: AI summary accepted, every explanation rejected for a missing explanation field', async () => {
    const secretText = 'Supplier consolidation in Europe changes Nike sourcing leverage';
    const { instance, logs } = app((ids) => ({ summary: 'Nike is consolidating European suppliers.', explanations: ids.map((articleId) => ({ articleId, reason: secretText })) }));
    const report = await generate(instance);
    expect(report.summarySource).toBe('ai');
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'deterministic')).toBe(true);
    const rejected = logs.filter((entry) => entry.message === 'ai_explanation_rejected');
    expect(rejected).toHaveLength(report.recommendations.length);
    expect(rejected.every((entry) => entry.fields.rejectReason === 'missing_explanation' && entry.fields.presentFields === 'articleId,reason')).toBe(true);
    expect(new Set(rejected.map((entry) => entry.fields.articleId))).toEqual(new Set(report.recommendations.map((item) => item.articleId)));
    expect(JSON.stringify(rejected)).not.toContain(secretText);
  });

  it('names the explanation field in the content prompt and accepts explanations that use it', async () => {
    let system = '';
    const { instance, logs } = app((ids, prompt) => { system = prompt; return { summary: 'Nike is consolidating European suppliers.', explanations: ids.map((articleId) => ({ articleId, explanation: 'A sourcing benchmark for procurement.' })) }; });
    const report = await generate(instance);
    expect(system).toContain('{"articleId": "a1", "angle": "...", "explanation": "..."}');
    expect(system).toContain('you MUST return exactly one explanations entry for every supplied articleId');
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'ai')).toBe(true);
    expect(logs.filter((entry) => entry.message === 'ai_explanation_rejected')).toHaveLength(0);
  });

  it('logs a reason code for each kind of rejected or missing explanation', async () => {
    // Part B (explanations only) gets valid output so the malformed list is exercised once, by part A.
    let partASize = 0;
    const { instance, logs } = app((ids, system) => system.includes('Do not write a summary') ? { explanations: ids.map((articleId) => ({ articleId, explanation: 'Valid.' })) } : (partASize = ids.length, {
      summary: 'Summary.',
      explanations: [
        { articleId: ids[0], explanation: 'Accepted.' },
        { articleId: ids[0], explanation: 'Duplicate.' },
        { articleId: 'https://www.sgieurope.com/invented/1.article', explanation: 'Unknown.' },
        { articleId: ids[1], explanation: 'x'.repeat(601) },
        { articleId: ids[2], explanation: '   ' },
        { explanation: 'No id.' },
        { articleId: ids[3], 'Supplier consolidation matters because it shifts sourcing leverage': true },
        'not an object',
      ],
    }));
    const report = await generate(instance);
    expect(partASize).toBe(7);
    const reasons = logs.filter((entry) => entry.message === 'ai_explanation_rejected').map((entry) => [entry.fields.rejectReason, entry.fields.articleId]);
    expect(reasons).toEqual(expect.arrayContaining([
      ['duplicate_article_id', report.recommendations[0].articleId],
      ['unknown_article_id', 'https://www.sgieurope.com/invented/1.article'],
      ['explanation_too_long', expect.any(String)],
      ['empty_explanation', expect.any(String)],
      ['missing_article_id', undefined],
      ['not_object', undefined],
      ['missing_explanation', expect.any(String)],
    ]));
    const textAsKey = logs.find((entry) => entry.message === 'ai_explanation_rejected' && String(entry.fields.presentFields).includes('<other>'));
    expect(textAsKey?.fields.presentFields).toBe('<other>,articleId');
    expect(JSON.stringify(logs)).not.toContain('Supplier consolidation');
    const notReturned = reasons.filter(([reason]) => reason === 'not_returned');
    expect(notReturned).toHaveLength(partASize - 4);
  });

  it('logs when explanations are missing or not an array', async () => {
    for (const [explanations, reason] of [[undefined, 'explanations_missing'], [{ a: 'b' }, 'explanations_not_array']] as const) {
      const { instance, logs } = app(() => ({ summary: 'Summary.', ...(explanations === undefined ? { notes: [] } : { explanations }) }));
      await generate(instance);
      const shape = logs.find((entry) => entry.message === 'ai_explanation_rejected' && entry.fields.rejectReason === reason);
      expect(shape?.fields.presentFields).toBe(explanations === undefined ? 'notes,summary' : 'explanations,summary');
    }
  });
});
