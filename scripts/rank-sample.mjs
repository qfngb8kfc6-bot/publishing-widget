// Prints the top-ranked recommendations for review scenarios using the checkout in the current directory.
// Usage (from the repo root): npm run build:server && node scripts/rank-sample.mjs
// To compare branches, copy this file outside the repo and run it after `npm run build:server` on each checkout.
// Optional: FEED_FILE=/path/to/sgi.rss serves a saved SGI feed instead of fetching it live.
// AI is used only if AI_ENABLED/AI_API_KEY are set in the environment; otherwise ranking is deterministic.
// Full-text before/after: with DATABASE_URL (synced publisher_article_texts) or ARTICLE_TEXT_FILE (JSON object of
// story code -> plain text), each scenario is ranked twice: without full text, then with lead excerpts enabled.
// Only titles and scores are printed, never article text.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { createProductionApp, PostgresArticleTextStore } = await import(pathToFileURL(path.resolve(process.cwd(), 'dist/server.mjs')).href);
const feedFile = process.env.FEED_FILE;
const feed = feedFile ? await readFile(feedFile, 'utf8') : undefined;
const scenarios = [
  ['puma.com', 'Head of Sustainability'],
  ['nike.com', 'Head of Procurement'],
  ['nike.com', 'Head of Retail'],
  ['adidas.com', 'Product Manager'],
  ['lululemon.com', 'Head of Legal'],
];
const fetchImpl = async (input, init) => (feed && String(input).includes('sgieurope.com') && String(input).includes('.rss')
  ? new Response(feed, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })
  : fetch(input, init));

async function textStore() {
  if (process.env.ARTICLE_TEXT_FILE) {
    const texts = JSON.parse(await readFile(process.env.ARTICLE_TEXT_FILE, 'utf8'));
    const lead = (text, maxChars) => (text.length <= maxChars ? text : text.slice(0, Math.max(text.lastIndexOf(' ', maxChars), 1)));
    const rows = (codes, maxChars) => codes.filter((code) => texts[code]).map((storyCode) => ({ storyCode, lead: lead(texts[storyCode], maxChars), isPrivate: true }));
    return { leads: async (_publisherId, codes, maxChars) => rows([...new Set(codes)], maxChars), leadPage: async (_publisherId, after, limit, maxChars) => rows(Object.keys(texts).filter((code) => code > after).sort().slice(0, limit), maxChars), count: async () => Object.keys(texts).length, syncState: async () => null, saveSyncState: async () => undefined, upsert: async () => [] };
  }
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    return new PostgresArticleTextStore(new Pool({ connectionString: process.env.DATABASE_URL, max: 2 }));
  }
  return undefined;
}

async function rankAll(app) {
  const results = new Map();
  for (const [company, role] of scenarios) {
    const response = await app.handle(new Request('http://localhost/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: process.env.PUBLISHER_ID ?? 'sgi-europe', companyUrl: company, jobTitle: role }) }));
    const payload = await response.json();
    results.set(`${company} / ${role}`, { status: response.status, payload, report: payload.reportId ? await app.reportStore.get(payload.reportId) : undefined });
  }
  return results;
}

function printResult(label, { status, payload, report }, verbose) {
  console.log(`\n${label}: HTTP ${status}`);
  if (!report) { console.log(`  ${payload.error ?? 'generation failed'}`); return; }
  const profile = report.professionalProfile;
  if (verbose) {
    const direct = (profile.retrieval?.concepts ?? []).filter((concept) => concept.relevanceType === 'direct').slice(0, 12).map((concept) => `${concept.concept} (${concept.source} ${concept.weight})`);
    console.log(`  role function: ${profile.role.function} · source: ${profile.role.roleSource ?? 'n/a'}${profile.role.titleTopics?.length ? ` · title topics: ${profile.role.titleTopics.join(', ')}` : ''}`);
    console.log(`  direct concepts: ${direct.join(', ')}`);
  }
  report.recommendations.slice(0, 8).forEach((item, index) => {
    const c = item.rankingMetadata.scoreComponents ?? {};
    const year = item.article.publishedAt ? new Date(item.article.publishedAt).getUTCFullYear() : '----';
    console.log(`  ${index + 1}. [${item.displayScore} ${item.rankingMetadata.relevanceType}] ${year} ${item.article.title}${item.subscriberOnly ? ' (subscriber)' : ''}`);
    console.log(`       direct ${c.direct} · adjacent ${c.adjacent} · role ${c.role} · company ${c.company} · recency ×${c.recencyMultiplier} · ${(item.rankingMetadata.relevanceSignals ?? []).join('; ')}`);
  });
}

const quiet = { info() {}, error() {} };
const baseEnvironment = { ...process.env, PUBLISHER_INDEX_PREBUILD: 'false', WVC_ENRICHMENT_ENABLED: 'false' };
const before = createProductionApp({ environment: 'development', serverEnvironment: baseEnvironment, fetchImpl, logger: quiet });
const beforeResults = await rankAll(before);
const store = await textStore();
if (!store) {
  for (const [label, result] of beforeResults) printResult(label, result, true);
} else {
  const after = createProductionApp({ environment: 'development', serverEnvironment: { ...baseEnvironment, WVC_ENRICHMENT_ENABLED: 'true' }, fetchImpl, logger: quiet, articleTextStore: store });
  // Load the catalogue and wait for its lead excerpts before ranking.
  await after.prewarmCatalogues();
  await after.catalogueIdle();
  const afterResults = await rankAll(after);
  for (const [label, result] of beforeResults) {
    console.log(`\n===== ${label} =====`);
    printResult('BEFORE (no full text)', result, true);
    printResult('AFTER (lead excerpts)', afterResults.get(label), false);
  }
  await store.client?.end?.();
}
