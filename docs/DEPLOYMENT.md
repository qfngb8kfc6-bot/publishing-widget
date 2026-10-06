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

## Required services

- Node-capable web service for `server-entry.mjs`.
- Static asset/CDN hosting for `dist/widget.js`, `dist/index.html`, `dist/assets/` and `dist/embed-test.html`.
- Production relational database implementing `AnalyticsStore`, using `db/migrations/001_analytics_events.sql`.
- Server-side publisher API credentials and, only if approved, an AI provider credential.
- TLS termination, request logging/monitoring and a secrets manager.

The default `MemoryAnalyticsStore` is development-only. `server-entry.mjs` automatically creates a bounded `pg` pool when `DATABASE_URL` is present and injects `PostgresAnalyticsStore`; without it, production readiness is intentionally not ready.

## Build and run

```bash
npm ci
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=8787 node server-entry.mjs
```

`npm run build` typechecks the project, builds the demo frontend, widget bundle and `dist/server.mjs`. `npm start` performs the same build and starts the server.

Before starting a production instance, run `npm run db:migrate`, then `npm run analytics:check`. The server uses `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS` and `DB_STATEMENT_TIMEOUT_MS`; SIGTERM/SIGINT close the HTTP server and database pool cleanly. Set `TRUSTED_PROXY=true` only when a known reverse proxy overwrites `x-forwarded-for`; otherwise forwarding headers are not used for rate-limit identity.

## Environment

Required values depend on the publisher. Use `PUBLISHER_<ID>_API_KEY`, `PUBLISHER_<ID>_BASE_URL`, endpoint values and `PUBLISHER_<ID>_ALLOWED_ORIGINS` for scalable onboarding. The current generic real-publisher compatibility variables are documented in `.env.example`.

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
- Hosted routes `/p/:publisherId/generate/:generationId` and `/p/:publisherId/:reportId` render the branded generation/report experience.

All public API requests receive request IDs, security headers and route-class rate limits. Production CORS requires an exact configured publisher origin; unrestricted `*` access is not used. Localhost origins are accepted only in development/test modes.

## Database and retention

Apply migrations in order before enabling production analytics and reports. Migration `002_reports.sql` adds tenant-scoped reports and recommendations with JSONB versioned profile/retrieval data. The event table is indexed by publisher/time, publisher/event and publisher/article. Raw events and derived daily/article/topic aggregates should receive separate retention policies later; no automated deletion job is included in this phase.

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

## Production limitations

The first real publisher remains a generic adapter because this repository has not been given a named publisher's API documentation or credentials. Production database credentials, AI credentials, deployment account configuration and approved publisher origins are deployment inputs rather than committed project data.
