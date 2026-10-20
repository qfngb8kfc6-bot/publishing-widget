import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile } from '../src/core';
import { explanationQualityWarnings, summaryQualityWarnings } from '../src/ai/content-quality';
import { REPORT_CONTENT_INSTRUCTIONS } from '../src/ai/providers/openai-compatible';
import { articleRelationship } from '../src/reports/relationship';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { company } from './ranking-fixtures';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const articles = [
  { slug: 'nike-stores', title: 'Nike opens 12 owned stores in Germany', description: 'Nike expanded its retail stores and omnichannel distribution in Germany.' },
  { slug: 'adidas-wholesale', title: 'Adidas cuts wholesale accounts in Europe', description: 'Adidas cut wholesale accounts while expanding its own retail stores and omnichannel distribution in Europe.' },
  { slug: 'factory-shift', title: 'Footwear factory in Vietnam adds capacity', description: 'A supplier factory added retail stores capacity and distribution for footwear brands.' },
  { slug: 'market-growth', title: 'European sports retail market grows 4%', description: 'Retail stores and omnichannel distribution sales grew 4% across European markets.' },
];
const items = articles.map((article, index) => `<item><title>${article.title}</title><link>https://www.sgieurope.com/retail/${article.slug}/12000${index}.article</link><guid>https://www.sgieurope.com/retail/${article.slug}/12000${index}.article</guid><description>${article.description}</description><pubDate>Mon, 0${index + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('');
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;

type Logged = { message: string; fields: Record<string, unknown> };
type ContentPayload = { reader: Record<string, unknown>; articles: Array<{ id: string; title: string; relationship?: string }> };

function app(respond: (payload: ContentPayload) => unknown) {
  const logs: Logged[] = [];
  let contentPayload: ContentPayload | undefined;
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-quality-key', AI_MODEL: 'test-model', AI_ENDPOINT },
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      if (ref.operation === 'professional-profile-enrichment') return Response.json({ choices: [{ message: { content: JSON.stringify({ relevantEntities: ['Adidas', 'Puma'] }) }, finish_reason: 'stop' }] });
      if (ref.operation !== 'report-content') return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
      contentPayload = ref.payload;
      return Response.json({ choices: [{ message: { content: JSON.stringify(respond(ref.payload)) }, finish_reason: 'stop' }] });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'Nike designs footwear and apparel.', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  return { instance, logs, payload: () => contentPayload };
}

async function generate(target: ReturnType<typeof app>['instance']) {
  const response = await target.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  return (await target.reportStore.get(reportId, 'sgi-europe'))!;
}

describe('content prompt', () => {
  it('states grounding, the summary and explanation rules, the banned phrases and placeholder examples', () => {
    for (const rule of ['use only facts stated', 'Never invent numbers, companies', 'Use only the supplied article ids', '3-4 sentences', 'strongest pattern', 'one specific thing to watch', 'citedArticleIds', 'never more than 45', 'angle is exactly one of: competitor benchmark, market signal', 'a collaboration or product launch is never a leadership move', 'no two explanations may start with the same three words', '"relevant because"', '"the profile"', '"the most relevant articles"', 'Acme Apparel', 'Northwind Sports']) {
      expect(REPORT_CONTENT_INSTRUCTIONS).toContain(rule);
    }
  });
});

describe('content call inputs and stored output', () => {
  it('sends compact reader context and a relationship hint per article under short aliases', async () => {
    const { instance, payload } = app(() => ({ summary: 'S.', explanations: [] }));
    const report = await generate(instance);
    const sent = payload()!;
    expect(Object.keys(sent.reader).sort()).toEqual(['company', 'companyDescription', 'industry', 'jobTitle', 'priorities', 'responsibilities', 'roleFunction', 'today']);
    expect(sent.articles.map((article) => article.id)).toEqual(report.recommendations.map((_, index) => `a${index + 1}`));
    const relationships = new Map(sent.articles.map((article) => [article.title, article.relationship]));
    expect(relationships.get('Nike opens 12 owned stores in Germany')).toBe('own_company');
    expect(relationships.get('Adidas cuts wholesale accounts in Europe')).toBe('likely_competitor');
    expect(relationships.get('Footwear factory in Vietnam adds capacity')).toBe('supplier_partner');
    expect(relationships.get('European sports retail market grows 4%')).toBe('wider_market');
  });

  it('maps aliases back, stores angles and summary citations, and keeps text that breaks style rules', async () => {
    const { instance, logs } = app(({ articles: sent }) => ({
      summary: 'Nike is adding 12 owned stores in Germany while Adidas cuts wholesale accounts, and European sports retail grew 4%. Watch shelf space at multi-brand retailers.',
      citedArticleIds: [sent[0].id, sent[1].id, 'a99'],
      explanations: sent.map((article, index) => ({ articleId: article.id, angle: index === 0 ? 'Channel Shift' : 'a very long angle label that is far too long', explanation: index === 0 ? 'This article is relevant because it maps to retail.' : `${article.title} signals a shift worth tracking.` })),
    }));
    const report = await generate(instance);
    const byTitle = new Map(report.recommendations.map((item) => [item.article.title, item]));
    const first = report.recommendations.find((item) => item.rankingMetadata.angle);
    expect(first?.rankingMetadata.angle).toBe('channel shift');
    expect(report.recommendations.filter((item) => item.rankingMetadata.angle)).toHaveLength(1);
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'ai')).toBe(true);
    expect(report.recommendations.filter((item) => item.rankingMetadata.citedInSummary)).toHaveLength(2);
    expect(byTitle.size).toBeGreaterThan(2);
    const warnings = logs.filter((entry) => entry.message === 'ai_quality_warning');
    expect(warnings).toContainEqual(expect.objectContaining({ fields: expect.objectContaining({ stage: 'explanation', qualityCode: 'banned_phrase', articleId: first?.articleId }) }));
    expect(JSON.stringify(warnings)).not.toContain('relevant because');
    expect(JSON.stringify(warnings)).not.toContain('shelf space');
  });
});

describe('quality heuristics', () => {
  const titles = new Map([['a', 'Acme opens 12 stores in Germany'], ['b', 'Northwind cuts wholesale accounts'], ['c', 'Market grows'], ['d', 'Retail update']]);

  it('flags banned phrases, repeated openings, length and missing specifics', () => {
    const warnings = explanationQualityWarnings([
      { articleId: 'a', explanation: 'Acme opened 12 stores in Germany, a channel benchmark.' },
      { articleId: 'b', explanation: 'Acme opened 12 wholesale doors too, unlike Northwind.' },
      { articleId: 'c', explanation: 'This matters because it aligns with priorities.' },
      { articleId: 'd', explanation: `${'word '.repeat(46)}in 2026.` },
    ], titles);
    expect(warnings).toEqual([
      { articleId: 'b', code: 'duplicate_opening' },
      { articleId: 'c', code: 'banned_phrase' },
      { articleId: 'c', code: 'no_specific_fact' },
      { articleId: 'd', code: 'too_long' },
    ]);
  });

  it('flags summaries that use banned phrases, cite too few articles or restate the reader', () => {
    expect(summaryQualityWarnings('The most relevant articles focus on sourcing for a Head of Procurement at Nike.', ['a1'], { jobTitle: 'Head of Procurement', companyName: 'Nike' })).toEqual(['banned_phrase', 'too_few_citations', 'restates_reader', 'third_person_reader']);
    expect(summaryQualityWarnings('Acme and Northwind are both diversifying suppliers; watch freight costs.', ['a1', 'a2', 'a3'], { jobTitle: 'Head of Procurement', companyName: 'Nike' })).toEqual([]);
  });
});

describe('article relationship', () => {
  const profile = { ...buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', []), 'Head of Procurement'), entities: ['Nike', 'Adidas', 'Puma'] };

  it('classifies own company, supplier or partner, likely competitor and wider market', () => {
    expect(articleRelationship({ title: 'Nike reshapes its store network', description: 'New flagship locations.' }, profile)).toBe('own_company');
    expect(articleRelationship({ title: 'Nike supplier adds a factory in Vietnam', description: '' }, profile)).toBe('supplier_partner');
    expect(articleRelationship({ title: 'Puma raises guidance', description: '' }, profile)).toBe('likely_competitor');
    expect(articleRelationship({ title: 'Sports retail market grows 4%', description: '' }, profile)).toBe('wider_market');
    expect(articleRelationship({ title: 'Pumarama festival returns', description: '' }, profile)).toBe('wider_market');
  });
});
