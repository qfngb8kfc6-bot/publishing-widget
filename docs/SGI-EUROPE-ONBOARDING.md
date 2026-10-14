# SGI Europe onboarding

## Tenant

- Stable publisher ID: `sgi-europe`
- Display name: `SGI Europe`
- Approved widget origins: `https://www.sgieurope.com` and `https://sgieurope.com`

## Content source

SGI Europe uses its public RSS feed as the primary source:

```text
https://www.sgieurope.com/9871.rss?adredir=1
```

The source is restricted to the SGI Europe hostnames, accepts a maximum 20 MiB
feed document, parses all valid feed items, removes duplicate GUIDs/canonical
URLs, sorts the normalized articles newest-first, and bounds downstream
candidate retrieval at 100 articles before the existing ranking pipeline runs.
The adapter supports RSS media in this order: `media:content`, `enclosure`,
then `media:thumbnail`. It also maps SGI's `abacus:byline` and derives a
human-readable section from the first URL path segment.

The integration does not use the retired Webvision storylistpagination API,
does not require an API key, and does not scrape article pages.

## Production onboarding

1. Deploy the build containing the `sgi-europe` registry definition.
2. Apply pending migrations with `npm run db:migrate`; this onboarding does
   not add a new schema migration.
3. Sign in at `/admin` and create or save the `sgi-europe` publisher. The
   production Postgres publisher store is authoritative; source files are the
   safe fallback for development and tests and do not automatically overwrite
   an existing production row.
4. Save the following content source values in the publisher configuration:
   - type: `rss`
   - feed URL: the URL above
   - allowed hostnames: `www.sgieurope.com`, `sgieurope.com`
   - candidate limit: `100`
   - maximum bytes: `5000000`
   - source name: `SGI Europe RSS feed`
5. Save the approved origins and branding, then run **Run saved check**.
6. Confirm the check reports a reachable RSS source, accepted records,
   duplicate/rejection counts, coverage and sample SGI Europe titles.
7. Use **Generate test briefing** with a company and role, open the report,
   test **Find stories**, and verify analytics are scoped to `sgi-europe`.

## Embed

```html
<script src="https://discovery.ldsystems.uk/widget.js" data-publisher="sgi-europe" defer></script>
```

The embed must be placed on one of the saved approved origins. No private
credential is placed in the browser bundle or publisher manifest.

## Local verification

```bash
npm run publisher:content-check -- sgi-europe
```

The repository includes sanitized RSS fixtures covering SGI namespace/CDATA,
media fallbacks, bylines, duplicate records, malformed entries and missing
optional fields. Live checks print only safe health metadata and sample titles.
