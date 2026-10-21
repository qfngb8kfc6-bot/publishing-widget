/** Milestones of one report generation, in pipeline order. */
export const GENERATION_STAGES = ['company_resolved', 'profile_built', 'content_retrieved', 'ranking_complete', 'ai_complete', 'report_persisted'] as const;
export type GenerationStage = typeof GENERATION_STAGES[number];

/** Safe, personalised details shown on the loading page as they become available. Never scores or AI text. */
export interface GenerationDetails {
  companyName?: string;
  jobTitle?: string;
  /** Up to MAX_GENERATION_THEMES role themes. */
  themes?: string[];
  /** Number of publisher articles searched. */
  articlesSearched?: number;
}

export interface GenerationProgress {
  stage?: GenerationStage;
  details?: GenerationDetails;
}

export type GenerationStatus = 'running' | 'complete' | 'failed';

/** The submitted input, kept so a failed generation can be retried server-side. Never returned by status. */
export interface GenerationInput {
  companyUrl: string;
  jobTitle: string;
  sessionId?: string;
}

export interface GenerationJob {
  id: string;
  publisherId: string;
  status: GenerationStatus;
  completedStages: GenerationStage[];
  details: GenerationDetails;
  reportId?: string;
  input?: GenerationInput;
  /** Safe error code, set when status is failed. */
  errorCode?: string;
  /** The process running the job; a job from another process that stops updating is reported lost. */
  instanceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationJobStore {
  save(job: GenerationJob): Promise<void>;
  get(id: string, publisherId: string): Promise<GenerationJob | null>;
  /** Deletes jobs created before the cutoff. */
  prune?(createdBefore: Date): Promise<void>;
}

export const MAX_GENERATION_THEMES = 6;
const MAX_DETAIL_TEXT = 120;

/** Error codes a status response may carry; anything else is reported as generation_unavailable. */
export const SAFE_GENERATION_ERROR_CODES = new Set(['generation_unavailable', 'generation_interrupted', 'generation_timeout', 'invalid_publisher', 'company_resolution_failed', 'company_resolution_timeout', 'invalid_company_url', 'unsafe_company_url']);

function cleanText(value: unknown, limit = MAX_DETAIL_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  return text || undefined;
}

/** Bounds and cleans details before they are stored or returned. */
export function safeGenerationDetails(details: GenerationDetails | undefined): GenerationDetails {
  if (!details) return {};
  const themes = Array.isArray(details.themes)
    ? [...new Set(details.themes.map((theme) => cleanText(theme, 48)).filter((theme): theme is string => Boolean(theme)))].slice(0, MAX_GENERATION_THEMES)
    : undefined;
  const articles = Number(details.articlesSearched);
  return {
    ...(cleanText(details.companyName) ? { companyName: cleanText(details.companyName) } : {}),
    ...(cleanText(details.jobTitle, 160) ? { jobTitle: cleanText(details.jobTitle, 160) } : {}),
    ...(themes?.length ? { themes } : {}),
    ...(Number.isFinite(articles) && articles > 0 ? { articlesSearched: Math.round(articles) } : {}),
  };
}

function clone(job: GenerationJob): GenerationJob {
  return structuredClone(job);
}

export class MemoryGenerationJobStore implements GenerationJobStore {
  readonly jobs = new Map<string, GenerationJob>();
  async save(job: GenerationJob): Promise<void> { this.jobs.set(job.id, clone(job)); }
  async get(id: string, publisherId: string): Promise<GenerationJob | null> {
    const job = this.jobs.get(id);
    return job && job.publisherId === publisherId ? clone(job) : null;
  }
  async prune(createdBefore: Date): Promise<void> {
    for (const [id, job] of this.jobs) if (Date.parse(job.createdAt) < createdBefore.getTime()) this.jobs.delete(id);
  }
}

export interface GenerationSqlClient {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}

function jsonValue(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) as unknown : value;
}

/** Postgres adapter (migration 008). One row per generation, upserted at each stage. */
export class PostgresGenerationJobStore implements GenerationJobStore {
  constructor(private readonly client: GenerationSqlClient) {}

