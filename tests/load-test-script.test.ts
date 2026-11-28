import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { isMainModule, logStats, PROFILES } from '../scripts/load-test.mjs';

describe('npm run load:test helpers', () => {
  it('has 20 distinct, varied profiles', () => {
    expect(PROFILES).toHaveLength(20);
    expect(new Set(PROFILES.map(([company, title]: string[]) => `${company}|${title}`)).size).toBe(20);
  });

  it('reads peak heap and server-side generation times from saved log lines', () => {
    const log = [
      '[publisher-widget] {"message":"heap_usage","heapUsedMb":120.5,"rssMb":310}',
      'not json',
      '[publisher-widget] {"message":"report_performance","totalMs":4000}',
      '[publisher-widget] {"message":"heap_usage","heapUsedMb":168.2,"rssMb":295}',
      '[publisher-widget] {"message":"report_performance","totalMs":9000}',
      '[publisher-widget] {"message":"report_performance","totalMs":6000}',
    ].join('\n');
    expect(logStats(log)).toEqual({ peakHeapUsedMb: 168.2, peakRssMb: 310, serverGenerations: 3, serverP50Ms: 6000, serverP95Ms: 9000 });
  });
});

describe('GENERATION_RATE_LIMIT_PER_MINUTE', () => {
  const statuses = async (serverEnvironment: Record<string, string>, count: number) => {
    const { createProductionApp } = await import('../src/server/production');
    const app = createProductionApp({ environment: 'test', serverEnvironment });
    const result: number[] = [];
    for (let index = 0; index < count; index += 1) result.push((await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Technology professional' }) }))).status);
    return result;
  };

  it('keeps 12 per minute by default and ignores out-of-range values', async () => {
    expect((await statuses({}, 13)).filter((status) => status === 429)).toHaveLength(1);
    expect((await statuses({ GENERATION_RATE_LIMIT_PER_MINUTE: '100000' }, 13)).filter((status) => status === 429)).toHaveLength(1);
  });

  it('applies a configured limit', async () => {
    expect(await statuses({ GENERATION_RATE_LIMIT_PER_MINUTE: '2' }, 3)).toEqual([201, 201, 429]);
  });
});

describe('npm run load:test from a path with a space', () => {
  let directory: string;
  let script: string;
  let server: Server;
  let baseUrl: string;
  let failAll = false;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'publishing widget '));
    script = path.join(directory, 'load-test.mjs');
    await copyFile(path.resolve('scripts/load-test.mjs'), script);
    server = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        if (failAll) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end('{"error":"boom"}'); return; }
        response.writeHead(201, { 'Content-Type': 'application/json' });
        response.end('{"reportId":"report_1"}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const run = (env: Record<string, string>) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const { BASE_URL: _ignored, ...inherited } = process.env;
    execFile(process.execPath, [script], { cwd: directory, env: { ...inherited, ...env } }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }));
  });

  it('recognises itself as the entry point although import.meta.url encodes the space', () => {
    expect(pathToFileURL(script).href).toContain('publishing%20widget');
    expect(isMainModule(pathToFileURL(script).href, script)).toBe(true);
    expect(isMainModule(pathToFileURL(script).href, path.join(directory, 'other.mjs'))).toBe(false);
    expect(isMainModule(pathToFileURL(script).href, undefined)).toBe(false);
  });

  it('runs, prints progress and a summary, and writes OUT', async () => {
    failAll = false;
    const out = path.join(directory, 'result file.json');
    const result = await run({ BASE_URL: baseUrl, CONCURRENCY: '3', OUT: out });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[load-test] started 3 concurrent sync generations');
    expect(result.stdout.match(/\[load-test\] \d\/3 #\d .*: ok status 201 \d+ ms/g)).toHaveLength(3);
    expect(result.stdout).toMatch(/summary: 3\/3 succeeded, 0 errors, 0 rate limited; p50 \d+ ms, p95 \d+ ms/);
    const saved = JSON.parse(await readFile(out, 'utf8'));
    expect(saved).toMatchObject({ succeeded: 3, errors: 0, concurrency: 3 });
    expect(saved.results).toHaveLength(3);
  });

  it('exits non-zero with a clear error when every request fails', async () => {
    failAll = true;
    const result = await run({ BASE_URL: baseUrl, CONCURRENCY: '2' });
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/summary: 0\/2 succeeded, 2 errors/);
    expect(result.stderr).toContain('every request failed (2x 500:boom)');
  });

  it('names the network error when nothing listens at BASE_URL', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as { port: number }).port;
    await new Promise((resolve) => closed.close(resolve));
    const result = await run({ BASE_URL: `http://127.0.0.1:${port}`, CONCURRENCY: '1' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('every request failed (1x 0:ECONNREFUSED)');
  });

  it('exits non-zero with a clear error when BASE_URL is missing', async () => {
    const result = await run({});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('BASE_URL is required');
  });
});
