import type { Intent, NormalizedArticle, PublisherAdapter, SearchOptions } from '../../core';
import { SitemapContentAdapter } from '../content';
import type { ContentImportDiagnostics, ContentTimingDiagnostics } from '../content';
import { ibiContentSource } from './config';
import { normalizeIbiArticle } from './normalizer';

export class IbiPublisherAdapter implements PublisherAdapter<unknown> {
  readonly publisherId = 'ibi';
  readonly sourceType = 'sitemap' as const;
  readonly supportsPagination = true;
  private readonly delegate: SitemapContentAdapter;

  constructor(fetchImpl?: typeof fetch) {
    this.delegate = new SitemapContentAdapter(this.publisherId, ibiContentSource, fetchImpl);
  }

  get lastDiagnostics(): ContentImportDiagnostics | undefined { return this.delegate.lastDiagnostics; }
  get sourceTimings(): ContentTimingDiagnostics | undefined { return this.delegate.sourceTimings; }

  async search(intent: Intent, options: SearchOptions): Promise<unknown[]> { return this.delegate.search(intent, options); }
  async loadCatalogue(options?: { limit?: number; onDebug?: import('../../core').DebugSink }): Promise<unknown[]> { return this.delegate.loadCatalogue!(options); }
  selectCatalogue(articles: NormalizedArticle[], intent: Intent, options: { limit: number; archiveWide?: boolean }): NormalizedArticle[] { return this.delegate.selectCatalogue!(articles, intent, options); }
  fetch(intent: Intent, options: SearchOptions): Promise<unknown[]> { return this.search(intent, options); }
  normalizeArticle(raw: unknown) { return normalizeIbiArticle(raw); }
  healthCheck() { return this.delegate.healthCheck(); }
}
