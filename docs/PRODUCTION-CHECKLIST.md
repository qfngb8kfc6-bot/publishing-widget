# Production checklist

Before cutover:

- [ ] `npm run release:check` passes in CI.
- [ ] No private `.env` files, API keys or database URLs are tracked.
- [ ] `DATABASE_URL` is provisioned and `npm run db:migrate` passes.
- [ ] `npm run analytics:check` passes.
- [ ] Publisher API staging check passes with bounded results.
- [ ] AI is disabled unless an approved provider, budget and server-only key exist; `npm run ai:check` passes when enabled.
- [ ] Exact publisher origins and TLS are configured.
- [ ] `TRUSTED_PROXY=true` is used only behind a known proxy that overwrites forwarding headers.
- [ ] `/health` and `/ready` are monitored; readiness must report Postgres in production.
- [ ] `/embed-test.html`, `/widget.js`, dashboard, CORS preflight and article links are checked from the real host origin.
- [ ] Request IDs, upstream errors, analytics failures and shutdown logs are visible without secrets.
- [ ] Previous application/static artifacts and a rollback owner are recorded.

The application can serve recommendations if analytics persistence is temporarily unavailable because analytics delivery is asynchronous. Production readiness remains failed until the Postgres store is active, so an orchestrator will not route traffic to an instance with only in-memory analytics.
