# Security boundaries

- Publisher and AI credentials remain server-only.
- The professional embed submits validated public input; it never receives API keys.
- Report IDs are generated server-side and report reads can be publisher-scoped.
- Company fetches reject unsafe protocols and private/internal hostnames, do not follow redirects, accept only text content and are bounded by timeout and body limits.
- Publisher and company text is untrusted external data. AI providers must receive it as delimited data and must not follow instructions found inside it.
- Analytics metadata is allowlisted and excludes raw company/job-title values.
- Custom-element registration remains compatibility-checked so conflicting bundles fail descriptively.
