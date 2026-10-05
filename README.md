# Publisher Content Discovery Widget

Phase 5 foundation for a reusable, multi-tenant content discovery widget. The repository contains the Phase 1 demo, the configurable `real-publisher` adapter, an optional provider-independent AI intelligence layer, typed publisher manifests and onboarding tooling. AI is an enhancement, never the source of publisher articles and never a requirement for serving results.

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
http://localhost:5173/?publisher=demo&ai=mock&debug=1
```

## Architecture

The universal layers live under `src/core/`:

- `PublisherConfig` describes branding, questions, content limits and result presentation. Question rendering supports `single-select`, `multi-select` and `free-text` without hard-coding publisher questions.
- `PublisherAdapter` is the boundary around publisher search APIs. It exposes `search`, optional `getArticle`, and `normalizeArticle`.
- `NormalizedArticle` is the universal format used by ranking and the UI. The demo adapter converts its raw article shape into this format.
- `RecommendationService` creates structured intent, retrieves candidates, ranks them, and asks an `ExplanationProvider` for the grounded “Why this matches you” copy.
- `rankArticles` is deterministic and provider-free. It scores title, description, category, tags, content snippet, audience/persona and interest matches. The interface can later be replaced or augmented by an embedding/LLM reranker.
- `AnalyticsClient` receives non-sensitive events with publisher ID, session ID and timestamp. `MemoryAnalytics` is useful in tests; `ConsoleAnalytics` is the Phase 1 default.
- `DebugSink` is an optional development-only callback. It reports structured intent, the generated publisher request, candidate count, normalized article summaries, scores/signals and final IDs. It is not connected to the production embed.
- `RecommendationService` optionally receives an `AIRecommendationLayer`. When absent or disabled, its Phase 1 behavior is unchanged. When enabled, it enriches intent, retrieves publisher candidates, preserves deterministic scoring, optionally semantically reranks a shortlist, and generates batched grounded explanations.

The UI in `src/widget/` is framework-agnostic TypeScript. It handles the launcher, questionnaire, progress stages, result cards, empty/error states, responsive layout, keyboard focus, Escape-to-close and reduced-motion preferences.

## Adding a publisher

The supported onboarding path is documented in [docs/ONBOARDING.md](/Users/lucadominguez/publishing%20widget/docs/ONBOARDING.md). Start with:

```bash
npm run publisher:create -- acme-media
npm run publisher:check -- acme-media
npm run publisher:embed -- acme-media
```

Onboarding another publisher requires a manifest/configuration and adapter rather than a widget fork:

1. Create a `PublisherConfig` with its own questions, branding and content limits.
2. Implement `PublisherAdapter<RawArticle>` and keep credentials/server-only API calls outside the browser bundle.
3. Register the pair with a `PublisherRegistry`, alongside an `ExplanationProvider`.
4. Pass the registry and publisher ID to `mountWidget`.

`PublisherManifest` adds environment, version, feature, ranking, API and origin metadata. `PublisherRegistry.registerManifest()` validates it and refuses duplicate publisher ids. The `_template` directory is compile-safe but never registered.

For a private publisher API, the adapter should call a server-side proxy. Do not put API keys in `widget.js` or expose them in publisher configuration.

## Demo content and behaviour

`src/demo/articles.ts` contains 19 mocked articles with publisher URLs, images, dates, authors, categories, tags and snippets. One hybrid-propulsion story is intentionally a semantic-match fixture: it does not use the exact `sustainability` interest label, but the mock AI provider connects it to related propulsion/decarbonisation concepts. The two demo questions are configuration data in `src/demo/config.ts`.

The result URL is always copied from a normalized article returned by the adapter. The widget does not synthesize article titles or URLs.

## Consumer experience preview

Phase 4 keeps the widget framework-agnostic and moves the product experience toward a premium editorial destination rather than a chatbot. The launcher, intro, questions, staged progress view, featured best match, supporting cards, grounded explanation treatment, empty/error states and actions all remain inside the Shadow DOM.

The demo page includes development-only preview links for the major states:

```text
/?preview=intro
/?preview=question-1
/?preview=question-2
/?preview=progress
/?preview=results&ai=mock
/?preview=empty
/?preview=error
```

Publisher-controlled radius, background treatment, logo, colors, copy and article-tab behavior are optional configuration values with safe product defaults. The result UI is identical for deterministic and hybrid ranking; only the underlying ranking metadata changes. Mobile uses a viewport-edge results surface with safe-area padding, while desktop expands the results stage into a wider editorial panel.

## Optional AI intelligence

AI modules live under `src/ai/` and are provider-independent:

- `IntentEnhancer` enriches the deterministic intent with bounded primary themes, related concepts, search terms, entities and exclusions while retaining the original answers and answer-derived persona.
- `RerankingProvider` receives only a shortlist of genuine normalized publisher candidates and returns structured article IDs, semantic scores and concise signals.
- `AIExplanationProvider` generates explanations in one batch for the final results. `DeterministicExplanationProvider` remains the fallback.
- `MockAIProvider` is used by `?ai=mock` for local demonstration and tests.
- `HttpAIProvider` is browser-safe and talks only to our own `/api/ai` endpoint. It never receives a provider secret.
- `OpenAICompatibleProvider` is server-only and can be mounted behind `src/server/ai-proxy.ts`. It is not imported by `widget.js`.

The default hybrid weights are intentionally deterministic-first:

```text
finalScore = deterministicScore * 0.70 + semanticScore * 0.30
```

Scores are clamped to 0–100, rounded to two decimal places, and ties retain deterministic ordering. If intent enrichment, semantic reranking, or AI explanations fail validation, time out, rate-limit, or become unavailable, the service falls back to deterministic behavior. Unknown AI article IDs are discarded before ranking or rendering.

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

One normal hybrid journey makes at most three batched AI operations: one intent-enrichment request, one shortlist reranking request, and one final explanation request. Reranking receives at most `AI_RERANK_LIMIT` candidates and short metadata/snippets rather than full article bodies. Explanations are requested in one batch rather than one call per article. Intent enrichment and article metadata are ready for a future cache abstraction; user-specific explanations are not globally cached.

Publisher content is explicitly delimited as untrusted reference data in the server prompt. Article text cannot change instructions, output schema, tools, authentication or article selection. Session IDs, analytics IDs, IP addresses and unnecessary personal data are not sent to AI providers.

To add another provider, implement `AIProvider` (or its `IntentEnhancer`, `RerankingProvider` and `AIExplanationProvider` interfaces), validate its structured responses through `src/ai/validation.ts`, and inject it as an `AIRecommendationLayer`. No widget, publisher adapter, ranking UI or analytics rewrite is required.

## Real publisher adapter

The first external integration lives under `src/publishers/real-publisher/`:

- `config.ts` contains publisher-facing questions/branding and API transport configuration.
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

Phase 8 adds production activation checks, Postgres migrations and health checks, bounded database pooling, graceful shutdown, readiness, AI cost limits, release checks and a first-publisher launch runbook. Phase 9 adds a commercial demo page, real reader scenarios, sample publisher insights, a lightweight embed explanation and a practical [sales demo guide](/Users/lucadominguez/publishing%20widget/docs/SALES-DEMO.md). See [docs/DEPLOYMENT.md](/Users/lucadominguez/publishing%20widget/docs/DEPLOYMENT.md), [docs/PRODUCTION-CHECKLIST.md](/Users/lucadominguez/publishing%20widget/docs/PRODUCTION-CHECKLIST.md) and [docs/FIRST-PUBLISHER-LAUNCH.md](/Users/lucadominguez/publishing%20widget/docs/FIRST-PUBLISHER-LAUNCH.md).

## Publisher analytics

Phase 6 adds a first-party analytics layer with versioned events, privacy-safe answer handling, asynchronous batching, tenant-scoped ingestion/storage, derived reports and a development dashboard. Start the seeded dashboard with:

```text
/analytics?publisher=demo
/dashboard?publisher=real-publisher&admin=1
```

The dashboard supports overview and funnel metrics, structured interests/personas, article and recommendation-position CTR, deterministic/hybrid measurements, potential content-gap opportunities, archive discovery, UTC date filters and publisher-scoped CSV exports. Raw free-text answers are never stored; only `freeTextUsed: true` is emitted. See [docs/ANALYTICS.md](/Users/lucadominguez/publishing%20widget/docs/ANALYTICS.md) for the event contract, ingestion route, storage boundary, retention extension point and privacy controls.

## Next production steps

- Replace `DemoPublisherAdapter` with a server-backed adapter per publisher.
- Add server-side authentication, rate limiting, timeout handling and an analytics endpoint.
- Add CSP/security review for publisher-controlled branding assets and URLs.
- Add an AI reranker or explanation provider behind the existing abstractions, retaining metadata-grounded signals and a deterministic fallback.
- Replace the generic real-publisher field mapping with the first client’s documented schema and connect the proxy to its server-side credentials.
- Connect `HttpAIProvider` and `OpenAICompatibleProvider` to a deployed own-backend route after a real AI provider key and deployment target are approved.
