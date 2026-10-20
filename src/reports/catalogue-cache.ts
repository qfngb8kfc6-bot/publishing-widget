import { compactProfessionalFieldIndexes, mapInSlices, professionalFieldIndexes, TokenDictionary, type NormalizedArticle, type ProfessionalFieldIndexes } from '../core';
import { compactFeedPreselectionFields, feedPreselectionFields, type ContentTimingDiagnostics, type FeedPreselectionFields } from '../publishers/content';
import type { CatalogueSnapshotStore } from './catalogue-snapshot';

export interface CatalogueCacheDiagnostics extends ContentTimingDiagnostics {
  catalogueSnapshotLookupMs?: number;
  catalogueCacheHit: boolean;
  catalogueCacheAgeMs: number;
  catalogueRefreshMs: number;
  catalogueRefreshReason: 'warm' | 'snapshot' | 'cold' | 'expired' | 'key_changed' | 'shared_refresh' | 'stale';
  catalogueStale?: boolean;
}

/**
 * Per-article match indexes for one catalogue version. Built lazily, at most once per article, and owned by
 * the cache entry: a refresh, source-key change or invalidation replaces the entry and drops its indexes.
 * Only the entry's own article objects are memoized, so one publisher's index never serves another's articles.
 */
export class CatalogueArticleIndex {
  private readonly articles: readonly NormalizedArticle[];
  private readonly members: ReadonlySet<NormalizedArticle>;
  private cancelled = false;
  /** Shared by both index kinds; dropped with this catalogue version. */
  private readonly dictionary = new TokenDictionary();
  private readonly preselection = new Map<NormalizedArticle, FeedPreselectionFields>();
  private readonly professional = new Map<NormalizedArticle, ProfessionalFieldIndexes>();

  constructor(articles: readonly NormalizedArticle[]) {
    this.articles = articles;
    this.members = new Set(articles);
  }

  /** Stops an in-progress prebuild, e.g. when a refresh replaces this catalogue version. */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Builds both index kinds for every article off the request path, in short slices that yield to the event
   * loop so requests are never blocked for long. It uses the same memoized builders as requests, so a request
   * arriving mid-build reuses what is built, computes the rest itself, and gets identical results.
   */
  async prebuild(options: IndexPrebuildOptions = {}): Promise<IndexPrebuildStats> {
    const sliceMs = Math.max(1, options.sliceMs ?? 15);
    const yieldToEventLoop = options.yieldToEventLoop ?? defaultYield;
    const clock = options.clock ?? defaultClock;
    const startedAt = clock();
    let busyMs = 0;
    let slices = 0;
    let index = 0;
    while (index < this.articles.length && !this.cancelled) {
      const sliceStartedAt = clock();
      do {
        const article = this.articles[index];
        this.preselectionFields(article);
        this.professionalFields(article);
        index += 1;
      } while (index < this.articles.length && clock() - sliceStartedAt < sliceMs);
      busyMs += clock() - sliceStartedAt;
      slices += 1;
      if (index < this.articles.length) await yieldToEventLoop();
    }
    return { articleCount: this.articles.length, indexedArticles: index, durationMs: clock() - startedAt, busyMs, slices, cancelled: this.cancelled && index < this.articles.length };
  }

  readonly preselectionFields = (article: NormalizedArticle): FeedPreselectionFields => {
    if (!this.members.has(article)) return feedPreselectionFields(article);
    let fields = this.preselection.get(article);
    if (!fields) { fields = compactFeedPreselectionFields(article, this.dictionary); this.preselection.set(article, fields); }
    return fields;
  };

  readonly professionalFields = (article: NormalizedArticle): ProfessionalFieldIndexes => {
    if (!this.members.has(article)) return professionalFieldIndexes(article);
    let fields = this.professional.get(article);
    if (!fields) { fields = compactProfessionalFieldIndexes(article, this.dictionary); this.professional.set(article, fields); }
    return fields;
  };

  get indexedCounts(): { preselection: number; professional: number; dictionary: number } {
    return { preselection: this.preselection.size, professional: this.professional.size, dictionary: this.dictionary.size };
  }
}

export interface IndexPrebuildOptions {
  /** Longest stretch of synchronous indexing before yielding to the event loop. */
  sliceMs?: number;
  yieldToEventLoop?: () => Promise<void>;
  clock?: () => number;
}

