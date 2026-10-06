# Publisher analytics

Phase 6 adds first-party, multi-tenant product analytics without cookies or cross-site identity tracking.

## Event contract

Events have `eventId`, `schemaVersion`, `name`, `timestamp`, `publisherId`, `sessionId`, `widgetVersion`, `publisherConfigVersion` and an allowlisted primitive metadata object. The primary funnel is widget impression/open → company and role entered → report requested/generation started → profile and retrieval milestones → report generated/viewed → story impression/click. `question_answered`, `search_*`, `result_impression`, `change_answers` and `restart_clicked` remain accepted only for historical questionnaire records.

The embed sends events to `POST /api/analytics/events` through `BatchingAnalyticsClient`. Events are queued, flushed periodically, and flushed immediately for story clicks, generated reports, failures and page visibility changes. Delivery is best effort; a failed request never blocks generation or hosted report navigation.

## Privacy

Company and role events emit only bounded classification metadata; raw company URLs and job titles are not analytics metadata. Historical selectable answers are represented by configured option IDs and question kind. Free-text questionnaire events emit only `freeTextUsed: true` and never store the answer, label, prompt, or a derived raw phrase. Session IDs are product-session identifiers; the system does not fingerprint users, set third-party cookies, or combine unrelated browsing data.

Publishers can disable analytics with `manifest.features.analyticsEnabled: false`. The existing abstraction also supports a future consent-gated client or an essential-only event policy without changing widget behavior.

## Ingestion and storage

Mount `createAnalyticsIngestionRoute()` at `/api/analytics/events` in the host server. It rejects non-POST requests, invalid JSON, oversized bodies, unknown event names, unsupported schema versions, malformed timestamps, disallowed metadata and unapproved publisher IDs.

`AnalyticsStore` is the database boundary. `MemoryAnalyticsStore` is used for development and seed data. A production adapter can persist the same validated `StoredAnalyticsEvent` records in Postgres, Supabase, ClickHouse, BigQuery or another approved store. Raw events and derived reports remain separate so retention can later differ: raw events may have a shorter retention period than daily/article/topic aggregates.

Every storage query requires `publisherId`, and the ingestion route can enforce an allowed publisher resolver. Dashboard reports, exports, article metrics and topic metrics are built from a tenant-filtered query. Cross-publisher totals are only available in explicit development/admin mode.

## Dashboard

Open the development dashboard at `/analytics?publisher=demo`. It includes today/7-day/30-day/custom UTC date ranges, overview metrics, professional generation funnel, daily usage, article and position CTR, deterministic/hybrid segmentation, potential content gaps, archive discovery, session metrics and CSV exports. Add `&admin=1` for the development-only internal aggregate view. Legacy interest/persona panels are retained only while historical questionnaire events are still in the store.

The dashboard states measurements factually. Small samples are not labelled as statistically better or worse ranking systems. Potential content gaps are heuristic opportunities based on professional demand, result availability and click rate, not definitive editorial instructions.

CSV exports are publisher-scoped and include daily metrics, a legacy interest export for historical data, top recommended articles and top clicked articles. The browser export is generated from the already scoped report.

## Production work remaining

- Mount the ingestion handler behind the approved server/API gateway.
- Replace `MemoryAnalyticsStore` with a production database adapter and define raw/aggregate retention.
- Add the publisher’s authentication/authorization boundary before exposing customer dashboards.
- Configure CORS, rate limits, payload logging policy and operational monitoring.
- Decide whether a consent signal should select a disabled, essential-only or full analytics client.
