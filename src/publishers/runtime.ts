import { DeterministicExplanationProvider, type PublisherDefinition, type PublisherRegistry } from '../core';
import { createContentAdapter } from './content';
import type { ContentSourceConfig } from './content';
import type { PublisherManifest } from './manifest';
import { manifestToPublisherConfig } from './manifest';
import { PublisherStoreError, type PublisherRecord, type PublisherStore } from './store';

export interface PublisherRuntimeOptions {
  store?: PublisherStore;
  fetchImpl?: typeof fetch;
  resolveSecret?: (reference: string) => string | undefined;
  cacheTtlMs?: number;
}

/** Resolves persisted publisher manifests into the existing synchronous registry contract. */
export class PublisherRuntime {
  private loadedAt = 0;
  private loading?: Promise<void>;
  private readonly ttlMs: number;
  private readonly staticDefinitions = new Map<string, PublisherDefinition>();

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

  async list(): Promise<PublisherDefinition[]> {
    await this.ensureLoaded();
    return this.registry.list();
  }

  async create(manifest: PublisherManifest): Promise<PublisherDefinition> {
    if (!this.options.store) throw new PublisherStoreError('unavailable', 'Publisher persistence is not configured.');
    const record = await this.options.store.create(manifest);
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
    this.apply(record);
    this.loadedAt = Date.now();
    return this.registry.get(manifest.publisherId)!;
  }

  /** Builds an unsaved definition for draft content checks without changing runtime state. */
  draft(manifest: PublisherManifest): PublisherDefinition {
    return this.definition(manifest, this.staticDefinitions.get(manifest.publisherId) ?? this.registry.get(manifest.publisherId));
  }

  private apply(record: PublisherRecord): void {
    this.registry.upsert(this.definition(record.manifest, this.staticDefinitions.get(record.manifest.publisherId) ?? this.registry.get(record.manifest.publisherId)));
  }

  private definition(manifest: PublisherManifest, base?: PublisherDefinition): PublisherDefinition {
    const source = manifest.contentSource;
    const keepBaseAdapter = Boolean(base && (!source || source.type === 'static-demo' || (source.type === 'rest-json' && source.baseUrl.startsWith('/api/'))));
    const adapter = keepBaseAdapter
      ? base!.adapter
      : source && source.type !== 'static-demo'
      ? createContentAdapter(manifest.publisherId, source as ContentSourceConfig, { fetchImpl: this.options.fetchImpl, resolveSecret: this.options.resolveSecret })
      : base?.adapter;
    if (!adapter) throw new PublisherStoreError('invalid_record', `Publisher ${manifest.publisherId} has no compatible content adapter.`);
    return {
      config: manifestToPublisherConfig(manifest),
      adapter,
      explanationProvider: base?.explanationProvider ?? new DeterministicExplanationProvider(),
      manifest,
    };
  }
}