  async save(job: GenerationJob): Promise<void> {
    await this.client.query(
      `INSERT INTO report_generations (id, publisher_id, status, completed_stages_json, details_json, report_id, error_code, instance_id, created_at, updated_at, input_json)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, completed_stages_json = EXCLUDED.completed_stages_json, details_json = EXCLUDED.details_json, report_id = EXCLUDED.report_id, error_code = EXCLUDED.error_code, updated_at = EXCLUDED.updated_at
       WHERE report_generations.publisher_id = EXCLUDED.publisher_id`,
      [job.id, job.publisherId, job.status, JSON.stringify(job.completedStages), JSON.stringify(job.details), job.reportId ?? null, job.errorCode ?? null, job.instanceId, job.createdAt, job.updatedAt, job.input ? JSON.stringify(job.input) : null],
    );
  }

  async get(id: string, publisherId: string): Promise<GenerationJob | null> {
    const row = (await this.client.query<Record<string, unknown>>('SELECT * FROM report_generations WHERE id = $1 AND publisher_id = $2', [id, publisherId])).rows[0];
    if (!row) return null;
    const stages = jsonValue(row.completed_stages_json);
    const status = String(row.status);
    const input = jsonValue(row.input_json) as Partial<GenerationInput> | null;
    return {
      id: String(row.id),
      publisherId: String(row.publisher_id),
      status: status === 'complete' || status === 'failed' ? status : 'running',
      completedStages: Array.isArray(stages) ? stages.filter((stage): stage is GenerationStage => (GENERATION_STAGES as readonly string[]).includes(String(stage))) : [],
      details: safeGenerationDetails(jsonValue(row.details_json) as GenerationDetails),
      ...(row.report_id ? { reportId: String(row.report_id) } : {}),
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      ...(input && typeof input.companyUrl === 'string' && typeof input.jobTitle === 'string' ? { input: { companyUrl: input.companyUrl, jobTitle: input.jobTitle, ...(typeof input.sessionId === 'string' ? { sessionId: input.sessionId } : {}) } } : {}),
      instanceId: String(row.instance_id),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  async prune(createdBefore: Date): Promise<void> {
    await this.client.query('DELETE FROM report_generations WHERE created_at < $1', [createdBefore.toISOString()]);
  }
}

export interface GenerationJobsOptions {
  store?: GenerationJobStore;
  instanceId?: string;
  /** A running job from another process with no update for this long is reported lost. */
  foreignStaleMs?: number;
  /** A running job older than this is reported timed out, wherever it runs. */
  maxRuntimeMs?: number;
  /** How long jobs are kept, in memory and in the store. */
  retentionMs?: number;
  now?: () => number;
  onPersistError?: (error: unknown, jobId: string) => void;
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  throw new Error('secure_random_unavailable');
}

/**
 * Generation jobs: this process's jobs live in memory (status polls never touch the database) and every change
 * is written through to the store in order, so another process, or this one after a restart, can tell a lost
 * job from a running one. Writes never block or fail the generation itself.
 */
export class GenerationJobs {
  readonly instanceId: string;
  private readonly local = new Map<string, GenerationJob>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly store?: GenerationJobStore;
  private readonly foreignStaleMs: number;
  private readonly maxRuntimeMs: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private lastPruneAt = 0;

  constructor(private readonly options: GenerationJobsOptions = {}) {
    this.store = options.store;
    this.instanceId = options.instanceId ?? randomId();
    this.foreignStaleMs = options.foreignStaleMs ?? 30_000;
    this.maxRuntimeMs = options.maxRuntimeMs ?? 120_000;
    this.retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /** Creates a running job with an unguessable ID and waits for its first write (best effort). */
  async create(publisherId: string, details: GenerationDetails = {}, input?: GenerationInput): Promise<GenerationJob> {
    this.prune();
    const at = new Date(this.now()).toISOString();
    const job: GenerationJob = { id: randomId(), publisherId, status: 'running', completedStages: [], details: safeGenerationDetails(details), ...(input ? { input: { ...input } } : {}), instanceId: this.instanceId, createdAt: at, updatedAt: at };
    this.local.set(job.id, job);
    await this.persist(job);
    return clone(job);
  }

  /** Records a reached stage and/or newly available details. Stages only move forward. */
  progress(id: string, update: GenerationProgress): void {
    const job = this.local.get(id);
    if (!job || job.status !== 'running') return;
    if (update.stage && !job.completedStages.includes(update.stage)) {
      const reached = GENERATION_STAGES.indexOf(update.stage);
      job.completedStages = GENERATION_STAGES.filter((stage, index) => index <= reached || job.completedStages.includes(stage));
    }
    if (update.details) job.details = safeGenerationDetails({ ...job.details, ...update.details });
    job.updatedAt = new Date(this.now()).toISOString();
    void this.persist(job);
  }

  complete(id: string, reportId: string): void {
    const job = this.local.get(id);
    if (!job || job.status !== 'running') return;
    job.status = 'complete';
    job.reportId = reportId;
    job.completedStages = [...GENERATION_STAGES];
    job.updatedAt = new Date(this.now()).toISOString();
    void this.persist(job);
  }

  fail(id: string, errorCode: string): void {
    const job = this.local.get(id);
    if (!job || job.status !== 'running') return;
    job.status = 'failed';
    job.errorCode = SAFE_GENERATION_ERROR_CODES.has(errorCode) ? errorCode : 'generation_unavailable';
    job.updatedAt = new Date(this.now()).toISOString();
    void this.persist(job);
  }

  /**
   * The job as the status endpoint reports it. A running job that can no longer finish (its process restarted
   * or stopped updating it, or it ran past the runtime cap) is reported, and recorded, as failed.
   */
  async get(id: string, publisherId: string): Promise<GenerationJob | null> {
    const local = this.local.get(id);
    if (local) {
      if (local.publisherId !== publisherId) return null;
      if (local.status === 'running' && this.now() - Date.parse(local.createdAt) > this.maxRuntimeMs) this.fail(id, 'generation_timeout');
      return clone(local);
    }
    if (!this.store) return null;
    const stored = await this.store.get(id, publisherId);
    if (!stored || stored.publisherId !== publisherId || stored.status !== 'running') return stored;
    const now = this.now();
    const timedOut = now - Date.parse(stored.createdAt) > this.maxRuntimeMs;
    // Not in this process's memory: either this process restarted (same store, new instance) or another one runs it.
    const lost = stored.instanceId === this.instanceId || now - Date.parse(stored.updatedAt) > this.foreignStaleMs;
    if (!timedOut && !lost) return stored;
    const failed: GenerationJob = { ...stored, status: 'failed', errorCode: timedOut ? 'generation_timeout' : 'generation_interrupted', updatedAt: new Date(now).toISOString() };
    await this.write(failed);
    return failed;
  }

  /** Resolves once every queued write has settled (tests and shutdown). */
  async idle(): Promise<void> {
    await Promise.all([...this.writes.values()]);
  }

  private persist(job: GenerationJob): Promise<void> {
    const snapshot = clone(job);
    const previous = this.writes.get(job.id) ?? Promise.resolve();
    const next = previous.then(() => this.write(snapshot));
    this.writes.set(job.id, next);
    void next.finally(() => { if (this.writes.get(job.id) === next) this.writes.delete(job.id); });
    return next;
  }

  private async write(job: GenerationJob): Promise<void> {
    if (!this.store) return;
    try { await this.store.save(job); } catch (error) { this.options.onPersistError?.(error, job.id); }
  }

  /** Drops old jobs from memory, and from the store at most once an hour. */
  private prune(): void {
    const now = this.now();
    const cutoff = now - this.retentionMs;
    for (const [id, job] of this.local) {
      // Finished jobs are only needed in memory while their page polls; the store keeps them for the retention period.
      const finishedLongAgo = job.status !== 'running' && now - Date.parse(job.updatedAt) > 15 * 60 * 1000;
      if (finishedLongAgo || Date.parse(job.createdAt) < cutoff) this.local.delete(id);
    }
    if (!this.store?.prune || now - this.lastPruneAt < 60 * 60 * 1000) return;
    this.lastPruneAt = now;
    void this.store.prune(new Date(cutoff)).catch((error: unknown) => this.options.onPersistError?.(error, 'prune'));
  }
}
