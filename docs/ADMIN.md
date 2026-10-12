# Publisher administration

The internal publisher console is available at `/admin` when the application is running. It is protected by the server-side `ADMIN_PASSWORD` environment variable; there is no built-in default password. Sessions use an HttpOnly, SameSite cookie and login attempts are rate limited.

The current publisher registry is static TypeScript source. The admin console therefore supports:

- publisher-scoped registry and analytics inspection;
- server-side content checks through the configured publisher adapter;
- draft manifest validation with exact approved-origin and public-header checks;
- safe manifest export for a source-controlled change;
- the current embed snippet;
- test reports through the existing `ReportGenerationService`.

It does not write publisher configuration or create a database migration. Credentials are never entered into the browser or returned by the admin API. Content-source authentication uses a server-side `secretRef`; only that reference and whether it is configured are visible in the console.

For local development, set a password before starting the server:

```sh
ADMIN_PASSWORD='use-a-local-value' npm run dev:full
```

After exporting a validated manifest, update the relevant manifest source under `src/` and deploy the normal build. Public publisher routes, ranking, report generation and analytics semantics remain shared with the embedded experience.
