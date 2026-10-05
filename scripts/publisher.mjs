import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv.find((value) => value !== '--' && value !== process.argv[0] && value !== process.argv[1]);
if (!id || !/^[a-z][a-z0-9-]{1,80}$/.test(id)) { console.error('Usage: npm run publisher -- publisher-id'); process.exit(1); }
if (id === 'demo') { await access(path.join(root, 'src/demo/articles.ts')); console.log('demo publisher fixture is available; no live credentials required.'); process.exit(0); }
const prefix = `PUBLISHER_${id.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`;
const baseUrl = process.env[`${prefix}_BASE_URL`] || (id === 'real-publisher' ? process.env.REAL_PUBLISHER_UPSTREAM_BASE_URL : undefined);
const endpoint = process.env[`${prefix}_SEARCH_ENDPOINT`] || (id === 'real-publisher' ? process.env.REAL_PUBLISHER_SEARCH_ENDPOINT : '/search');
const token = process.env[`${prefix}_API_KEY`] || (id === 'real-publisher' ? process.env.REAL_PUBLISHER_API_TOKEN : undefined);
if (!baseUrl || !token) { console.error(`Live check requires ${prefix}_BASE_URL and ${prefix}_API_KEY server environment values.`); process.exit(1); }
const url = new URL(endpoint, baseUrl);
url.searchParams.set('q', 'health check'); url.searchParams.set('limit', '5');
try {
  const response = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  if (!response.ok) { console.error(`Publisher request failed with status ${response.status}.`); process.exit(1); }
  const body = await response.json();
  const candidates = Array.isArray(body) ? body : body && typeof body === 'object' ? body.results ?? body.articles ?? body.items ?? body.hits ?? [] : [];
  if (!Array.isArray(candidates)) { console.error('Publisher response did not contain a supported result array.'); process.exit(1); }
  console.log(`Live publisher check passed for ${id}: ${candidates.length} candidate results received.`);
} catch { console.error('Publisher live check failed without exposing upstream details.'); process.exit(1); }
