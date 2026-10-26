import { describe, expect, it } from 'vitest';
import { MockAIProvider } from '../src/ai/providers/mock';
import type { ReportContentRequest } from '../src/ai/types';
import { MemoryAnalyticsStore } from '../src/analytics/store';
import { MemoryArticleTextStore, MemoryCatalogueSnapshotStore, MemoryReportStore } from '../src/reports';
import { createProductionApp } from '../src/server/production';
import type { ServerLogFields, StructuredLogger } from '../src/server/logging';

const BODY_MARKER = 'Zorblax';
const TOPICS = ['Sustainability targets tighten for sportswear brands', 'Textile recycling capacity expands in Europe', 'Circular economy rules reshape apparel packaging', 'Carbon emissions reporting becomes mandatory for retailers', 'Sustainable materials gain share in footwear', 'Brands publish sustainability reports on supply chain emissions', 'Recycled polyester sourcing scales up', 'Climate goals push renewable energy in factories'];
const storyCodes = TOPICS.map((_, index) => String(200100 + index));
const recent = new Date(Date.now() - 5 * 86_400_000).toUTCString();
const feed = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>SGI</title>${TOPICS.map((title, index) => `<item><guid>g-${storyCodes[index]}</guid><title>${title}</title><link>https://www.sgieurope.com/csr-and-sustainability/story-${index}/${storyCodes[index]}.article</link><description>${title}: brands set sustainability, recycling and emissions targets across the sporting goods industry.</description><category>CSR and sustainability</category><pubDate>${recent}</pubDate></item>`).join('')}</channel></rss>`;

class CapturingSnapshotStore extends MemoryCatalogueSnapshotStore {
  readonly saved: string[] = [];
  override async save(snapshot: Parameters<MemoryCatalogueSnapshotStore['save']>[0]): Promise<void> {
    this.saved.push(JSON.stringify(snapshot));
    return super.save(snapshot);
  }
}

class CapturingAIProvider extends MockAIProvider {
  readonly contentRequests: ReportContentRequest[] = [];
  override async generateReportContent(input: ReportContentRequest): Promise<unknown> {
    this.contentRequests.push(input);
    return super.generateReportContent(input);
  }
}

async function setup(enabled: boolean) {
  const texts = new MemoryArticleTextStore();
  await texts.upsert('sgi-europe', storyCodes.map((storyCode, index) => ({ storyCode, isPrivate: index % 2 === 0, text: `${BODY_MARKER} confidential paragraph about sustainability, textile recycling and circular sportswear for story ${storyCode}. ${'More subscriber-only detail. '.repeat(80)}` })));
  const lines: Array<{ message: string; fields?: ServerLogFields }> = [];
  const logger: StructuredLogger = { info: (message, fields) => lines.push({ message, fields }), error: (message, fields) => lines.push({ message, fields }) };
  const provider = new CapturingAIProvider();
  const analyticsStore = new MemoryAnalyticsStore();
  const snapshots = new CapturingSnapshotStore();
  const reportStore = new MemoryReportStore();
  const fetchImpl = (async (input: RequestInfo | URL) => (String(input).includes('sgieurope.com') && String(input).includes('.rss') ? new Response(feed, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }) : new Response('not found', { status: 404 }))) as typeof fetch;
  const app = createProductionApp({ environment: 'test', serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'mock', AI_MODEL: 'test-model', PUBLISHER_INDEX_PREBUILD: 'false', ...(enabled ? { WVC_ENRICHMENT_ENABLED: 'true' } : {}) }, aiProvider: provider, logger, fetchImpl, analyticsStore, catalogueSnapshotStore: snapshots, reportStore, articleTextStore: texts });
  return { app, provider, lines, analyticsStore, snapshots, reportStore };
}

async function generate(app: ReturnType<typeof createProductionApp>) {
  const response = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'puma.com', jobTitle: 'Head of Sustainability' }) }));
  const payload = await response.json() as { reportId: string };
  expect(response.status, JSON.stringify(payload)).toBe(201);
  const reportResponse = await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}?publisherId=sgi-europe`));
  return { reportId: payload.reportId, json: await reportResponse.text() };
}

