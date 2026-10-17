import type { NormalizedArticle } from '../core';
import type { ContentTimingDiagnostics } from '../publishers/content';
import type { CatalogueSnapshot, CatalogueSnapshotStore } from './catalogue-snapshot';

export interface CatalogueCacheDiagnostics extends ContentTimingDiagnostics {
  catalogueSnapshotLookupMs?: number;
  catalogueCacheHit: boolean;
  catalogueCacheAgeMs: number;
  catalogueRefreshMs: number;
  catalogueRefreshReason: 'warm' | 'snapshot' | 'cold' | 'expired' | 'key_changed' | 'shared_refresh' | 'stale';
  catalogueStale?: boolean;
}

export interface CatalogueCacheResult {
  articles: NormalizedArticle[];
  diagnostics: CatalogueCacheDiagnostics;
}

export interface PublisherCatalogueCacheOptions {
  ttlMs?: number;
  maxStaleMs?: number;
  maxArticles?: number;
  now?: () => number;
  snapshotStore?: CatalogueSnapshotStore;
  onRefreshError?: (publisherId: string, error: unknown, background: boolean) => void;
}

interface CacheEntry {
  publisherId: string;
  key: string;
  refreshedAt: number;
  articles: NormalizedArticle[];
  timings: ContentTimingDiagnostics;
}

type CatalogueLoader = () => Promise<{ articles: NormalizedArticle[]; timings?: ContentTimingDiagnostics }>;

