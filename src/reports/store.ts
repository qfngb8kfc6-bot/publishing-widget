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
    [`INSERT INTO reports (id, publisher_id, session_id, company_url, company_domain, company_name, job_title, professional_profile_json, retrieval_context_json, overall_match_score, generated_summary, generation_version, ranking_version, professional_profile_version, ai_provider_version, publisher_config_version, widget_version, created_at, updated_at, summary_source, summary_fallback_reason, theme_descriptions_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb) ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`, [report.id, report.publisherId, report.sessionId, report.companyUrl, report.companyDomain, report.companyName ?? null, report.jobTitle, JSON.stringify(report.professionalProfile), JSON.stringify(report.retrievalContext), report.overallMatchScore, report.generatedSummary, report.generationVersion, report.rankingVersion, report.professionalProfileVersion, report.aiProviderVersion, report.publisherConfigVersion, report.widgetVersion, report.createdAt, report.updatedAt, report.summarySource ?? null, report.summaryFallbackReason ?? null, report.themeDescriptions ? JSON.stringify(report.themeDescriptions) : null]],
    ['DELETE FROM report_recommendations WHERE report_id = $1', [report.id]],
  ];
  if (report.recommendations.length) {
    const placeholders = report.recommendations.map((_, index) => {
      const base = index * REPORT_RECOMMENDATION_COLUMNS;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7}::jsonb,$${base + 8}::jsonb,$${base + 9})`;
    });
    const parameters = report.recommendations.flatMap((recommendation) => [report.id, recommendation.articleId, recommendation.rank, recommendation.rawScore, recommendation.displayScore, recommendation.explanation, JSON.stringify(recommendation.article), JSON.stringify(recommendation.subscriberOnly === undefined ? recommendation.rankingMetadata : { ...recommendation.rankingMetadata, subscriberOnly: recommendation.subscriberOnly }), report.createdAt]);
    statements.push([`INSERT INTO report_recommendations (report_id, article_id, rank, raw_score, display_score, reason, article_json, ranking_metadata_json, created_at) VALUES ${placeholders.join(',')}`, parameters]);
  }
  return statements;
}

/** Theme descriptions as stored (JSONB object of theme → line); absent on reports from before migration 006. */
function storedThemeDescriptions(value: unknown): Record<string, string> | undefined {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const entries = Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : undefined;
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

  /** Loads a report and its ranked recommendations in a single round trip. */
  async get(id: string, publisherId?: string): Promise<ReportRecord | null> {
    const parameters: unknown[] = [id];
    let where = 'r.id = $1';
    if (publisherId) { parameters.push(publisherId); where += ' AND r.publisher_id = $2'; }
    const reportResult = await this.client.query<Record<string, unknown>>(`SELECT r.*, COALESCE((SELECT json_agg(json_build_object('article_id', rr.article_id, 'rank', rr.rank, 'raw_score', rr.raw_score, 'display_score', rr.display_score, 'reason', rr.reason, 'article_json', rr.article_json, 'ranking_metadata_json', rr.ranking_metadata_json) ORDER BY rr.rank ASC) FROM report_recommendations rr WHERE rr.report_id = r.id), '[]'::json) AS recommendations_json FROM reports r WHERE ${where} LIMIT 1`, parameters);
    const row = reportResult.rows[0];
    if (!row) return null;
    const recommendationRows = (typeof row.recommendations_json === 'string' ? JSON.parse(row.recommendations_json) : row.recommendations_json) as Array<Record<string, unknown>> | null;
    const recommendations = { rows: Array.isArray(recommendationRows) ? recommendationRows : [] };
    const normalizedRecommendations = recommendations.rows.map((item) => {
      // subscriberOnly is stored inside ranking_metadata_json (no schema change) and lifted back to the top level.
      const { subscriberOnly, ...rankingMetadata } = (item.ranking_metadata_json ?? {}) as ReportRecord['recommendations'][number]['rankingMetadata'] & { subscriberOnly?: unknown };
      return { articleId: String(item.article_id), rank: Number(item.rank), rawScore: Number(item.raw_score), displayScore: Number(item.display_score), explanation: String(item.reason), article: item.article_json as ReportRecord['recommendations'][number]['article'], ...(typeof subscriberOnly === 'boolean' ? { subscriberOnly } : {}), rankingMetadata: rankingMetadata as ReportRecord['recommendations'][number]['rankingMetadata'] };
    });
    return {
      id: String(row.id), publisherId: String(row.publisher_id), sessionId: String(row.session_id), companyUrl: String(row.company_url), companyDomain: String(row.company_domain), companyName: row.company_name ? String(row.company_name) : undefined, jobTitle: String(row.job_title),
      professionalProfile: row.professional_profile_json as ReportRecord['professionalProfile'], retrievalContext: row.retrieval_context_json as ReportRecord['retrievalContext'], overallMatchScore: Number(row.overall_match_score), generatedSummary: String(row.generated_summary), summarySource: row.summary_source === 'ai' || row.summary_source === 'deterministic' ? row.summary_source : undefined, summaryFallbackReason: typeof row.summary_fallback_reason === 'string' ? row.summary_fallback_reason : undefined,
      recommendations: normalizedRecommendations, sections: sectionsFromRecommendations(normalizedRecommendations),
      ...(storedThemeDescriptions(row.theme_descriptions_json) ? { themeDescriptions: storedThemeDescriptions(row.theme_descriptions_json) } : {}),
      generationVersion: String(row.generation_version), rankingVersion: String(row.ranking_version), professionalProfileVersion: String(row.professional_profile_version), aiProviderVersion: String(row.ai_provider_version), publisherConfigVersion: String(row.publisher_config_version), widgetVersion: String(row.widget_version), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }
}
