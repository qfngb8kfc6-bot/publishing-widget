import { fetchWvcPage, WvcError, type WvcCatalogueParseOptions, type WvcEnrichmentSourceConfig, type WvcPage } from '../publishers/content';
import type { StructuredLogger } from '../server/logging';
import type { ArticleTextStore, TextSyncState, WvcCatalogueStore } from './article-texts';

/** What the admin Content Health view shows. Codes and counts only: never text, URLs or keys. */
export interface TextEnrichmentStatus {
  enabled: boolean;
  recordsSynced: number;
  backfillComplete: boolean;
  backfillLastPage: number;
  totalPages?: number;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastErrorCode?: string;
  lastErrorAt?: string;
}

export interface TextEnrichmentSyncOptions {
  publisherId: string;
  source: WvcEnrichmentSourceConfig;
  store: ArticleTextStore & Partial<WvcCatalogueStore>;
  /**
   * Set for a WVC catalogue source: each story's catalogue fields (title, URL, date, description, image) are parsed
   * and written with its text. Enrichment-only publishers (SGI) leave it unset and write exactly what they did.
   */
  catalogue?: WvcCatalogueParseOptions;
  resolveSecret: (reference: string) => string | undefined;
  /** Runs one job on the catalogue cache's background queue, so a page never overlaps a refresh, prebuild or snapshot save. */
  runExclusive: <T>(job: () => Promise<T>) => Promise<T>;
  fetchImpl?: typeof fetch;
  logger?: StructuredLogger;
  /** Called after a page wrote rows, with the story codes written (to refresh lead match indexes). */
  onTextsChanged?: (publisherId: string, storyCodes: string[]) => void;
  /** Pause between page requests (one request at a time). */
  pageDelayMs?: number;
  /** Incremental sync interval once the backfill is complete. */
  incrementalIntervalMs?: number;
  /** Retry delay after a failed backfill cycle. */
  failureRetryMs?: number;
  /** Delay before the first cycle after start(), so startup prewarm goes first. */
  startDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { const timer = setTimeout(resolve, ms); (timer as { unref?: () => void }).unref?.(); });

/**
 * Background full-text sync for one publisher. Never on the request path. The first cycles backfill every page
 * once (oldest first, resumable from the last completed page); afterwards each cycle fetches the last two pages,
 * where new and recently edited stories land. Rows are written only when LASTMODIFIED is newer.
 */
export class TextEnrichmentSync {
  private readonly pageDelayMs: number;
  private readonly incrementalIntervalMs: number;
  private readonly failureRetryMs: number;
  private readonly startDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<{ backfillComplete: boolean; failed: boolean }>;
  private stopped = false;

