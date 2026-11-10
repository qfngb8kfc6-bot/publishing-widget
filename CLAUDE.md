# LD Systems — publisher content discovery (handover)

Multi-tenant SaaS: a reader enters their company (name or URL) and job title, and gets a personalised
briefing of a publisher's own articles (summary, ranked stories with "why this matters", theme cards with
"Find stories"). Hosted at https://discovery.ldsystems.uk (also an embeddable widget). Repo:
qfngb8kfc6-bot/publishing-widget.

## Working rules
- Create a new `claude/<task>` branch from main for each task (`git fetch origin main && git checkout -b
  claude/<task> origin/main`); never push to main; the user merges via PRs.
- One commit per task, clear messages. Report per commit with before/after evidence, then stop.
- Run `npm run release:check` (lint, typecheck, tests, build, secret scan) once at the end of a batch, plus
  `git diff --check` and `npm run build:server` before pushing.
- Never lower relevance thresholds to make results appear. Never "simplify" security to pass a test.
- Ranking changes must be proven: before/after top results, dedicated roles unchanged unless intended.
- No model identifiers in commits, PRs or code comments.

## Security rules (non-negotiable)
- Publisher credentials live server-side only, referenced by `secretRef`; never in manifests, logs or client.
- Never ask the owner to paste API secrets. WVC keys were exposed in old chats: treat them as compromised,
  never print/recover/reuse them; rotate before any WVC work.
- Strict origin allowlists, tenant isolation, SSRF protection with private-IP rejection, rate limits,
  request IDs, platform origin from config (never Host-derived).
- AI only references supplied article IDs (aliased a1, a2… and mapped back); never invents articles.
  Prompt-injection defence: external text is data, never instructions. Never log AI text or prompts.
- Production logs are whitelisted (`src/server/logging.ts`); add new diagnostic messages there deliberately.

## Architecture and key files
- Stack: TypeScript, Vite, Vitest (jsdom for UI tests), Node server (`server-entry.mjs` + `dist/server.mjs`),
  pg Pool on Supabase Postgres, hosted on Render.
- `src/server/production.ts` — app factory: routes, stores, AI provider, catalogue cache wiring, health.
- `src/server/report-routes.ts` — generate, report lookup, theme search (`POST /api/reports/:id/themes/:theme/search`).
- `src/reports/generate.ts` — report pipeline (see below); `themes.ts`, `sections.ts`, `relationship.ts`.
- `src/reports/catalogue-cache.ts` — per-publisher catalogue cache, background work queue, index prebuild.
- `src/reports/catalogue-snapshot.ts` — compact chunked snapshots in Postgres (500 articles per chunk).
- `src/core/professional.ts` — role analysis, profile building, generic-role subject anchoring.
- `src/core/relevance.ts` — deterministic scorer, weights, thresholds (do not lower).
- `src/ai/` — provider (`providers/openai-compatible.ts`), prompts, validation, angles, content quality.
- `src/hosted.ts` — hosted report UI (browser code: never import server modules into it).
- `src/hosted-loading.ts` — hosted loading page (`/p/:publisherId/generate/:id`): polls `/api/generations/:id/status`
  (~600 ms), real stages, weighted creeping progress, Retry/Edit. `src/reports/generation-jobs.ts` — async job status.
- `src/publishers/` — manifests, adapters (`content/adapters.ts`), runtime registry, per-publisher folders.
- `db/migrations/` — numbered SQL migrations; `db/schema.sql`. Docs in `docs/` (DEPLOYMENT, SECURITY, …).
- Scripts: `npm run rank:sample` (ranking samples), `npm run wvc:compare` (SGI current vs WVC API-only, side-by-side HTML), `npm run sample:briefings`, `npm run db:migrate`,
  `npm run wvc:check` (read-only WVC last-page diagnostics; counts only).

## Report pipeline (generate.ts)
1. Resolve company (name or URL) → company context.
2. `buildProfessionalProfile` (role rules; dedicated vs generic roles). AI enrichment runs as two parallel
   calls — main profile + subject vocabulary (generic titled roles) — each under the 5 s AI cap; only a
   complete result is cached 24 h; a failed/partial one is retried once in the background (`enrichment_retry`).
3. Catalogue from cache (warm-up in parallel) → archive-wide preselection with the professional scorer (same as
   theme search) to ≤100 candidates → deterministic ranking.
4. AI rerank (compact `{id, score, weak}`), hybrid blend; weak fits removed (min 3 kept).
5. Content calls in parallel, each ≤ ~350 output tokens under its own 5 s cap and fallback: S (summary +
   citedArticleIds + theme card lines) and E1..En (explanations, ≤4 articles per batch, ≤4 batches; ≤5 calls).