export interface IndexPrebuildStats {
  articleCount: number;
  indexedArticles: number;
  durationMs: number;
  busyMs: number;
  slices: number;
  cancelled: boolean;
}

const defaultYield = (): Promise<void> => new Promise((resolve) => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)));
const defaultClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface CatalogueCacheResult {
  articles: NormalizedArticle[];
  index: CatalogueArticleIndex;
  diagnostics: CatalogueCacheDiagnostics;
}

export interface PublisherCatalogueCacheOptions {
  ttlMs?: number;
  maxStaleMs?: number;
  maxArticles?: number;
  now?: () => number;
  snapshotStore?: CatalogueSnapshotStore;
  onRefreshError?: (publisherId: string, error: unknown, background: boolean) => void;
  /** Build match indexes in the background after every load, refresh or snapshot hydration. */
  prebuildIndexes?: boolean | IndexPrebuildOptions;
  onIndexPrebuilt?: (publisherId: string, stats: IndexPrebuildStats & { trigger: 'load' | 'snapshot' }) => void;
  /** Called once per source refresh, after any snapshot write has finished. */
  onRefreshComplete?: (publisherId: string, report: CatalogueRefreshReport) => void;
}

interface CacheEntry {
  publisherId: string;
  key: string;
  refreshedAt: number;
  articles: NormalizedArticle[];
  index: CatalogueArticleIndex;
  timings: ContentTimingDiagnostics;
  /** True once this version is known to be stored as the persisted snapshot. */
  snapshotPersisted?: boolean;
  fingerprint?: Promise<string>;
}

/**
 * Cheap content fingerprint (FNV-1a over ID, dates, title and description length), computed in slices.
 * Equal fingerprints mean the persisted snapshot is already current and need not be rewritten.
 */