  constructor(private readonly options: TextEnrichmentSyncOptions) {
    this.pageDelayMs = Math.max(0, options.pageDelayMs ?? 1000);
    this.incrementalIntervalMs = Math.max(60_000, options.incrementalIntervalMs ?? 30 * 60 * 1000);
    this.failureRetryMs = Math.max(1000, options.failureRetryMs ?? 5 * 60 * 1000);
    this.startDelayMs = Math.max(0, options.startDelayMs ?? 60_000);
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  get publisherId(): string { return this.options.publisherId; }

  start(): void {
    if (this.timer || this.running) return;
    this.stopped = false;
    this.schedule(this.startDelayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // An unfinished backfill (failed or interrupted) resumes sooner; incremental passes keep their interval.
      void this.runCycle().then((outcome) => this.schedule(outcome.backfillComplete ? this.incrementalIntervalMs : this.failureRetryMs));
    }, delayMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** One cycle: backfill until done, otherwise an incremental pass. Never throws; failures are recorded. */
  async runCycle(): Promise<{ backfillComplete: boolean; failed: boolean }> {
    if (this.running) return this.running;
    this.running = this.cycle();
    try { return await this.running; } finally { this.running = undefined; }
  }

  private async cycle(): Promise<{ backfillComplete: boolean; failed: boolean }> {
    const { publisherId, store, logger } = this.options;
    let state: TextSyncState = { backfillLastPage: 0, backfillComplete: false };
    let stage: 'backfill' | 'incremental' = 'backfill';
    let page = 0;
    try {
      state = (await store.syncState(publisherId)) ?? state;
      stage = state.backfillComplete ? 'incremental' : 'backfill';
      if (stage === 'backfill') {
        page = state.backfillLastPage + 1;
        while (!this.stopped) {
          const { result, written } = await this.fetchAndStore(page);
          state = { ...state, totalPages: result.totalPages, totalRecords: result.totalRecords, backfillLastPage: page, lastSyncAt: this.iso(), lastSuccessAt: this.iso(), lastErrorCode: undefined, lastErrorAt: undefined };
          if (page >= result.totalPages) state.backfillComplete = true;
          await store.saveSyncState(publisherId, state);
          if (page % 10 === 0 || state.backfillComplete) logger?.info('wvc_sync_progress', { publisherId, stage, page, totalPages: result.totalPages, recordsWritten: written });
          if (state.backfillComplete) break;
          page += 1;
          await this.sleep(this.pageDelayMs);
        }
      } else {
        const probePage = Math.max(1, state.totalPages ?? 1);
        page = probePage;
        const probe = await this.fetchAndStore(probePage);
        let written = probe.written;
        const totalPages = probe.result.totalPages;
        for (const next of [totalPages - 1, totalPages]) {
          if (next < 1 || next === probePage || this.stopped) continue;
          await this.sleep(this.pageDelayMs);
          page = next;
          written += (await this.fetchAndStore(next)).written;
        }
        state = { ...state, totalPages, totalRecords: probe.result.totalRecords, lastSyncAt: this.iso(), lastSuccessAt: this.iso(), lastErrorCode: undefined, lastErrorAt: undefined };
        await store.saveSyncState(publisherId, state);
        logger?.info('wvc_sync_progress', { publisherId, stage, page, totalPages, recordsWritten: written });
      }
      return { backfillComplete: state.backfillComplete, failed: false };
    } catch (error) {
      const errorCode = error instanceof WvcError ? error.code : 'wvc_sync_error';
      logger?.error('wvc_sync_failed', { publisherId, stage, page, errorCode, errorName: error instanceof Error ? error.name : 'unknown' });
      try {
        await store.saveSyncState(publisherId, { ...state, lastSyncAt: this.iso(), lastErrorCode: errorCode, lastErrorAt: this.iso() });
      } catch {
        // The failure is already logged; the state write is retried on the next cycle.
      }
      return { backfillComplete: state.backfillComplete, failed: true };
    }
  }

  private async fetchAndStore(page: number): Promise<{ result: WvcPage; written: number }> {
    const { publisherId, source, store, resolveSecret, fetchImpl, runExclusive, onTextsChanged } = this.options;
    const outcome = await runExclusive(async () => {
      const catalogue = this.options.catalogue;
      const result = await fetchWvcPage(source, page, { fetchImpl, resolveSecret, ...(catalogue ? { catalogue } : {}) });
      const codes = catalogue && store.upsertCatalogue ? await store.upsertCatalogue(publisherId, result.stories, this.iso()) : await store.upsert(publisherId, result.stories, this.iso());
      // Only counts leave this job: the page's text is released as soon as it is written.
      return { result: { ...result, stories: [] }, codes };
    });
    if (outcome.codes.length) onTextsChanged?.(publisherId, outcome.codes);
    return { result: outcome.result, written: outcome.codes.length };
  }

  async status(enabled: boolean): Promise<TextEnrichmentStatus> {
    const [state, recordsSynced] = await Promise.all([this.options.store.syncState(this.options.publisherId), this.options.store.count(this.options.publisherId)]);
    return { enabled, recordsSynced, backfillComplete: state?.backfillComplete ?? false, backfillLastPage: state?.backfillLastPage ?? 0, totalPages: state?.totalPages, lastSyncAt: state?.lastSyncAt, lastSuccessAt: state?.lastSuccessAt, lastErrorCode: state?.lastErrorCode, lastErrorAt: state?.lastErrorAt };
  }

  private iso(): string { return new Date(this.now()).toISOString(); }
}
