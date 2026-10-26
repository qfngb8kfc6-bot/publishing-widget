import { describe, expect, it } from 'vitest';
import { explanationQualityWarnings, summaryQualityWarnings } from '../src/ai/content-quality';
import { articleTiming, OpenAICompatibleProvider, REPORT_CONTENT_INSTRUCTIONS, REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS, REPORT_SUMMARY_ONLY_INSTRUCTIONS } from '../src/ai/providers/openai-compatible';

const NOW = Date.parse('2026-10-20T12:00:00.000Z');

describe('article timing', () => {
  it('gives the publication year and flags articles older than 18 months', () => {
    expect(articleTiming('2018-06-01T09:00:00.000Z', NOW)).toEqual({ published: '2018', older: true });
    expect(articleTiming('2025-04-01T09:00:00.000Z', NOW)).toEqual({ published: '2025', older: true });
    expect(articleTiming('2025-05-21T09:00:00.000Z', NOW)).toEqual({ published: '2025' });
    expect(articleTiming('2026-09-01T09:00:00.000Z', NOW)).toEqual({ published: '2026' });
    expect(articleTiming(undefined, NOW)).toEqual({});
    expect(articleTiming('not a date', NOW)).toEqual({});
  });
});

describe('date-aware prompt and inputs', () => {
  it('tells the model to date older facts, build the pattern from recent articles and address the reader directly', () => {
    for (const instructions of [REPORT_CONTENT_INSTRUCTIONS, REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS, REPORT_SUMMARY_ONLY_INSTRUCTIONS]) {
      expect(instructions).toContain('older:true when it is more than 18 months old');
      expect(instructions).toContain('anchor the fact in time ("In 2019, Decathlon ...")');
      expect(instructions).toContain('never as a current plan or current news');
    }
    expect(REPORT_CONTENT_INSTRUCTIONS).toContain('addressed to the reader directly (you, your team)');
    expect(REPORT_CONTENT_INSTRUCTIONS).toContain('primarily from articles that are not older');
    expect(REPORT_SUMMARY_ONLY_INSTRUCTIONS).toContain('addressed to the reader directly (you, your team)');
    expect(REPORT_SUMMARY_ONLY_INSTRUCTIONS).toContain('primarily from articles that are not older');
  });

  it('sends published year, an older flag and today instead of full timestamps', async () => {
    let payload: { reader: { today: string }; articles: Array<Record<string, unknown>> } | undefined;
    const provider = new OpenAICompatibleProvider({ endpoint: 'https://ai.example.test/v1', apiKey: 'sk-test-dates-1234', model: 'm', timeoutMs: 1_000 }, async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      payload = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')).payload;
      return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
    });
    const recent = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await provider.generateReportContent({ publisherId: 'p', profile: {} as never, recommendations: [
      { article: { id: 'old', title: 'Decathlon plans environmental labels by 2019', publishedAt: '2018-06-01T09:00:00.000Z', categories: [], tags: [], publisherId: 'p' }, deterministicExplanation: '', relevanceSignals: [], semanticSignals: [] },
      { article: { id: 'new', title: 'Puma commits to deforestation-free leather', publishedAt: recent, categories: [], tags: [], publisherId: 'p' }, deterministicExplanation: '', relevanceSignals: [], semanticSignals: [] },
    ] });
    expect(payload!.reader.today).toMatch(/^\d{4}-\d{2}$/);
    expect(payload!.articles[0]).toMatchObject({ published: '2018', older: true });
    expect(payload!.articles[1]).toMatchObject({ published: recent.slice(0, 4) });
    expect(payload!.articles[1]).not.toHaveProperty('older');
    expect(JSON.stringify(payload)).not.toContain('publishedAt');
  });
});

describe('date and reader warnings', () => {
  it('flags an older fact that is not anchored in its year', () => {
    const articles = new Map([['old', { title: 'Decathlon plans environmental labels', olderYear: '2018' }], ['new', { title: 'Puma commits to leather traceability' }]]);
    expect(explanationQualityWarnings([
      { articleId: 'old', explanation: 'Decathlon plans to label all footwear by the end of 2019, a labelling benchmark.' },
      { articleId: 'new', explanation: 'Puma will trace all leather to farm level by 2030.' },
    ], articles)).toEqual([{ articleId: 'old', code: 'old_fact_not_dated' }]);
    expect(explanationQualityWarnings([{ articleId: 'old', explanation: 'In 2018, Decathlon said it would label all footwear, a precedent for labelling.' }], articles)).toEqual([]);
  });

  it('flags summaries that talk about the reader in the third person', () => {
    const reader = { jobTitle: 'Product Manager', companyName: 'Adidas' };
    expect(summaryQualityWarnings('Competitors launched carbon-plated shoes; for a product manager this means faster cycles.', ['a1', 'a2'], reader)).toEqual(['third_person_reader']);
    expect(summaryQualityWarnings('Store growth matters for a retailer watching wholesale.', ['a1', 'a2'], reader)).toEqual(['third_person_reader']);
    expect(summaryQualityWarnings('Adidas and Puma both shortened launch cycles; your roadmap should plan for faster competitor drops.', ['a1', 'a2'], reader)).toEqual([]);
  });
});

describe('figure periods', () => {
  it('tells the model to keep the period an article gives for its figures', () => {
    for (const instructions of [REPORT_CONTENT_INSTRUCTIONS, REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS, REPORT_SUMMARY_ONLY_INSTRUCTIONS]) {
      expect(instructions).toContain('published year is when it was written, not the period its figures describe');
      expect(instructions).toContain('Never relabel a figure with the published year');
      expect(instructions).toContain('present them as different periods');
    }
  });

  it('flags a summary year that no cited article states (a 2024 figure relabelled with the 2025 publication year)', () => {
    const reader = { jobTitle: 'Product Manager', companyName: 'Nike' };
    const sources = new Map([
      ['market-2024', { text: 'Market Analysis: the global athletic apparel market. 2024 sales reached $122.6bn, up 2.1%.' }],
      ['market-2025', { text: 'Market Analysis: athletic apparel grew 7% in 2025.' }],
      ['old', { text: 'Decathlon plans environmental labels', olderYear: '2019' }],
    ]);
    expect(summaryQualityWarnings('In 2025 global athletic apparel sales rose just 2.1%, while Puma and Adidas cut prices; your team should watch margins.', ['market-2024', 'old'], reader, sources)).toEqual(['unsupported_year']);
    expect(summaryQualityWarnings('Athletic apparel sales rose 2.1% in 2024 and 7% in 2025; in 2019 Decathlon added labels, so your team should watch margins.', ['market-2024', 'market-2025', 'old'], reader, sources)).toEqual([]);
    expect(summaryQualityWarnings('In 2025 sales rose 2.1%.', ['a1', 'a2'], reader)).not.toContain('unsupported_year');
  });

  it('flags an explanation year missing from that article', () => {
    const articles = new Map([['m', { title: 'Market Analysis: athletic apparel', sourceText: 'Market Analysis: athletic apparel. 2024 sales reached $122.6bn, up 2.1%.' }]]);
    expect(explanationQualityWarnings([{ articleId: 'm', explanation: 'Athletic apparel sales rose 2.1% in 2025, a slow market for new product lines.' }], articles)).toEqual([{ articleId: 'm', code: 'unsupported_year' }]);
    expect(explanationQualityWarnings([{ articleId: 'm', explanation: 'Athletic apparel sales rose 2.1% in 2024, a slow market for new product lines.' }], articles)).toEqual([]);
  });
});
