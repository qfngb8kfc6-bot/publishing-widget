import { describe, expect, it } from 'vitest';
import { buildIntent, DeterministicExplanationProvider } from '../src/core';
import { demoConfig } from '../src/demo/config';
import { DemoPublisherAdapter } from '../src/demo/adapter';
import { checkPublisherContract } from '../src/publishers/contract';
import { realPublisherSearchFixture } from '../src/publishers/real-publisher/fixtures';
import { defaultRealPublisherApiConfig } from '../src/publishers/real-publisher/config';
import { createRealPublisherDefinition } from '../src/publishers/real-publisher/definition';

describe('shared publisher adapter contract', () => {
  const intent = buildIntent(demoConfig, { interest: 'sustainability', role: 'manufacturer' });

  it('covers the demo adapter', async () => {
    const report = await checkPublisherContract({ config: demoConfig, adapter: new DemoPublisherAdapter(), explanationProvider: new DeterministicExplanationProvider() }, intent);
    expect(report.errors).toEqual([]);
    expect(report.normalizedCount).toBeGreaterThan(0);
  });

  it('covers the real publisher adapter with a sanitized fixture', async () => {
    const definition = createRealPublisherDefinition({ ...defaultRealPublisherApiConfig, baseUrl: 'https://fixture.example.test' }, async () => new Response(JSON.stringify(realPublisherSearchFixture), { status: 200 }));
    const report = await checkPublisherContract(definition, intent);
    expect(report.errors).toEqual([]);
    expect(report.rawCount).toBe(5);
    expect(report.normalizedCount).toBe(4);
  });
});
