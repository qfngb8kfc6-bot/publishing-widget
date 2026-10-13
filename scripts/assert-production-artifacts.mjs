import { access } from 'node:fs/promises';

const required = ['dist/index.html', 'dist/admin.html', 'dist/widget.js', 'dist/server.mjs', 'server-entry.mjs', 'server-static.mjs'];
const missing = [];
for (const file of required) {
  try { await access(file); } catch { missing.push(file); }
}
if (missing.length) {
  console.error(`[production-artifacts] missing: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('[production-artifacts] dist/admin.html and server entry artifacts present');
}
