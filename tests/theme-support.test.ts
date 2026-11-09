import { describe, expect, it } from 'vitest';
import { explanationRestatement } from '../src/ai/content-quality';
import { REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS, REPORT_EXPLANATIONS_RESTATED_INSTRUCTIONS, REPORT_SUMMARY_ONLY_INSTRUCTIONS } from '../src/ai/providers/openai-compatible';
import { validateReportContent } from '../src/ai/validation';
import { buildProfessionalProfile } from '../src/core';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { articleSupportsTheme, findReportTheme, reportThemes, themeDisplayTitle, themeInlineText, themeSupport, themeSupportingRecommendations } from '../src/reports/themes';
import type { ReportRecommendation, ReportRecord } from '../src/reports';
import { createProductionApp } from '../src/server/production';
import { company } from './ranking-fixtures';

describe('theme display titles', () => {
  it('shows themes in sentence case and keeps acronyms and brand spellings', () => {
    expect(themeDisplayTitle('connected fitness')).toBe('Connected fitness');
    expect(themeDisplayTitle('wearables')).toBe('Wearables');
    expect(themeDisplayTitle('ai coaching')).toBe('AI coaching');
    expect(themeDisplayTitle('AI coaching')).toBe('AI coaching');
    expect(themeDisplayTitle('rfid in stores')).toBe('RFID in stores');
    expect(themeDisplayTitle('esg reporting')).toBe('ESG reporting');
    expect(themeDisplayTitle('ebay marketplace')).toBe('eBay marketplace');
    expect(themeDisplayTitle('selling on ebay')).toBe('Selling on eBay');
    expect(themeDisplayTitle('ai-powered personalisation')).toBe('AI-powered personalisation');
    expect(themeDisplayTitle('e-commerce')).toBe('E-commerce');
    expect(themeDisplayTitle('eu  digital product passport')).toBe('EU digital product passport');
    // Inline text restores acronyms only: "stories that touch on AI coaching", not "on Ai coaching".
    expect(themeInlineText('ai coaching')).toBe('AI coaching');
    expect(themeInlineText('connected fitness')).toBe('connected fitness');
  });
});

const article = (id: string, title: string, description: string): ReportRecommendation['article'] => ({ id, publisherId: 'sgi-europe', title, description, url: `https://www.sgieurope.com/${id}.article`, categories: [], tags: [] } as unknown as ReportRecommendation['article']);
const rec = (id: string, title: string, description: string, displayScore: number, rank: number) => ({ articleId: id, rank, rawScore: displayScore, displayScore, explanation: '', article: article(id, title, description), rankingMetadata: {} } as unknown as ReportRecommendation);

describe('theme support', () => {
  const fitbit = rec('fitbit', 'Fitbit unveils AI health coach', 'Google\'s Fitbit has put an AI health coach into public preview.', 61, 1);
  const fesi = rec('fesi', 'FESI calls for simpler EU digital rules', 'The federation urged Brussels to simplify digital rules.', 39, 3);
  const peloton = rec('peloton', 'Peloton adds AI form tracking', 'Peloton refreshed its connected fitness hardware.', 48, 2);
  const recommendations = [fitbit, peloton, fesi];

  it('uses the AI theme links when they exist and falls back to stories whose text names the theme', () => {
    const support = themeSupport(['connected fitness', 'regulation', 'digital product passport'], recommendations, { 'connected fitness': ['peloton', 'fitbit', 'not-in-report'] });
    expect(support['connected fitness']).toEqual(['peloton', 'fitbit']);
    // No AI links: text match, here through the regulation concept family ("rules" does not count, "regulation" would).
    expect(themeSupport(['connected fitness'], recommendations)).toEqual({ 'connected fitness': ['peloton'] });
    // A theme no story supports gets no entry.
    expect(support['digital product passport']).toBeUndefined();
    // AI links to articles that are no longer in the report fall back to text.
    expect(themeSupport(['connected fitness'], recommendations, { 'connected fitness': ['gone'] })).toEqual({ 'connected fitness': ['peloton'] });
  });

  it('lists the supporting report stories by match score, hides unsupported themes and still accepts them for search', () => {
    const profile = { ...buildProfessionalProfile(company('ldsystems.uk', 'LD Systems', 'software', []), 'Technology Professional'), themes: ['connected fitness', 'wearables'], themeArticleIds: { 'connected fitness': ['fesi', 'fitbit', 'peloton'] } };
    const report = { professionalProfile: profile, recommendations } as unknown as ReportRecord;
    expect(themeSupportingRecommendations(report, 'connected fitness').map((item) => [item.articleId, item.displayScore])).toEqual([['fitbit', 61], ['peloton', 48], ['fesi', 39]]);
    expect(reportThemes(report)).toEqual(['connected fitness']);
    expect(findReportTheme(report, 'Wearables')).toBe('wearables');
    // Older reports without stored links are matched by text.
    const older = { professionalProfile: { ...profile, themeArticleIds: undefined }, recommendations } as unknown as ReportRecord;
    expect(themeSupportingRecommendations(older, 'connected fitness').map((item) => item.articleId)).toEqual(['peloton']);
  });

  it('counts standard synonyms for procurement themes as support', () => {
    expect(articleSupportsTheme('procurement', { title: 'Materials contracts put new focus on supplier performance', description: '', categories: [] })).toBe(true);
    expect(articleSupportsTheme('connected fitness', { title: 'FESI calls for simpler EU digital rules', description: 'Digital Product Passport rules for sporting goods.', categories: ['Compliance'] })).toBe(false);
  });

  it('keeps AI theme links only for supplied articles', () => {
    const request = { publisherId: 'sgi-europe', themes: ['connected fitness'], includeExplanations: false, profile: buildProfessionalProfile(company('ldsystems.uk', 'LD Systems', 'software', []), 'Technology Professional'), recommendations: ['x', 'y'].map((id) => ({ article: { id, publisherId: 'sgi-europe', title: id, categories: [], tags: [] }, deterministicExplanation: '', relevanceSignals: [], semanticSignals: [] })) } as unknown as Parameters<typeof validateReportContent>[1];
    const result = validateReportContent({ summary: 'S.', citedArticleIds: ['x'], themeDescriptions: [{ theme: 'Connected Fitness', description: 'Line.', articleIds: ['y', 'invented', 'y'] }] }, request);
    expect(result?.themeArticleIds).toEqual({ 'connected fitness': ['y'] });
  });
});

