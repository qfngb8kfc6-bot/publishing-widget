export interface CompanyUrlNormalizationOptions {
  preserveWww?: boolean;
}

export function normalizeCompanyUrl(input: string, options: CompanyUrlNormalizationOptions = {}): { domain: string; canonicalUrl: string } {
  const value = input.trim();
  if (!value || value.length > 253) throw new Error('company_url_required');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) throw new Error('unsafe_company_url');
  let parsed: URL;
  try { parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { throw new Error('invalid_company_url'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsafe_company_url');
  if (parsed.username || parsed.password) throw new Error('company_url_credentials_not_allowed');
  const parsedHostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const hasWwwPrefix = parsedHostname.startsWith('www.');
  const hostname = parsedHostname.replace(/^www\./, '');
  if (isPrivateHostname(hostname)) throw new Error('unsafe_company_url');
  if (!hostname || hostname.includes('..') || !hostname.includes('.') || /[^a-z0-9.-]/i.test(hostname)) throw new Error('invalid_company_url');
  const canonicalHostname = options.preserveWww && hasWwwPrefix ? `www.${hostname}` : hostname;
  return { domain: hostname, canonicalUrl: `https://${canonicalHostname}/` };
}

export function isPrivateHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === 'metadata.google.internal') return true;
  const ipv6 = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (ipv6.includes(':')) return ipv6 === '::1' || ipv6.startsWith('fc') || ipv6.startsWith('fd') || ipv6.startsWith('fe80:');
  if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) return true;
  const private172 = hostname.match(/^172\.(\d+)\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}
