import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

describe('local Vite development integration', () => {
  it('proxies same-origin API requests to the local backend', () => {
    const proxy = viteConfig.server?.proxy;
    expect(proxy).toBeDefined();
    expect(proxy && !Array.isArray(proxy) && typeof proxy !== 'function' ? proxy['/api'] : undefined).toMatchObject({ target: 'http://localhost:8787', changeOrigin: true });
  });
});
