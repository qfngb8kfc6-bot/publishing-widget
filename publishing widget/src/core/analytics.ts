import type { AnalyticsClient, AnalyticsEvent, AnalyticsEventName } from './types';

export class ConsoleAnalytics implements AnalyticsClient {
  track(event: AnalyticsEvent): void {
    if (typeof console !== 'undefined') console.info('[content-discovery]', event);
  }
}

export class MemoryAnalytics implements AnalyticsClient {
  readonly events: AnalyticsEvent[] = [];
  track(event: AnalyticsEvent): void { this.events.push(event); }
}

export function createEvent(name: AnalyticsEventName, publisherId: string, sessionId: string, metadata?: AnalyticsEvent['metadata']): AnalyticsEvent {
  return { name, publisherId, sessionId, timestamp: new Date().toISOString(), metadata };
}
