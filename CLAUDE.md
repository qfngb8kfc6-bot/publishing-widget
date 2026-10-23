# LD Systems — publisher content discovery (handover)

Multi-tenant SaaS: a reader enters their company (name or URL) and job title, and gets a personalised
briefing of a publisher's own articles (summary, ranked stories with "why this matters", theme cards with
"Find stories"). Hosted at https://discovery.ldsystems.uk (also an embeddable widget). Repo:
qfngb8kfc6-bot/publishing-widget.

## Working rules
- Work only on branch `claude/keen-darwin-6i5lk3`. Never push to main; the owner merges via PRs. After a
  merge, restart the branch from main: `git checkout -B claude/keen-darwin-6i5lk3 origin/main`.
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
- Scripts: `npm run rank:sample` (ranking samples), `npm run sample:briefings`, `npm run db:migrate`.

## Report pipeline (generate.ts)
1. Resolve company (name or URL) → company context.
2. `buildProfessionalProfile` (role rules; dedicated vs generic roles). AI enrichment runs as two parallel
   calls — main profile + subject vocabulary (generic titled roles) — each under the 5 s AI cap; only a
   complete result is cached 24 h; a failed/partial one is retried once in the background (`enrichment_retry`).
3. Catalogue from cache (warm-up in parallel) → archive-wide preselection with the professional scorer (same as
   theme search) to ≤100 candidates → deterministic ranking.
4. AI rerank (compact `{id, score, weak}`), hybrid blend; weak fits removed (min 3 kept).
5. Content calls A (summary + first 7 explanations + theme card lines) and B (rest), in parallel.
6. Own-company articles held to ~60% when alternatives pass the threshold; sections; transactional persist;
   analytics in the background.
- Generic roles ("Head of Sustainability", "Head of Legal") are anchored on their title subject: only
  subject concepts are direct; leadership words (strategy, finance, growth…) are adjacent at most.
- Theme cards (`themes.ts`): up to 4 distinct subtopics chosen at generation (near-synonyms rejected by word
  form, concept family or shared report articles) and stored as `professionalProfile.themes`.
- Angles come from a fixed list of 15 (`src/ai/angles.ts`); a collaboration/launch is never a leadership move.
- Key logs: `ai_performance` (per call, `aiOperation`, tokens, finish reason), `ai_explanation_rejected`,
  `ai_quality_warning`, `weak_fit_removed`, `own_company_share`, `report_performance`, `theme_performance`,
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

## Deployment
- Render, 1 CPU / 2 GB RAM, `NODE_OPTIONS=--max-old-space-size=1536`. Supabase Postgres via `DATABASE_URL`.
- `npm start` = build + `node server-entry.mjs`. Migrations are expected to run on start via Render's start
  command (`npm run db:migrate` is not part of `npm start` in this repo — keep that Render setting). Apply a
  new migration before code that uses it (latest: `009_publisher_article_texts.sql`, required before enabling WVC full text).
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
- Diagnose the occasional deterministic explanation fallback (pull `ai_performance` part A/B and
  `ai_explanation_rejected` for the request); consider adding `part` to `ai_explanation_rejected`.
- Theme results have no AI explanations yet (the "why" box is hidden for them).
- Scorer's 5-character prefix match causes rare false positives ("investigation" ~ "invests").
- WVC full text: run the backfill in production, confirm `heap_usage`, then compare real before/after top 8 with
  `DATABASE_URL=… npm run rank:sample`.
