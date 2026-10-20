// Prints the top-ranked recommendations for review scenarios using the checkout in the current directory.
// Usage (from the repo root): npm run build:server && node scripts/rank-sample.mjs
// To compare branches, copy this file outside the repo and run it after `npm run build:server` on each checkout.
// Optional: FEED_FILE=/path/to/sgi.rss serves a saved SGI feed instead of fetching it live.
// AI is used only if AI_ENABLED/AI_API_KEY are set in the environment; otherwise ranking is deterministic.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { createProductionApp } = await import(pathToFileURL(path.resolve(process.cwd(), 'dist/server.mjs')).href);
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
const app = createProductionApp({ environment: 'development', serverEnvironment: { ...process.env, PUBLISHER_INDEX_PREBUILD: 'false' }, fetchImpl, logger: { info() {}, error() {} } });

for (const [company, role] of scenarios) {
  const response = await app.handle(new Request('http://localhost/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: process.env.PUBLISHER_ID ?? 'sgi-europe', companyUrl: company, jobTitle: role }) }));
  const payload = await response.json();
  console.log(`\n${company} / ${role}: HTTP ${response.status}`);
  if (!payload.reportId) { console.log(`  ${payload.error ?? 'generation failed'}`); continue; }
  const report = await app.reportStore.get(payload.reportId);
  const profile = report.professionalProfile;
  const direct = (profile.retrieval?.concepts ?? []).filter((concept) => concept.relevanceType === 'direct').slice(0, 12).map((concept) => `${concept.concept} (${concept.source} ${concept.weight})`);
  console.log(`  role function: ${profile.role.function} · source: ${profile.role.roleSource ?? 'n/a'}${profile.role.titleTopics?.length ? ` · title topics: ${profile.role.titleTopics.join(', ')}` : ''}`);
  console.log(`  direct concepts: ${direct.join(', ')}`);
  report.recommendations.slice(0, 8).forEach((item, index) => {
    const c = item.rankingMetadata.scoreComponents ?? {};
    const year = item.article.publishedAt ? new Date(item.article.publishedAt).getUTCFullYear() : '----';
    console.log(`  ${index + 1}. [${item.displayScore} ${item.rankingMetadata.relevanceType}] ${year} ${item.article.title}`);
    console.log(`       direct ${c.direct} · adjacent ${c.adjacent} · role ${c.role} · company ${c.company} · recency ×${c.recencyMultiplier} · ${(item.rankingMetadata.relevanceSignals ?? []).join('; ')}`);
  });
}
