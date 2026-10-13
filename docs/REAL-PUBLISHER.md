# First publisher integration status

IBI News is now the first named production publisher configuration. Its stable tenant ID is `ibi`; see [IBI onboarding](./IBI-ONBOARDING.md) for the source, admin workflow and embed contract.

The registered `real-publisher` adapter remains a safe generic integration scaffold, not a claim about an undocumented external API. It supports configurable base URL, search/article endpoints, query names, pagination, candidate limits, timeout and server-proxy authentication, and implements the shared content-adapter health contract.

For new source types, use the reusable adapters in `src/publishers/content/`: `RestJsonContentAdapter`, `FeedContentAdapter`, `SitemapContentAdapter`, `StaticJsonContentAdapter` and `CsvContentAdapter`. They all terminate at the canonical `PublisherArticle` model; the recommendation engine does not know which source produced an article.

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
