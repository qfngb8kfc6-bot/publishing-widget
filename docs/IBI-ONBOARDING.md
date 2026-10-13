# IBI News onboarding

## Tenant

- Stable publisher ID: `ibi`
- Display name: `IBI News`
- Approved widget origins: `https://ibinews.com` and `https://www.ibinews.com`

## Content source

IBI is configured through the shared bounded sitemap adapter using the sitemap index advertised by IBI's `robots.txt`:

```text
https://www.ibinews.com/GoogleSiteMapIndex.aspx
```

The index returns bounded child sitemaps such as `googlesitemap.aspx?year=2026`; article links use public `*.article` URLs. The runtime follows at most five sitemap documents and fetches at most 30 article pages per candidate retrieval, normalizes each page into `PublisherArticle`, deduplicates canonical URLs/GUIDs/IDs, and then applies the existing professional relevance and optional AI reranking pipeline. It does not load the full IBI archive or send the archive to AI.

The source is public and requires no secret reference. The repository contains sanitized fixtures for tests only; they are not production content.

## Refresh and checks

The sitemap index, bounded child sitemaps and article metadata are fetched when a bounded report retrieval or admin content check runs. Publisher manifest caching remains governed by `PUBLISHER_CACHE_TTL_MS`; no Redis or separate IBI archive cache is introduced.

Run the source inspection command:

```bash
npm run publisher:content-check -- ibi
```

For live diagnostics, sign in to `/admin`, open IBI News, and run **Run saved check**. The result reports reachability, fetched/accepted/rejected/duplicate counts, coverage, elapsed time and sample titles without displaying source headers or secrets.

## Admin workflow

1. Apply the existing database migrations; do not reset production data.
2. Sign in at `/admin`.
3. Confirm `IBI News` is listed as `ibi`.
4. Run the saved content check.
5. Use **Generate test briefing** with a company and role.
6. Open the report and test the theme-specific **Find stories** actions.
7. Use the publisher analytics link to confirm events are scoped to `ibi`.
8. Disable/re-enable the publisher from the saved configuration when required.

If the existing persisted `ibi` manifest still contains the retired `/sitemap.xml` URL, save the updated source configuration once through the admin control plane after deploying this build. This change does not mutate production Postgres automatically.

## Embed

```html
<script src="https://discovery.ldsystems.uk/widget.js" data-publisher="ibi" defer></script>
```

The initial manifest uses safe text/color fallbacks because an approved IBI logo/background asset was not supplied. Replace those values through the admin control plane once the publisher supplies approved assets.

## Environment and limitations

No IBI API key is required for the public sitemap source. The service still requires the normal production `DATABASE_URL`, admin password and deployment settings documented in `docs/DEPLOYMENT.md`.

The current source is bounded sitemap coverage rather than a full historical crawl. Subscriber-only access remains controlled by IBI; the widget only indexes fields publicly returned by the configured article pages. A verified IBI RSS URL or licensed content API can be adopted later by changing the saved source configuration through admin, without changing the core ranking or report code.
