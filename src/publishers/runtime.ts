import { DeterministicExplanationProvider, type PublisherDefinition, type PublisherRegistry } from '../core';
import { createContentAdapter } from './content';
import type { ContentSourceConfig, WvcCatalogueReader } from './content';
import type { PublisherManifest } from './manifest';
import { manifestToPublisherConfig } from './manifest';
import { PublisherStoreError, type PublisherRecord, type PublisherStore } from './store';

export interface PublisherRuntimeOptions {
  store?: PublisherStore;
  fetchImpl?: typeof fetch;
  resolveSecret?: (reference: string) => string | undefined;
  cacheTtlMs?: number;
  /** Rows for WVC catalogue sources (Postgres article store). */
  wvcCatalogueStore?: WvcCatalogueReader;
}

export interface PublisherRuntimeCapabilities {
  persistenceMode: 'postgres' | 'memory' | 'static';
  writable: boolean;
  databaseBacked: boolean;
  createAllowed: boolean;
  editAllowed: boolean;
}

export interface PublisherRuntimeDiagnostics {
  publisherId: string;
  runtimeSource?: string;
  registryMode: PublisherRuntimeCapabilities['persistenceMode'];
  sourceType?: string;
  feedUrlPresent?: boolean;
  maxBytes?: number;
  candidateLimit?: number;
  adapterResolved: boolean;
  runtimeCacheHit: boolean;
  runtimeVersion: number;
  configVersion?: string;
}

/** Keep older RSS rows readable without mutating the persisted manifest. */
function normalizePersistedManifest(manifest: PublisherManifest): PublisherManifest {
  const source = manifest.contentSource as (ContentSourceConfig & { feed?: unknown; url?: unknown }) | undefined;
  if (!source || (source.type !== 'rss' && source.type !== 'atom') || typeof source.feedUrl === 'string') return manifest;
  const legacyUrl = typeof source.feed === 'string' ? source.feed : typeof source.url === 'string' ? source.url : undefined;
  if (!legacyUrl) return manifest;
  return { ...manifest, contentSource: { ...source, feedUrl: legacyUrl } as ContentSourceConfig };
}

function stableManifestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableManifestValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stableManifestValue(child)]));
}

function manifestFingerprint(manifest: PublisherManifest): string {
  return JSON.stringify(stableManifestValue(normalizePersistedManifest(manifest)));
}

/** Resolves persisted publisher manifests into the existing synchronous registry contract. */
export class PublisherRuntime {
  private loadedAt = 0;
  private loading?: Promise<void>;
  private readonly ttlMs: number;
  private readonly staticDefinitions = new Map<string, PublisherDefinition>();
  private readonly runtimeVersions = new Map<string, number>();
  private readonly manifestFingerprints = new Map<string, string>();

  constructor(private readonly registry: PublisherRegistry, private readonly options: PublisherRuntimeOptions = {}) {
    this.ttlMs = Math.max(0, options.cacheTtlMs ?? 5_000);
    for (const definition of registry.list()) this.staticDefinitions.set(definition.config.publisherId, definition);
  }

  async ensureLoaded(force = false): Promise<void> {
    if (!this.options.store) return;
    if (!force && this.loadedAt && Date.now() - this.loadedAt < this.ttlMs) return;
    if (this.loading) return this.loading;
    this.loading = this.reload().finally(() => { this.loading = undefined; });
    return this.loading;
  }

  async reload(): Promise<void> {
    if (!this.options.store) return;
    const records = await this.options.store.list();
    for (const record of records) this.apply(record);
    this.loadedAt = Date.now();
  }

  async invalidate(): Promise<void> {
    this.loadedAt = 0;
    await this.ensureLoaded(true);
  }

  async get(publisherId: string): Promise<PublisherDefinition | undefined> {
    await this.ensureLoaded();
    return this.registry.get(publisherId);
  }

