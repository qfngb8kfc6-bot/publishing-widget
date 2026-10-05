import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required for db:migrate. No migration was run.');
  process.exit(1);
}

const numberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const pool = new Pool({
  connectionString: databaseUrl,
  max: numberEnv('DB_POOL_MAX', 10),
  connectionTimeoutMillis: numberEnv('DB_CONNECTION_TIMEOUT_MS', 5000),
  idleTimeoutMillis: numberEnv('DB_IDLE_TIMEOUT_MS', 30000),
  statement_timeout: numberEnv('DB_STATEMENT_TIMEOUT_MS', 10000),
});
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');

try {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  const applied = new Set((await pool.query('SELECT filename FROM schema_migrations')).rows.map((row) => row.filename));
  for (const filename of files) {
    if (applied.has(filename)) continue;
    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`[db:migrate] applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(`[db:migrate] complete migrations=${files.length}`);
} catch (error) {
  console.error(`[db:migrate] failed: ${error instanceof Error ? error.name : 'unknown'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
