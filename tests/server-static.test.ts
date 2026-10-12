import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { staticAssetPath, staticResponse } from '../server-static.mjs';

let root: string;

async function setup() { root = await mkdtemp(path.join(os.tmpdir(), 'publisher-widget-static-')); await writeFile(path.join(root, 'admin.html'), '<main id="admin-root"></main>'); }
async function teardown() { await rm(root, { recursive: true, force: true }); }

describe('production static routes', () => {
  beforeAll(setup);
  afterAll(teardown);

  it.each(['/admin', '/admin/'])('maps %s to the built admin page', async (pathname) => {
    expect(staticAssetPath(pathname)).toBe('/admin.html');
    const response = await staticResponse(new Request(`http://localhost${pathname}`), root);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Content-Type')).toContain('text/html');
    expect(await response?.text()).toContain('id="admin-root"');
  });

  it.each(['/', '/analytics', '/p/demo/report-id', '/p/demo/generate/generation-id'])('preserves the existing public SPA route %s', (pathname) => {
    expect(staticAssetPath(pathname)).toBe('/index.html');
  });

  it('does not make admin APIs public through static serving', async () => {
    const response = await staticResponse(new Request('http://localhost/api/admin/publishers'), root);
    expect(response).toBeNull();
  });
});
