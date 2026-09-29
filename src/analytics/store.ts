import type { AnalyticsStore, AnalyticsDateRange, StoredAnalyticsEvent } from './types';

function inRange(timestamp: string, range?: AnalyticsDateRange): boolean {
  if (!range) return true;
  const time = Date.parse(timestamp);
  return time >= Date.parse(range.from) && time <= Date.parse(range.to);
}

/** Development store with the same tenant-scoped interface a database adapter must implement. */
export class MemoryAnalyticsStore implements AnalyticsStore {
  readonly events: StoredAnalyticsEvent[] = [];

  async append(events: StoredAnalyticsEvent[]): Promise<void> {
    this.events.push(...events.map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined })));
  }

  async query(scope: { publisherId: string; range?: AnalyticsDateRange }): Promise<StoredAnalyticsEvent[]> {
    return this.events.filter((event) => event.publisherId === scope.publisherId && inRange(event.timestamp, scope.range)).map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined }));
  }

  async listPublisherIds(): Promise<string[]> {
    return [...new Set(this.events.map((event) => event.publisherId))].sort();
  }
}
