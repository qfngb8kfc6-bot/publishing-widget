import { describe, expect, it } from 'vitest';
import { createProductionApp } from '../src/server/production';
import { GenerationJobs, MemoryGenerationJobStore, PostgresGenerationJobStore, GENERATION_STAGES, type GenerationJob } from '../src/reports/generation-jobs';
import type { CompanyContextProvider } from '../src/server/company';

const ORIGIN = 'https://product.example';

function companyContext(domain: string) {
  return { domain, canonicalUrl: `https://${domain}/`, name: 'LD Systems', industry: 'technology', description: 'Software for publishers.', topics: ['software'], entities: ['LD Systems'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' };
}

/** A company provider that holds generation at its first stage until released. */
function gatedProvider() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const provider: CompanyContextProvider = { getContext: async (domain: string) => { await gate; return companyContext(domain) as Awaited<ReturnType<CompanyContextProvider['getContext']>>; } };
  return { provider, release };
}

function post(app: ReturnType<typeof createProductionApp>, body: Record<string, unknown>, query = '', headers: Record<string, string> = {}) {
  return app.handle(new Request(`${ORIGIN}/api/reports/generate${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
}

async function status(app: ReturnType<typeof createProductionApp>, url: string, headers: Record<string, string> = {}) {
  const response = await app.handle(new Request(`${ORIGIN}${url}`, { headers }));
  return { response, body: await response.json() as Record<string, unknown> & { details?: Record<string, unknown>; completedStages?: string[] } };
}

async function until(check: () => Promise<boolean>, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
}

describe('asynchronous report generation', () => {
  it('returns 202 at once, then reports every stage, safe details and the report URL', async () => {
    const { provider, release } = gatedProvider();
    const app = createProductionApp({ environment: 'test', companyContextProvider: provider });
    const response = await post(app, { publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' });
    expect(response.status).toBe(202);
    const created = await response.json() as { generationId: string; statusUrl: string; generationUrl: string; status: string };
    expect(created.status).toBe('running');
    expect(created.generationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.statusUrl).toBe(`/api/generations/${created.generationId}/status?publisherId=demo`);
    expect(created.generationUrl).toBe(`/p/demo/generate/${created.generationId}`);
    // Neither the company nor the role ever appears in a URL.
    expect(`${created.statusUrl}${created.generationUrl}`.toLowerCase()).not.toMatch(/ldsystems|engineer/);

    const running = await status(app, created.statusUrl);
    expect(running.response.headers.get('Cache-Control')).toBe('no-store');
    expect(running.body).toMatchObject({ status: 'running', stage: 'started', completedStages: [], details: { jobTitle: 'Software Engineer' } });
    expect(running.body.reportUrl).toBeUndefined();

    release();
    let final = running.body;
    const seen = new Set<string>();
    await until(async () => {
      final = (await status(app, created.statusUrl)).body;
      (final.completedStages ?? []).forEach((stage) => seen.add(stage));
      return final.status !== 'running';
    });
    expect(final).toMatchObject({ status: 'complete', stage: 'report_persisted', completedStages: [...GENERATION_STAGES], reportUrl: expect.stringMatching(/^\/p\/demo\/[a-zA-Z0-9_-]+$/) });
    expect(final.details).toMatchObject({ companyName: 'LD Systems', jobTitle: 'Software Engineer', articlesSearched: expect.any(Number) });
    expect((final.details?.themes as string[]).length).toBeGreaterThan(0);
    expect((final.details?.themes as string[]).length).toBeLessThanOrEqual(6);
    // No scores, internals or secrets in the status payload.
    expect(JSON.stringify(final)).not.toMatch(/score|instanceId|requestId|recommendations|summary/i);
    const report = await app.handle(new Request(`${ORIGIN}/api/reports/${final.reportId as string}?publisherId=demo`));
    expect(report.status).toBe(200);
  });

  it('records stages in pipeline order with their details as generation runs', async () => {
    const jobs = new GenerationJobs();
    const job = await jobs.create('demo', { jobTitle: 'Head of Legal' });
    jobs.progress(job.id, { stage: 'company_resolved', details: { companyName: 'Nike' } });
    expect((await jobs.get(job.id, 'demo'))?.completedStages).toEqual(['company_resolved']);
    jobs.progress(job.id, { details: { articlesSearched: 11_482 } });
    jobs.progress(job.id, { stage: 'profile_built', details: { themes: ['contracts', 'litigation', 'compliance', 'regulation', 'governance', 'privacy', 'antitrust', 'ip'] } });
    // A later stage implies the earlier ones; stages never go backwards.
    jobs.progress(job.id, { stage: 'ranking_complete' });
    jobs.progress(job.id, { stage: 'company_resolved' });
    const current = (await jobs.get(job.id, 'demo'))!;
    expect(current.completedStages).toEqual(['company_resolved', 'profile_built', 'content_retrieved', 'ranking_complete']);
    expect(current.details).toEqual({ companyName: 'Nike', jobTitle: 'Head of Legal', articlesSearched: 11_482, themes: ['contracts', 'litigation', 'compliance', 'regulation', 'governance', 'privacy'] });
    jobs.complete(job.id, 'report-1');
    jobs.fail(job.id, 'generation_unavailable');
    expect(await jobs.get(job.id, 'demo')).toMatchObject({ status: 'complete', reportId: 'report-1', completedStages: [...GENERATION_STAGES] });
    expect(await jobs.get(job.id, 'other-publisher')).toBeNull();
  });

  it('keeps an unknown company in the widget: 400 with a specific code and no job', async () => {
    const app = createProductionApp({ environment: 'test', companyInputResolver: { resolve: async () => { throw new Error('company_resolution_failed'); } } });
    const response = await post(app, { publisherId: 'demo', companyUrl: 'adids', jobTitle: 'Product Manager' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'company_resolution_failed' });
    expect((await post(app, { publisherId: 'demo', companyUrl: '', jobTitle: 'Product Manager' })).status).toBe(400);
    expect((await post(app, { publisherId: 'missing', companyUrl: 'nike.com', jobTitle: 'Product Manager' })).status).toBe(403);
  });

  it('reports a background failure as failed with a safe code and a retry option', async () => {
    const app = createProductionApp({ environment: 'test', companyContextProvider: { getContext: async () => { throw new Error('upstream said: password=hunter2 at 10.0.0.4'); } } });
    const created = await (await post(app, { publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' })).json() as { statusUrl: string };
    let body: Record<string, unknown> = {};
    await until(async () => { body = (await status(app, created.statusUrl)).body; return body.status !== 'running'; });
    expect(body).toMatchObject({ status: 'failed', error: 'generation_unavailable', retryable: true });
    expect(JSON.stringify(body)).not.toMatch(/hunter2|10\.0\.0\.4|upstream/);
  });

  it('is tenant-scoped, origin-checked and rate-limited', async () => {
    const app = createProductionApp({ environment: 'production', serverEnvironment: { PLATFORM_ORIGIN: ORIGIN }, companyContextProvider: { getContext: async (domain: string) => companyContext(domain) as never }, rateLimits: { generationStatus: 3 } });
    const created = await (await post(app, { publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }, '', { Origin: ORIGIN })).json() as { generationId: string; statusUrl: string };
    expect((await status(app, `/api/generations/${created.generationId}/status?publisherId=real-publisher`)).response.status).toBe(404);
    expect((await status(app, created.statusUrl, { Origin: 'https://evil.example' })).response.status).toBe(403);
    for (let poll = 0; poll < 3; poll += 1) expect((await status(app, created.statusUrl, { Origin: ORIGIN })).response.status).toBe(200);
    const limited = await status(app, created.statusUrl, { Origin: ORIGIN });
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get('Retry-After')).toBeTruthy();
  });

  it('retries a failed generation server-side from its stored input, with no company or role in the request', async () => {
    let calls = 0;
    const app = createProductionApp({ environment: 'test', companyContextProvider: { getContext: async (domain: string) => { calls += 1; if (calls === 1) throw new Error('temporary'); return companyContext(domain) as never; } } });
    const created = await (await post(app, { publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer', sessionId: 'session-abc' })).json() as { generationId: string; statusUrl: string };
    let body: Record<string, unknown> = {};
    await until(async () => { body = (await status(app, created.statusUrl)).body; return body.status !== 'running'; });
    expect(body).toMatchObject({ status: 'failed', retryable: true, sessionId: 'session-abc' });
    // The stored input never leaves the server.
    expect(JSON.stringify(body)).not.toContain('ldsystems.uk');

    const retry = await app.handle(new Request(`${ORIGIN}/api/generations/${created.generationId}/retry?publisherId=demo`, { method: 'POST' }));
    expect(retry.status).toBe(202);
    const retried = await retry.json() as { generationId: string; statusUrl: string; generationUrl: string };
    expect(retried.generationId).not.toBe(created.generationId);
    await until(async () => { body = (await status(app, retried.statusUrl)).body; return body.status !== 'running'; });
    expect(body).toMatchObject({ status: 'complete', sessionId: 'session-abc', details: { companyName: 'LD Systems', jobTitle: 'Software Engineer' } });

    // A complete generation is not retried, and another publisher's ID cannot retry it.
    const again = await app.handle(new Request(`${ORIGIN}/api/generations/${retried.generationId}/retry?publisherId=demo`, { method: 'POST' }));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'generation_complete', reportUrl: expect.any(String) });
    expect((await app.handle(new Request(`${ORIGIN}/api/generations/${created.generationId}/retry?publisherId=real-publisher`, { method: 'POST' }))).status).toBe(404);
  });

  it('keeps the synchronous response for scripts and tests with ?mode=sync', async () => {
    const app = createProductionApp({ environment: 'test', companyContextProvider: { getContext: async (domain: string) => companyContext(domain) as never } });
    const response = await post(app, { publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }, '?mode=sync');
    expect(response.status).toBe(201);
    const body = await response.json() as { reportId: string; reportUrl: string; status: string };
    expect(body).toMatchObject({ status: 'complete', reportUrl: `/p/demo/${body.reportId}` });
    expect(response.headers.get('Server-Timing')).toContain('total;dur=');
  });
});

describe('lost generations', () => {
  it('reports a job whose process restarted as failed instead of hanging', async () => {
    const store = new MemoryGenerationJobStore();
    let now = Date.parse('2026-10-21T10:00:00Z');
    const before = new GenerationJobs({ store, now: () => now });
    const job = await before.create('demo', { jobTitle: 'Software Engineer' });
    before.progress(job.id, { stage: 'profile_built' });
    await before.idle();

    // A new process (new instance ID) shares the store but not the running work.
    const after = new GenerationJobs({ store, now: () => now });
    now += 5_000;
    expect(await after.get(job.id, 'demo')).toMatchObject({ status: 'running', completedStages: ['company_resolved', 'profile_built'] });
    now += 30_000;
    expect(await after.get(job.id, 'demo')).toMatchObject({ status: 'failed', errorCode: 'generation_interrupted' });
    // The failure is recorded, so every later poll agrees.
    expect((await store.get(job.id, 'demo'))?.status).toBe('failed');
  });

  it('times out a job that runs past the cap, wherever it runs', async () => {
    let now = Date.parse('2026-10-21T10:00:00Z');
    const jobs = new GenerationJobs({ now: () => now, maxRuntimeMs: 60_000 });
    const job = await jobs.create('demo');
    now += 61_000;
    expect(await jobs.get(job.id, 'demo')).toMatchObject({ status: 'failed', errorCode: 'generation_timeout' });
  });

  it('keeps generating when a status write fails, and logs it', async () => {
    const errors: unknown[] = [];
    const jobs = new GenerationJobs({ store: { save: async () => { throw new Error('db down'); }, get: async () => null }, onPersistError: (error) => errors.push(error) });
    const job = await jobs.create('demo');
    jobs.progress(job.id, { stage: 'company_resolved' });
    await jobs.idle();
    expect(errors.length).toBe(2);
    expect((await jobs.get(job.id, 'demo'))?.completedStages).toEqual(['company_resolved']);
  });
});

describe('PostgresGenerationJobStore', () => {
  it('upserts one row per generation and reads it back tenant-scoped', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const statements: string[] = [];
    const client = {
      async query<Row>(sql: string, parameters: unknown[] = []) {
        statements.push(sql);
        if (sql.startsWith('INSERT')) {
          const [id, publisherId, status, stages, details, reportId, errorCode, instanceId, createdAt, updatedAt, input] = parameters;
          rows.set(String(id), { id, publisher_id: publisherId, status, completed_stages_json: stages, details_json: details, report_id: reportId, error_code: errorCode, instance_id: instanceId, created_at: createdAt, updated_at: updatedAt, input_json: input });
          return { rows: [] as Row[] };
        }
        const row = rows.get(String(parameters[0]));
        return { rows: (row && row.publisher_id === parameters[1] ? [row] : []) as Row[] };
      },
    };
    const store = new PostgresGenerationJobStore(client);
    const job: GenerationJob = { id: 'gen-1', publisherId: 'sgi-europe', status: 'running', completedStages: ['company_resolved'], details: { companyName: 'Nike', themes: ['retail'] }, input: { companyUrl: 'nike', jobTitle: 'Head of Retail', sessionId: 'session-1' }, instanceId: 'i-1', createdAt: '2026-10-21T10:00:00.000Z', updatedAt: '2026-10-21T10:00:01.000Z' };
    await store.save(job);
    expect(statements[0]).toContain('ON CONFLICT (id) DO UPDATE');
    expect(await store.get('gen-1', 'sgi-europe')).toEqual(job);
    expect(await store.get('gen-1', 'ibi')).toBeNull();
  });
});
