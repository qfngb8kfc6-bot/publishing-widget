import type { AnalyticsClient, AnalyticsEvent, AnalyticsEventName, AnalyticsMetadata } from './types';
import { WIDGET_VERSION } from '../version';

export const ANALYTICS_SCHEMA_VERSION = '1.0';

function eventId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class ConsoleAnalytics implements AnalyticsClient {
  track(event: AnalyticsEvent): void {
    if (typeof console !== 'undefined') console.info('[content-discovery]', event);
  }
}

export class MemoryAnalytics implements AnalyticsClient {
  readonly events: AnalyticsEvent[] = [];
  track(event: AnalyticsEvent): void { this.events.push(event); }
}

export function createEvent(name: AnalyticsEventName, publisherId: string, sessionId: string, metadata?: AnalyticsMetadata, publisherConfigVersion?: string): AnalyticsEvent {
  return { eventId: eventId(), schemaVersion: ANALYTICS_SCHEMA_VERSION, name, publisherId, sessionId, timestamp: new Date().toISOString(), widgetVersion: WIDGET_VERSION, publisherConfigVersion, metadata };
}
