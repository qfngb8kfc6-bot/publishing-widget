# Company analysis

Company input is normalized to an HTTPS canonical domain. Localhost, private/link-local ranges, metadata hosts, credentials and unsafe protocols are rejected before any fetch.

`CompanyContextProvider` is server-side. `SafeCompanyContextProvider` uses deterministic demo fixtures, a bounded public homepage request for unknown domains, a one-day cache, strict content-type/size limits and a graceful domain-only fallback. External website text is treated as untrusted data; it is not used as instructions and is not sent to the browser.

Role interpretation is deterministic and versioned. Company and role context are combined once into `ProfessionalProfile`, which is reused for retrieval, ranking, explanations, reporting and analytics segmentation.
