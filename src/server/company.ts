import type { CompanyContext } from '../core';
export { isPrivateHostname, normalizeCompanyUrl } from '../core/company-url';

export interface CompanyContextProvider {
  getContext(domain: string, signal?: AbortSignal): Promise<CompanyContext>;
}

export interface CompanyContextCache {
  get(domain: string): Promise<CompanyContext | null>;
  set(context: CompanyContext): Promise<void>;
}

export class MemoryCompanyContextCache implements CompanyContextCache {
  private readonly values = new Map<string, CompanyContext>();
  async get(domain: string): Promise<CompanyContext | null> {
    const value = this.values.get(domain);
    if (!value || Date.parse(value.expiresAt) <= Date.now()) return null;
    return value;
  }
  async set(context: CompanyContext): Promise<void> { this.values.set(context.domain, context); }
}

const DEMO_CONTEXTS: Record<string, Omit<CompanyContext, 'domain' | 'canonicalUrl' | 'fetchedAt' | 'expiresAt'>> = {
  'ldsystems.uk': { name: 'LD Systems', industry: 'technology', description: 'A technology company working across digital products, software and automation.', topics: ['technology', 'software', 'AI', 'automation', 'digital products'], entities: ['LD Systems'], source: 'demo-fixture', analysisVersion: '1.0' },
  'sunseeker.com': { name: 'Sunseeker', industry: 'marine manufacturing', description: 'A marine manufacturer focused on high-performance boats and customer experience.', topics: ['marine', 'manufacturing', 'design', 'propulsion', 'sustainability'], entities: ['Sunseeker'], source: 'demo-fixture', analysisVersion: '1.0' },
  'microsoft.com': { name: 'Microsoft', industry: 'technology', description: 'A technology company building software, cloud services and enterprise platforms.', topics: ['software', 'cloud', 'AI', 'security', 'enterprise technology'], entities: ['Microsoft'], source: 'demo-fixture', analysisVersion: '1.0' },
  'jpmorgan.com': { name: 'JPMorgan', industry: 'financial services', description: 'A financial services organisation operating across markets, banking and investment.', topics: ['finance', 'markets', 'investment', 'risk', 'regulation'], entities: ['JPMorgan'], source: 'demo-fixture', analysisVersion: '1.0' },
};

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= maxBytes) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error('company_context_too_large');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  if (chunks.length === 1) return new TextDecoder().decode(chunks[0]);
  const combined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

export class SafeCompanyContextProvider implements CompanyContextProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly cache: CompanyContextCache = new MemoryCompanyContextCache(), private readonly timeoutMs = 4000) {}

  async getContext(domain: string, signal?: AbortSignal): Promise<CompanyContext> {
    const cached = await this.cache.get(domain);
    if (cached) return cached;
    const now = new Date();
    const fixture = DEMO_CONTEXTS[domain];
    if (fixture) {
      const context = this.withDates(domain, fixture, now);
      await this.cache.set(context);
      return context;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await this.fetchImpl(`https://${domain}/`, { method: 'GET', headers: { Accept: 'text/html,text/plain;q=0.8' }, redirect: 'error', signal: controller.signal });
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !type.includes('text/')) throw new Error('company_context_unavailable');
        const html = await readBoundedText(response, 80_000);
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
        const context = this.withDates(domain, { name: domain.split('.')[0], description: text || undefined, topics: [], entities: [], source: 'public-website', analysisVersion: '1.0' }, now);
        await this.cache.set(context);
        return context;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
    } catch {
      return this.withDates(domain, { name: domain.split('.')[0], topics: [], entities: [], source: 'submitted-domain', analysisVersion: '1.0' }, now);
    }
  }

  private withDates(domain: string, value: Omit<CompanyContext, 'domain' | 'canonicalUrl' | 'fetchedAt' | 'expiresAt'>, now: Date): CompanyContext {
    return { ...value, domain, canonicalUrl: `https://${domain}/`, fetchedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString() };
  }
}
