import type { NormalizedArticle } from '../core';
import type { ContentTimingDiagnostics } from '../publishers/content';

export interface CatalogueCacheDiagnostics extends ContentTimingDiagnostics {
  catalogueCacheHit: boolean;
  catalogueCacheAgeMs: number;
  catalogueRefreshMs: number;
  catalogueRefreshReason: 'warm' | 'cold' | 'expired' | 'key_changed' | 'shared_refresh';
}

export interface CatalogueCacheResult {
  articles: NormalizedArticle[];
  diagnostics: CatalogueCacheDiagnostics;
}

export interface PublisherCatalogueCacheOptions {
  ttlMs?: number;
  maxArticles?: number;
  now?: () => number;
}

interface CacheEntry {
  publisherId: string;
  key: string;
  createdAt: number;
  articles: NormalizedArticle[];
  timings: ContentTimingDiagnostics;
}

type CatalogueLoader = () => Promise<{ articles: NormalizedArticle[]; timings?: ContentTimingDiagnostics }>;

/**
 * Process-local, tenant-scoped catalogue cache. It intentionally caches only
 * normalized public articles and never source credentials or raw responses.
 */
export class PublisherCatalogueCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CatalogueCacheResult>>();
  private readonly ttlMs: number;
  private readonly maxArticles: number;
  private readonly now: () => number;

  constructor(options: PublisherCatalogueCacheOptions = {}) {
    this.ttlMs = Math.max(0, options.ttlMs ?? 5 * 60 * 1000);
    this.maxArticles = Math.max(1, options.maxArticles ?? 25_000);
    this.now = options.now ?? Date.now;
  }

  async get(publisherId: string, key: string, loader: CatalogueLoader): Promise<CatalogueCacheResult> {
    const cacheKey = `${publisherId}:${key}`;
    const now = this.now();
    const existing = this.entries.get(publisherId);
    if (existing && existing.key === key && now - existing.createdAt < this.ttlMs) {
      return { articles: existing.articles, diagnostics: { sourceFetchMs: 0, sourceParseMs: 0, normalizationMs: 0, cataloguePreparationMs: 0, catalogueCacheHit: true, catalogueCacheAgeMs: Math.max(0, now - existing.createdAt), catalogueRefreshMs: 0, catalogueRefreshReason: 'warm' } };
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      const shared = await pending;
      return { articles: shared.articles, diagnostics: { ...shared.diagnostics, catalogueCacheHit: true, catalogueRefreshReason: 'shared_refresh' } };
    }

    const reason: CatalogueCacheDiagnostics['catalogueRefreshReason'] = !existing ? 'cold' : existing.key === key ? 'expired' : 'key_changed';
    const startedAt = this.now();
    const refresh = (async (): Promise<CatalogueCacheResult> => {
      const loaded = await loader();
      if (loaded.articles.length <= this.maxArticles) {
        this.entries.set(publisherId, { publisherId, key, createdAt: this.now(), articles: loaded.articles, timings: loaded.timings ?? {} });
      } else {
        this.entries.delete(publisherId);
      }
      return {
        articles: loaded.articles,
        diagnostics: {
          ...(loaded.timings ?? {}),
          catalogueCacheHit: false,
          catalogueCacheAgeMs: 0,
          catalogueRefreshMs: Math.max(0, this.now() - startedAt),
          catalogueRefreshReason: reason,
        },
      };
    })();
    this.inFlight.set(cacheKey, refresh);
    try { return await refresh; } finally { this.inFlight.delete(cacheKey); }
  }

  invalidatePublisher(publisherId: string): void {
    this.entries.delete(publisherId);
    for (const key of this.inFlight.keys()) if (key.startsWith(`${publisherId}:`)) this.inFlight.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}
