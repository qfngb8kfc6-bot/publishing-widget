// Side-by-side SGI briefings: the current catalogue (RSS + WVC full text) next to an API-only catalogue built the way
// a "wvc" source builds it (title, URL, date, first 1-2 sentences, first in-text image), to judge images and
// descriptions without RSS. Writes one local HTML file; prints counts only, never the key or article text.
// Usage (rotate the WVC key first; see CLAUDE.md): SGI_WVC_API_KEY=... npm run wvc:compare
// Options: PAGES=20 (newest WVC pages synced into memory for the API-only side; 0 = all), OUT=wvc-compare.html,
// IMAGE_HOSTS=cdn.example,... (extra hosts allowed for in-text images; www.sgieurope.com is always allowed),
// PRIVATE_EXCERPTS=1 (show text excerpts as descriptions for subscriber-only stories; off by default, as in setup).
// AI is used only when AI_ENABLED/AI_API_KEY are set; otherwise both sides rank deterministically.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCENARIOS = [
  ['nike.com', 'Head of Retail'],
  ['nike.com', 'Head of Procurement'],
  ['puma.com', 'Head of Sustainability'],
  ['adidas.com', 'Product Manager'],
  ['nike.com', 'Software Engineer'],
];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const percent = (count, total) => (total ? `${Math.round((count / total) * 100)}%` : 'n/a');

