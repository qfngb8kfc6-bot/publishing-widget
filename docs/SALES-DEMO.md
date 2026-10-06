# Sales demo guide

## Preparation

- Open the deployed demo URL on a laptop and phone-sized window.
- Confirm the compact professional briefing embed opens and the sample dashboard loads at `/analytics?publisher=demo`.
- Do not describe the demo publication or sample metrics as a live customer deployment.

## Five-minute script

1. **Set the context.** “This is a professional-intelligence layer for publishers. Visitors provide a company website and job role; the platform builds a briefing from the publisher’s real archive.”
2. **Show the entry point.** Click **See the demo** or **Start live demo**. The compact embed opens above the sales page and asks only for company and role.
3. **Start generation.** Use `sunseeker.com` and `Head of Procurement`, or select a scenario. The embed sends the request to the hosted generation route; it does not contain recommendations or private credentials.
4. **Show the hosted experience.** Walk through company analysis, role analysis, retrieval and ranking, then open the persisted publisher-branded report.
5. **Show relevance.** Highlight the professional profile, grounded “Why this matters to you” explanations and links to real publisher stories.
6. **Show publisher value.** Open **Publisher insights** and point out the scoped professional funnel, report generation and story engagement. Say “sample data” when referring to the dashboard.
7. **Close on integration.** Show the one-script embed and explain that the publisher API remains the content source of truth; branding, approved origins and server credentials are configured per publisher.

## Scenario profiles

- Marine industry: `sunseeker.com` · Head of Procurement
- Finance: `jpmorgan.com` · Investment Analyst
- Technology: `microsoft.com` · Chief Technology Officer
- Science: `ldsystems.uk` · Research professional

## Talking points

- The embed is intentionally small: company + role, safe analytics and a navigation handoff.
- The hosted application owns company analysis, role analysis, generation progress, report persistence, report rendering, editing and sharing.
- Recommendations are retrieved from real publisher content, ranked deterministically and linked back to source articles.
- AI is optional and bounded. Publisher content remains the source of truth and deterministic fallbacks remain available.
- No CMS migration is required; the publisher’s existing API remains authoritative.

## Technical questions to collect

- API base URL, search route, authentication method and staging access.
- Search parameters, pagination, rate limits and maximum practical result set.
- Response fields for canonical URL, title, description, image, date, author, categories and tags.
- Approved embed origins, branding requirements and article-link behavior.
- Analytics retention expectations and whether approved AI enhancement is permitted.
