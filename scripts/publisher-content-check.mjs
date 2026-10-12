import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv.find((value) => value !== '--' && value !== process.argv[0] && value !== process.argv[1]);
if (!id) { console.error('Usage: npm run publisher:content-check -- publisher-id'); process.exit(1); }

const directory = id === 'demo' ? path.join(root, 'src', 'demo') : path.join(root, 'src', 'publishers', id);
try { await access(directory); } catch { console.error(`Publisher directory not found: ${id}`); process.exit(1); }
const requiredFiles = id === 'demo' ? ['config.ts', 'adapter.ts', 'articles.ts'] : ['config.ts', 'adapter.ts', 'normalizer.ts'];
const files = await Promise.all(requiredFiles.map(async (name) => ({ name, present: await access(path.join(directory, name)).then(() => true).catch(() => false) })));
const missing = files.filter((file) => !file.present).map((file) => file.name);
if (missing.length && id !== 'demo') { console.error(`Content source is incomplete. Missing: ${missing.join(', ')}`); process.exit(1); }
const sourceText = await Promise.all(files.filter((file) => file.present).map((file) => readFile(path.join(directory, file.name), 'utf8')));
const combined = sourceText.join('\n');
const sourceTypes = [...new Set([...combined.matchAll(/type:\s*['"](rest-json|rss|atom|sitemap|json|csv|static-demo)['"]/g)].map((match) => match[1]))];
const fixturePath = path.join(directory, 'fixtures');
const fixturePresent = await access(fixturePath).then(() => true).catch(() => false);
console.log(`Publisher ${id}: content source ${sourceTypes.length ? sourceTypes.join(', ') : id === 'demo' ? 'static-demo' : 'adapter-defined'}`);
console.log(`Publisher ${id}: source files ${missing.length ? `missing ${missing.join(', ')}` : 'present'}`);
console.log(`Publisher ${id}: sanitized fixtures ${fixturePresent ? 'present' : id === 'demo' ? 'built-in demo archive' : 'not found'}`);
console.log('Diagnostics are metadata-only; this command never prints headers, tokens, payloads or environment secrets.');
