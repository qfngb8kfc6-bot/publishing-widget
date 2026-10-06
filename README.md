# Publisher Content Discovery Widget

Reusable, multi-tenant professional intelligence for publishers. The repository contains a compact company + role embed, hosted generation/report routes, the configurable `real-publisher` adapter, an optional provider-independent AI layer, typed publisher manifests and onboarding tooling. AI is an enhancement, never the source of publisher articles and never a requirement for serving a report.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The demo host page is intentionally plain so the widget can be checked against a non-React, non-Next host.

```bash
npm test
npm run typecheck
npm run build
```

The production build emits the demo site in `dist/` and a self-contained `dist/widget.js` bundle. A publisher can embed the demo bundle with:

```html
<script src="https://our-domain.example/widget.js" data-publisher="demo"></script>
```

The bundle mounts a `<content-discovery-widget>` custom element and uses Shadow DOM to keep widget styles and markup isolated from the host page.

The demo page can select a registered adapter without changing widget code:

```text
http://localhost:5173/?publisher=demo
http://localhost:5173/?publisher=real-publisher&debug=1
http://localhost:5173/?publisher=demo&debug=1
```

## Architecture

The universal layers live under `src/core/`:

- `PublisherConfig` describes publisher branding, content limits and result presentation. Its optional questionnaire schema is retained only for temporary compatibility with older service consumers and historical data.
- `PublisherAdapter` is the boundary around publisher search APIs. It exposes `search`, optional `getArticle`, and `normalizeArticle`.
- `NormalizedArticle` is the universal format used by ranking and the UI. The demo adapter converts its raw article shape into this format.
- `ProfessionalProfile` and `RetrievalConcepts` are the primary intent model. Hosted generation builds a deterministic foundation, optionally enriches it server-side with the configured AI provider, retrieves candidates, applies deterministic-first hybrid ranking and persists report recommendations with grounded explanations.
- `rankArticles` is deterministic and provider-free. It scores title, description, category, tags, content snippet, audience/persona and interest matches. The interface can later be replaced or augmented by an embedding/LLM reranker.
- `AnalyticsClient` receives non-sensitive events with publisher ID, session ID and timestamp. `MemoryAnalytics` is useful in tests; `ConsoleAnalytics` is the Phase 1 default.
- `DebugSink` is an optional development-only callback. It reports structured intent, the generated publisher request, candidate count, normalized article summaries, scores/signals and final IDs. It is not connected to the production embed.
- `RecommendationService` remains a compatibility foundation for older provider consumers. The public embed never invokes it; the hosted report pipeline owns the professional journey and reuses the shared AI provider interfaces directly.

The UI in `src/widget/` is framework-agnostic TypeScript. It handles only the compact launcher, company/role form, validation/error state, responsive layout, keyboard focus, Escape-to-close and reduced-motion preferences. Hosted pages own generation progress and report rendering.

## Adding a publisher

The supported onboarding path is documented in [docs/ONBOARDING.md](/Users/lucadominguez/publishing%20widget/docs/ONBOARDING.md). Start with:

```bash
npm run publisher:create -- acme-media
npm run publisher:check -- acme-media
npm run publisher:embed -- acme-media
```

Onboarding another publisher requires a manifest/configuration and adapter rather than a widget fork:

1. Create a `PublisherManifest` with its own professional briefing branding and content limits.
2. Implement `PublisherAdapter<RawArticle>` and keep credentials/server-only API calls outside the browser bundle.
3. Register the pair with a `PublisherRegistry`, alongside an `ExplanationProvider`.
4. Pass the registry and publisher ID to `mountWidget`; the embed always collects company website and job role.

`PublisherManifest` adds environment, version, feature, ranking, API and origin metadata. `PublisherRegistry.registerManifest()` validates it and refuses duplicate publisher ids. The `_template` directory is compile-safe but never registered.

For a private publisher API, the adapter should call a server-side proxy. Do not put API keys in `widget.js` or expose them in publisher configuration.

## Demo content and behaviour

`src/demo/articles.ts` contains 19 mocked articles with publisher URLs, images, dates, authors, categories, tags and snippets. The demo scenarios use realistic company + role pairs and run through the same hosted generation/report flow as the public embed.

