import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.log('[analytics:check] skipped: DATABASE_URL is not configured');
  process.exit(0);
}
const numberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: numberEnv('DB_POOL_MAX', 10), connectionTimeoutMillis: numberEnv('DB_CONNECTION_TIMEOUT_MS', 5000), idleTimeoutMillis: numberEnv('DB_IDLE_TIMEOUT_MS', 30000), statement_timeout: numberEnv('DB_STATEMENT_TIMEOUT_MS', 10000) });
const eventId = `analytics-check-${randomUUID()}`;
try {
  await pool.query(`INSERT INTO analytics_events (event_id, schema_version, publisher_id, event_name, occurred_at, session_id, metadata) VALUES ($1, '1', '__analytics_check__', 'analytics_check', NOW(), $2, '{}'::jsonb)`, [eventId, eventId]);
  const result = await pool.query('SELECT event_id FROM analytics_events WHERE event_id = $1', [eventId]);
  if (result.rows.length !== 1) throw new Error('analytics event was not readable after insert');
  await pool.query('DELETE FROM analytics_events WHERE event_id = $1', [eventId]);
  console.log('[analytics:check] passed: insert, read and cleanup');
} catch (error) {
  console.error(`[analytics:check] failed: ${error instanceof Error ? error.name : 'unknown'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
