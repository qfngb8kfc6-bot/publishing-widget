import { describe, expect, it } from 'vitest';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const titles = ['Texas attorney general opens PFAS probe into outdoor brands', 'Gymshark faces lawsuit over trademark', 'Lululemon proxy fight settlement', 'Lululemon legal team reviews contracts'];
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${titles.map((title, index) => `<item><title>${title}</title><link>https://www.sgieurope.com/business/l-${index}/1500${index}.article</link><guid>https://www.sgieurope.com/business/l-${index}/1500${index}.article</guid><description>${title}; regulator, lawsuit and settlement coverage.</description><pubDate>Mon, 0${index + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const main = { person: { responsibilities: ['legal contract review'], decisionAreas: ['legal strategy'] }, professionalInterests: ['litigation'], relevantEntities: ['Lululemon'] };
const terms = { terms: ['lawsuit', 'probe', 'settlement', 'trademark', 'strategy'] };

type Behaviour = 'ok' | 'fail' | 'hang';
type Logged = { message: string; fields: Record<string, unknown> };

function app(behaviour: { main: Behaviour[]; vocabulary: Behaviour[] }) {
  const logs: Logged[] = [];
  const calls: string[] = [];
  const started: Record<string, number> = {};
  const respond = async (operation: string, mode: Behaviour | undefined, content: unknown) => {
    started[operation] = Date.now();
    if (mode === 'hang') return new Promise<Response>(() => undefined);
    if (mode === 'fail') return new Response('upstream error', { status: 500 });
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
  };
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-enrich-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '60' },
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const operation = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')).operation as string;
      calls.push(operation);
      if (operation === 'professional-profile-enrichment') return respond(operation, behaviour.main.shift() ?? 'ok', main);
      if (operation === 'subject-vocabulary') return respond(operation, behaviour.vocabulary.shift() ?? 'ok', terms);
      return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Lululemon', industry: 'sporting goods', topics: [], entities: ['Lululemon'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  const generate = async (jobTitle = 'Head of Legal') => {
    const response = await instance.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'lululemon.com', jobTitle }) }));
    const { reportId } = await response.json() as { reportId: string };
    return (await instance.reportStore.get(reportId, 'sgi-europe'))!;
  };
  return { instance, logs, calls, started, generate };
}

const directConcepts = (report: Awaited<ReturnType<ReturnType<typeof app>['generate']>>) => report.professionalProfile.retrieval.concepts!.filter((concept) => concept.relevanceType === 'direct').map((concept) => concept.concept);
const enrichmentCalls = (calls: string[]) => calls.filter((operation) => operation === 'professional-profile-enrichment' || operation === 'subject-vocabulary');
const performance = (logs: Logged[], operation: string) => logs.filter((entry) => entry.message === 'ai_performance' && entry.fields.aiOperation === operation);

describe('profile enrichment reliability', () => {
  it('runs the main enrichment and the subject vocabulary in parallel, logs both, and caches a complete result', async () => {
    const target = app({ main: [], vocabulary: [] });
    const report = await target.generate();
    expect(Math.abs(target.started['professional-profile-enrichment'] - target.started['subject-vocabulary'])).toBeLessThan(30);
    expect(directConcepts(report)).toEqual(expect.arrayContaining(['legal', 'lawsuit', 'probe', 'settlement']));
    expect(directConcepts(report)).not.toContain('strategy');
    expect(performance(target.logs, 'professional_profile_enrichment')[0].fields).toMatchObject({ aiSuccess: true, aiRetryCount: 0 });
    expect(performance(target.logs, 'subject_vocabulary')[0].fields).toMatchObject({ aiSuccess: true, aiRetryCount: 0 });
    await target.generate();
    expect(enrichmentCalls(target.calls)).toHaveLength(2);
    expect(target.logs.some((entry) => entry.message === 'enrichment_retry')).toBe(false);
  });

  it('keeps the vocabulary when the main enrichment times out, does not cache, and warms the cache with one retry', async () => {
    const target = app({ main: ['hang'], vocabulary: [] });
    const first = await target.generate();
    expect(directConcepts(first)).toEqual(expect.arrayContaining(['lawsuit', 'probe']));
    expect(performance(target.logs, 'professional_profile_enrichment')[0].fields).toMatchObject({ aiSuccess: false, aiErrorCode: 'timeout' });
    await target.instance.flushEnrichmentRetries();
    expect(target.logs.find((entry) => entry.message === 'enrichment_retry')?.fields).toMatchObject({ retryOperations: 'professional_profile_enrichment', retrySuccess: true });
    // Only the failed part was retried.
    expect(performance(target.logs, 'professional_profile_enrichment').map((entry) => entry.fields.aiRetryCount)).toEqual([0, 1]);
    expect(performance(target.logs, 'subject_vocabulary')).toHaveLength(1);
    const callsBefore = enrichmentCalls(target.calls).length;
    const second = await target.generate();
    expect(enrichmentCalls(target.calls)).toHaveLength(callsBefore);
    expect(second.professionalProfile.role.responsibilities).toContain('legal contract review');
  });

  it('keeps the main enrichment when the vocabulary call fails and retries only the vocabulary', async () => {
    const target = app({ main: [], vocabulary: ['fail'] });
    const first = await target.generate();
    expect(first.professionalProfile.role.responsibilities).toContain('legal contract review');
    expect(directConcepts(first)).not.toContain('lawsuit');
    await target.instance.flushEnrichmentRetries();
    expect(target.logs.find((entry) => entry.message === 'enrichment_retry')?.fields).toMatchObject({ retryOperations: 'subject_vocabulary', retrySuccess: true });
    expect(performance(target.logs, 'professional_profile_enrichment')).toHaveLength(1);
    expect(directConcepts(await target.generate())).toContain('lawsuit');
  });

  it('retries only once and caches nothing when the retry fails too', async () => {
    const target = app({ main: ['fail', 'fail', 'ok'], vocabulary: ['fail', 'fail', 'ok'] });
    await target.generate();
    await target.instance.flushEnrichmentRetries();
    expect(target.logs.filter((entry) => entry.message === 'enrichment_retry').map((entry) => entry.fields)).toEqual([expect.objectContaining({ retryOperations: 'professional_profile_enrichment,subject_vocabulary', retrySuccess: false })]);
    // Next visitor tries again (nothing cached) and gets the full result.
    const next = await target.generate();
    expect(directConcepts(next)).toContain('lawsuit');
  });

  it('makes no vocabulary call for a dedicated role', async () => {
    const target = app({ main: [], vocabulary: [] });
    await target.generate('Head of Retail');
    expect(enrichmentCalls(target.calls)).toEqual(['professional-profile-enrichment']);
  });
});
