import { readFile, readdir } from 'node:fs/promises';

// Browser artifacts must not contain credentials. The server artifact may
// legitimately contain environment-variable names and Authorization code;
// those values are supplied only at runtime by the server environment.
let assetFiles = [];
try { assetFiles = (await readdir('dist/assets')).map((file) => `dist/assets/${file}`); } catch {}
const files = ['dist/widget.js', 'dist/index.html', ...assetFiles];
const patterns = [
  /(?:AI_API_KEY|REAL_PUBLISHER_API_TOKEN|PUBLISHER_[A-Z0-9_]+_API_KEY)\s*[:=]\s*["']?(?!replace-on-the-server-only)[A-Za-z0-9_\-]{12,}/i,
  /server-only-test-key/i,
  /Authorization\s*:\s*["'`]Bearer\s+\$?\{?[^"'`}]+/i,
];
for (const file of files) {
  let contents;
  try { contents = await readFile(file, 'utf8'); } catch { continue; }
  if (patterns.some((pattern) => pattern.test(contents))) { console.error(`Potential credential pattern found in ${file}`); process.exit(1); }
}
console.log('credential scan clean');
