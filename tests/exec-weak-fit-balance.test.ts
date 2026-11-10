import { describe, expect, it } from 'vitest';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS, REPORT_SUMMARY_ONLY_INSTRUCTIONS } from '../src/ai/providers/openai-compatible';
import { createProductionApp } from '../src/server/production';
import { EXEC_FIXTURE_STORIES } from './exec-market-fixtures';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${EXEC_FIXTURE_STORIES.map(([section, title, description], i) => `<item><title>${title}</title><link>https://www.sgieurope.com/${section}/s-${i}/16000${i}.article</link><guid>https://www.sgieurope.com/${section}/s-${i}/16000${i}.article</guid><description>${description}</description><pubDate>Mon, 0${(i % 9) + 1} Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const contexts: Record<string, [string, string, string[]]> = { 'decathlon.com': ['Decathlon', 'sporting goods retail', ['retail', 'sporting goods']], 'nike.com': ['Nike', 'sporting goods', ['footwear', 'apparel']] };

/** Small seeded PRNG (mulberry32): the same seed always flags the same stories. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Article = { id: string; title: string; ownCompany: boolean };
type Logged = { message: string; fields: Record<string, unknown> };

/**
 * Stub AI: the rerank keeps everything (no weak flags); each E call flags stories about other companies weak with
 * probability `weakChance` (1 = every competitor story, the live 1ea12d7a case); own-company stories are explained.
 */
async function generate(domain: string, jobTitle: string, weakChance: number, seed: number) {
  const random = seeded(seed);
  const logs: Logged[] = [];
  const contentCalls: Array<{ system: string; reader: Record<string, unknown>; part: 'S' | 'E' }> = [];
  const app = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-weak-key', AI_MODEL: 'test-model', AI_ENDPOINT },
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const system = body.messages[0].content as string;
      const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      let content: unknown = {};
      if (ref.operation === 'semantic-reranking') content = { results: (ref.payload.candidates as Array<{ id: string }>).map((entry, index) => ({ id: entry.id, score: 90 - index })) };
      else if (ref.operation === 'report-content') {
        const articles = ref.payload.articles as Article[];
        const part = system.includes('Do not write explanations') ? 'S' as const : 'E' as const;
        contentCalls.push({ system, reader: ref.payload.reader, part });
        content = part === 'S'
          ? { summary: 'JD Sports and Intersport results set the pace for sporting goods retail.', citedArticleIds: articles.slice(0, 2).map((entry) => entry.id) }
          : { explanations: articles.map((entry, index) => (!entry.ownCompany && random() < weakChance ? { articleId: entry.id, fit: 'weak' } : { articleId: entry.id, angle: 'competitive move', explanation: `Point ${index} changes how you weigh your next capital decision against rivals.` })) };
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
    },
    companyContextProvider: { getContext: async (d: string) => ({ domain: d, canonicalUrl: `https://${d}/`, name: contexts[d][0], industry: contexts[d][1], topics: contexts[d][2], entities: [contexts[d][0]], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: domain, jobTitle }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  const report = (await app.reportStore.get(reportId, 'sgi-europe'))!;
  const share = logs.find((entry) => entry.message === 'own_company_share')!.fields;
  return { report, logs, share, contentCalls, titles: report.recommendations.map((item) => item.article.title) };
}

const isOwn = (title: string, company: string) => title.startsWith(company);

describe('CEO at Decathlon: content-call weak fits do not empty the report of market stories', () => {
  it('holds own-company share at or under 60% over five runs with random competitor weak flags', async () => {
    const rows: string[] = [];
    for (const [run, weakChance] of [[1, 1], [2, 0.8], [3, 0.6], [4, 0.8], [5, 1]] as const) {
      const { titles, share, logs } = await generate('decathlon.com', 'CEO', weakChance, run * 7919);
      const nonOwn = titles.filter((title) => !isOwn(title, 'Decathlon')).length;
      const weakFlags = logs.filter((entry) => entry.message === 'weak_fit_removed')[0]?.fields.weakFromContent ?? 0;
      rows.push(`run ${run} (p=${weakChance}): weakFromContent=${weakFlags} own=${share.ownCompanyCount}/${share.recommendationCount} share=${share.ownCompanyShare} nonOwn=${nonOwn}`);
      expect(nonOwn, rows.at(-1)).toBeGreaterThanOrEqual(2);
      expect(share.ownCompanyShare as number, rows.at(-1)).toBeLessThanOrEqual(0.6);
      expect(share.ownCompanyCapExceeded, rows.at(-1)).toBe(false);
    }
    process.stdout.write(`${rows.join('\n')}\n`);
  });
});

describe('executive context reaches the content calls', () => {
  it('sends reader.executive and the EXECUTIVE READER rule to S and E for a CEO, not for Head of Retail', async () => {
    expect(REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS).toMatch(/EXECUTIVE READER: when reader\.executive is true/);
    expect(REPORT_SUMMARY_ONLY_INSTRUCTIONS).toMatch(/EXECUTIVE READER: when reader\.executive is true/);
    const ceo = await generate('decathlon.com', 'CEO', 0, 1);
    expect(ceo.contentCalls.map((call) => call.part)).toEqual(expect.arrayContaining(['S', 'E']));
    for (const call of ceo.contentCalls) {
      expect(call.reader.executive, call.part).toBe(true);
      expect(call.system, call.part).toMatch(/never mark such an article weak[^.]*just because it is about another company/i);
    }
    const retail = await generate('nike.com', 'Head of Retail', 0, 1);
    for (const call of retail.contentCalls) expect(call.reader.executive, call.part).toBeUndefined();
  });
});

describe('weak removals and the selection trace are logged (IDs and codes only)', () => {
  it('logs rerank_dropped with stage content for every content-call removal, and one selection_trace line', async () => {
    const { report, logs } = await generate('nike.com', 'Head of Retail', 1, 3);
    const removed = logs.find((entry) => entry.message === 'weak_fit_removed')!.fields;
    const drops = logs.filter((entry) => entry.message === 'rerank_dropped' && entry.fields.stage === 'content');
    expect(removed.weakRemoved as number).toBeGreaterThan(0);
    // Every report story the content call removed, plus flagged reserves / market candidates that never joined.
    expect(drops.length).toBeGreaterThanOrEqual(removed.weakRemoved as number);
    for (const entry of drops) {
      expect(Object.keys(entry.fields).sort()).toEqual(['articleId', 'publisherId', 'rejectReason', 'requestId', 'stage']);
      expect(['weak_removed', 'not_returned']).toContain(entry.fields.rejectReason);
    }
    const traces = logs.filter((entry) => entry.message === 'selection_trace');
    expect(traces).toHaveLength(1);
    const entries = (traces[0].fields.selectionTrace as string).split(';').map((part) => part.split('|'));
    const byId = new Map(entries.map(([id, stage, outcome, reason]) => [id, { stage, outcome, reason }]));
    for (const recommendation of report.recommendations) expect(['selected', 'weak', 'restored', 'relaxed']).toContain(byId.get(recommendation.articleId)?.outcome);
    for (const entry of drops) expect(byId.get(entry.fields.articleId as string)).toMatchObject({ stage: 'content', outcome: 'dropped' });
    for (const [, stage, outcome] of entries) {
      expect(['ranking', 'rerank', 'cap', 'content', 'restore', 'balance', 'final']).toContain(stage);
      expect(['selected', 'weak', 'duplicate', 'capped', 'restored', 'relaxed', 'dropped']).toContain(outcome);
    }
    // No titles or other article text in the trace.
    for (const [, title] of EXEC_FIXTURE_STORIES) expect(traces[0].fields.selectionTrace).not.toContain(title);
  });

  it('CEO live case (every competitor story flagged weak): market stories kept as lower confidence, traced', async () => {
    const { report, logs, share } = await generate('decathlon.com', 'CEO', 1, 3);
    const kept = report.recommendations.filter((item) => !isOwn(item.article.title, 'Decathlon'));
    expect(kept.length).toBeGreaterThanOrEqual(2);
    expect(kept.every((item) => item.rankingMetadata.lowerConfidence)).toBe(true);
    expect(share).toMatchObject({ ownCompanyRestored: 0, ownCompanyCapExceeded: false });
    const trace = logs.find((entry) => entry.message === 'selection_trace')!.fields.selectionTrace as string;
    for (const item of kept) expect(trace).toContain(`${item.articleId}|content|weak|market_balance`);
  });
});

describe('dedicated roles unchanged', () => {
  // Same titles as main before this change, with the content call flagging every other-company story weak.
  it('Head of Retail at Nike', async () => {
    expect((await generate('nike.com', 'Head of Retail', 1, 3)).titles).toEqual([
      'Decathlon expands footprint in cities with two new stores in Nuremberg',
      'Nike opens House of Innovation flagship in Paris',
      'Intersport posts record revenue as store network grows',
    ]);
    expect((await generate('nike.com', 'Head of Retail', 0.5, 11)).titles).toHaveLength(7);
  });

  it('Head of Procurement at Nike', async () => {
    for (const [chance, seed] of [[0, 1], [0.5, 11], [1, 3]] as const) {
      expect((await generate('nike.com', 'Head of Procurement', chance, seed)).titles).toEqual(['Sporting goods market in Germany grows 3%', 'Sportisimo acquires rival chain in Poland']);
    }
  });
});