The result URL is always copied from a normalized article returned by the adapter. The widget does not synthesize article titles or URLs.

## Professional briefing experience

The public journey is `company website + job role → hosted generation → persisted report`. Publisher-controlled radius, background treatment, logo, colors and copy are optional configuration values with safe product defaults. Mobile uses a viewport-edge input surface with safe-area padding; desktop presents a compact floating panel.

## Optional AI intelligence

AI modules live under `src/ai/` and are provider-independent:

- `ProfessionalAIProvider` optionally enriches the deterministic company/role profile and its retrieval concepts without changing the submitted company URL, job title or deterministic role function.
- `RerankingProvider` receives only a shortlist of genuine normalized publisher candidates and returns structured article IDs, semantic scores and concise signals.
- `AIExplanationProvider` and the professional report-content method generate grounded explanations and a report summary in one batched request for the final results. Deterministic explanations and summary remain the fallback.
- `MockAIProvider` is test-only compatibility support and is not activated by the sales or production demo.
- `HttpAIProvider` is browser-safe and talks only to our own `/api/ai` endpoint. It never receives a provider secret.
- `OpenAICompatibleProvider` is server-only and can be mounted behind `src/server/ai-proxy.ts`. It is not imported by `widget.js`.

The default hybrid weights are intentionally deterministic-first:

```text
finalScore = deterministicScore * 0.70 + semanticScore * 0.30
```

Scores are clamped to 0–100, rounded to two decimal places, and ties retain deterministic ordering. If profile/retrieval enrichment, semantic reranking, or report content generation fail validation, time out, rate-limit, or become unavailable, the service falls back to deterministic behavior. Unknown AI article IDs are discarded before ranking or rendering.

### AI configuration

The server-side configuration supports:

- `AI_ENABLED`
- `AI_PROVIDER`
- `AI_MODEL`
- `AI_API_KEY`
- `AI_ENDPOINT`
- `AI_RERANK_LIMIT`
- `AI_EXPLANATIONS_ENABLED`
- `AI_TIMEOUT_MS`
- `AI_MAX_TOKENS`
- `AI_DETERMINISTIC_WEIGHT`
- `AI_SEMANTIC_WEIGHT`

Use `createAIConfig(environment)` with server environment values. Never pass `AI_API_KEY` to `mountWidget`, `HttpAIProvider`, browser code, analytics, or publisher adapters. Provider calls should be mounted through the own-backend `createAIProxy` handler. The OpenAI-compatible implementation sends structured JSON prompts, uses temperature zero, requests JSON output, and validates every response before use.

### AI request and cost model

One normal professional journey makes at most three batched AI operations: one profile/retrieval enrichment request, one shortlist reranking request, and one final report-content request containing the summary and explanations. Reranking receives at most `AI_RERANK_LIMIT` candidates and short metadata/snippets rather than full article bodies. Explanations are requested in one batch rather than one call per article. Profile enrichment and article metadata are ready for a future cache abstraction; user-specific explanations are not globally cached.

Publisher content is explicitly delimited as untrusted reference data in the server prompt. Article text cannot change instructions, output schema, tools, authentication or article selection. Session IDs, analytics IDs, IP addresses and unnecessary personal data are not sent to AI providers.

To add another provider, implement `ProfessionalAIProvider` alongside the compatibility `AIProvider` methods, validate its structured responses through `src/ai/validation.ts`, and inject it as an `AIRecommendationLayer`. No widget, publisher adapter, ranking UI or analytics rewrite is required.

## Real publisher adapter

The first external integration lives under `src/publishers/real-publisher/`:

- `config.ts` contains publisher-facing professional briefing branding and API transport configuration.
- `adapter.ts` maps structured `Intent` to a GET request, applies a candidate limit and timeout, maps safe HTTP failures to `DiscoveryError`, extracts common response envelopes, and exposes the existing `PublisherAdapter` interface.
- `normalizer.ts` is the only place that knows raw publisher field names. It accepts common variants such as `headline`/`title`, `standfirst`/`description`, `canonical_url`/`url`, object or string sections, and object or string tags. Articles without an ID, title or URL are skipped rather than invented.
- `fixtures/search-response.ts` is a sanitized example response used by tests; tests never call the network.
- `src/server/real-publisher-proxy.ts` is a platform-neutral server handler for private-token APIs. Mount it behind `/api/publishers/real-publisher` in the host server, passing the token from server-only environment variables. The browser adapter sends no token.

