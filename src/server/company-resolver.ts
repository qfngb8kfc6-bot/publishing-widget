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
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^\d+$/.test(value)) return 'domain';
  // A dot means a domain, except in a name with a dotted legal form ("Acme S.A.", "Smith & Co."): domains have no spaces.
  if (value.includes('.') && !(/\s/.test(value) && legalSuffix(value))) return 'domain';
  return 'company_name';
}

function companyName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Legal forms (compared without dots, case-insensitive) that domains rarely contain: "XXL ASA" lives at xxl.*. */
const LEGAL_SUFFIXES = new Set(['asa', 'as', 'ab', 'oy', 'oyj', 'gmbh', 'ag', 'sa', 'spa', 'nv', 'bv', 'plc', 'ltd', 'limited', 'inc', 'llc', 'corp', 'corporation', 'co', 'group']);

/** The trailing legal form of a multi-word name ("XXL ASA" → "ASA", "Nike, Inc." → "Inc."), if any. */
function legalSuffix(name: string): string | undefined {
  const match = name.match(/[\s,]+([\p{L}.]+)\s*$/u);
  return match && LEGAL_SUFFIXES.has(match[1].replace(/\./g, '').toLowerCase()) ? match[1] : undefined;
}

/**
 * The name as typed, then with one trailing legal form removed at a time, so "Frasers Group plc" tries
 * "Frasers Group plc", "Frasers Group", "Frasers". Never down to nothing: a single word is kept.
 */
export function companyNameStages(name: string): string[] {
  const stages = [companyName(name)];
  for (let current = stages[0]; ;) {
    const suffix = legalSuffix(current);
    if (!suffix) break;
    const next = current.slice(0, current.length - current.match(/[\s,]+[\p{L}.]+\s*$/u)![0].length).trim();
    if (!next) break;
    stages.push(next);
    current = next;
  }
  return stages;
}

/** Candidate domains per name stage: the bare name gets the full budget, longer forms a short look first. */
function stagedCandidateDomains(name: string, maxCandidates: number): string[] {
  const stages = companyNameStages(name);
  const fullFormCandidates = Math.min(4, maxCandidates);
  const domains = stages.flatMap((stage, index) => candidateDomains(stage, index === stages.length - 1 ? maxCandidates : fullFormCandidates));
  // Pan-European readers: the bare name also tries European country TLDs, after every other candidate.
  return [...new Set([...domains, ...europeanCandidateDomains(stages[stages.length - 1])])];
}

/** European TLDs tried for the bare name only, after the default ones ("XXL ASA" → xxl.no). */
export const EUROPEAN_TLDS = ['fr', 'it', 'es', 'nl', 'be', 'at', 'ch', 'se', 'no', 'dk', 'fi', 'pl', 'pt', 'ie', 'eu'] as const;
/** At most this many European candidates: the compact spelling on every TLD, then hyphenated while room remains. */
export const EUROPEAN_CANDIDATE_LIMIT = 15;

function europeanCandidateDomains(name: string): string[] {
  return candidateBases(name).flatMap((base) => EUROPEAN_TLDS.map((tld) => `${base}.${tld}`)).slice(0, EUROPEAN_CANDIDATE_LIMIT);
}

/** Probes started at once; the first candidate in priority order that answers wins. */
export const PROBE_CONCURRENCY = 12;
/** One probe's limit; a missing domain usually fails much sooner (DNS). */
const PROBE_TIMEOUT_MS = 800;

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
  return [...new Set([compact, hyphenated])].filter((value) => value.length >= 2 && value.length <= 63);
}

function candidateDomains(name: string, maxCandidates: number): string[] {
  const tlds = ['com', 'co.uk', 'uk', 'org', 'net', 'de'];
  // TLD first, then spelling: a short budget covers both spellings on .com and .co.uk.
  const bases = candidateBases(name);
  return tlds.flatMap((tld) => bases.map((base) => `${base}.${tld}`)).slice(0, maxCandidates);
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
    // ~2 s in total: up to three waves of parallel probes, each probe at most 800 ms.
    private readonly timeoutMs = 2_000,
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
    // The name as typed first, then without its legal form(s); the typed name stays the display name.
    const domain = await this.firstAnswering(stagedCandidateDomains(value, this.maxCandidates), deadline, signal);
    if (domain) {
      const normalized = normalizeCompanyUrl(domain);
      const resolved: ResolvedCompanyInput = { inputType, displayName: value, ...normalized, resolutionMethod: 'bounded_public_site' };
      if (this.successCache.size >= 128) this.successCache.delete(this.successCache.keys().next().value as string);
      this.successCache.set(cacheKey, resolved);
      return resolved;
    }
    throw new Error('company_resolution_failed');
  }

  /**
   * Probes candidates in waves of PROBE_CONCURRENCY, in parallel, and returns the first one in priority order that
   * answers (a later candidate never wins over an earlier one that also answers). The rest of the wave is aborted.
   */
  private async firstAnswering(domains: string[], deadline: number, signal?: AbortSignal): Promise<string | undefined> {
    for (let start = 0; start < domains.length; start += PROBE_CONCURRENCY) {
      if (Date.now() >= deadline || signal?.aborted) throw abortError();
      const wave = new AbortController();
      const onAbort = () => wave.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const batch = domains.slice(start, start + PROBE_CONCURRENCY);
      const probes = batch.map((domain) => this.probe(domain, deadline, wave.signal).then((ok) => ({ ok }), (error: unknown) => ({ ok: false, error })));
      try {
        for (let index = 0; index < batch.length; index += 1) {
          const outcome = await probes[index];
          if (outcome.ok) return batch[index];
          if ('error' in outcome && outcome.error) throw outcome.error;
        }
      } finally {
        wave.abort();
        signal?.removeEventListener('abort', onAbort);
        await Promise.allSettled(probes);
      }
    }
    return undefined;
  }

  private async probe(domain: string, deadline: number, parentSignal?: AbortSignal): Promise<boolean> {
    const normalized = normalizeCompanyUrl(domain);
    const controller = new AbortController();
    const remaining = Math.max(1, Math.min(PROBE_TIMEOUT_MS, deadline - Date.now()));
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
