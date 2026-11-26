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
    return (this.events ?? []).filter((event) => event.publisherId === scope.publisherId && inRange(event.timestamp, scope.range)).map((event) => ({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined }));
  }

  async listPublisherIds(): Promise<string[]> {
    return [...new Set(this.events.map((event) => event.publisherId))].sort();
  }

  async deleteOccurredBefore(publisherId: string, cutoff: Date, limit: number): Promise<number> {
    const doomed = new Set(this.events.filter((event) => event.publisherId === publisherId && Date.parse(event.timestamp) < cutoff.getTime()).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)).slice(0, limit));
    for (let index = this.events.length - 1; index >= 0; index -= 1) if (doomed.has(this.events[index])) this.events.splice(index, 1);
    return doomed.size;
  }
}
