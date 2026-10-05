import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

const required = ['package.json', 'server-entry.mjs', 'dist/widget.js', 'dist/server.mjs', 'dist/embed-test.html'];
for (const file of required) {
  try { await access(file); } catch { console.error(`[release:check] missing ${file}`); process.exitCode = 1; }
}
for (const file of ['.env', '.env.production', '.env.local']) {
  try { await access(file); console.error(`[release:check] private environment file present: ${file}`); process.exitCode = 1; } catch { /* expected */ }
}
try {
  const assets = await readdir(path.resolve('dist/assets'));
  if (assets.length === 0) throw new Error('no hashed assets');
} catch {
  console.error('[release:check] hashed frontend assets are missing');
  process.exitCode = 1;
}
if (!process.exitCode) console.log('[release:check] production artifact checks passed');