The generic response contract accepts a top-level array or one of `results`, `articles`, `items`, `hits`, or nested `data` arrays. The request uses configurable query names for `q`, page and limit. The default request is equivalent to:

```text
GET /api/publishers/real-publisher/search?q=<intent>&page=1&limit=30
```

Replace the generic config, field mapping and proxy upstream route once the actual publisher API documentation is available. This is the current blocker to confirming a live external request: the brief did not identify the publisher or provide API documentation/credentials.

## Credentials and environment

Copy [.env.example](/Users/lucadominguez/publishing%20widget/.env.example) for safe routing defaults. `REAL_PUBLISHER_API_BASE_URL`, endpoint paths, query parameter names, candidate limit and timeout are configuration inputs. `REAL_PUBLISHER_AUTH_MODE=server-proxy` is the default.

Private tokens belong only in the server process, for example as `REAL_PUBLISHER_API_TOKEN`. Do not add that variable to the browser build, `src/embed.ts`, `dist/widget.js`, publisher configuration or analytics events. The built bundle contains the adapter and relative proxy route but no credential values.

For new publishers, use the scalable `PUBLISHER_<PUBLISHER_ID>_<FIELD>` server convention. See [docs/ONBOARDING.md](/Users/lucadominguez/publishing%20widget/docs/ONBOARDING.md) for startup validation, route organization, fixture contracts, origin allowlisting and the production checklist.

The proxy forwards only sanitized JSON responses and converts upstream failures to product-level status codes. It does not return upstream error bodies, tokens or stack traces.

## Production deployment

Production includes activation checks, Postgres migrations and health checks, bounded database pooling, graceful shutdown, readiness, AI cost limits, release checks, a professional-intelligence sales demo and a first-publisher launch runbook. See [docs/DEPLOYMENT.md](/Users/lucadominguez/publishing%20widget/docs/DEPLOYMENT.md), [docs/PRODUCTION-CHECKLIST.md](/Users/lucadominguez/publishing%20widget/docs/PRODUCTION-CHECKLIST.md), [docs/FIRST-PUBLISHER-LAUNCH.md](/Users/lucadominguez/publishing%20widget/docs/FIRST-PUBLISHER-LAUNCH.md) and [docs/SALES-DEMO.md](/Users/lucadominguez/publishing%20widget/docs/SALES-DEMO.md).

## Publisher analytics

Phase 6 adds a first-party analytics layer with versioned events, privacy-safe answer handling, asynchronous batching, tenant-scoped ingestion/storage, derived reports and a development dashboard. Start the seeded dashboard with:

```text
/analytics?publisher=demo
/dashboard?publisher=real-publisher&admin=1
```

The dashboard supports overview and professional-generation funnel metrics, article and recommendation-position CTR, deterministic/hybrid measurements, potential content-gap opportunities, archive discovery, UTC date filters and publisher-scoped CSV exports. Legacy interest/persona panels remain only for historical questionnaire records; new events never store raw company URLs or job titles. See [docs/ANALYTICS.md](/Users/lucadominguez/publishing%20widget/docs/ANALYTICS.md) for the event contract, ingestion route, storage boundary, retention extension point and privacy controls.

## Next production steps

- Replace `DemoPublisherAdapter` with a server-backed adapter per publisher.
- Add server-side authentication, rate limiting, timeout handling and an analytics endpoint.
- Add CSP/security review for publisher-controlled branding assets and URLs.
- Add an AI reranker or explanation provider behind the existing abstractions, retaining metadata-grounded signals and a deterministic fallback.
- Replace the generic real-publisher field mapping with the first client’s documented schema and connect the proxy to its server-side credentials.
- Connect `HttpAIProvider` and `OpenAICompatibleProvider` to a deployed own-backend route after a real AI provider key and deployment target are approved.
