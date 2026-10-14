import { isPrivateHostname, normalizeCompanyUrl } from '../core/company-url';

export type CompanyInputType = 'domain' | 'company_name';

export interface ResolvedCompanyInput {
  inputType: CompanyInputType;
  displayName?: string;
  domain: string;
  canonicalUrl: string;
  resolutionMethod: 'submitted_domain' | 'bounded_public_site';
}

export interface CompanyInputResolver {
  resolve(input: string, signal?: AbortSignal): Promise<ResolvedCompanyInput>;
}

export interface CompanyInputResolverOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxCandidates?: number;
}

export function classifyCompanyInput(input: string): CompanyInputType {
  const value = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes('.') || /^\d+$/.test(value)) return 'domain';
  return 'company_name';
}

function companyName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function candidateBases(name: string): string[] {
  const words = name.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const compact = words.join('');
  const hyphenated = words.join('-');
  const withoutCommonSuffix = words.filter((word) => !['inc', 'llc', 'ltd', 'limited', 'plc', 'corp', 'corporation'].includes(word));
  const variants = [compact, hyphenated];
  if (withoutCommonSuffix.length && withoutCommonSuffix.length !== words.length) {
    variants.push(withoutCommonSuffix.join(''), withoutCommonSuffix.join('-'));
  }
  return [...new Set(variants)].filter((value) => value.length >= 2 && value.length <= 63);
}

function candidateDomains(name: string, maxCandidates: number): string[] {
  const tlds = ['com', 'co.uk', 'uk', 'org', 'net', 'de'];
  return candidateBases(name).flatMap((base) => tlds.map((tld) => `${base}.${tld}`)).slice(0, maxCandidates);
}

function abortError(): Error {
  return new Error('company_resolution_timeout');
}

/**
 * Resolves a company name without putting a name-to-domain table in product
 * logic. Candidate generation is deliberately small and every candidate is
 * validated and probed through the same public-host safety boundary.
 */
export class BoundedCompanyInputResolver implements CompanyInputResolver {
  private readonly successCache = new Map<string, ResolvedCompanyInput>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 4_000,
    private readonly maxCandidates = 12,
  ) {}

  async resolve(input: string, signal?: AbortSignal): Promise<ResolvedCompanyInput> {
    const value = companyName(input);
    if (!value || value.length > 253) throw new Error('company_url_required');
    const inputType = classifyCompanyInput(value);
    if (inputType === 'domain') {
      const normalized = normalizeCompanyUrl(value);
      return { inputType, ...normalized, resolutionMethod: 'submitted_domain' };
    }

    // A bare private hostname is a safety rejection, not an unresolved name.
    if (isPrivateHostname(value.toLowerCase())) {
      throw new Error('unsafe_company_url');
    }
    if (!/^[\p{L}\p{N}][\p{L}\p{N}&.'’()\-]*(?:\s+[\p{L}\p{N}&.'’()\-]+)*$/u.test(value)) throw new Error('company_resolution_failed');

    const cacheKey = value.toLocaleLowerCase('en-GB');
    const cached = this.successCache.get(cacheKey);
    if (cached) return { ...cached, displayName: value };
    const deadline = Date.now() + this.timeoutMs;
    for (const domain of candidateDomains(value, this.maxCandidates)) {
      if (Date.now() >= deadline || signal?.aborted) throw abortError();
      if (!await this.probe(domain, deadline, signal)) continue;
      const normalized = normalizeCompanyUrl(domain);
      const resolved: ResolvedCompanyInput = { inputType, displayName: value, ...normalized, resolutionMethod: 'bounded_public_site' };
      if (this.successCache.size >= 128) this.successCache.delete(this.successCache.keys().next().value as string);
      this.successCache.set(cacheKey, resolved);
      return resolved;
    }
    throw new Error('company_resolution_failed');
  }

  private async probe(domain: string, deadline: number, parentSignal?: AbortSignal): Promise<boolean> {
    const normalized = normalizeCompanyUrl(domain);
    const controller = new AbortController();
    const remaining = Math.max(1, Math.min(1_200, deadline - Date.now()));
    const timeout = setTimeout(() => controller.abort(), remaining);
    const onAbort = () => controller.abort();
    parentSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.fetchImpl(normalized.canonicalUrl, { method: 'HEAD', headers: { Accept: 'text/html,text/plain;q=0.8' }, redirect: 'manual', signal: controller.signal });
      if (response.body) await response.body.cancel().catch(() => undefined);
      return response.status >= 200 && response.status < 400;
    } catch (error) {
      if (controller.signal.aborted && Date.now() >= deadline) throw abortError();
      return false;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  }
}
