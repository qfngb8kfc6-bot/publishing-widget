import { describe, expect, it } from 'vitest';
import { BoundedCompanyInputResolver, classifyCompanyInput } from '../src/server/company';
import { companyNameStages } from '../src/server/company-resolver';
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
  describe('legal-form suffixes', () => {
    const resolveWith = async (name: string, live: string[]) => {
      const requested: string[] = [];
      const resolver = new BoundedCompanyInputResolver(async (input) => {
        requested.push(new URL(String(input)).hostname);
        return publicProbe((hostname) => live.includes(hostname) ? 200 : 404)(input);
      }, 1_000, 12);
      return { resolved: await resolver.resolve(name), requested };
    };

    it('strips one trailing legal form at a time, never down to nothing', () => {
      expect(companyNameStages('XXL ASA')).toEqual(['XXL ASA', 'XXL']);
      expect(companyNameStages('Amer Sports Oyj')).toEqual(['Amer Sports Oyj', 'Amer Sports']);
      expect(companyNameStages('Frasers Group plc')).toEqual(['Frasers Group plc', 'Frasers Group', 'Frasers']);
      expect(companyNameStages('Nike, Inc.')).toEqual(['Nike, Inc.', 'Nike']);
      expect(companyNameStages('Acme S.A.')).toEqual(['Acme S.A.', 'Acme']);
      expect(companyNameStages('Group')).toEqual(['Group']);
      expect(companyNameStages('Decathlon')).toEqual(['Decathlon']);
      // Only trailing forms: a leading "AS" (AS Roma) or one inside the name stays.
      expect(companyNameStages('AS Roma')).toEqual(['AS Roma']);
    });

    it('resolves "XXL ASA" with the bare name and keeps the typed name for display', async () => {
      const { resolved, requested } = await resolveWith('XXL ASA', ['xxl.com']);
      expect(resolved).toMatchObject({ inputType: 'company_name', displayName: 'XXL ASA', domain: 'xxl.com', resolutionMethod: 'bounded_public_site' });
      // The full name is tried first.
      expect(requested[0]).toBe('xxlasa.com');
      expect(requested.indexOf('xxl.com')).toBeGreaterThan(0);
    });

    it('resolves "Amer Sports Oyj" with the bare name', async () => {
      const { resolved } = await resolveWith('Amer Sports Oyj', ['amersports.com']);
      expect(resolved).toMatchObject({ displayName: 'Amer Sports Oyj', domain: 'amersports.com' });
    });

    it('resolves "Frasers Group plc" at the first stage that answers', async () => {
      expect((await resolveWith('Frasers Group plc', ['frasersgroup.com', 'frasers.com'])).resolved).toMatchObject({ displayName: 'Frasers Group plc', domain: 'frasersgroup.com' });
      expect((await resolveWith('Frasers Group plc', ['frasers.co.uk'])).resolved).toMatchObject({ displayName: 'Frasers Group plc', domain: 'frasers.co.uk' });
    });

    it('still resolves the full name first when it has a site of its own', async () => {
      expect((await resolveWith('XXL ASA', ['xxlasa.com', 'xxl.com'])).resolved.domain).toBe('xxlasa.com');
    });

    it('treats a name with a dotted legal form as a name, not a domain', () => {
      expect(classifyCompanyInput('Acme S.A.')).toBe('company_name');
      expect(classifyCompanyInput('Smith & Co.')).toBe('company_name');
      expect(classifyCompanyInput('nike.com')).toBe('domain');
      expect(classifyCompanyInput('www.nike.com')).toBe('domain');
    });

    it('fails as before when no stage resolves', async () => {
      await expect(resolveWith('XXL ASA', [])).rejects.toThrow('company_resolution_failed');
    });

    it('generates a report for "XXL ASA" through the real endpoint, shown as typed', async () => {
      const resolver = new BoundedCompanyInputResolver(publicProbe((hostname) => hostname === 'xxl.com' ? 200 : 404), 1_000, 12);
      const app = createProductionApp({ environment: 'test', companyInputResolver: resolver, companyContextProvider: { getContext: async (domain) => companyContext(domain) } });
      const response = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'XXL ASA', jobTitle: 'Category Manager' }) }));
      expect(response.status, await response.clone().text()).toBe(201);
      const report = await app.reportStore.get((await response.json() as { reportId: string }).reportId, 'demo');
      expect(report?.companyName).toBe('XXL ASA');
    });
  });

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
