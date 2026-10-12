import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function staticAssetPath(pathname) {
  if (pathname === '/admin' || pathname === '/admin/') return '/admin.html';
  if (pathname === '/' || pathname === '/analytics' || pathname === '/dashboard' || /^\/p\/[^/]+(?:\/.*)?$/.test(pathname)) return '/index.html';
  return pathname;
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

export async function staticResponse(request, root) {
  const url = new URL(request.url, 'http://localhost');
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const pathname = staticAssetPath(url.pathname);
  const candidate = path.resolve(root, `.${pathname}`);
  if (!candidate.startsWith(`${root}${path.sep}`)) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(candidate);
    const hashedAsset = pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]+\.[a-z0-9]+$/i.test(pathname);
    const cacheControl = hashedAsset ? 'public, max-age=31536000, immutable' : pathname === '/widget.js' ? 'public, max-age=300, stale-while-revalidate=86400' : 'public, max-age=3600';
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: { 'Content-Type': contentType(candidate), 'Cache-Control': cacheControl, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:; base-uri 'self'; frame-ancestors 'self'" } });
  } catch { return null; }
}
