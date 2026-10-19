import type { ReportRecord, ReportStore } from './types';
import { sectionsFromRecommendations } from './sections';

function clone(report: ReportRecord): ReportRecord {
  return structuredClone(report);
}

export class MemoryReportStore implements ReportStore {
  readonly reports = new Map<string, ReportRecord>();
  async save(report: ReportRecord): Promise<void> { this.reports.set(report.id, clone(report)); }
  async get(id: string, publisherId?: string): Promise<ReportRecord | null> {
    const report = this.reports.get(id);
    if (!report || (publisherId && report.publisherId !== publisherId)) return null;
    return clone(report);
  }
}

export interface ReportSqlClient {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  /** Present on a pg Pool: checks out one connection so a save can run as a single transaction. */
  connect?(): Promise<ReportSqlConnection>;
}

export interface ReportSqlConnection {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  release(error?: Error | boolean): void;
}

const REPORT_RECOMMENDATION_COLUMNS = 9;

function reportWriteStatements(report: ReportRecord): Array<[string, unknown[]]> {
  const statements: Array<[string, unknown[]]> = [
    [`INSERT INTO reports (id, publisher_id, session_id, company_url, company_domain, company_name, job_title, professional_profile_json, retrieval_context_json, overall_match_score, generated_summary, generation_version, ranking_version, professional_profile_version, ai_provider_version, publisher_config_version, widget_version, created_at, updated_at, summary_source, summary_fallback_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`, [report.id, report.publisherId, report.sessionId, report.companyUrl, report.companyDomain, report.companyName ?? null, report.jobTitle, JSON.stringify(report.professionalProfile), JSON.stringify(report.retrievalContext), report.overallMatchScore, report.generatedSummary, report.generationVersion, report.rankingVersion, report.professionalProfileVersion, report.aiProviderVersion, report.publisherConfigVersion, report.widgetVersion, report.createdAt, report.updatedAt, report.summarySource ?? null, report.summaryFallbackReason ?? null]],
    ['DELETE FROM report_recommendations WHERE report_id = $1', [report.id]],
  ];
  if (report.recommendations.length) {
    const placeholders = report.recommendations.map((_, index) => {
      const base = index * REPORT_RECOMMENDATION_COLUMNS;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7}::jsonb,$${base + 8}::jsonb,$${base + 9})`;
    });
    const parameters = report.recommendations.flatMap((recommendation) => [report.id, recommendation.articleId, recommendation.rank, recommendation.rawScore, recommendation.displayScore, recommendation.explanation, JSON.stringify(recommendation.article), JSON.stringify(recommendation.rankingMetadata), report.createdAt]);
    statements.push([`INSERT INTO report_recommendations (report_id, article_id, rank, raw_score, display_score, reason, article_json, ranking_metadata_json, created_at) VALUES ${placeholders.join(',')}`, parameters]);
  }
  return statements;
}

/** Postgres adapter for persisted reports. Structured profile and recommendations stay versioned JSONB. */
export class PostgresReportStore implements ReportStore {
  constructor(private readonly client: ReportSqlClient) {}

  /** Writes the report and all recommendations atomically: one transaction, one multi-row recommendation insert. */
  async save(report: ReportRecord): Promise<void> {
    const statements = reportWriteStatements(report);
    if (!this.client.connect) {
      for (const [sql, parameters] of statements) await this.client.query(sql, parameters);
      return;
    }
    const connection = await this.client.connect();
    try {
      await connection.query('BEGIN');
      for (const [sql, parameters] of statements) await connection.query(sql, parameters);
      await connection.query('COMMIT');
    } catch (error) {
      try { await connection.query('ROLLBACK'); } catch { /* the original error is the one worth reporting */ }
      connection.release(error instanceof Error ? error : true);
      throw error;
    }
    connection.release();
  }

  async get(id: string, publisherId?: string): Promise<ReportRecord | null> {
    const parameters: unknown[] = [id];
    let where = 'r.id = $1';
    if (publisherId) { parameters.push(publisherId); where += ' AND r.publisher_id = $2'; }
    const reportResult = await this.client.query<Record<string, unknown>>(`SELECT r.* FROM reports r WHERE ${where} LIMIT 1`, parameters);
    const row = reportResult.rows[0];
    if (!row) return null;
    const recommendations = await this.client.query<Record<string, unknown>>('SELECT article_id, rank, raw_score, display_score, reason, article_json, ranking_metadata_json FROM report_recommendations WHERE report_id = $1 ORDER BY rank ASC', [id]);
    const normalizedRecommendations = recommendations.rows.map((item) => ({ articleId: String(item.article_id), rank: Number(item.rank), rawScore: Number(item.raw_score), displayScore: Number(item.display_score), explanation: String(item.reason), article: item.article_json as ReportRecord['recommendations'][number]['article'], rankingMetadata: item.ranking_metadata_json as ReportRecord['recommendations'][number]['rankingMetadata'] }));
    return {
      id: String(row.id), publisherId: String(row.publisher_id), sessionId: String(row.session_id), companyUrl: String(row.company_url), companyDomain: String(row.company_domain), companyName: row.company_name ? String(row.company_name) : undefined, jobTitle: String(row.job_title),
      professionalProfile: row.professional_profile_json as ReportRecord['professionalProfile'], retrievalContext: row.retrieval_context_json as ReportRecord['retrievalContext'], overallMatchScore: Number(row.overall_match_score), generatedSummary: String(row.generated_summary), summarySource: row.summary_source === 'ai' || row.summary_source === 'deterministic' ? row.summary_source : undefined, summaryFallbackReason: typeof row.summary_fallback_reason === 'string' ? row.summary_fallback_reason : undefined,
      recommendations: normalizedRecommendations, sections: sectionsFromRecommendations(normalizedRecommendations),
      generationVersion: String(row.generation_version), rankingVersion: String(row.ranking_version), professionalProfileVersion: String(row.professional_profile_version), aiProviderVersion: String(row.ai_provider_version), publisherConfigVersion: String(row.publisher_config_version), widgetVersion: String(row.widget_version), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }
}
