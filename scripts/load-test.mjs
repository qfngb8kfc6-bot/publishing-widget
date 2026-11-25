// Load test: N concurrent report generations with varied profiles against BASE_URL; p50/p95 time, errors, and (from a
// saved server log) peak heap. Never point it at production without agreeing a window: every request is a real
// generation (catalogue ranking and, with AI enabled, up to ~7 AI calls).
//
//   BASE_URL=https://staging.example.com npm run load:test
//
// Options (environment):
//   BASE_URL      required: the server to test (no trailing path).
//   PUBLISHER     publisher ID (default sgi-europe).
//   CONCURRENCY   generations started at once (default 20).
//   MODE          sync (default: one request per generation, timed until the report is saved) or async (202, then
//                 polls the status URL every POLL_MS, default 1500; status polling has its own rate limit).
//   TIMEOUT_MS    per generation (default 120000).
//   LOG_FILE      a saved copy of the server's log for the test window: heap_usage and report_performance lines are
//                 read from it for peak heap (MB) and server-side generation times.
//   OUT           write the JSON summary to this file too.
// The server limits generations to 12 per minute per client; set GENERATION_RATE_LIMIT_PER_MINUTE on the target
// (for example 60) for a 20-generation burst from one machine. 429s are counted separately from errors.
import { readFile, writeFile } from 'node:fs/promises';

const base = process.env.BASE_URL?.replace(/\/+$/, '');
const publisherId = process.env.PUBLISHER ?? 'sgi-europe';
const concurrency = Math.max(1, Math.min(200, Number(process.env.CONCURRENCY ?? 20) || 20));
const mode = process.env.MODE === 'async' ? 'async' : 'sync';
const pollMs = Math.max(250, Number(process.env.POLL_MS ?? 1500) || 1500);
const timeoutMs = Math.max(5_000, Number(process.env.TIMEOUT_MS ?? 120_000) || 120_000);

/** Varied companies (names and websites) and roles: executives, dedicated and generic roles, typos. */
export const PROFILES = [
  ['Decathlon', 'CEO'], ['nike.com', 'Head of Retail'], ['Nike', 'Head of Procurement'], ['adidas.com', 'Head of Sustainability'],
  ['Puma', 'Chief Financial Officer'], ['JD Sports', 'Head of Marketing'], ['intersport.com', 'Managing Director'], ['Asics', 'Product Manager'],
  ['Frasers Group', 'Head of Legal'], ['garmin.com', 'Software Engineer'], ['Under Armour', 'VP of Sales'], ['New Balance', 'Supply Chain Director'],
  ['decathlon.com', 'Head of E-commerce'], ['Salomon', 'Brand Manager'], ['Columbia Sportswear', 'Head of Sourcing'], ['On Running', 'Founder'],
  ['XXL ASA', 'Category Manager'], ['Sportisimo', 'Store Operations Manager'], ['Amer Sports', 'Head of HR'], ['Lululemon', 'Head of Product Developement'],
];

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
};

async function postJson(path, body, signal) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-ID': `load-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify(body), signal });
}

async function generateOne(index) {
  const [companyUrl, jobTitle] = PROFILES[index % PROFILES.length];
  const startedAt = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await postJson(`/api/reports/generate${mode === 'sync' ? '?mode=sync' : ''}`, { publisherId, companyUrl, jobTitle }, signal);
    if (response.status === 429) return { index, outcome: 'rate_limited', status: 429, ms: performance.now() - startedAt };
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { index, outcome: 'error', status: response.status, error: body.error ?? 'http_error', ms: performance.now() - startedAt };
    if (mode === 'sync') return { index, outcome: 'ok', status: response.status, ms: performance.now() - startedAt, reportId: body.reportId };
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const status = await fetch(`${base}${body.statusUrl}`, { signal });
      if (status.status === 429) continue;
      const job = await status.json().catch(() => ({}));
      if (job.status === 'complete') return { index, outcome: 'ok', status: 200, ms: performance.now() - startedAt, reportId: job.reportId };
      if (job.status === 'failed') return { index, outcome: 'error', status: 200, error: job.error ?? 'generation_failed', ms: performance.now() - startedAt };
    }
  } catch (error) {
    return { index, outcome: 'error', status: 0, error: error?.name === 'TimeoutError' ? 'timeout' : error?.name ?? 'network_error', ms: performance.now() - startedAt };
  }
}

/** Peak heap and server-side generation times from JSON log lines ("[publisher-widget] {...}"). */
export function logStats(text) {
  let heapUsedMb = null;
  let rssMb = null;
  const serverMs = [];
  for (const line of text.split('\n')) {
    const start = line.indexOf('{');
    if (start < 0) continue;
    let entry;
    try { entry = JSON.parse(line.slice(start)); } catch { continue; }
    if (entry.message === 'heap_usage') {
      if (typeof entry.heapUsedMb === 'number') heapUsedMb = Math.max(heapUsedMb ?? 0, entry.heapUsedMb);
      if (typeof entry.rssMb === 'number') rssMb = Math.max(rssMb ?? 0, entry.rssMb);
    }
    if (entry.message === 'report_performance' && typeof entry.totalMs === 'number') serverMs.push(entry.totalMs);
  }
  return { peakHeapUsedMb: heapUsedMb, peakRssMb: rssMb, serverGenerations: serverMs.length, serverP50Ms: percentile(serverMs, 50), serverP95Ms: percentile(serverMs, 95) };
}

async function main() {
  if (!base || !/^https?:\/\//.test(base)) {
    console.error('BASE_URL is required, for example BASE_URL=http://localhost:8787 npm run load:test');
    process.exit(1);
  }
  console.log(`[load-test] ${concurrency} concurrent ${mode} generations -> ${base} (publisher ${publisherId})`);
  const startedAt = performance.now();
  const results = await Promise.all(Array.from({ length: concurrency }, (_, index) => generateOne(index)));
  const wallMs = Math.round(performance.now() - startedAt);
  const ok = results.filter((result) => result.outcome === 'ok');
  const times = ok.map((result) => result.ms);
  const errors = results.filter((result) => result.outcome === 'error');
  const summary = {
    baseUrl: base, publisherId, mode, concurrency, wallMs,
    succeeded: ok.length, rateLimited: results.filter((result) => result.outcome === 'rate_limited').length, errors: errors.length,
    errorCodes: Object.fromEntries([...new Set(errors.map((result) => `${result.status}:${result.error}`))].map((code) => [code, errors.filter((result) => `${result.status}:${result.error}` === code).length])),
    p50Ms: percentile(times, 50), p95Ms: percentile(times, 95), maxMs: times.length ? Math.round(Math.max(...times)) : null,
    ...(process.env.LOG_FILE ? logStats(await readFile(process.env.LOG_FILE, 'utf8')) : {}),
  };
  for (const result of results) console.log(`  #${String(result.index + 1).padStart(2)} ${PROFILES[result.index % PROFILES.length].join(' / ').padEnd(48)} ${result.outcome.padEnd(12)} ${Math.round(result.ms)} ms${result.error ? ` (${result.status} ${result.error})` : ''}`);
  console.log(JSON.stringify(summary, null, 2));
  if (!process.env.LOG_FILE) console.log('[load-test] peak heap: set LOG_FILE to a saved server log of this window (heap_usage lines) to include it.');
  if (summary.rateLimited) console.log('[load-test] some generations were rate limited (12/min per client): set GENERATION_RATE_LIMIT_PER_MINUTE on the target for a burst test.');
  if (process.env.OUT) await writeFile(process.env.OUT, `${JSON.stringify({ ...summary, results }, null, 2)}\n`);
  process.exitCode = errors.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
