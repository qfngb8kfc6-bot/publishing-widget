import { describe, expect, it } from 'vitest';
import { buildIntent, DeterministicExplanationProvider, MemoryAnalytics, PublisherRegistry, rankArticles, RecommendationService, validatePublisherConfig } from '../src/core';
import { demoArticles } from '../src/demo/articles';
import { DemoPublisherAdapter } from '../src/demo/adapter';
import { demoConfig } from '../src/demo/config';
import { createPublisherRegistry } from '../src/publishers/registry';
import { RealPublisherAdapter, buildRealSearchRequest } from '../src/publishers/real-publisher/adapter';
import { defaultRealPublisherApiConfig } from '../src/publishers/real-publisher/config';
import { normalizeRealPublisherArticle } from '../src/publishers/real-publisher/normalizer';
import { realPublisherSearchFixture } from '../src/publishers/real-publisher/fixtures';

const adapter = new DemoPublisherAdapter();

describe('publisher configuration and registry', () => {
  it('registers a publisher without coupling the widget to its questions', () => {
    const registry = new PublisherRegistry();
    registry.register({ config: demoConfig, adapter, explanationProvider: new DeterministicExplanationProvider() });
    expect(registry.has('demo')).toBe(true);
    expect(registry.get('demo')?.config.questions[0].id).toBe('interest');
  });

  it('rejects duplicate question ids and mismatched adapters', () => {
    expect(() => validatePublisherConfig({ ...demoConfig, questions: [demoConfig.questions[0], { ...demoConfig.questions[0] }] })).toThrow('unique');
    const registry = new PublisherRegistry();
    const mismatchedAdapter = { publisherId: 'other', search: adapter.search.bind(adapter), normalizeArticle: adapter.normalizeArticle.bind(adapter) };
    expect(() => registry.register({ config: demoConfig, adapter: mismatchedAdapter, explanationProvider: new DeterministicExplanationProvider() })).toThrow('ids must match');
  });
});

describe('intent, normalization and relevance', () => {
  it('builds structured intent from configured answers', () => {
    const intent = buildIntent(demoConfig, { interest: 'sustainability', role: 'manufacturer' });
    expect(intent.queryText).toBe('Sustainability I make or build things');
    expect(intent.keywords).toContain('sustainability');
    expect(intent.interests).toEqual(['Sustainability']);
    expect(intent.personas).toEqual(['I make or build things']);
  });

  it('normalizes the demo adapter format', () => {
    const normalized = adapter.normalizeArticle(demoArticles[0]);
    expect(normalized).toMatchObject({ id: 'quiet-revolution-electric-ferries', publisherId: 'demo', categories: ['Sustainability'] });
    expect(normalized.url).toMatch(/^https:\/\/demo\.publisher\.example/);
  });

  it('changes ranking for meaningfully different answer combinations', () => {
    const sustainability = buildIntent(demoConfig, { interest: 'sustainability', role: 'manufacturer' });
    const technology = buildIntent(demoConfig, { interest: 'technology', role: 'developer' });
    const articles = demoArticles.map((article) => adapter.normalizeArticle(article));
    const sustainabilityTop = rankArticles(articles, sustainability, 3)[0].article.id;
    const technologyTop = rankArticles(articles, technology, 3)[0].article.id;
    expect(sustainabilityTop).not.toBe(technologyTop);
    expect(sustainabilityTop).not.toBe(technologyTop);
    expect(['quiet-revolution-electric-ferries', 'repair-economy', 'farming-with-less-water', 'designing-for-reuse']).toContain(sustainabilityTop);
    expect(['small-language-models', 'materials-that-learn', 'robotics-in-the-workshop', 'open-source-observatories', 'work-after-the-office']).toContain(technologyTop);
  });
});

