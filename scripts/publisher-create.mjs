import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv.find((value) => value !== '--' && value !== process.argv[0] && value !== process.argv[1]);
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const reserved = new Set(['_template', 'demo', 'real-publisher']);

if (!id || !idPattern.test(id) || reserved.has(id)) {
  console.error('Usage: npm run publisher:create -- acme-media');
  console.error('Publisher ids must be unique kebab-case identifiers and may not use a reserved id.');
  process.exit(1);
}

const directory = path.join(root, 'src', 'publishers', id);
try { await access(directory); console.error(`Refusing to overwrite existing publisher: ${id}`); process.exit(1); } catch {}
const className = id.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
const files = {
  'types.ts': `import type { NormalizedArticle } from '../../core';\n\nexport type ${className}RawArticle = Record<string, unknown>;\nexport type ${className}NormalizedArticle = NormalizedArticle;\n`,
  'normalizer.ts': `import type { NormalizedArticle } from '../../core';\nimport type { ${className}RawArticle } from './types';\n\nexport function normalize${className}Article(raw: ${className}RawArticle): NormalizedArticle | null {\n  const id = typeof raw.id === 'string' ? raw.id : '';\n  const title = typeof raw.title === 'string' ? raw.title : '';\n  const url = typeof raw.url === 'string' ? raw.url : '';\n  if (!id || !title || !/^https?:\\/\\//i.test(url)) return null;\n  return { id, title, url, description: typeof raw.description === 'string' ? raw.description : undefined, categories: [], tags: [], publisherId: '${id}', provenance: { publisherId: '${id}', sourceArticleId: id, sourceUrl: url, retrievalSource: '${id}-api' } };\n}\n`,
  'config.ts': `import type { PublisherManifest } from '../manifest';\n\nexport const ${id.replaceAll('-', '')}Manifest: PublisherManifest = {\n  publisherId: '${id}',\n  name: 'Replace with publisher name',\n  enabled: true,\n  environment: 'development',\n  publisherConfigVersion: '1',\n  branding: { primaryAccent: '#244d3b', secondaryColor: '#e8efe6', launcherText: 'Find stories for you', widgetTitle: 'Your reading guide', introductoryCopy: 'Answer a few quick questions and we will find relevant stories.' },\n  questions: [{ id: 'interest', question: 'What are you interested in?', type: 'free-text', required: true }],\n  content: { adapterId: '${id}-api', resultLimit: 8, candidateRetrievalLimit: 30, searchBehavior: 'intent' },\n  results: { heading: 'Stories selected for you', maximumRecommendations: 8, openArticleInNewTab: true },\n  features: { analyticsEnabled: true, explanationsEnabled: true, aiEnabled: false },\n};\n`,
  'adapter.ts': `import { DiscoveryError, type Intent, type PublisherAdapter, type SearchOptions } from '../../core';\nimport { normalize${className}Article } from './normalizer';\nimport type { ${className}RawArticle } from './types';\n\nexport class ${className}PublisherAdapter implements PublisherAdapter<${className}RawArticle> {\n  readonly publisherId = '${id}';\n  async search(_intent: Intent, _options: SearchOptions): Promise<${className}RawArticle[]> {\n    throw new DiscoveryError('api-unavailable');\n  }\n  normalizeArticle(raw: ${className}RawArticle) { return normalize${className}Article(raw); }\n}\n`,
};
await mkdir(directory, { recursive: false });
for (const [name, contents] of Object.entries(files)) await writeFile(path.join(directory, name), contents, 'utf8');
await writeFile(path.join(directory, 'README.md'), `# ${id}\n\nComplete the manifest, adapter request, normalizer, server credentials and fixture contract before adding this publisher to src/publishers/registry.ts.\n`, 'utf8');
console.log(`Created src/publishers/${id}/ (${Object.keys(files).length + 1} files).`);
console.log('Next steps: complete config.ts, implement adapter.ts and normalizer.ts, add a sanitized fixture, then register the manifest and run npm run publisher:check -- ' + id + '.');
