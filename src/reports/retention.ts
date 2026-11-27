/**
 * Retention: reports (with their recommendations) and their feedback are deleted once older than
 * REPORT_RETENTION_DAYS (default 365), and analytics events once older than ANALYTICS_RETENTION_DAYS (default 365,
 * by the time the event occurred). A cleanup runs shortly after start and every 6 hours, in batches, and logs
 * report_retention_cleanup with counts only.
 */
import { DEFAULT_REPORT_RETENTION_DAYS } from '../core/privacy';
import type { FeedbackStore } from './feedback';
import type { ReportStore } from './types';
import type { AnalyticsStore } from '../analytics/types';
import type { StructuredLogger } from '../server/logging';

const DAY_MS = 86_400_000;
export const MIN_REPORT_RETENTION_DAYS = 7;
export const MAX_REPORT_RETENTION_DAYS = 3_650;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60_000;
const BATCH_SIZE = 500;
/** Batches per run: a backlog larger than this is finished by the next runs. */
const MAX_BATCHES = 40;
/** Analytics events are small and many: larger batches, same per-run cap of batches per publisher. */
const ANALYTICS_BATCH_SIZE = 5_000;

function retentionDaysFrom(raw: string | undefined): number {
  const value = raw?.trim() ? Number(raw.trim()) : Number.NaN;
  return Number.isInteger(value) && value >= MIN_REPORT_RETENTION_DAYS && value <= MAX_REPORT_RETENTION_DAYS ? value : DEFAULT_REPORT_RETENTION_DAYS;
}

/** REPORT_RETENTION_DAYS as a whole number of days from 7 to 3650; anything else falls back to 365. */
export function reportRetentionDays(environment: Record<string, string | undefined>): number {
  return retentionDaysFrom(environment.REPORT_RETENTION_DAYS);
}

/** ANALYTICS_RETENTION_DAYS, with the same rules: whole days from 7 to 3650, else 365. */
export function analyticsRetentionDays(environment: Record<string, string | undefined>): number {
  return retentionDaysFrom(environment.ANALYTICS_RETENTION_DAYS);
}

export interface RetentionRun { reportsDeleted: number; feedbackDeleted: number; analyticsEventsDeleted: number }

export class ReportRetention {
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;
  private running?: Promise<RetentionRun>;

  constructor(private readonly options: { days: number; reports: ReportStore; feedback?: FeedbackStore; analytics?: AnalyticsStore; analyticsDays?: number; logger?: StructuredLogger; now?: () => number }) {}

  get days(): number { return this.options.days; }

  get analyticsDays(): number { return this.options.analyticsDays ?? DEFAULT_REPORT_RETENTION_DAYS; }

  /** Deletes reports (and their feedback) and analytics events older than their retention periods. One run at a time. */
  run(): Promise<RetentionRun> {
    if (!this.running) this.running = this.cleanup().finally(() => { this.running = undefined; });
    return this.running;
  }

  start(): void {
    if (this.timer || (!this.options.reports.deleteCreatedBefore && !this.options.analytics?.deleteOccurredBefore)) return;
    const runSafely = () => { void this.run().catch((error: unknown) => this.options.logger?.error('report_retention_failed', { errorName: error instanceof Error ? error.name : 'unknown' })); };
    this.first = setTimeout(runSafely, FIRST_RUN_DELAY_MS);
    this.timer = setInterval(runSafely, CLEANUP_INTERVAL_MS);
    (this.first as { unref?: () => void }).unref?.();
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = undefined;
    this.timer = undefined;
  }

  private async cleanup(): Promise<RetentionRun> {
    const { reports, feedback, analytics, logger } = this.options;
    const startedAt = Date.now();
    const now = this.options.now?.() ?? Date.now();
    let reportsDeleted = 0;
    let feedbackDeleted = 0;
    if (reports.deleteCreatedBefore) {
      const cutoff = new Date(now - this.options.days * DAY_MS);
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const ids = await reports.deleteCreatedBefore(cutoff, BATCH_SIZE);
        reportsDeleted += ids.length;
        if (ids.length && feedback?.removeForReports) feedbackDeleted += await feedback.removeForReports(ids);
        if (ids.length < BATCH_SIZE) break;
      }
    }
    let analyticsEventsDeleted = 0;
    if (analytics?.deleteOccurredBefore) {
      const cutoff = new Date(now - this.analyticsDays * DAY_MS);
      for (const publisherId of await analytics.listPublisherIds()) {
        for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
          const deleted = await analytics.deleteOccurredBefore(publisherId, cutoff, ANALYTICS_BATCH_SIZE);
          analyticsEventsDeleted += deleted;
          if (deleted < ANALYTICS_BATCH_SIZE) break;
        }
      }
    }
    logger?.info('report_retention_cleanup', { reportsDeleted, feedbackDeleted, analyticsEventsDeleted, retentionDays: this.options.days, analyticsRetentionDays: this.analyticsDays, durationMs: Date.now() - startedAt });
    return { reportsDeleted, feedbackDeleted, analyticsEventsDeleted };
  }
}