6. Own-company articles held to ~60% when alternatives pass the threshold; sections; transactional persist;
   analytics in the background. Market context: a report always has ≥2 stories not naming the reader's company
   when any score ≥ `RELAXED_MARKET_FLOOR` (threshold − 15 = 9; report threshold unchanged). Candidates (named
   competitors, then same sector, then score) ride in the E batches like reserves and join only with an accepted
   AI "why", displacing the lowest own-company stories; only then may own share pass 60% (`nonOwnCompanyRelaxed`).
   Own-company story (`isOwnCompanyStory`, `relationship.ts`): the company (entered/resolved name, without legal
   form, or domain label) is the subject — whole word in the headline (not "Nike supplier…"), or the actor in the
   excerpt's first sentence (first 5 words, not after "of/for/with…"). Checked before supplier/partner words.
- Executive roles (`isExecutiveTitle`: CEO, MD, GM, founder, president, COO, CFO; not VP) get `role.executive` and
  `EXECUTIVE_MARKET_CONCEPTS` (results, trading, revenue, profit, investors, acquisition, expansion, sales…, source
  `market`): direct only when the story shows the company's sector (a company concept or named peer), else adjacent.
  The rerank intent carries `executive: true`; the S and E content calls get `reader.executive` and the EXECUTIVE READER
  rule (competitor/peer results, strategy and market data are never weak for being about another company).
  `own_company_share` also logs `nonOwnCompanyRerankWeak`.
- Executives after the content calls (`keepMarketWeakFits`): weak-fit removal never leaves <2 market stories nor own
  >60% while removed market stories exist; the best stay as lower confidence. Restore order (all roles): market
  candidates (relaxed, accepted "why") before own-company reserves; only executives let relaxed candidates and then
  remaining market weak fits fill a thin report's places, and own-company stories are then trimmed to 60%
  (≥2 market stories, ≥3 stories). Other roles take relaxed candidates only for the two-story floor (unchanged).
- Generic roles ("Head of Sustainability", "Head of Legal") are anchored on their title subject: only
  subject concepts are direct; leadership words (strategy, finance, growth…) are adjacent at most.
- Theme cards (`themes.ts`): up to 4 distinct subtopics chosen at generation (near-synonyms rejected by word
  form, concept family or shared report articles) and stored as `professionalProfile.themes`.
  Each theme's supporting report stories are stored as `professionalProfile.themeArticleIds` (the S call's
  `themeDescriptions[].articleIds`, else stories naming the theme); themes with none are hidden. Focused reading
  shows those stories first (`briefingRecommendations`, by score), then on-theme archive results.
  Procurement family (procurement, suppliers, vendors, sourcing, purchasing; exact word forms, so "supply chains"
  stays separate): a second member is chosen only if its own stories clearly differ, and cards merge when ≥75%
  of their supporting stories are shared.
- Card labels (`src/hosted.ts`): only Top developments, Companies to watch, Market moves; other section ids
  (e.g. the old "More relevant stories") show no label.
- Explanations that restate the headline/excerpt (>5 consecutive words or ≥70% content-word overlap) are
  regenerated once (part R); still restated → fallback with the "why" box hidden (`explanationRestated`).
- Own-company stories carry `ownCompany:true` in the AI content payload (with `reader.company`); the summary and
  explanations frame them as your company / your team. An own-company "why" with singular competitor/rival wording is
  regenerated once in part R (`own_company_misframed`); still misframed → first-sentence fallback.
- A theme whose AI line says no article covers it ("No supplied article directly addresses regulation") is dropped
  at generation (`theme_unsupported_dropped`) and hidden by `reportThemes` on older reports.
- Role titles are displayed with `displayRoleTitle` (`src/core/role-title.ts`): CEO, CFO, VP, HR, ESG… stay capitals.
- Logo-like story images (≥2.4:1, a "logo" file name, mostly white or white edges) get `is-logo`: contain on a tint.
  Server side (`src/reports/image-probe.ts`): at generation the first 64 KB of each story image is read (Range GET,
  1.5 s timeout, allowlisted hosts only: manifest `imageHostnames`, else the content source hosts plus its
  `imageHostnames` — SGI: `"imageHostnames": ["d1f00kj7ad54bu.cloudfront.net"]` in the admin Content source JSON; cached per URL)
  and wide / transparent or palette PNG / GIF / SVG / logo-named images get `rankingMetadata.imageIsLogo`. Probes
  run alongside the AI calls and are waited on ≤300 ms; on failure the browser check applies as before.
- Company typo hint: `GET /api/publishers/:id/company-suggestion?company=` (`src/reports/company-suggestion.ts`, cached
  catalogue only) → "Did you mean Nike?" under the company field of the widget, edit forms and admin Test report; never blocks.
- Angles come from a fixed list of 15 (`src/ai/angles.ts`); a collaboration/launch is never a leadership move.
- Key logs: `ai_performance` (per call, `aiOperation`, tokens, finish reason), `ai_explanation_rejected`,
  `ai_quality_warning`, `weak_fit_removed`, `duplicates_collapsed`, `explanation_fallback` (articleId, part, rejectReason: weak_kept / not_returned_kept / batch_failed / restated),
  `rerank_dropped` (stage report / theme / content: content-call weak or not returned), `selection_trace` (one per
  report: `articleId|stage|outcome|reason;…`, shown stories first, ≤4,000 chars, IDs and codes only),
  `explanation_restated` (articleId, part, restatedRule, outcome: regenerated / fallback), `own_company_misframed` (articleId, part, outcome), `theme_unsupported_removed`, `theme_unsupported_dropped`, `own_company_share`, `report_performance`, `theme_performance`,
  `slow_span`, `catalogue_refresh_complete`, `index_prebuild_complete`, `heap_usage`.

