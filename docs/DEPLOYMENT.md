# Production deployment

## Recommended shape

Deploy the static Vite output and the Node-capable server from the same product domain:

```text
product-domain/widget.js
product-domain/demo/
product-domain/dashboard/
product-domain/api/...
```

The recommended starting point is a Node 22+ service running `node server-entry.mjs`, optionally behind a CDN/reverse proxy. The server composition is in [`src/server/production.ts`](/Users/lucadominguez/publishing%20widget/src/server/production.ts); it reuses the publisher proxy, AI proxy, analytics ingestion, storage interface, CORS, rate limiting, request IDs and health handlers.

For Render, use `npm run build` as the build command and `node server-entry.mjs` as the start command. There is currently no `render.yaml` in this repository, so the Render service command is configured in the Render dashboard. Do not use `node dist/server.mjs`, `npm run build:server`, or `npm run dev` as the production start command; those paths do not run the static frontend server.

## Required services

- Node-capable web service for `server-entry.mjs`.
- Static asset/CDN hosting for `dist/widget.js`, `dist/index.html`, `dist/admin.html`, `dist/assets/` and `dist/embed-test.html`.
- Production relational database implementing analytics, reports and the publisher store, using all migrations in `db/migrations/`.
- Server-side publisher API credentials and, only if approved, an AI provider credential.
- TLS termination, request logging/monitoring and a secrets manager.

The default `MemoryAnalyticsStore` is development-only. `server-entry.mjs` automatically creates a bounded `pg` pool when `DATABASE_URL` is present and injects `PostgresAnalyticsStore`; without it, production readiness is intentionally not ready.

## Build and run

```bash
npm ci
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=8787 node server-entry.mjs
```

`npm run build` typechecks the project, builds the demo frontend, admin frontend, widget bundle and `dist/server.mjs`, then asserts that the production artifacts exist. `npm start` performs the same build and starts `server-entry.mjs`.

Before starting a production instance, run `npm run db:migrate`, then `npm run analytics:check`. Migration `003_publishers.sql` creates the persistent publisher control-plane table `004_publisher_catalogue_snapshots.sql` stores normalized catalogue snapshots used across restarts, and `005_report_content_provenance.sql` adds nullable `summary_source` and `summary_fallback_reason` columns to `reports`. `006_report_theme_descriptions.sql` adds the nullable `theme_descriptions_json` column (AI-written theme card lines); apply it before deploying code that writes it, or report saves fail. `007_catalogue_snapshot_chunks.sql` adds `publisher_catalogue_snapshot_chunks` and a nullable `chunk_count` column: catalogue snapshots are stored as compact chunks of 500 articles, so writing or reading one never holds the whole catalogue as a single string. Apply it before deploying; without it snapshot saves fail (the catalogue still loads from the feed). The first refresh after deploy rewrites the old single-row snapshot as chunks. The server logs `heap_usage` (heapUsedMb, heapTotalMb, rssMb, externalMb) every 60 seconds and after each catalogue stage (snapshot_hydrated, source_loaded, index_prebuilt, snapshot_saved). The server uses `DB_POOL_MAX`, `DB_POOL_MIN` (connections kept warm, default 2), `DB_CONNECTION_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS` and `DB_STATEMENT_TIMEOUT_MS`, and logs `db_connection_opened` whenever a new database connection is created; SIGTERM/SIGINT close the HTTP server and database pool cleanly. Set `TRUSTED_PROXY=true` only when a known reverse proxy overwrites `x-forwarded-for`; otherwise forwarding headers are not used for rate-limit identity.

## Environment

Required values depend on the publisher. Persist only a `secretRef` in the publisher manifest, for example `env:ACME_API_TOKEN`, and provide `ACME_API_TOKEN` to the server environment. Use `PUBLISHER_CACHE_TTL_MS` to tune publisher manifest cache freshness. The current generic real-publisher compatibility variables are documented in `.env.example`.

Never pass API keys through Vite, `PublisherManifest`, browser configuration, analytics, request IDs or logs. `AI_API_KEY` and publisher tokens are server-only.

## Routes

- `GET /health` returns version and environment only.
- `GET /ready` and `/readiness` return deployment readiness; production requires the Postgres analytics mode.
- `GET /api/publishers/:publisherId/health` reports registration and non-secret server configuration status.
- `GET /api/publishers/:publisherId/search` proxies approved publisher search requests.
- `POST /api/ai/intent`, `/api/ai/rerank`, `/api/ai/explain` proxy enabled AI operations.
- `POST /api/analytics/events` validates and stores safe events.
- `GET /api/analytics/:publisherId/overview` returns a publisher-scoped report.
- `POST /api/reports/generate` creates a tenant-scoped professional briefing.
- `GET /api/generations/:id/status` provides the async-compatible generation boundary.
- `GET /api/reports/:id` reloads a persisted report without regeneration.
- `GET /admin` and `/admin/` serve the internal admin frontend; `/api/admin/*` remains server-authenticated.
- `POST /api/admin/publishers` creates a persistent publisher.
- `PATCH /api/admin/publishers/:publisherId/config` persists branding, origins, enable state and content source configuration.
- `POST /api/admin/publishers/:publisherId/content-check` checks saved configuration, or a supplied draft before saving.
- Hosted routes `/p/:publisherId/generate/:generationId` and `/p/:publisherId/:reportId` render the branded generation/report experience.

All public API requests receive request IDs, security headers and route-class rate limits. Production CORS requires an exact configured publisher origin; unrestricted `*` access is not used. Localhost origins are accepted only in development/test modes.

## Database and retention

Apply migrations in order before enabling production analytics, reports and publisher administration. Migration `002_reports.sql` adds tenant-scoped reports and recommendations with JSONB versioned profile/retrieval data. Migration `003_publishers.sql` stores the public publisher manifest and secret references; it never stores secret values. Migration `004_publisher_catalogue_snapshots.sql` stores normalized, tenant-scoped catalogue snapshots; it contains article metadata only and is bounded by the runtime catalogue limit. The event table is indexed by publisher/time, publisher/event and publisher/article. Raw events and derived daily/article/topic aggregates should receive separate retention policies later; no automated deletion job is included in this phase.

## Static caching and rollback

Keep the embed URL stable (`/widget.js`) and use its short cache with `stale-while-revalidate`; hashed `/assets/` files are immutable. The health response can include `COMMIT_SHA`, while the widget version remains in the bundle. Roll back by restoring the previous `dist/` artifact and server image, then invalidate only the affected CDN keys. Migrations are forward-only and must not be reset as part of rollback.

## Verification

```bash
npm run ci
npm run release:check
npm run db:migrate
npm run analytics:check
npm run ai:check
npm run publisher -- demo
npm run publisher:check -- real-publisher
curl https://discovery.ldsystems.uk/health
```

For a configured live publisher, run `npm run publisher -- publisher-id`. It performs one bounded search, validates that a supported result array is present and prints no response body or secret. Verify success, 401/403, 404, 429, 5xx, timeout and malformed JSON with staging fixtures before changing the manifest to production.

For a new production deployment, use this order:

```text
npm ci
npm run build
npm run db:migrate
NODE_ENV=production node server-entry.mjs
```

After deployment, sign in at `/admin`, create or update the publisher, run a draft content check, save the manifest, and verify that the generated absolute embed snippet points to the deployed `/widget.js` URL.

## Production limitations

IBI News and SGI Europe are configured as named production publishers through their public bounded content sources. The generic `real-publisher` definition remains available for a future authenticated integration. Production database credentials, AI credentials, deployment account configuration and approved publisher origins are deployment inputs rather than committed project data.
