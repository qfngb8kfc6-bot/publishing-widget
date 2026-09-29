# Publisher onboarding

Adding a publisher is intentionally an adapter/configuration task. The universal widget, normalized article model, deterministic ranking, explanations and UI do not change.

## 1. Scaffold

```bash
npm run publisher:create -- acme-media
```

The command validates a unique kebab-case id and refuses to overwrite an existing directory. It creates `config.ts`, `adapter.ts`, `normalizer.ts`, `types.ts` and a README under `src/publishers/acme-media/`.

## 2. Complete the manifest

Set the publisher name, branding, questions, result/candidate limits, adapter id, environment, feature flags, version and optional allowed origins. Keep the candidate limit higher than the displayed result limit. Use `environment: 'production'` only after the server route and credentials are ready.

Branding assets should be HTTPS URLs controlled by the publisher or host asset pipeline. The widget accepts only HTTP(S) image URLs and the host should enforce its normal CSP/image allowlist; avoid inline data or arbitrary script-like URLs.

## 3. Implement the adapter and normalizer

`search()` translates the existing structured intent into publisher-specific query parameters and retrieves 30–100 candidates. `normalizeArticle()` must return the shared `NormalizedArticle` shape or `null` for malformed records. Raw API fields must not escape the adapter/normalizer directory.

Use `src/publishers/real-publisher/` as the working example and add sanitized response fixtures under `<publisher>/fixtures/`. A fixture must never contain credentials or private article data.

## 4. Protect credentials

Use the server route `/api/publishers/:publisherId/search` and keep private keys in the server process. Environment names follow `PUBLISHER_<ID>_API_KEY`, `PUBLISHER_<ID>_BASE_URL`, `PUBLISHER_<ID>_SEARCH_ENDPOINT`, `PUBLISHER_<ID>_ARTICLE_ENDPOINT` and `PUBLISHER_<ID>_TIMEOUT_MS`. Call `validatePublisherServerConfig()` during server startup for production server-proxy manifests.

`src/server/real-publisher-proxy.ts` is a platform-neutral example. Mount it in the host server, add rate limiting and use `allowedOrigins` when the deployment needs origin restrictions. Origin allowlisting is an additional boundary; it is not a replacement for authentication.

## 5. Register the publisher

Add one entry to the definitions array in `src/publishers/registry.ts`, using `registry.registerManifest(manifest, adapter, explanationProvider)`. The registry validates the manifest, prevents duplicate ids and confirms the adapter id matches. Do not import `_template` into the registry.

## 6. Verify

```bash
npm run publisher:check -- acme-media
npm test
npm run typecheck
npm run build
npm run publisher:embed -- acme-media
```

The health command performs a source/fixture/placeholder check without reading or printing secrets. Host deployments should additionally execute a live request against the server route with a staging credential and verify timeout, authentication, rate-limit and malformed-response behavior.

## 7. Embed

```html
<script src="https://YOUR-WIDGET-HOST.example/widget.js" data-publisher="acme-media" data-position="bottom-right"></script>
```

Supported attributes are `data-publisher`, `data-position="bottom-right|bottom-left"` and development-only `data-debug="true"`. The loader mounts one instance per page and the element exposes `destroy()` for host-controlled teardown. The widget may be mounted programmatically more than once when the host explicitly owns those instances.

## Production readiness checklist

- [ ] Manifest uses the intended publisher id, version and production environment.
- [ ] Server proxy owns all private credentials; `dist/widget.js` contains no token or provider key.
- [ ] Search retrieves more candidates than the display limit and passes them through core ranking.
- [ ] Normalizer safely skips missing id/title/URL records and preserves provenance.
- [ ] Sanitized fixture and shared publisher contract test pass.
- [ ] Live staging health check covers success, timeout, 401/403, 429 and invalid JSON.
- [ ] Rate limiting, timeout, CORS/origin policy, CSP and asset URL policy are reviewed by the host.
- [ ] Analytics events include publisher id and widget/config versions without answer text or secrets.
- [ ] Production build has no demo preview toolbar, mock AI activation or fixture registration.
- [ ] Embed snippet has the correct publisher id and no `data-debug` attribute.