## Publishers
- **SGI Europe** (`src/publishers/sgi-europe`): RSS `https://www.sgieurope.com/9871.rss?adredir=1`, ~11.5k
  articles, ~13–14 MB, `maxBytes` 20 MB, 8 s timeout. Section labels come from URLs only for
  section/slug/id paths (≤4 words), else the feed's `<category>`, else no label.
- **IBI** (`src/publishers/ibi`): sitemap index `https://www.ibinews.com/GoogleSiteMapIndex.aspx`
  (`maxUrls` 100); see `docs/IBI-ONBOARDING.md`.
- **SGI full text via WVC** (enrichment alongside RSS, `src/publishers/content/wvc.ts`,
  `src/reports/text-enrichment.ts`, `article-texts.ts`): `GET /abaapi/storylistpagination/json`, header
  `API_ACCESS_TOKEN`, `profilename=Editorial%20Finder`, `pagesize` ≥ 50, `dataconstraint=4` (STORYTEXT), pages
  oldest-first, errors as HTTP 200 + `ErrorsFound`. Off unless `WVC_ENRICHMENT_ENABLED=true`; key only from
  `SGI_WVC_API_KEY`. Cleaned plain text (≤20k chars) lives in Postgres (`publisher_article_texts`, migration 009),
  joined on the numeric story code before `.article`. Backfill once (resumable), then the last 2 pages every
  30 min, each page on the catalogue queue. Matching: 1,500-char lead → `LeadMatchIndex` (24-bit hashes, ~14 MB
  for SGI); lead matches only reinforce title/metadata/body evidence. AI content call: 800-char lead per selected
  article. Public reports expose only `subscriberOnly`; body text must never reach public JSON, UI, analytics,
  logs or snapshots (`tests/full-text-privacy.test.ts`).

- **WVC API as the catalogue** (source type `wvc`, most new publishers; `src/publishers/content/wvc.ts`,
  `WvcCatalogueContentAdapter` in `content/adapters.ts`): the sync also stores title/URL/date/description (first 1–2
  sentences, ≤300 chars)/first allowed https image per story (migration 010); the catalogue is built from those rows.
  Optional `rss` supplement for images and categories. `secretRef` must be `env:*_WVC_API_KEY`. Headline field
  `HEADLINE` (absent at dataconstraint 0: story fetches always use 4, 0 only for the page-count probe).
  `showPrivateExcerpts` (default off): subscriber-only stories get no description unless the publisher opts in. Guided setup and the
  Test step (`POST /api/admin/source-test`) are in the admin; see `docs/ONBOARDING.md`. SGI stays RSS + enrichment.

## Deployment
- Render, 1 CPU / 2 GB RAM, `NODE_OPTIONS=--max-old-space-size=1536`. Supabase Postgres via `DATABASE_URL`.
- `npm start` = build + `node server-entry.mjs`. Migrations are expected to run on start via Render's start
  command (`npm run db:migrate` is not part of `npm start` in this repo — keep that Render setting). Apply a
  new migration before code that uses it (latest: `010_publisher_article_catalogue.sql`, required before creating a WVC-catalogue publisher; `009` before enabling WVC full text).
- Startup prewarms catalogues (snapshot hydrate → refresh if stale → index prebuild → snapshot save, one job at
  a time) and logs `heap_usage` every 60 s.

## Memory budget
- Steady state ≈ 85 MB per SGI-sized publisher (11.5k articles): catalogue ~40 MB + match indexes ~43 MB.
  With WVC full text enabled, lead indexes add ~14 MB (≈2 MB JS heap + ≈12 MB typed arrays, shown in
  `externalMb`); they are carried across catalogue refreshes, so they add no refresh peak.
- A refresh adds ~60–75 MB temporarily; refreshes, prebuilds and snapshot writes are serialized across all
  publishers, so only one transient peak at a time. Base process ~20 MB.
- SGI alone peaks ~130–170 MB (survives a 145 MB heap limit). Keep per-publisher text compact; large
  full-text stores belong in Postgres. Professional-index normalized text (~21 MB) is kept deliberately:
  recomputing it made phrase scoring 23× slower.

## Open tasks
- Confirm production `heap_usage` matches the local measurements (synthetic feed); then consider downsizing.
- AI rerank is close to the 5 s cap for some roles (e.g. nike / Head of Procurement ~4.99 s).
- Explanation fallbacks now use the article's own first sentence (never a template) and log `explanation_fallback`
  with the reason; check production for how often `weak_kept` occurs.
- Theme results have no AI explanations yet (the "why" box is hidden for them).
- Scorer's 5-character prefix match causes rare false positives ("investigation" ~ "invests").
- WVC full text: run the backfill in production, confirm `heap_usage`, then compare real before/after top 8 with
  `DATABASE_URL=… npm run rank:sample`.
