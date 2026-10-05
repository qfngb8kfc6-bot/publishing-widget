# Publisher integration requirements

Supply these values before enabling a named publisher. Secrets should be exchanged through the deployment secret manager, never in tickets, fixtures or this repository.

- Publisher name and stable publisher ID.
- API base URL and environment-specific staging/production URLs.
- Search endpoint and article/content endpoint, if separate.
- Authentication method, required headers, token audience and rotation procedure.
- Search parameter names for query, categories, keywords, page, cursor and limit.
- Maximum page size, rate limits, timeout guidance and pagination semantics.
- Raw response envelope and field types for ID, title, description, URL, image, date, author, categories, tags and snippet/content.
- Canonical URL and image-host policy.
- Empty-result, partial-result and upstream-error behavior.
- Approved embedding origins and result-link behavior.
- Whether article content may be sent to an approved AI provider; default is no full article body.
- Test credentials or a sanitized fixture that represents the documented response.

The adapter must normalize only confirmed fields. Missing optional fields remain absent, and records without a stable ID, title or URL are skipped. Browser code receives only the relative server route and normalized articles; private credentials remain server-side.
