import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { logStats, PROFILES } from '../scripts/load-test.mjs';

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
