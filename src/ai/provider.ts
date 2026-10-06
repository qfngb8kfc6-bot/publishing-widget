export class AIProviderError extends Error {
  constructor(readonly code: 'unavailable' | 'timeout' | 'invalid-response' | 'rate-limit', message: string = code) {
    super(message);
    this.name = 'AIProviderError';
  }
}