describe('subscriber-only full text stays server-side', () => {
  it('feeds leads to the AI call but never into public report JSON, analytics, logs or snapshots', async () => {
    const { app, provider, lines, analyticsStore, snapshots } = await setup(true);
    const { reportId, json } = await generate(app);
    await app.flushAnalytics();
    await app.catalogueIdle();
    const report = JSON.parse(json) as { recommendations: Array<{ articleId: string; subscriberOnly?: boolean; article: Record<string, unknown> }> };
    expect(report.recommendations.length).toBeGreaterThan(0);

    // The AI content call received bounded leads for the selected articles.
    const sent = provider.contentRequests.flatMap((request) => request.recommendations);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((item) => item.leadExcerpt?.startsWith(BODY_MARKER) && item.leadExcerpt.length <= 800)).toBe(true);

    // Public JSON: only the boolean, never body text, under any key.
    expect(json).not.toContain(BODY_MARKER);
    expect(json).not.toContain('subscriber-only detail');
    expect(json).not.toMatch(/"(leadExcerpt|lead|plainText|plain_text|storyText|STORYTEXT)"/);
    expect(report.recommendations.every((item) => typeof item.subscriberOnly === 'boolean')).toBe(true);
    expect(report.recommendations.every((item) => !('leadExcerpt' in item.article))).toBe(true);

    // Theme search results carry the flag too, and no text.
    const theme = (JSON.parse(json) as { professionalProfile: { themes?: string[] } }).professionalProfile.themes?.[0];
    if (theme) {
      const themeResponse = await app.handle(new Request(`https://product.example/api/reports/${reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=sgi-europe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
      expect(await themeResponse.text()).not.toContain(BODY_MARKER);
    }

    expect(JSON.stringify(await analyticsStore.query({ publisherId: 'sgi-europe' }))).not.toContain(BODY_MARKER);
    expect(JSON.stringify(lines)).not.toContain(BODY_MARKER);
    expect(snapshots.saved.length).toBeGreaterThan(0);
    expect(snapshots.saved.join('')).not.toContain(BODY_MARKER);
  });

  it('behaves as before when enrichment is off: no leads, no flag', async () => {
    const { app, provider } = await setup(false);
    const { json } = await generate(app);
    const report = JSON.parse(json) as { recommendations: Array<Record<string, unknown>> };
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.every((item) => !('subscriberOnly' in item))).toBe(true);
    expect(provider.contentRequests.flatMap((request) => request.recommendations).some((item) => 'leadExcerpt' in item)).toBe(false);
    expect(json).not.toContain(BODY_MARKER);
  });
});

describe('subscriberOnly persistence', () => {
  it('is stored inside ranking metadata and read back as a top-level boolean', async () => {
    const { PostgresReportStore } = await import('../src/reports/store');
    const written: unknown[][] = [];
    const client = { query: async <Row>(sql: string, parameters?: unknown[]) => {
      if (sql.startsWith('INSERT INTO report_recommendations')) written.push(parameters ?? []);
      if (sql.startsWith('SELECT r.*')) return { rows: [{ id: 'r1', publisher_id: 'sgi-europe', session_id: 's', company_url: 'https://puma.com/', company_domain: 'puma.com', job_title: 'Head of Sustainability', professional_profile_json: {}, retrieval_context_json: {}, overall_match_score: 50, generated_summary: 'x', generation_version: '1', ranking_version: '1', professional_profile_version: '1', ai_provider_version: 'd', publisher_config_version: '1', widget_version: '1', created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z', recommendations_json: [{ article_id: 'a', rank: 1, raw_score: 50, display_score: 50, reason: 'why', article_json: { id: 'a' }, ranking_metadata_json: { relevanceSignals: [], rankingMode: 'deterministic', rankingVersion: '1', subscriberOnly: true } }] }] as Row[] };
      return { rows: [] as Row[] };
    } };
    const store = new PostgresReportStore(client as never);
    const report = (await store.get('r1'))!;
    expect(report.recommendations[0].subscriberOnly).toBe(true);
    expect('subscriberOnly' in report.recommendations[0].rankingMetadata).toBe(false);
    await store.save(report);
    expect(JSON.parse(String(written[0][7]))).toMatchObject({ subscriberOnly: true });
  });
});
