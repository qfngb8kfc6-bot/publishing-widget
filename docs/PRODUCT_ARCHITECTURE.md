# Product architecture

Content Discovery is a multi-tenant professional-intelligence layer for publisher content.

The runtime is split into three experiences:

1. The embeddable custom element collects a company website and job role. It contains no secrets and submits only to the platform generation endpoint.
2. The hosted generation route (`/p/{publisherId}/generate/{generationId}`) provides the publisher-branded transition into a briefing.
3. The persisted report route (`/p/{publisherId}/{reportId}`) loads recommendations from stored report data. Refreshing it does not regenerate the profile or ranking.

Publisher-specific behaviour remains in manifests, adapters, normalizers and server configuration. Core ranking, profile contracts, report storage and the custom-element compatibility helper are shared.

The public production contract is the professional path. The questionnaire schema remains only as a temporary compatibility type for older adapter/service tests and historical analytics; it is not registered in the demo, real publisher, embed, loader or sales experience.
