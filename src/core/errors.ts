export type DiscoveryErrorCode = 'publisher-unavailable' | 'invalid-publisher' | 'api-unavailable' | 'authentication-failure' | 'rate-limit' | 'invalid-response' | 'search-timeout' | 'not-found' | 'unexpected';

export class DiscoveryError extends Error {
  constructor(readonly code: DiscoveryErrorCode, message = code) {
    super(message);
    this.name = 'DiscoveryError';
  }
}
