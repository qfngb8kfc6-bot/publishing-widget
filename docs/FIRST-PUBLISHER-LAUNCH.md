# First publisher launch runbook

This is the repeatable launch sequence for a named publisher. The generic `real-publisher` entry is a placeholder until the publisher supplies its documented API contract.

1. Record the publisher ID, API documentation, allowed widget origins, canonical article URL policy and result limit.
2. Complete [PUBLISHER-INTEGRATION-REQUIREMENTS.md](./PUBLISHER-INTEGRATION-REQUIREMENTS.md) without placing secrets in the form or repository.
3. Add a sanitized raw-response fixture and normalizer contract tests.
4. Configure the publisher manifest, adapter, API mapping and server proxy.
5. Set server-only API credentials in the deployment secret manager.
6. Set exact `PUBLISHER_<ID>_ALLOWED_ORIGINS` values.
7. Run `npm run publisher:check -- <publisher-id>`.
8. Run `npm run publisher -- <publisher-id>` against staging.
9. Verify successful search, empty results, malformed records, 401/403, 404, 429, 5xx and timeout behavior.
10. Build with `npm run release:check`.
11. Provision Postgres and set `DATABASE_URL` plus the pool timeout settings.
12. Run `npm run db:migrate` once against the target database.
13. Run `npm run analytics:check` and confirm its temporary check row is removed.
14. Set `HOST`, `PORT`, `TRUSTED_PROXY` and `COMMIT_SHA`.
15. If approved, configure `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_ENDPOINT`, `AI_API_KEY` and `AI_MAX_TOKENS`.
16. Run `npm run ai:check` without sending customer data.
17. Start the release with `NODE_ENV=production node server-entry.mjs`.
18. Confirm `/health` is 200 and `/ready` is 200 with `analyticsStore=postgres`.
19. Verify the standalone `/embed-test.html` page and an embed on the approved publisher origin.
20. Verify CORS preflight, request IDs, rate limits, CSP, cache headers and article links.
21. Verify the publisher-scoped dashboard and label any intentional sample data as demo seed data.
22. Monitor error logs, upstream latency, analytics writes and AI spend during a staged rollout.
23. Record the release version, commit SHA, deployment owner and rollback artifact.

Rollback means restoring the previous application/static artifact and invalidating only affected CDN keys. Database migrations are forward-only; do not reset or drop the production analytics database during an application rollback.