  describe(publisherId: string): PublisherRuntimeDiagnostics {
    const definition = this.registry.get(publisherId);
    const source = definition?.manifest?.contentSource as (ContentSourceConfig & { feed?: unknown; url?: unknown }) | undefined;
    const feedUrlPresent = source?.type === 'rss' || source?.type === 'atom' ? typeof source.feedUrl === 'string' && source.feedUrl.length > 0 : undefined;
    const mode = this.capabilities().persistenceMode;
    return {
      publisherId,
      runtimeSource: source?.type,
      registryMode: mode,
      sourceType: source?.type ?? definition?.manifest?.content?.adapterId,
      feedUrlPresent,
      maxBytes: source?.type === 'rss' || source?.type === 'atom' ? source.maxBytes : undefined,
      candidateLimit: source && 'candidateLimit' in source && typeof source.candidateLimit === 'number' ? source.candidateLimit : definition?.config?.content?.candidateRetrievalLimit,
      adapterResolved: Boolean(definition?.adapter),
      runtimeCacheHit: Boolean(this.options.store && this.loadedAt),
      runtimeVersion: this.runtimeVersions.get(publisherId) ?? 0,
      configVersion: definition?.manifest?.publisherConfigVersion,
    };
  }

  async list(): Promise<PublisherDefinition[]> {
    await this.ensureLoaded();
    return this.registry.list();
  }

  capabilities(): PublisherRuntimeCapabilities {
    const mode = this.options.store?.mode ?? (this.options.store ? 'memory' : 'static');
    const writable = Boolean(this.options.store);
    return {
      persistenceMode: mode,
      writable,
      databaseBacked: mode === 'postgres',
      createAllowed: writable,
      editAllowed: writable,
    };
  }

  async create(manifest: PublisherManifest): Promise<PublisherDefinition> {
    if (!this.options.store) throw new PublisherStoreError('unavailable', 'Publisher persistence is not configured.');
    const record = await this.options.store.create(manifest);
    this.loadedAt = 0;
    this.apply(record);
    this.loadedAt = Date.now();
    return this.registry.get(manifest.publisherId)!;
  }

  async update(manifest: PublisherManifest): Promise<PublisherDefinition> {
    if (!this.options.store) throw new PublisherStoreError('unavailable', 'Publisher persistence is not configured.');
    let record: PublisherRecord;
    try {
      record = await this.options.store.update(manifest);
    } catch (error) {
      if (!(error instanceof PublisherStoreError) || error.code !== 'not_found') throw error;
      record = await this.options.store.create(manifest);
    }
    this.loadedAt = 0;
    this.apply(record);
    this.loadedAt = Date.now();
    return this.registry.get(manifest.publisherId)!;
  }

  /** Builds an unsaved definition for draft content checks without changing runtime state. */
  draft(manifest: PublisherManifest): PublisherDefinition {
    return this.definition(manifest, this.staticDefinitions.get(manifest.publisherId) ?? this.registry.get(manifest.publisherId));
  }

  private apply(record: PublisherRecord): void {
    const publisherId = record.manifest.publisherId;
    const fingerprint = manifestFingerprint(record.manifest);
    if (this.manifestFingerprints.get(publisherId) === fingerprint && this.registry.get(publisherId)) return;
    const definition = this.definition(record.manifest, this.staticDefinitions.get(publisherId) ?? this.registry.get(publisherId));
    this.registry.upsert(definition);
    this.manifestFingerprints.set(publisherId, fingerprint);
    this.runtimeVersions.set(publisherId, (this.runtimeVersions.get(publisherId) ?? 0) + 1);
  }

  private definition(manifest: PublisherManifest, base?: PublisherDefinition): PublisherDefinition {
    const runtimeManifest = normalizePersistedManifest(manifest);
    const source = runtimeManifest.contentSource;
    const keepBaseAdapter = Boolean(base && (!source || source.type === 'static-demo' || (source.type === 'rest-json' && source.baseUrl.startsWith('/api/'))));
    const adapter = keepBaseAdapter
      ? base!.adapter
      : source && source.type !== 'static-demo'
      ? createContentAdapter(runtimeManifest.publisherId, source as ContentSourceConfig, { fetchImpl: this.options.fetchImpl, resolveSecret: this.options.resolveSecret, wvcCatalogueStore: this.options.wvcCatalogueStore })
      : base?.adapter;
    if (!adapter) throw new PublisherStoreError('invalid_record', `Publisher ${runtimeManifest.publisherId} has no compatible content adapter.`);
    return {
      config: manifestToPublisherConfig(runtimeManifest),
      adapter,
      explanationProvider: base?.explanationProvider ?? new DeterministicExplanationProvider(),
      manifest: runtimeManifest,
    };
  }
}
