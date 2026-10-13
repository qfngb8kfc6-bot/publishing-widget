# Publisher administration

The internal publisher console is available at `/admin` when the application is running. It is protected by the server-side `ADMIN_PASSWORD` environment variable; there is no built-in default password. Sessions use an HttpOnly, SameSite cookie and login attempts are rate limited.

Publisher configuration is persisted by the server-side publisher store. Production uses Postgres; development and tests use an in-memory store seeded from the static demo and real-publisher manifests. The admin console supports:

- publisher-scoped registry and analytics inspection;
- server-side content checks through the configured publisher adapter;
- create and edit publisher manifests;
- persistent enable/disable state, branding, content-source configuration and allowed origins;
- draft manifest validation and content checks before saving;
- safe manifest export;
- the current embed snippet;
- test reports through the existing `ReportGenerationService`.

Credentials are never entered into the browser or returned by the admin API. Content-source authentication uses a server-side `secretRef` such as `env:ACME_API_TOKEN`; only that reference and whether it is configured are visible in the console. Raw secrets and credential-shaped headers are rejected before persistence.

For local development, set a password before starting the server:

```sh
ADMIN_PASSWORD='use-a-local-value' npm run dev:full
```

For production, apply `npm run db:migrate` before starting the server. The runtime publisher cache reloads persisted records on its TTL and is invalidated immediately after an admin save. Public publisher routes, ranking, report generation and analytics semantics remain shared with the embedded experience.
