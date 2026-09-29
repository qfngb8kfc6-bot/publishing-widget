import type { PublisherManifest } from '../publishers/manifest';

export function isPublisherOriginAllowed(manifest: PublisherManifest, origin: string | null): boolean {
  if (!manifest.allowedOrigins || manifest.allowedOrigins.length === 0 || !origin) return true;
  return manifest.allowedOrigins.includes(origin);
}
