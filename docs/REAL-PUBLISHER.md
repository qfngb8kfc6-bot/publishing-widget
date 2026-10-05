# First publisher integration status

The registered `real-publisher` adapter is a safe generic integration scaffold, not a claim about an undocumented external API. It supports configurable base URL, search/article endpoints, query names, pagination, candidate limits, timeout and server-proxy authentication.

Before enabling a named publisher, replace the generic mapping only with fields confirmed by that publisher's API documentation:

- publisher name and ID
- API base URL and authentication method
- search endpoint, pagination and rate limits
- query/category mappings
- response envelope and raw field types
- canonical article URL, image, date, author, category/tag and snippet fields
- empty-result and error semantics
- approved widget origins and result-link policy

Unknown fields must remain optional and malformed records must be skipped by the normalizer. Add a sanitized fixture and shared contract test before registering the production manifest. Do not put credentials or private payloads in fixtures.
