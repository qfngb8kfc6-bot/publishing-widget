import type { AnalyticsDateRange, AnalyticsStore, StoredAnalyticsEvent } from './types';

export interface SqlQueryResult<Row> { rows: Row[]; rowCount?: number | null; }
export interface SqlClient { query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<SqlQueryResult<Row>>; end?(): Promise<void>; }

type PostgresAnalyticsRow = Omit<StoredAnalyticsEvent, 'timestamp' | 'receivedAt'> & { timestamp: string | Date; receivedAt: string | Date };

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  throw new Error('Analytics store returned an invalid timestamp.');
}

/** Vendor-neutral relational adapter. Inject a configured pg/Supabase client at startup. */
export class PostgresAnalyticsStore implements AnalyticsStore {
  constructor(private readonly client: SqlClient) {}

  async append(events: StoredAnalyticsEvent[]): Promise<void> {
    for (const event of events) {
      await this.client.query(`INSERT INTO analytics_events (event_id, schema_version, publisher_id, event_name, occurred_at, session_id, widget_version, publisher_config_version, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (event_id) DO NOTHING`, [event.eventId, event.schemaVersion, event.publisherId, event.name, event.timestamp, event.sessionId, event.widgetVersion ?? null, event.publisherConfigVersion ?? null, JSON.stringify(event.metadata ?? {})]);
    }
  }

  async query(scope: { publisherId: string; range?: AnalyticsDateRange }): Promise<StoredAnalyticsEvent[]> {
    const parameters: unknown[] = [scope.publisherId];
    let sql = `SELECT event_id AS "eventId", schema_version AS "schemaVersion", publisher_id AS "publisherId", event_name AS name, occurred_at AS timestamp, session_id AS "sessionId", widget_version AS "widgetVersion", publisher_config_version AS "publisherConfigVersion", metadata, received_at AS "receivedAt" FROM analytics_events WHERE publisher_id = $1`;
    if (scope.range) { parameters.push(scope.range.from, scope.range.to); sql += ` AND occurred_at >= $2 AND occurred_at <= $3`; }
    sql += ' ORDER BY occurred_at ASC';
    const result = await this.client.query<PostgresAnalyticsRow>(sql, parameters);
    return Array.isArray(result.rows) ? result.rows.map((event) => ({ ...event, timestamp: isoTimestamp(event.timestamp), receivedAt: isoTimestamp(event.receivedAt), metadata: event.metadata ?? {} })) : [];
  }

  async listPublisherIds(): Promise<string[]> {
    const result = await this.client.query<{ publisherId: string }>('SELECT DISTINCT publisher_id AS "publisherId" FROM analytics_events ORDER BY publisher_id');
    return (Array.isArray(result.rows) ? result.rows : []).map((row) => row.publisherId);
  }

  /** Retention, one publisher at a time so the (publisher_id, occurred_at) index serves the scan; oldest first. */
  async deleteOccurredBefore(publisherId: string, cutoff: Date, limit: number): Promise<number> {
    const result = await this.client.query('DELETE FROM analytics_events WHERE event_id IN (SELECT event_id FROM analytics_events WHERE publisher_id = $1 AND occurred_at < $2 ORDER BY occurred_at LIMIT $3)', [publisherId, cutoff.toISOString(), limit]);
    return result.rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.client.end?.();
  }
}