/** Builds both apps, ranks every scenario on each and returns { html, summary }. */
export async function compare({ server, fetchImpl = fetch, resolveSecret, pages = 20, imageHosts = [], showPrivateExcerpts = false, environment = process.env, scenarios = SCENARIOS, companyContextProvider }) {
  const { createProductionApp, MemoryArticleTextStore, MemoryPublisherStore, fetchWvcPage, fetchWvcPageCount, sgiEuropeEnrichmentSource, sgiEuropeManifest, wvcCatalogueFetchConfig, wvcCatalogueParseOptions } = server;
  const wvcSource = {
    type: 'wvc', baseUrl: sgiEuropeEnrichmentSource.baseUrl, profileName: sgiEuropeEnrichmentSource.profileName, pageSize: sgiEuropeEnrichmentSource.pageSize,
    secretRef: sgiEuropeEnrichmentSource.secretRef, allowedHostnames: sgiEuropeEnrichmentSource.allowedHostnames, imageHostnames: [...sgiEuropeEnrichmentSource.allowedHostnames, ...imageHosts], showPrivateExcerpts,
  };
  const fetchConfig = wvcCatalogueFetchConfig(wvcSource);
  const catalogue = wvcCatalogueParseOptions(wvcSource);
  const store = new MemoryArticleTextStore();
  // dataconstraint 0 only for the page count; every story fetch below uses 4 (HEADLINE and STORYTEXT).
  const probe = await fetchWvcPageCount(fetchConfig, { fetchImpl, resolveSecret });
  const first = pages > 0 ? Math.max(1, probe.totalPages - pages + 1) : 1;
  let stored = 0;
  for (let page = first; page <= probe.totalPages; page += 1) {
    const result = await fetchWvcPage(fetchConfig, page, { fetchImpl, resolveSecret, catalogue });
    for (const story of result.stories) await store.upsertCatalogue('sgi-europe', [story], new Date().toISOString());
    stored += result.stories.length;
  }
  const quiet = { info() {}, error() {} };
  const base = { environment: 'development', fetchImpl, logger: quiet, articleTextStore: store, ...(companyContextProvider ? { companyContextProvider } : {}) };
  const serverEnvironment = { ...environment, WVC_ENRICHMENT_ENABLED: 'true', PUBLISHER_INDEX_PREBUILD: 'false' };
  const current = createProductionApp({ ...base, serverEnvironment, publisherStore: new MemoryPublisherStore([sgiEuropeManifest]) });
  const apiOnly = createProductionApp({ ...base, serverEnvironment, publisherStore: new MemoryPublisherStore([{ ...sgiEuropeManifest, content: { ...sgiEuropeManifest.content, adapterId: 'wvc' }, contentSource: wvcSource }]) });

  const catalogueStats = async (app) => {
    await app.prewarmCatalogues();
    const definition = app.registry.get('sgi-europe');
    const articles = (await definition.adapter.loadCatalogue()).map((record) => definition.adapter.normalizeArticle(record)).filter(Boolean);
    return { articles: articles.length, image: percent(articles.filter((article) => article.imageUrl).length, articles.length), description: percent(articles.filter((article) => article.description).length, articles.length), category: percent(articles.filter((article) => article.categories?.length).length, articles.length) };
  };
  const stats = { current: await catalogueStats(current), apiOnly: await catalogueStats(apiOnly) };

  const top = async (app, companyUrl, jobTitle) => {
    const response = await app.handle(new Request('http://localhost/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl, jobTitle }) }));
    const payload = await response.json();
    const report = payload.reportId ? await app.reportStore.get(payload.reportId, 'sgi-europe') : undefined;
    return report ? report.recommendations.slice(0, 8) : [];
  };
  const card = (item) => `<li class="story">${item.article.imageUrl ? `<img src="${escapeHtml(item.article.imageUrl)}" alt="" loading="lazy">` : '<div class="no-image">No image</div>'}<div><p class="meta">${escapeHtml(item.displayScore)}% · ${escapeHtml(item.article.categories?.[0] ?? 'no category')} · ${escapeHtml(item.article.publishedAt?.slice(0, 10) ?? 'no date')}${item.subscriberOnly ? ' · subscriber' : ''}</p><a href="${escapeHtml(item.article.url)}">${escapeHtml(item.article.title)}</a><p>${escapeHtml(item.article.description ?? '')}</p></div></li>`;
  const sections = [];
  for (const [companyUrl, jobTitle] of scenarios) {
    const [left, right] = [await top(current, companyUrl, jobTitle), await top(apiOnly, companyUrl, jobTitle)];
    sections.push(`<section><h2>${escapeHtml(jobTitle)} at ${escapeHtml(companyUrl)}</h2><div class="columns"><div><h3>Current: RSS + WVC</h3><ol>${left.map(card).join('')}</ol></div><div><h3>API only (WVC)</h3><ol>${right.map(card).join('')}</ol></div></div></section>`);
  }
  const statLine = (label, value) => `<p><strong>${label}:</strong> ${value.articles} articles · images ${value.image} · descriptions ${value.description} · categories ${value.category}</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SGI catalogue comparison</title><style>body{margin:0;padding:24px;font:15px/1.45 system-ui,sans-serif;color:#1d2833;background:#f4f6f8}h1{margin:0 0 6px}section{margin:28px 0}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}ol{margin:0;padding:0;list-style:none}.story{display:grid;grid-template-columns:120px 1fr;gap:12px;margin:0 0 10px;padding:10px;border-radius:10px;background:#fff}.story img,.no-image{width:120px;height:80px;border-radius:6px;object-fit:cover;background:#e3e8ec}.no-image{display:grid;place-items:center;color:#7a8794;font-size:12px}.meta{margin:0 0 4px;color:#66737f;font-size:12px}.story p:last-child{margin:4px 0 0;color:#3d4b57;font-size:13px}a{color:#244f68;font-weight:650;text-decoration:none}@media(max-width:800px){.columns{grid-template-columns:1fr}}</style></head><body><h1>SGI Europe: current catalogue vs WVC API only</h1>${statLine('Current (RSS + WVC full text)', stats.current)}${statLine(`API only (newest ${pages > 0 ? pages : 'all'} of ${probe.totalPages} pages, ${stored} stories; subscriber-only excerpts ${showPrivateExcerpts ? 'shown' : 'hidden'})`, stats.apiOnly)}${sections.join('')}</body></html>`;
  return { html, summary: { totalPages: probe.totalPages, pagesSynced: probe.totalPages - first + 1, storiesStored: stored, current: stats.current, apiOnly: stats.apiOnly } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (!process.env.SGI_WVC_API_KEY?.trim()) {
    console.error('[wvc:compare] SGI_WVC_API_KEY is not set (rotate the key first). Nothing was fetched.');
    process.exit(1);
  }
  const server = await import(pathToFileURL(path.resolve(process.cwd(), 'dist/server.mjs')).href);
  const resolveSecret = (reference) => (reference === server.sgiEuropeEnrichmentSource.secretRef ? process.env.SGI_WVC_API_KEY : undefined);
  const { html, summary } = await compare({ server, resolveSecret, pages: Number(process.env.PAGES ?? 20), imageHosts: (process.env.IMAGE_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean), showPrivateExcerpts: process.env.PRIVATE_EXCERPTS === '1' });
  const out = path.resolve(process.env.OUT ?? 'wvc-compare.html');
  await writeFile(out, html, 'utf8');
  console.log(`[wvc:compare] ${summary.pagesSynced} of ${summary.totalPages} pages, ${summary.storiesStored} stories → ${out}`);
  console.log(`[wvc:compare] current: ${JSON.stringify(summary.current)}`);
  console.log(`[wvc:compare] api-only: ${JSON.stringify(summary.apiOnly)}`);
}
