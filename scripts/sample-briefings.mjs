// Generates sample briefings through the public API and prints them for writing-quality review.
// Usage: npm run build:server && BASE_URL=https://discovery.ldsystems.uk node scripts/sample-briefings.mjs
// Optional: PUBLISHER_ID (default sgi-europe), ORIGIN (default https://discovery.ldsystems.uk).
// Not part of the test suite: it creates real reports and makes real AI calls on the target server.
import { explanationQualityWarnings, summaryQualityWarnings } from '../dist/server.mjs';

const baseUrl = (process.env.BASE_URL ?? '').replace(/\/$/, '');
const publisherId = process.env.PUBLISHER_ID ?? 'sgi-europe';
const origin = process.env.ORIGIN ?? 'https://discovery.ldsystems.uk';
const scenarios = [
  { company: 'nike', role: 'Head of Procurement' },
  { company: 'nike', role: 'Head of Retail' },
  { company: 'adidas', role: 'Product Manager' },
  { company: 'puma', role: 'Head of Sustainability' },
];

if (!baseUrl) {
  console.error('[sample-briefings] BASE_URL is required, e.g. BASE_URL=https://discovery.ldsystems.uk');
  process.exit(1);
}

function wrap(text, indent = '    ', width = 100) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) { lines.push(line); line = word; } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines.map((value) => `${indent}${value}`).join('\n');
}

async function sample({ company, role }) {
  const startedAt = Date.now();
  const generated = await fetch(`${baseUrl}/api/reports/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ publisherId, companyUrl: company, jobTitle: role }),
  });
  const wallMs = Date.now() - startedAt;
  const serverTiming = generated.headers.get('server-timing') ?? '';
  const requestId = generated.headers.get('x-request-id') ?? '';
  const payload = await generated.json().catch(() => ({}));
  console.log(`\n${'='.repeat(100)}\n${company} / ${role}  →  HTTP ${generated.status}  ${wallMs}ms  requestId=${requestId}`);
  if (!generated.ok || !payload.reportId) {
    console.log(`  generation failed: ${payload.error ?? 'unknown error'}`);
    return;
  }
  const reportResponse = await fetch(`${baseUrl}/api/reports/${payload.reportId}?publisherId=${encodeURIComponent(publisherId)}`, { headers: { Origin: origin } });
  const report = await reportResponse.json();
  const recommendations = report.recommendations ?? [];
  const cited = recommendations.filter((item) => item.rankingMetadata?.citedInSummary).map((item) => item.articleId);
  console.log(`  report: ${baseUrl}/p/${publisherId}/${payload.reportId}`);
  console.log(`  timings: ${serverTiming.split(', ').filter((part) => /^(company|catalogue-select|ranking|ai-|persist|total)/.test(part)).join('  ')}`);
  console.log(`\n  SUMMARY [${report.summarySource ?? 'unknown'}${report.summaryFallbackReason ? `: ${report.summaryFallbackReason}` : ''}] cites ${cited.length} article(s)`);
  console.log(wrap(report.generatedSummary));
  const summaryWarnings = report.summarySource === 'ai' ? summaryQualityWarnings(report.generatedSummary, cited, { jobTitle: report.jobTitle, companyName: report.companyName }) : [];
  if (summaryWarnings.length) console.log(`    ⚠ ${summaryWarnings.join(', ')}`);
  const aiExplanations = recommendations.filter((item) => item.rankingMetadata?.explanationSource === 'ai').map((item) => ({ articleId: item.articleId, explanation: item.explanation }));
  const warnings = explanationQualityWarnings(aiExplanations, new Map(recommendations.map((item) => [item.articleId, item.article?.title ?? ''])));
  console.log(`\n  EXPLANATIONS (${aiExplanations.length}/${recommendations.length} from AI)`);
  for (const item of recommendations) {
    const flags = warnings.filter((warning) => warning.articleId === item.articleId).map((warning) => warning.code);
    console.log(`\n  #${item.rank} ${item.article?.title ?? item.articleId}`);
    console.log(`    [${item.rankingMetadata?.explanationSource ?? 'unknown'}${item.rankingMetadata?.angle ? ` · ${item.rankingMetadata.angle}` : ''}${item.rankingMetadata?.citedInSummary ? ' · cited' : ''}]${flags.length ? `  ⚠ ${flags.join(', ')}` : ''}`);
    console.log(wrap(item.explanation));
  }
  const counts = warnings.reduce((totals, warning) => ({ ...totals, [warning.code]: (totals[warning.code] ?? 0) + 1 }), {});
  console.log(`\n  quality warnings (server heuristics, computed locally): ${Object.entries(counts).map(([code, count]) => `${code}=${count}`).join(' ') || 'none'}`);
}

for (const scenario of scenarios) {
  try { await sample(scenario); } catch (error) { console.log(`\n${scenario.company} / ${scenario.role}: request failed (${error instanceof Error ? error.message : 'unknown'})`); }
}