export async function catalogueFingerprint(articles: readonly NormalizedArticle[]): Promise<string> {
  const parts = await mapInSlices(articles, (article) => `${article.id}\u0001${article.url}\u0001${article.publishedAt ?? ''}\u0001${article.updatedAt ?? ''}\u0001${article.title}\u0001${article.description?.length ?? 0}\u0001${article.imageUrl ?? ''}\u0001${article.categories.join('|')}`);
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${articles.length}:${(hash >>> 0).toString(16)}`;
}

function entryFingerprint(entry: CacheEntry): Promise<string> {
  entry.fingerprint ??= catalogueFingerprint(entry.articles);
  return entry.fingerprint;
}

export interface CatalogueRefreshReport {
  articleCount: number;
  refreshMs: number;
  snapshot: 'saved' | 'unchanged' | 'failed' | 'none';
  snapshotSaveMs: number;
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
  private readonly prebuildOptions?: IndexPrebuildOptions;
  private readonly onIndexPrebuilt?: PublisherCatalogueCacheOptions['onIndexPrebuilt'];
  private readonly onRefreshComplete?: PublisherCatalogueCacheOptions['onRefreshComplete'];

  constructor(options: PublisherCatalogueCacheOptions = {}) {
    this.ttlMs = Math.max(0, options.ttlMs ?? 5 * 60 * 1000);
    this.maxStaleMs = Math.max(this.ttlMs, options.maxStaleMs ?? 24 * 60 * 60 * 1000);
    this.maxArticles = Math.max(1, options.maxArticles ?? 25_000);
    this.now = options.now ?? Date.now;
    this.snapshotStore = options.snapshotStore;
    this.onRefreshError = options.onRefreshError;
    this.prebuildOptions = options.prebuildIndexes === true ? {} : options.prebuildIndexes || undefined;
    this.onIndexPrebuilt = options.onIndexPrebuilt;
    this.onRefreshComplete = options.onRefreshComplete;
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
      return { articles: shared.articles, index: shared.index, diagnostics: { ...shared.diagnostics, catalogueRefreshReason: 'shared_refresh' } };
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
    this.entries.get(publisherId)?.index.cancel();
    this.entries.delete(publisherId);
    for (const key of this.inFlight.keys()) if (key.startsWith(`${publisherId}:`)) this.inFlight.delete(key);
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.index.cancel();
    this.entries.clear();
    this.inFlight.clear();
  }

  /**
   * Writes the snapshot in the background, but only when the catalogue changed: rewriting an unchanged
   * multi-megabyte snapshot on every refresh costs serialization time and a long database write for nothing.
   */
  private async persistSnapshot(entry: CacheEntry, previous: CacheEntry | undefined, refreshMs: number): Promise<void> {
    const report: CatalogueRefreshReport = { articleCount: entry.articles.length, refreshMs, snapshot: 'none', snapshotSaveMs: 0 };
    if (this.snapshotStore) {
      const startedAt = this.now();
      try {
        const unchanged = Boolean(previous?.snapshotPersisted && previous.key === entry.key && await entryFingerprint(previous) === await entryFingerprint(entry));
        if (unchanged) {
          entry.snapshotPersisted = true;
          report.snapshot = 'unchanged';
        } else {
          await this.snapshotStore.save({ publisherId: entry.publisherId, sourceKey: entry.key, articles: entry.articles, refreshedAt: new Date(entry.refreshedAt).toISOString() });
          entry.snapshotPersisted = true;
          report.snapshot = 'saved';
        }
      } catch (error) {
        report.snapshot = 'failed';
        this.onRefreshError?.(entry.publisherId, error, true);
      }
      report.snapshotSaveMs = Math.max(0, this.now() - startedAt);
    }
    this.onRefreshComplete?.(entry.publisherId, report);
  }

  /** Makes an entry current, cancels the replaced version's prebuild and starts this version's. */
  private install(entry: CacheEntry, trigger: 'load' | 'snapshot'): void {
    const previous = this.entries.get(entry.publisherId);
    if (previous && previous !== entry) previous.index.cancel();
    this.entries.set(entry.publisherId, entry);
    if (!this.prebuildOptions) return;
    void entry.index.prebuild(this.prebuildOptions)
      .then((stats) => { if (!stats.cancelled) this.onIndexPrebuilt?.(entry.publisherId, { ...stats, trigger }); })
      .catch((error) => this.onRefreshError?.(entry.publisherId, error, true));
  }

  private warm(entry: CacheEntry, age: number): CatalogueCacheResult {
    return { articles: entry.articles, index: entry.index, diagnostics: { sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, cataloguePreparationMs: 0, catalogueCacheHit: true, catalogueCacheAgeMs: age, catalogueRefreshMs: 0, catalogueRefreshReason: 'warm' } };
  }

  private stale(entry: CacheEntry, age: number): CatalogueCacheResult {
    return { articles: entry.articles, index: entry.index, diagnostics: { sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, cataloguePreparationMs: 0, catalogueCacheHit: true, catalogueCacheAgeMs: age, catalogueRefreshMs: 0, catalogueRefreshReason: 'stale', catalogueStale: true } };
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
            const entry: CacheEntry = { publisherId, key, refreshedAt, articles: snapshot.articles, index: new CatalogueArticleIndex(snapshot.articles), timings: {}, snapshotPersisted: true };
            this.install(entry, 'snapshot');
            const age = Math.max(0, this.now() - refreshedAt);
            if (age < this.maxStaleMs) return { articles: entry.articles, index: entry.index, diagnostics: { sourceFetchMs: 0, sourceReadMs: 0, sourceParseMs: 0, normalizationMs: 0, cataloguePreparationMs: 0, catalogueSnapshotLookupMs: Math.max(0, Date.now() - snapshotStartedAt), catalogueCacheHit: true, catalogueCacheAgeMs: age, catalogueRefreshMs: 0, catalogueRefreshReason: 'snapshot', catalogueStale: age >= this.ttlMs } };
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
      const entry: CacheEntry = { publisherId, key, refreshedAt, articles: loaded.articles, index: new CatalogueArticleIndex(loaded.articles), timings: loaded.timings ?? {} };
      this.install(entry, 'load');
      void this.persistSnapshot(entry, existing, Math.max(0, this.now() - startedAt));
      return { articles: loaded.articles, index: entry.index, diagnostics: { ...(loaded.timings ?? {}), catalogueCacheHit: false, catalogueCacheAgeMs: 0, catalogueRefreshMs: Math.max(0, this.now() - startedAt), catalogueRefreshReason: reason } };
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
