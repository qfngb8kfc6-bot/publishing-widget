export interface RateLimitDecision { allowed: boolean; retryAfterSeconds: number; remaining: number; }

export interface RateLimitOptions { limit?: number; windowMs?: number; }

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: RateLimitOptions = {}) {
    this.limit = options.limit ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    const timestamps = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (timestamps.length >= this.limit) {
      this.buckets.set(key, timestamps);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + this.windowMs - now) / 1000)), remaining: 0 };
    }
    timestamps.push(now);
    this.buckets.set(key, timestamps);
    return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, this.limit - timestamps.length) };
  }
}

export function requestRateLimitKey(request: Request, routeClass: string, publisherId = 'global', trustedProxy = false): string {
  const forwarded = trustedProxy ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
  const identity = forwarded || 'anonymous';
  return `${routeClass}:${publisherId}:${identity}`;
}
