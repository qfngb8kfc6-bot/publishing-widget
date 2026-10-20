import { describe, expect, it } from 'vitest';
import { PostgresReportStore, type ReportSqlConnection } from '../src/reports/store';
import type { ReportRecord, ReportRecommendation } from '../src/reports/types';

function recommendation(rank: number): ReportRecommendation {
  return {
    articleId: `article-${rank}`,
    rank,
    rawScore: 90 - rank,
    displayScore: 90 - rank,
    explanation: `Why article ${rank} matters`,
    article: { id: `article-${rank}`, title: `Article ${rank}`, url: `https://www.sgieurope.com/a-${rank}.article`, categories: [], tags: [], publisherId: 'sgi-europe' },
    rankingMetadata: { relevanceSignals: ['retail'], rankingMode: 'deterministic', rankingVersion: '1.2', deterministicScore: 90 - rank, semanticSignals: [] },
  } as ReportRecommendation;
}

function report(recommendationCount: number): ReportRecord {
  return {
    id: 'report-1', publisherId: 'sgi-europe', sessionId: 'session-1', companyUrl: 'https://nike.com/', companyDomain: 'nike.com', companyName: 'Nike', jobTitle: 'Head of Retail',
    professionalProfile: {} as ReportRecord['professionalProfile'], retrievalContext: {} as ReportRecord['retrievalContext'], overallMatchScore: 80, generatedSummary: 'Summary',
    recommendations: Array.from({ length: recommendationCount }, (_, index) => recommendation(index + 1)), sections: [],
    generationVersion: '1.2', rankingVersion: '1.2', professionalProfileVersion: '1', aiProviderVersion: 'deterministic', publisherConfigVersion: '1', widgetVersion: '0.5.0',
    createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', summarySource: 'deterministic', summaryFallbackReason: 'timeout',
  };
}

class RecordingConnection implements ReportSqlConnection {
  readonly statements: Array<{ sql: string; parameters?: unknown[] }> = [];
  released?: Error | boolean | 'clean';

  constructor(private readonly failOn?: RegExp) {}

  async query<Row>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }> {
    this.statements.push({ sql, parameters });
    if (this.failOn?.test(sql)) throw new Error('insert failed');
    return { rows: [] };
  }

  release(error?: Error | boolean): void {
    this.released = error ?? 'clean';
  }
}

function pool(connection: RecordingConnection) {
  return {
    query: async () => { throw new Error('saves must use the checked-out connection'); },
    connect: async () => connection,
  };
}

describe('PostgresReportStore.save', () => {
  it('writes the report and every recommendation in one transaction with a single multi-row insert', async () => {
    const connection = new RecordingConnection();
    await new PostgresReportStore(pool(connection)).save(report(8));
    expect(connection.statements.map((statement) => statement.sql.split(' (')[0].split(' WHERE')[0])).toEqual([
      'BEGIN',
      'INSERT INTO reports',
      'DELETE FROM report_recommendations',
      'INSERT INTO report_recommendations',
      'COMMIT',
    ]);
    const reportInsert = connection.statements[1];
    expect(reportInsert.sql).toContain('summary_source, summary_fallback_reason) VALUES (');
    expect(reportInsert.parameters).toHaveLength(21);
    expect(reportInsert.parameters!.slice(19)).toEqual(['deterministic', 'timeout']);
    const insert = connection.statements[3];
    expect(insert.sql.match(/\(\$\d+,/g)).toHaveLength(8);
    expect(insert.sql).toContain('($64,$65,$66,$67,$68,$69,$70::jsonb,$71::jsonb,$72)');
    expect(insert.parameters).toHaveLength(72);
    // Same per-row values, in the same column order, as the previous one-insert-per-recommendation path.
    expect(insert.parameters!.slice(9, 18)).toEqual(['report-1', 'article-2', 2, 88, 88, 'Why article 2 matters', JSON.stringify(recommendation(2).article), JSON.stringify(recommendation(2).rankingMetadata), '2026-10-19T00:00:00.000Z']);
    expect(connection.released).toBe('clean');
  });

  it('skips the recommendation insert for a valid zero-result report', async () => {
    const connection = new RecordingConnection();
    await new PostgresReportStore(pool(connection)).save(report(0));
    expect(connection.statements.map((statement) => statement.sql.split(' ')[0])).toEqual(['BEGIN', 'INSERT', 'DELETE', 'COMMIT']);
  });

  it('rolls back, releases the connection with the error and rethrows when a write fails', async () => {
    const connection = new RecordingConnection(/^INSERT INTO report_recommendations/);
    await expect(new PostgresReportStore(pool(connection)).save(report(3))).rejects.toThrow('insert failed');
    expect(connection.statements.at(-1)?.sql).toBe('ROLLBACK');
    expect(connection.statements.some((statement) => statement.sql === 'COMMIT')).toBe(false);
    expect(connection.released).toBeInstanceOf(Error);
  });

  it('falls back to sequential statements on clients that cannot check out a connection', async () => {
    const statements: string[] = [];
    await new PostgresReportStore({ query: async (sql: string) => { statements.push(sql.split(' ')[0]); return { rows: [] }; } }).save(report(2));
    expect(statements).toEqual(['INSERT', 'DELETE', 'INSERT']);
  });
});

describe('PostgresReportStore.get', () => {
  const row = {
    id: 'report-1', publisher_id: 'sgi-europe', session_id: 'session-1', company_url: 'https://nike.com/', company_domain: 'nike.com', company_name: 'Nike', job_title: 'Head of Retail',
    professional_profile_json: {}, retrieval_context_json: {}, overall_match_score: 80, generated_summary: 'Summary', summary_source: 'ai', summary_fallback_reason: null,
    generation_version: '1.2', ranking_version: '1.2', professional_profile_version: '1', ai_provider_version: 'deterministic', publisher_config_version: '1', widget_version: '0.5.0',
    created_at: new Date('2026-10-19T00:00:00.000Z'), updated_at: new Date('2026-10-19T00:00:00.000Z'),
  };
  const recommendationRows = [1, 2].map((rank) => ({ article_id: `article-${rank}`, rank, raw_score: 90.5 - rank, display_score: 90 - rank, reason: `Why ${rank}`, article_json: recommendation(rank).article, ranking_metadata_json: recommendation(rank).rankingMetadata }));

  it('loads the report and its recommendations in one query', async () => {
    for (const recommendationsJson of [recommendationRows, JSON.stringify(recommendationRows)]) {
      const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
      const store = new PostgresReportStore({ query: async <Row>(sql: string, parameters?: unknown[]) => { queries.push({ sql, parameters }); return { rows: [{ ...row, recommendations_json: recommendationsJson }] as Row[] }; } });
      const loaded = await store.get('report-1', 'sgi-europe');
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain('json_agg');
      expect(queries[0].parameters).toEqual(['report-1', 'sgi-europe']);
      expect(loaded?.recommendations.map((item) => [item.articleId, item.rank, item.rawScore, item.displayScore])).toEqual([['article-1', 1, 89.5, 89], ['article-2', 2, 88.5, 88]]);
      expect(loaded?.summarySource).toBe('ai');
      expect(loaded?.summaryFallbackReason).toBeUndefined();
    }
  });

  it('returns null when no report matches and an empty list for a zero-result report', async () => {
    expect(await new PostgresReportStore({ query: async <Row>() => ({ rows: [] as Row[] }) }).get('missing')).toBeNull();
    const empty = await new PostgresReportStore({ query: async <Row>() => ({ rows: [{ ...row, recommendations_json: [] }] as Row[] }) }).get('report-1');
    expect(empty?.recommendations).toEqual([]);
  });
});
