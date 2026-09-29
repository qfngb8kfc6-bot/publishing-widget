import type { AnalyticsEvent } from '../core';

export interface StoredAnalyticsEvent extends AnalyticsEvent {
  eventId: string;
  schemaVersion: string;
  receivedAt: string;
}

export interface AnalyticsDateRange {
  from: string;
  to: string;
}

export interface AnalyticsStore {
  append(events: StoredAnalyticsEvent[]): Promise<void>;
  query(scope: { publisherId: string; range?: AnalyticsDateRange }): Promise<StoredAnalyticsEvent[]>;
  listPublisherIds(): Promise<string[]>;
}