describe('restated explanations', () => {
  const fitbit = { title: 'Fitbit unveils AI health coach', description: "Google's Fitbit has put an AI health coach into public preview, using real-time Fitbit and Pixel Watch data to tailor workouts." };
  it('flags more than five consecutive words from the headline or excerpt, or a near-total word overlap', () => {
    expect(explanationRestatement("Google's Fitbit has put an AI health coach into public preview, using real-time Fitbit and Pixel Watch data.", fitbit)).toBe('consecutive_words');
    expect(explanationRestatement('Fitbit put its AI health coach in public preview with Pixel Watch data and real-time workouts.', fitbit)).toBe('token_overlap');
    expect(explanationRestatement('Your product team now has a bar for personalised features: Fitbit coaching built on live wearable data, first for Premium members.', fitbit)).toBeUndefined();
    // Five shared consecutive words is within the rule.
    expect(explanationRestatement('Your roadmap should note that an AI health coach is now table stakes for premium wearables.', fitbit)).toBeUndefined();
  });

  it('asks for reader-first explanations, a short lead sentence and, on regeneration, no retelling', () => {
    expect(REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS).toMatch(/never retell the story: open with what it means for the reader/);
    expect(REPORT_SUMMARY_ONLY_INSTRUCTIONS).toMatch(/first sentence of about 25 words at most/);
    expect(REPORT_SUMMARY_ONLY_INSTRUCTIONS).toMatch(/articleIds lists every supplied article that line draws on/);
    expect(REPORT_EXPLANATIONS_RESTATED_INSTRUCTIONS).toMatch(/^.*RESTATED: the earlier explanations/);
  });
});

