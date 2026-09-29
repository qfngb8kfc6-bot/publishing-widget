import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv.find((value) => value !== '--' && value !== process.argv[0] && value !== process.argv[1]);
if (!id) { console.error('Usage: npm run publisher:check -- publisher-id'); process.exit(1); }
const directory = id === 'demo' ? path.join(root, 'src', 'demo') : path.join(root, 'src', 'publishers', id);
const required = id === 'demo' ? ['config.ts', 'adapter.ts', 'articles.ts'] : ['config.ts', 'adapter.ts', 'normalizer.ts', 'types.ts'];
const missing = [];
for (const file of required) { try { await access(path.join(directory, file)); } catch { missing.push(file); } }
if (missing.length) { console.error(`Publisher ${id} is incomplete. Missing: ${missing.join(', ')}`); process.exit(1); }
const config = await readFile(path.join(directory, 'config.ts'), 'utf8');
const adapter = await readFile(path.join(directory, 'adapter.ts'), 'utf8');
const fixture = await (async () => { try { await access(path.join(directory, id === 'demo' ? 'articles.ts' : 'fixtures')); return true; } catch { return false; } })();
const placeholder = /Replace with|Configure the server|Template adapter|replace-me/.test(`${config}\n${adapter}`);
console.log(`Publisher ${id}: source files present`);
console.log(`Publisher ${id}: fixture directory ${fixture ? 'present' : 'not found (add one for contract checks)'}`);
if (placeholder) { console.warn(`Publisher ${id}: placeholder implementation detected; live health checks require a completed adapter.`); process.exitCode = 1; }
console.log('Credential check: no secret values are read or printed by this command.');
