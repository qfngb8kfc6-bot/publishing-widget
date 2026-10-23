// Read-only check of the SGI WVC story-list API: fetches the newest (last) page and prints counts only.
// Usage: SGI_WVC_API_KEY=... npm run wvc:check
// Prints HTTP status, ErrorsFound, story count, newest DATEPUBLISHED, PRIVATE count, STORYTEXT length
// min/median/max and how many story codes match the current RSS catalogue (when the feed is reachable).
// Never prints the key or any article text, and writes nothing to the database.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { inspectWvcLastPage, storyCodeFromUrl, sgiEuropeEnrichmentSource, sgiEuropeFeedUrl } = await import(pathToFileURL(path.resolve(process.cwd(), 'dist/server.mjs')).href);

if (!process.env.SGI_WVC_API_KEY?.trim()) {
  console.error('[wvc:check] SGI_WVC_API_KEY is not set. Nothing was fetched.');
  process.exit(1);
}
const resolveSecret = (reference) => (reference === sgiEuropeEnrichmentSource.secretRef ? process.env.SGI_WVC_API_KEY : undefined);

async function catalogueCodes() {
  try {
    const response = await fetch(sgiEuropeFeedUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const xml = await response.text();
    const codes = new Set();
    for (const match of xml.matchAll(/<(?:link|guid)[^>]*>([^<]+)<\/(?:link|guid)>/g)) {
      const code = storyCodeFromUrl(match[1].trim());
      if (code) codes.add(code);
    }
    return { codes };
  } catch (error) {
    return { error: error instanceof Error ? error.name : 'unreachable' };
  }
}

const catalogue = await catalogueCodes();
const { probe, last } = await inspectWvcLastPage(sgiEuropeEnrichmentSource, { resolveSecret, catalogueCodes: catalogue.codes });
const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value ?? 'n/a'}`);

console.log('[wvc:check] page-count probe (page 1, dataconstraint=0)');
line('HTTP status', probe.httpStatus);
line('ErrorsFound', probe.errorsFound);
if (probe.errorCode) line('error', probe.errorCode);
line('total pages', probe.totalPages);
line('total records', probe.totalRecords);
if (!last) process.exit(1);

console.log(`[wvc:check] last page (${last.page}, dataconstraint=${sgiEuropeEnrichmentSource.dataConstraint})`);
line('HTTP status', last.httpStatus);
line('ErrorsFound', last.errorsFound);
if (last.errorCode) line('error', last.errorCode);
line('stories', last.storyCount);
line('newest DATEPUBLISHED', last.newestDatePublished);
line('PRIVATE=true', `${last.privateCount} of ${last.storyCount}`);
line('STORYTEXT length (chars)', last.storyTextLength ? `min ${last.storyTextLength.min} · median ${last.storyTextLength.median} · max ${last.storyTextLength.max}` : undefined);
line('RSS catalogue matches', catalogue.codes ? `${last.catalogueMatches} of ${last.storyCount} (catalogue ${catalogue.codes.size} codes)` : `feed not reachable (${catalogue.error})`);
process.exit(last.errorCode || last.errorsFound ? 1 : 0);
