# Sales demo guide

## Preparation

- Open the deployed demo URL on a laptop and phone-sized window.
- Confirm the green reader guide opens and the sample dashboard loads at `/analytics?publisher=demo`.
- Use the scenario buttons in the reader experience or add `?sales=1` for the compact demo control panel.
- Keep the sample-data label visible when showing publisher insights.
- Do not describe the demo publication or sample metrics as a live customer deployment.

## Five-minute script

1. **Set the context — 30 seconds.** “This is a personalised content discovery layer for publishers. It helps readers find relevant stories in the content you already have, while showing publishers what audiences are actively interested in.”
2. **Show the reader entry point — 45 seconds.** Click **See the demo**, open the real guide and point out that the reader does not need an account.
3. **Capture intent — 60 seconds.** Choose a persona and an interest. Explain that the two questions are deliberately lightweight and make the reader’s starting point explicit.
4. **Show the result — 60 seconds.** Highlight the featured recommendation, the article link and **Why this matches you**. Stress that recommendations link to real publisher stories.
5. **Change the scenario — 30 seconds.** Select another scenario, such as Technology or Science, and show that a different reader intent produces a different reading list.
6. **Show publisher value — 60 seconds.** Open **Publisher insights**. Point out interests, personas, recommendation engagement, the funnel and the potential content-gap signal. Say “sample data” when referring to the dashboard.
7. **Close on integration — 45 seconds.** Show the one-script embed and explain that the publisher API remains the content source of truth; branding, approved domains and the connection are configured per publisher.

## Talking points

- This is more than ordinary site search: the reader supplies intent, receives a considered route through coverage and sees why a story fits.
- It can resurface valuable archive content instead of relying only on recency or navigation categories.
- It creates first-party intent signals from selected interests and personas without requiring reader accounts.
- AI is optional. Publisher content remains the source of truth, recommendations are grounded in supplied article data and a reliable non-AI fallback remains available.
- The experience is designed to sit alongside the existing publication, not replace the CMS or redesign the site.

## Discovery questions

- How do readers currently discover older content?
- Do you have a searchable content API or another structured content source?
- What article metadata is available: categories, tags, dates, authors, images and snippets?
- What percentage of traffic reaches archive content?
- Do you currently personalise content, and where does that experience live?
- Which audience segments or reader roles matter most?
- What audience insights would be most valuable to editorial, audience or commercial teams?

## Technical questions to collect

- API base URL, search route, authentication method and staging access.
- Search parameters, pagination, rate limits and maximum practical result set.
- Response fields for canonical URL, title, description, image, date, author, categories and tags.
- Approved embed origins, branding requirements and article-link behavior.
- Analytics retention expectations and whether approved AI enhancement is permitted.

## Common objections

**“We already have site search.”** Site search answers a query. This experience starts with reader intent, ranks existing content around that intent and explains the recommendation.

**“We cannot migrate our content.”** No migration is required. The existing API or content source remains authoritative and recommendations link back to the publisher’s article URLs.

**“We do not want AI inventing editorial content.”** AI is optional and bounded. It can improve intent understanding or explanation, but it cannot create article records; deterministic ranking and explanations remain available.

**“We cannot add a large product project.”** The pilot starts with one embed, one content API, two questions, publisher branding and a scoped analytics view.

## Suggested pilot

One publication, one documented content API, two reader questions, a branded widget, publisher-scoped analytics and a defined pilot period followed by a review. Confirm the success questions and technical owner before the pilot begins; do not commit commercial pricing in the demo.

## Next step

Ask the prospect to select one publication, nominate the content/API owner and provide the discovery answers above. The next working session should use a sanitized content sample or staging API and agree the first two reader questions.
