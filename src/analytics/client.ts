import type { AnalyticsClient, AnalyticsEvent } from '../core';

export interface BatchingAnalyticsOptions {
  endpoint?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  fetchImpl?: typeof fetch;
  sendBeacon?: (url: string, data: BodyInit | null) => boolean;
}

const IMPORTANT_EVENTS = new Set<AnalyticsEvent['name']>(['article_clicked', 'story_clicked', 'report_generated', 'search_completed', 'search_failed', 'widget_closed', 'theme_find_stories_clicked', 'theme_story_clicked', 'generation_completed', 'generation_failed', 'loading_abandoned']);

/** Browser-safe, non-blocking delivery to the first-party analytics endpoint. */
export class BatchingAnalyticsClient implements AnalyticsClient {
  private readonly queue: AnalyticsEvent[] = [];
  private readonly endpoint: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly beacon?: (url: string, data: BodyInit | null) => boolean;
  private readonly crossOrigin: boolean;
  private timer?: ReturnType<typeof setInterval>;
  private flushing = false;

  constructor(options: BatchingAnalyticsOptions = {}) {
    this.endpoint = options.endpoint ?? '/api/analytics/events';
    this.flushIntervalMs = options.flushIntervalMs ?? 2500;
    this.maxBatchSize = options.maxBatchSize ?? 12;
    this.fetchImpl = options.fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
    this.crossOrigin = isCrossOrigin(this.endpoint);
    // A JSON beacon to another origin is a credentialed CORS request the platform does not allow, so the browser
    // would drop it silently. Cross-origin delivery uses keepalive fetch without credentials instead.
    this.beacon = this.crossOrigin ? undefined : options.sendBeacon ?? (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon.bind(navigator) : undefined);
    if (this.flushIntervalMs > 0 && typeof setInterval !== 'undefined') this.timer = setInterval(() => { void this.flush(); }, this.flushIntervalMs);
  }

  track(event: AnalyticsEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxBatchSize || IMPORTANT_EVENTS.has(event.name)) void this.flush(IMPORTANT_EVENTS.has(event.name));
  }

  async flush(preferBeacon = false): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const events = this.queue.splice(0, this.maxBatchSize);
    const body = JSON.stringify({ events });
    try {
      if (preferBeacon && this.beacon?.(this.endpoint, new Blob([body], { type: 'application/json' }))) return;
      if (!this.fetchImpl) return;
      await this.fetchImpl(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: preferBeacon, ...(this.crossOrigin ? { credentials: 'omit' as const } : {}) });
    } catch {
      // Analytics delivery is best-effort. Consumer recommendations and navigation must continue.
    } finally {
      this.flushing = false;
      if (this.queue.length >= this.maxBatchSize) void this.flush();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export function attachAnalyticsPageLifecycle(client: AnalyticsClient): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
  const flush = (preferBeacon = false) => { void client.flush?.(preferBeacon); };
  const visibility = () => { if (document.visibilityState === 'hidden') flush(true); };
  const pagehide = () => flush(true);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
  };
}

function isCrossOrigin(endpoint: string): boolean {
  if (typeof location === 'undefined' || !/^https?:\/\//i.test(endpoint)) return false;
  try {
    return new URL(endpoint).origin !== location.origin;
  } catch {
    return false;
  }
}
