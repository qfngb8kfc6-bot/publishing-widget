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
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    return { index, outcome: 'error', status: 0, error: error?.name === 'TimeoutError' ? 'timeout' : error?.cause?.code ?? error?.name ?? 'network_error', ms: performance.now() - startedAt };
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
  console.log(`[load-test] started ${concurrency} concurrent ${mode} generations -> ${base} (publisher ${publisherId})`);
  const startedAt = performance.now();
  let done = 0;
  const results = await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
    const result = await generateOne(index);
    done += 1;
    console.log(`[load-test] ${String(done).padStart(String(concurrency).length)}/${concurrency} #${index + 1} ${PROFILES[index % PROFILES.length].join(' / ')}: ${result.outcome} status ${result.status} ${Math.round(result.ms)} ms${result.error ? ` (${result.error})` : ''}`);
    return result;
  }));
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
  console.log(`[load-test] summary: ${summary.succeeded}/${concurrency} succeeded, ${summary.errors} errors, ${summary.rateLimited} rate limited; p50 ${summary.p50Ms ?? '-'} ms, p95 ${summary.p95Ms ?? '-'} ms, max ${summary.maxMs ?? '-'} ms, wall ${wallMs} ms`);
  console.log(JSON.stringify(summary, null, 2));
  if (!process.env.LOG_FILE) console.log('[load-test] peak heap: set LOG_FILE to a saved server log of this window (heap_usage lines) to include it.');
  if (summary.rateLimited) console.log('[load-test] some generations were rate limited (12/min per client): set GENERATION_RATE_LIMIT_PER_MINUTE on the target for a burst test.');
  if (process.env.OUT) {
    await writeFile(process.env.OUT, `${JSON.stringify({ ...summary, results }, null, 2)}\n`);
    console.log(`[load-test] wrote ${path.resolve(process.env.OUT)}`);
  }
  if (!ok.length) {
    console.error(`[load-test] error: every request failed (${Object.entries(summary.errorCodes).map(([code, count]) => `${count}x ${code}`).join(', ') || `${summary.rateLimited} rate limited`}). Is the server running at ${base}?`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = errors.length ? 1 : 0;
}

/**
 * True when this file is the script node was started with. Compared as file paths, not URLs: import.meta.url is
 * percent-encoded ("publishing%20widget"), so a URL comparison silently skipped main() in a path with a space.
 */
export function isMainModule(moduleUrl, argv1) {
  if (!argv1) return false;
  const canonical = (file) => { try { return realpathSync(file); } catch { return path.resolve(file); } };
  return canonical(fileURLToPath(moduleUrl)) === canonical(path.resolve(argv1));
}

if (isMainModule(import.meta.url, process.argv[1])) await main();
