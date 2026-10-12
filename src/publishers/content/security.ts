import type { ContentFetchOptions } from './types';

export type ContentSourceErrorCode = 'timeout' | 'authentication-failure' | 'rate-limit' | 'unavailable' | 'invalid-response' | 'unsafe-url' | 'empty-source';

export class ContentSourceError extends Error {
  readonly code: ContentSourceErrorCode;
  readonly status?: number;
  constructor(code: ContentSourceErrorCode, message?: string, status?: number) {
    super(message ?? code);
    this.code = code;
    this.status = status;
    this.name = 'ContentSourceError';
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] === 169 && parts[1] === 254 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function assertSafePublicUrl(input: string | URL, allowedHostnames?: string[]): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new ContentSourceError('unsafe-url', 'Source URL is not valid.'); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ContentSourceError('unsafe-url', 'Source URL must be a public HTTP(S) URL without credentials.');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd') || isPrivateIpv4(hostname)) throw new ContentSourceError('unsafe-url', 'Private and loopback source URLs are not allowed.');
  if (allowedHostnames?.length && !allowedHostnames.some((allowed) => hostname === allowed.toLowerCase() || hostname.endsWith(`.${allowed.toLowerCase()}`))) throw new ContentSourceError('unsafe-url', 'Source URL host is not allowlisted.');
  return url;
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds, 3600));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min((date - Date.now()) / 1000, 3600)) : undefined;
}

export async function safeSourceFetch(input: string | URL, init: RequestInit = {}, options: ContentFetchOptions = {}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new ContentSourceError('unavailable', 'A fetch implementation is required.');
  let current = assertSafePublicUrl(input, options.allowedHostnames);
  const maxRedirects = options.maxRedirects ?? 3;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      const response = await fetchImpl(current, { ...init, redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (!location || redirect === maxRedirects) throw new ContentSourceError('unavailable', 'Source redirected too many times.');
        current = assertSafePublicUrl(new URL(location, current), options.allowedHostnames);
        continue;
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new ContentSourceError('authentication-failure', 'Source authentication failed.', response.status);
        if (response.status === 429) {
          const retry = retryAfterSeconds(response);
          throw new ContentSourceError('rate-limit', retry === undefined ? 'Source rate limit reached.' : `Source rate limit reached; retry after ${Math.ceil(retry)} seconds.`, response.status);
        }
        throw new ContentSourceError('unavailable', `Source returned HTTP ${response.status}.`, response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof ContentSourceError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new ContentSourceError('timeout', 'Source request timed out.');
      throw new ContentSourceError('unavailable', 'Source could not be reached.');
    } finally { clearTimeout(timeout); }
  }
  throw new ContentSourceError('unavailable', 'Source could not be reached.');
}

export async function fetchText(input: string | URL, init: RequestInit = {}, options: ContentFetchOptions = {}): Promise<string> {
  const response = await safeSourceFetch(input, init, options);
  try {
    const value = await response.text();
    if (value.length > (options.maxBytes ?? 2_000_000)) throw new ContentSourceError('invalid-response', 'Source response exceeded the safety limit.');
    return value;
  } catch (error) {
    if (error instanceof ContentSourceError) throw error;
    throw new ContentSourceError('invalid-response', 'Source response could not be read.');
  }
}
