# Report pipeline

`POST /api/reports/generate` accepts `{ publisherId, companyUrl, jobTitle }` and runs:

1. publisher validation
2. company URL canonicalisation and SSRF checks
3. cached company context lookup or bounded public homepage context
4. deterministic role interpretation
5. one reusable `ProfessionalProfile`
6. publisher adapter candidate retrieval
7. normalisation, deduplication and deterministic ranking
8. grounded explanations tied to normalized article provenance
9. report and recommendation persistence

The response includes a report UUID, status URL and hosted report URL. The API is synchronous today, but the generation/status boundary allows a queued implementation later without changing the embed contract.

`ReportStore` has memory and Postgres implementations. Postgres uses additive migration `002_reports.sql`, JSONB for versioned profile/retrieval data, and publisher-scoped report lookup.
