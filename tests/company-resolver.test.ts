import { describe, expect, it } from 'vitest';
import { BoundedCompanyInputResolver } from '../src/server/company';
import { createProductionApp } from '../src/server/production';

function companyContext(domain: string) {
  return {
    domain,
    canonicalUrl: `https://${domain}/`,
    name: 'Resolved website label',
    industry: 'consumer products',
    description: 'A bounded test company context.',
    topics: ['retail', 'technology', 'innovation'],
    entities: ['Resolved website label'],
    source: 'demo-fixture' as const,
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    analysisVersion: 'test',
  };
}

function publicProbe(statusFor: (hostname: string) => number = () => 200) {
  return async (input: RequestInfo | URL): Promise<Response> => new Response(null, { status: statusFor(new URL(String(input)).hostname) });
}

describe('server-side company input resolution', () => {
  it('resolves company names through bounded public probes without a production name map', async () => {
    const requested: string[] = [];
    const resolver = new BoundedCompanyInputResolver(async (input) => {
      requested.push(String(input));
      return publicProbe((hostname) => hostname === 'jdsports.com' ? 200 : 404)(input);
    }, 1_000, 12);

    const resolved = await resolver.resolve('JD Sports');
    expect(resolved).toMatchObject({ inputType: 'company_name', displayName: 'JD Sports', domain: 'jdsports.com', canonicalUrl: 'https://jdsports.com/', resolutionMethod: 'bounded_public_site' });
    expect(requested).toContain('https://jdsports.com/');
    expect(requested.length).toBeLessThanOrEqual(12);
    expect(await resolver.resolve('JD Sports')).toEqual(resolved);
    expect(requested.length).toBeLessThanOrEqual(12);
  });

  it.each(['nike.com', 'www.nike.com', 'https://nike.com', 'https://www.nike.com', 'http://nike.com'])('normalizes submitted domain input %s without a company-name probe', async (input) => {
    let probes = 0;
    const resolver = new BoundedCompanyInputResolver(async () => { probes += 1; return new Response(null, { status: 200 }); });
    const resolved = await resolver.resolve(input);
    expect(resolved.inputType).toBe('domain');
    expect(resolved.domain).toBe('nike.com');
    expect(resolved.canonicalUrl).toBe('https://nike.com/');
    expect(probes).toBe(0);
  });

  it('distinguishes unresolved names from unsafe inputs', async () => {
    const resolver = new BoundedCompanyInputResolver(publicProbe(() => 404), 500, 4);
    await expect(resolver.resolve('not a real company')).rejects.toThrow('company_resolution_failed');
    await expect(resolver.resolve('localhost')).rejects.toThrow('unsafe_company_url');
    await expect(resolver.resolve('file:///etc/passwd')).rejects.toThrow('unsafe_company_url');

    const app = createProductionApp({ environment: 'test', companyInputResolver: resolver });
    const response = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'not a real company', jobTitle: 'Engineer' }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'company_resolution_failed' });
  });

  it('accepts bare company names through the real report endpoint and preserves their display input', async () => {
    const resolver = new BoundedCompanyInputResolver(publicProbe((hostname) => hostname.endsWith('.com') ? 200 : 404), 1_000, 12);
    const app = createProductionApp({
      environment: 'test',
      companyInputResolver: resolver,
      companyContextProvider: { getContext: async (domain) => companyContext(domain) },
    });
    const values = ['nike', 'Nike', 'nike.com', 'www.nike.com', 'https://www.nike.com', 'http://nike.com', 'adidas', 'JD Sports', 'LD Systems', 'ANWR Group'];
    for (const companyUrl of values) {
      const response = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publisherId: 'demo', companyUrl, jobTitle: 'Product Manager' }),
      }));
      expect(response.status, `${companyUrl}: ${await response.clone().text()}`).toBe(201);
      const payload = await response.json() as { reportId: string };
      const report = await app.reportStore.get(payload.reportId, 'demo');
      expect(report?.companyName).not.toBe('nike.com');
      // A bare name is kept as typed, except that an all-lowercase one is title-cased for display ("nike" → "Nike").
      if (!companyUrl.includes('.') && !companyUrl.includes('://')) expect(report?.companyName).toBe(/[A-Z]/.test(companyUrl) ? companyUrl : companyUrl.replace(/(^|[\s-])([a-z])/g, (_match, separator: string, letter: string) => `${separator}${letter.toUpperCase()}`));
    }
  });

  it('accepts a bare company name through the authenticated admin test-report path', async () => {
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      companyInputResolver: new BoundedCompanyInputResolver(publicProbe((hostname) => hostname.endsWith('.com') ? 200 : 404), 1_000, 12),
      companyContextProvider: { getContext: async (domain) => companyContext(domain) },
    });
    const login = await app.handle(new Request('https://admin.example/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'test-admin-password' }) }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get('Set-Cookie')?.split(';', 1)[0];
    const response = await app.handle(new Request('https://admin.example/api/admin/publishers/demo/test-report', {
      method: 'POST',
      headers: { Cookie: cookie ?? '', Origin: 'https://admin.example' },
      body: JSON.stringify({ companyUrl: 'Nike', jobTitle: 'Product Manager' }),
    }));
    expect(response.status, await response.clone().text()).toBe(201);
  });
});