/** The live SGI case: the "connected fitness" card names Peloton and Fitbit; the Fitbit explanation retells the story. */
const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const stories: Array<[string, string]> = [
  ['Fitbit unveils AI health coach', "Google's Fitbit has put an AI health coach for its wearables into public preview, using real-time Fitbit and Pixel Watch data. It opens to Premium members first."],
  ['Peloton adds AI form tracking to its connected fitness range', 'Peloton refreshed its connected fitness hardware with camera-based form tracking. Prices rise by $5.'],
  ['Garmin wearables revenue jumps 20%', 'Garmin said its fitness segment, including wearables and the Connect app, grew 20%. Margins rose.'],
  ['FESI calls for simpler EU digital rules', 'The sporting goods federation urged Brussels to simplify digital product rules for brands. Smaller firms carry the cost.'],
];
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${stories.map(([title, description], index) => `<item><title>${title}</title><link>https://www.sgieurope.com/news/t-${index}/4100${index}.article</link><guid>https://www.sgieurope.com/news/t-${index}/4100${index}.article</guid><description>${description}</description><pubDate>Mon, 0${index + 1} Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;

function app(retryRestates: boolean) {
  const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
  const contentCalls: string[] = [];
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-theme-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '500' },
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const system = body.messages[0].content as string;
      const { operation, payload } = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      const reply = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
      if (operation === 'subject-vocabulary') return reply({ terms: ['connected fitness', 'wearables'] });
      if (operation === 'professional-profile-enrichment') return reply({});
      if (operation !== 'report-content') return new Response('no', { status: 500 });
      const articles = payload.articles as Array<{ id: string; title: string; description: string }>;
      const alias = (prefix: string) => articles.find((item) => item.title.startsWith(prefix))?.id;
      if (system.includes('Do not write explanations')) {
        contentCalls.push('S');
        return reply({ summary: 'Peloton and Fitbit both moved coaching onto their devices; watch subscription prices.', citedArticleIds: [alias('Peloton'), alias('Fitbit')], themeDescriptions: (payload.themes as string[]).map((theme) => ({ theme, description: theme === 'connected fitness' ? 'Peloton and Fitbit put AI coaching on their devices.' : 'Garmin grew wearables revenue 20%.', articleIds: theme === 'connected fitness' ? [alias('Peloton'), alias('Fitbit')] : [alias('Garmin')] })) });
      }
      const retry = system.includes('RESTATED:');
      contentCalls.push(retry ? `R:${articles.length}` : 'E');
      return reply({ explanations: articles.map((item) => {
        if (item.title.startsWith('Fitbit') && (!retry || retryRestates)) return { articleId: item.id, angle: 'product innovation', explanation: item.description.split('. ')[0] + '.' };
        if (item.title.startsWith('Fitbit')) return { articleId: item.id, angle: 'product innovation', explanation: 'Your product team now has a bar for personalised coaching: Fitbit builds it on live watch data, starting with Premium members.' };
        return { articleId: item.id, angle: 'competitor benchmark', explanation: `A benchmark for your roadmap: ${item.title.split(' ')[0]} is moving first, so customers will compare your features against it within a year.` };
      }) });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'LD Systems', industry: 'software', description: 'LD Systems software', topics: [], entities: ['LD Systems'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  const generate = async () => {
    const response = await instance.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'ldsystems.uk', jobTitle: 'Technology Professional' }) }));
    const { reportId } = await response.json() as { reportId: string };
    return (await instance.reportStore.get(reportId, 'sgi-europe'))!;
  };
  const search = async (report: ReportRecord, theme: string) => (await instance.handle(new Request(`https://discovery.ldsystems.uk/api/reports/${report.id}/themes/${encodeURIComponent(theme)}/search?publisherId=sgi-europe`, { method: 'POST', headers: { Origin: 'https://discovery.ldsystems.uk' } }))).json() as Promise<{ briefingRecommendations: ReportRecommendation[]; recommendations: ReportRecommendation[] }>;
  return { logs, contentCalls, generate, search };
}

describe('themes and explanations through the report pipeline', () => {
  it('lists the report stories the theme card was written from, strongest first, and never the off-theme story', async () => {
    const target = app(false);
    const report = await target.generate();
    expect(report.professionalProfile.themes).toContain('connected fitness');
    const result = await target.search(report, 'connected fitness');
    const titles = result.briefingRecommendations.map((item) => item.article.title);
    expect(titles).toContain('Fitbit unveils AI health coach');
    expect(titles.some((title) => title.startsWith('Peloton'))).toBe(true);
    expect(titles).not.toContain('FESI calls for simpler EU digital rules');
    const scores = result.briefingRecommendations.map((item) => item.displayScore);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));
    // Archive extras are never report stories and are about the theme itself.
    expect(result.recommendations.every((item) => !report.recommendations.some((existing) => existing.articleId === item.articleId))).toBe(true);
  });

  it('regenerates an explanation that retells the story once, from the reader\'s side, and logs explanation_restated', async () => {
    const target = app(false);
    const report = await target.generate();
    const fitbit = report.recommendations.find((item) => item.article.title.startsWith('Fitbit'))!;
    expect(fitbit.explanation).toMatch(/^Your product team now has a bar/);
    expect(fitbit.rankingMetadata.explanationSource).toBe('ai');
    expect(fitbit.rankingMetadata.explanationRestated).toBeUndefined();
    expect(target.contentCalls.filter((call) => call.startsWith('R'))).toEqual(['R:1']);
    const restated = target.logs.filter((entry) => entry.message === 'explanation_restated');
    expect(restated).toHaveLength(1);
    expect(restated[0].fields).toMatchObject({ articleId: fitbit.articleId, restatedRule: 'consecutive_words', outcome: 'regenerated' });
    // IDs and codes only: never the explanation text.
    expect(JSON.stringify(restated)).not.toMatch(/Fitbit has put|product team/);
  });

  it('falls back when the regeneration still retells the story, and the page hides the repeated "why"', async () => {
    const target = app(true);
    const report = await target.generate();
    const fitbit = report.recommendations.find((item) => item.article.title.startsWith('Fitbit'))!;
    expect(fitbit.rankingMetadata.explanationSource).toBe('deterministic');
    expect(fitbit.rankingMetadata.explanationRestated).toBe(true);
    expect(target.logs.find((entry) => entry.message === 'explanation_restated')?.fields).toMatchObject({ outcome: 'fallback' });
    expect(target.logs.find((entry) => entry.message === 'explanation_fallback' && entry.fields.articleId === fitbit.articleId)?.fields).toMatchObject({ rejectReason: 'restated' });
    // No second regeneration.
    expect(target.contentCalls.filter((call) => call.startsWith('R'))).toHaveLength(1);
  });
});
