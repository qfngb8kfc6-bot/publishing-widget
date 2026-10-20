import { createServer } from 'node:http';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createProductionApp, PostgresAnalyticsStore, PostgresReportStore, PostgresPublisherStore, PostgresCatalogueSnapshotStore, resolveCommitSha } from './dist/server.mjs';
import { staticResponse } from './server-static.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const environment = process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development';
const commitSha = resolveCommitSha(process.env);

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeEnv(name, fallback) {
  const raw = process.env[name];
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

async function createAnalyticsStore() {
  if (!process.env.DATABASE_URL) return { store: undefined, reportStore: undefined, mode: 'memory' };
  const max = numberEnv('DB_POOL_MAX', 10);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    // Opening a connection costs several network round trips (TCP, TLS, auth), so keep a few warm instead of
    // letting the idle timeout close every connection between requests.
    min: Math.min(nonNegativeEnv('DB_POOL_MIN', 2), max),
    keepAlive: true,
    connectionTimeoutMillis: numberEnv('DB_CONNECTION_TIMEOUT_MS', 5000),
    idleTimeoutMillis: numberEnv('DB_IDLE_TIMEOUT_MS', 30000),
    statement_timeout: numberEnv('DB_STATEMENT_TIMEOUT_MS', 10000),
  });
  let connectionsOpened = 0;
  pool.on('connect', () => {
    connectionsOpened += 1;
    console.log(`[publisher-widget] db_connection_opened total=${connectionsOpened} poolSize=${pool.totalCount} idle=${pool.idleCount}`);
  });
  try {
    await pool.query('SELECT 1');
    return { store: new PostgresAnalyticsStore(pool), reportStore: new PostgresReportStore(pool), publisherStore: new PostgresPublisherStore(pool), catalogueSnapshotStore: new PostgresCatalogueSnapshotStore(pool), mode: 'postgres', pool };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

async function assertProductionArtifacts() {
  const required = ['admin.html', 'index.html', 'server.mjs'];
  const missing = [];
  for (const file of required) {
    try { await access(path.join(root, file)); } catch { missing.push(`dist/${file}`); }
  }
  if (missing.length) throw new Error(`[server] required production artifact missing: ${missing.join(', ')}`);
}

async function start() {
  await assertProductionArtifacts();
  console.log('[server] entry=server-entry static=true');
  let analyticsStore;
  let analyticsStoreMode;
  let reportStore;
  let publisherStore;
  let catalogueSnapshotStore;
  try {
    ({ store: analyticsStore, reportStore, publisherStore, catalogueSnapshotStore, mode: analyticsStoreMode } = await createAnalyticsStore());
  } catch (error) {
    console.error(`[publisher-widget] database startup failed: ${error instanceof Error ? error.name : 'unknown'}`);
    process.exitCode = 1;
    return;
  }
  const app = createProductionApp({ environment, serverEnvironment: process.env, analyticsStore, reportStore, publisherStore, catalogueSnapshotStore, analyticsStoreMode, trustedProxy: process.env.TRUSTED_PROXY === 'true', commitSha });
  if (publisherStore) {
    const existing = new Set((await publisherStore.list()).map((record) => record.manifest.publisherId));
    for (const definition of app.registry.list()) {
      if (definition.manifest && !existing.has(definition.manifest.publisherId)) await publisherStore.create(definition.manifest);
    }
    await app.publisherRuntime.invalidate();
  }
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
    await app.flushAnalytics();
    await analyticsStore?.close?.();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  // Any synchronous stall delays every timer, including the AI time cap, and every in-flight database reply.
  // Log stalls so a slow request can be matched to what blocked the process at the time.
  const stallThresholdMs = numberEnv('EVENT_LOOP_STALL_LOG_MS', 200);
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const stallMs = now - lastTick - 100;
    if (stallMs >= stallThresholdMs) console.log(`[publisher-widget] event_loop_blocked durationMs=${stallMs}`);
    lastTick = now;
  }, 100).unref();
  server.listen(port, host, () => {
    console.log(`[publisher-widget] server listening host=${host} port=${port} environment=${environment} analyticsStore=${analyticsStoreMode}`);
    // Load catalogues (and so start background index builds) before the first visitor needs them.
    if (process.env.PUBLISHER_CATALOGUE_PREWARM === 'false') return;
    const startedAt = Date.now();
    app.prewarmCatalogues()
      .then((publishers) => console.log(`[publisher-widget] catalogue_prewarm_complete publishers=${publishers.join(',') || 'none'} durationMs=${Date.now() - startedAt}`))
      .catch((error) => console.error(`[publisher-widget] catalogue_prewarm_failed error=${error instanceof Error ? error.name : 'unknown'}`));
  });
}

void start();