/** Tenant-scoped normalized catalogue cache with persisted stale-while-revalidate support. */
export class PublisherCatalogueCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CatalogueCacheResult>>();
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private readonly maxArticles: number;
  private readonly now: () => number;
  private readonly snapshotStore?: CatalogueSnapshotStore;
  private readonly onRefreshError?: PublisherCatalogueCacheOptions['onRefreshError'];

  constructor(options: PublisherCatalogueCacheOptions = {}) {
    this.ttlMs = Math.max(0, options.ttlMs ?? 5 * 60 * 1000);
    this.maxStaleMs = Math.max(this.ttlMs, options.maxStaleMs ?? 24 * 60 * 60 * 1000);
    this.maxArticles = Math.max(1, options.maxArticles ?? 25_000);
    this.now = options.now ?? Date.now;
    this.snapshotStore = options.snapshotStore;
    this.onRefreshError = options.onRefreshError;
  }

  async get(publisherId: string, key: string, loader: CatalogueLoader): Promise<CatalogueCacheResult> {
    const cacheKey = `${publisherId}:${key}`;
    const now = this.now();
    const existing = this.entries.get(publisherId);
    if (existing && existing.key === key) {
      const age = Math.max(0, now - existing.refreshedAt);
      if (age < this.ttlMs) return this.warm(existing, age);
      if (age < this.maxStaleMs) {
        this.startBackgroundRefresh(publisherId, key, cacheKey, loader, existing);
        return this.stale(existing, age);
      }
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      const shared = await pending;
      return { articles: shared.articles, diagnostics: { ...shared.diagnostics, catalogueRefreshReason: 'shared_refresh' } };
    }

    const reason: CatalogueCacheDiagnostics['catalogueRefreshReason'] = !existing ? 'cold' : existing.key === key ? 'expired' : 'key_changed';
    const operation = this.hydrateOrRefresh(publisherId, key, loader, reason, existing);
    this.inFlight.set(cacheKey, operation);
    let result: CatalogueCacheResult;
    try { result = await operation; } finally { this.inFlight.delete(cacheKey); }
    if (result.diagnostics.catalogueStale) this.startBackgroundRefresh(publisherId, key, cacheKey, loader, this.entries.get(publisherId));
    return result;
  }

  invalidatePublisher(publisherId: string): void {
    this.entries.delete(publisherId);
    for (const key of this.inFlight.keys()) if (key.startsWith(`${publisherId}:`)) this.inFlight.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  private warm(entry: CacheEntry, age: number): CatalogueCacheResult {
    return { articles: entry.articles, diagnostics: { sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, cataloguePreparationMs: 0, catalogueCacheHit: true, catalogueCacheAgeMs: age, catalogueRefreshMs: 0, catalogueRefreshReason: 'warm' } };
  }

  private stale(entry: CacheEntry, age: number): CatalogueCacheResult {
    return { articles: entry.articles, diagnostics: { sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, cataloguePreparationMs: 0, catalogueCacheHit: true, catalogueCacheAgeMs: age, catalogueRefreshMs: 0, catalogueRefreshReason: 'stale', catalogueStale: true } };
  }

  private async hydrateOrRefresh(publisherId: string, key: string, loader: CatalogueLoader, reason: CatalogueCacheDiagnostics['catalogueRefreshReason'], existing?: CacheEntry): Promise<CatalogueCacheResult> {
    let snapshotLookupMs = 0;
    if (this.snapshotStore) {
      const snapshotStartedAt = Date.now();
      try {
        const snapshot = await this.snapshotStore.get(publisherId, key);
        if (snapshot && snapshot.articles.length <= this.maxArticles && snapshot.articles.every((article) => article && article.publisherId === publisherId && typeof article.id === 'string' && typeof article.url === 'string')) {
          const refreshedAt = Date.parse(snapshot.refreshedAt);
          if (Number.isFinite(refreshedAt)) {
            const entry: CacheEntry = { publisherId, key, refreshedAt, articles: snapshot.articles, timings: {} };
            this.entries.set(publisherId, entry);
            const age = Math.max(0, this.now() - refreshedAt);
            if (age < this.maxStaleMs) return { articles: entry.articles, diagnostics: { sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, cataloguePreparationMs: 0, catalogueSnapshotLookupMs: Math.max(0, Date.now() - snapshotStartedAt), catalogueCacheHit: true, catalogueCacheAgeMs: age, catalogueRefreshMs: 0, catalogueRefreshReason: 'snapshot', catalogueStale: age >= this.ttlMs } };
          }
        }
      } catch (error) {
        this.onRefreshError?.(publisherId, error, false);
      } finally {
        snapshotLookupMs = Math.max(0, Date.now() - snapshotStartedAt);
      }
    }
    const refreshed = await this.refresh(publisherId, key, loader, reason, existing);
    return { ...refreshed, diagnostics: { ...refreshed.diagnostics, catalogueSnapshotLookupMs: snapshotLookupMs } };
  }

  private startBackgroundRefresh(publisherId: string, key: string, cacheKey: string, loader: CatalogueLoader, existing?: CacheEntry): void {
    if (this.inFlight.has(cacheKey)) return;
    const refresh = this.refresh(publisherId, key, loader, 'expired', existing);
    this.inFlight.set(cacheKey, refresh);
    void refresh.catch((error) => this.onRefreshError?.(publisherId, error, true)).finally(() => { this.inFlight.delete(cacheKey); });
  }

  private async refresh(publisherId: string, key: string, loader: CatalogueLoader, reason: CatalogueCacheDiagnostics['catalogueRefreshReason'], existing?: CacheEntry): Promise<CatalogueCacheResult> {
    const startedAt = this.now();
    try {
      const loaded = await loader();
      if (loaded.articles.length > this.maxArticles) throw new Error('catalogue_exceeds_cache_bound');
      const refreshedAt = this.now();
      const entry: CacheEntry = { publisherId, key, refreshedAt, articles: loaded.articles, timings: loaded.timings ?? {} };
      this.entries.set(publisherId, entry);
      if (this.snapshotStore) {
        const snapshot: CatalogueSnapshot = { publisherId, sourceKey: key, articles: loaded.articles, refreshedAt: new Date(refreshedAt).toISOString() };
        void Promise.resolve().then(() => this.snapshotStore!.save(snapshot)).catch((error) => this.onRefreshError?.(publisherId, error, true));
      }
      return { articles: loaded.articles, diagnostics: { ...(loaded.timings ?? {}), catalogueCacheHit: false, catalogueCacheAgeMs: 0, catalogueRefreshMs: Math.max(0, this.now() - startedAt), catalogueRefreshReason: reason } };
    } catch (error) {
      if (existing && existing.key === key) {
        this.onRefreshError?.(publisherId, error, true);
        return this.stale(existing, Math.max(0, this.now() - existing.refreshedAt));
      }
      this.onRefreshError?.(publisherId, error, false);
      throw error;
    }
  }
}
