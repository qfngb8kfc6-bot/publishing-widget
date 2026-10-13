import { describe, expect, it } from 'vitest';
import { demoManifest } from '../src/demo/config';
import { PostgresPublisherStore, MemoryPublisherStore, PublisherStoreError } from '../src/publishers/store';
import { createPublisherRegistry } from '../src/publishers/registry';
import { PublisherRuntime } from '../src/publishers/runtime';

describe('publisher persistence', () => {
  it('keeps the memory fallback compatible with create, update and enable state', async () => {
    const store = new MemoryPublisherStore([demoManifest]);
    const created = await store.create({ ...demoManifest, publisherId: 'tenant-one', name: 'Tenant One' });
    expect(created.manifest.publisherId).toBe('tenant-one');
    await expect(store.create({ ...demoManifest, publisherId: 'tenant-one', name: 'Duplicate' })).rejects.toMatchObject({ code: 'already_exists' });
    const updated = await store.update({ ...created.manifest, enabled: false, allowedOrigins: ['https://tenant.example'] });
    expect(updated.manifest).toMatchObject({ enabled: false, allowedOrigins: ['https://tenant.example'] });
    expect((await store.list()).map((record) => record.manifest.publisherId)).toEqual(['demo', 'tenant-one']);
  });

  it('persists only secret references, never raw source credentials', async () => {
    const store = new MemoryPublisherStore();
    const manifest = { ...demoManifest, publisherId: 'tenant-one', contentSource: { type: 'rest-json' as const, baseUrl: 'https://tenant.example', endpoint: '/search', authentication: { mode: 'bearer' as const, secretRef: 'env:TENANT_API_TOKEN' } } };
    await store.create(manifest);
    await expect(store.create({ ...manifest, publisherId: 'tenant-two', contentSource: { ...manifest.contentSource, authentication: { mode: 'bearer', secret: 'raw-secret' } as never } })).rejects.toBeInstanceOf(PublisherStoreError);
    const saved = await store.get('tenant-one');
    expect(JSON.stringify(saved)).toContain('env:TENANT_API_TOKEN');
    expect(JSON.stringify(saved)).not.toContain('raw-secret');
  });

  it('maps Postgres rows to publisher records and uses tenant-scoped parameters', async () => {
    const calls: Array<{ sql: string; parameters?: unknown[] }> = [];
    const client = {
      query: async <Row = Record<string, unknown>>(sql: string, parameters?: unknown[]) => {
        calls.push({ sql, parameters });
        return { rows: sql.startsWith('SELECT') ? [{ publisher_id: 'demo', manifest_json: demoManifest, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }] as Row[] : [{ publisher_id: 'demo', manifest_json: demoManifest, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }] as Row[] };
      },
    };
    const store = new PostgresPublisherStore(client);
    expect((await store.get('demo'))?.manifest.publisherId).toBe('demo');
    expect(calls[0]?.parameters).toEqual(['demo']);
    expect((await store.list())).toHaveLength(1);
  });

  it('caches runtime definitions and reloads them after invalidation', async () => {
    const store = new MemoryPublisherStore([demoManifest]);
    const runtime = new PublisherRuntime(createPublisherRegistry(), { store, cacheTtlMs: 60_000 });
    expect((await runtime.get('demo'))?.manifest?.name).toBe('Northstar Journal');
    await store.update({ ...demoManifest, name: 'Northstar Updated' });
    expect((await runtime.get('demo'))?.manifest?.name).toBe('Northstar Journal');
    await runtime.invalidate();
    expect((await runtime.get('demo'))?.manifest?.name).toBe('Northstar Updated');
  });
});