describe('explanations and analytics', () => {
  it('turns grounded relevance signals into a concise explanation', () => {
    const provider = new DeterministicExplanationProvider();
    const explanation = provider.explain(adapter.normalizeArticle(demoArticles[0]), buildIntent(demoConfig, { interest: 'sustainability', role: 'manufacturer' }), { score: 82, relevanceSignals: ['matches your interest in sustainability', 'relevant to your perspective as manufacturing'] });
    expect(explanation.toLowerCase()).toContain('matches your interest in sustainability');
    expect(explanation).toContain('relevant to your perspective as manufacturing');
  });

  it('stores only explicit analytics events and metadata', () => {
    const analytics = new MemoryAnalytics();
    analytics.track({ name: 'question_answered', publisherId: 'demo', sessionId: 'session-1', timestamp: '2026-09-28T10:00:00.000Z', metadata: { questionId: 'interest', answerType: 'single-select', answerCount: 1 } });
    expect(analytics.events).toHaveLength(1);
    expect(analytics.events[0].metadata).not.toHaveProperty('freeText');
  });
});

describe('real publisher adapter', () => {
  const intent = buildIntent(demoConfig, { interest: 'sustainability', role: 'manufacturer' });

  it('registers alongside demo without changing the universal registry', () => {
    const registry = createPublisherRegistry();
    expect(registry.has('demo')).toBe(true);
    expect(registry.has('real-publisher')).toBe(true);
    expect(registry.get('real-publisher')?.config.content.candidateRetrievalLimit).toBe(30);
  });

  it('constructs a publisher-specific search request from structured intent', () => {
    const request = buildRealSearchRequest(intent, { ...defaultRealPublisherApiConfig, baseUrl: 'https://api.example.test', queryParameters: { locale: 'en-GB' } });
    expect(request.method).toBe('GET');
    expect(request.url).toContain('q=Sustainability+I+make+or+build+things');
    expect(request.query).toMatchObject({ locale: 'en-GB', page: 1, limit: 30 });
  });

  it('normalizes common publisher fields and safely rejects malformed articles', () => {
    const first = normalizeRealPublisherArticle(realPublisherSearchFixture.results[0]);
    const partial = normalizeRealPublisherArticle(realPublisherSearchFixture.results[2]);
    const malformed = normalizeRealPublisherArticle(realPublisherSearchFixture.results[4]);
    expect(first).toMatchObject({ id: 'rp-001', title: 'The infrastructure of a cooler city', categories: ['Climate'], tags: ['sustainability', 'cities'] });
    expect(first?.provenance).toMatchObject({ publisherId: 'real-publisher', sourceArticleId: 'rp-001' });
    expect(partial).toMatchObject({ id: 'rp-003', author: undefined, categories: ['Business'], tags: ['sustainability', 'manufacturing'] });
    expect(malformed).toBeNull();
  });

  it('retrieves candidates, skips malformed results, and sends them through core ranking', async () => {
    const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify(realPublisherSearchFixture), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const adapter = new RealPublisherAdapter({ ...defaultRealPublisherApiConfig, baseUrl: 'https://api.example.test' }, fetchImpl);
    const raw = await adapter.search(intent, { limit: 30 });
    const normalized = raw.flatMap((article) => { const result = adapter.normalizeArticle(article); return result ? [result] : []; });
    expect(raw).toHaveLength(5);
    expect(normalized).toHaveLength(4);
    expect(rankArticles(normalized, intent, 3)[0].article.publisherId).toBe('real-publisher');

    const debugEvents: string[] = [];
    const service = new RecommendationService({ config: { ...demoConfig, publisherId: 'real-publisher' }, adapter, explanationProvider: new DeterministicExplanationProvider() }, (event) => debugEvents.push(event.type));
    const response = await service.recommend({ interest: 'sustainability', role: 'manufacturer' });
    expect(response.results[0].article.provenance?.retrievalSource).toBe('real-publisher-api');
    expect(debugEvents).toEqual(expect.arrayContaining(['intent', 'publisher_search_request', 'candidate_retrieval', 'normalized_articles', 'ranked_results']));
  });

  it('maps authentication and timeout failures to safe product errors', async () => {
    const authAdapter = new RealPublisherAdapter(defaultRealPublisherApiConfig, async () => new Response('', { status: 401 }));
    await expect(authAdapter.search(intent, { limit: 30 })).rejects.toMatchObject({ code: 'authentication-failure' });
    const timeoutAdapter = new RealPublisherAdapter({ ...defaultRealPublisherApiConfig, timeoutMs: 5 }, async (_input, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await expect(timeoutAdapter.search(intent, { limit: 30 })).rejects.toMatchObject({ code: 'search-timeout' });
  });
});
