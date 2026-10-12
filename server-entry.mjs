import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createProductionApp, PostgresAnalyticsStore, PostgresReportStore } from './dist/server.mjs';
import { staticResponse } from './server-static.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const environment = process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development';
const commitSha = process.env.COMMIT_SHA || process.env.GIT_SHA;

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function createAnalyticsStore() {
  if (!process.env.DATABASE_URL) return { store: undefined, reportStore: undefined, mode: 'memory' };
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: numberEnv('DB_POOL_MAX', 10),
    connectionTimeoutMillis: numberEnv('DB_CONNECTION_TIMEOUT_MS', 5000),
    idleTimeoutMillis: numberEnv('DB_IDLE_TIMEOUT_MS', 30000),
    statement_timeout: numberEnv('DB_STATEMENT_TIMEOUT_MS', 10000),
  });
  try {
    await pool.query('SELECT 1');
    return { store: new PostgresAnalyticsStore(pool), reportStore: new PostgresReportStore(pool), mode: 'postgres' };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

async function start() {
  let analyticsStore;
  let analyticsStoreMode;
  let reportStore;
  try {
    ({ store: analyticsStore, reportStore, mode: analyticsStoreMode } = await createAnalyticsStore());
  } catch (error) {
    console.error(`[publisher-widget] database startup failed: ${error instanceof Error ? error.name : 'unknown'}`);
    process.exitCode = 1;
    return;
  }
  const app = createProductionApp({ environment, serverEnvironment: process.env, analyticsStore, reportStore, analyticsStoreMode, trustedProxy: process.env.TRUSTED_PROXY === 'true', commitSha });
  const server = createServer(async (incoming, outgoing) => {
  const protocol = incoming.headers['x-forwarded-proto'] || 'http';
  const host = incoming.headers.host || `localhost:${port}`;
  const body = incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : incoming;
  const request = new Request(`${protocol}://${host}${incoming.url}`, { method: incoming.method, headers: incoming.headers, body, duplex: body ? 'half' : undefined });
  const response = (await staticResponse(request, root)) ?? await app.handle(request);
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[publisher-widget] shutting down signal=${signal}`);
    await new Promise((resolve) => server.close(() => resolve()));
    await analyticsStore?.close?.();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  server.listen(port, host, () => console.log(`[publisher-widget] server listening host=${host} port=${port} environment=${environment} analyticsStore=${analyticsStoreMode}`));
}

void start();
