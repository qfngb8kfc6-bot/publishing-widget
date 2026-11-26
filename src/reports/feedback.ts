/**
 * Anonymous briefing feedback: 👍 / 👎 on a report or on one of its stories. A vote stores the report ID, the
 * article ID (none for the whole briefing), the vote and the time; never a session, IP address or other
 * personal data. Admin sees totals per publisher.
 */
export type FeedbackVote = 'up' | 'down';

export interface FeedbackEntry {
  publisherId: string;
  reportId: string;
  /** Absent for a vote on the whole briefing. */
  articleId?: string;
  vote: FeedbackVote;
  createdAt: string;
}

export interface FeedbackTotals {
  publisherId: string;
  briefing: { up: number; down: number };
  stories: { up: number; down: number };
  /** Stories with the most votes (article ID and counts), most voted first, at most 10. */
  topStories: Array<{ articleId: string; up: number; down: number }>;
}

export interface FeedbackStore {
  record(entry: FeedbackEntry): Promise<void>;
  totals(publisherId: string): Promise<FeedbackTotals>;
  /** Removes the feedback of these reports (retention cleanup); returns rows removed. */
  removeForReports?(reportIds: readonly string[]): Promise<number>;
}

export const MAX_FEEDBACK_ARTICLE_ID_LENGTH = 512;

/** A vote body: {"vote": "up" | "down", "articleId"?: string}. Anything else is invalid. */
export function parseFeedbackBody(body: unknown): { vote: FeedbackVote; articleId?: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (value.vote !== 'up' && value.vote !== 'down') return null;
  if (value.articleId === undefined || value.articleId === null) return { vote: value.vote };
  if (typeof value.articleId !== 'string' || !value.articleId || value.articleId.length > MAX_FEEDBACK_ARTICLE_ID_LENGTH) return null;
  return { vote: value.vote, articleId: value.articleId };
}

function totalsFrom(publisherId: string, rows: ReadonlyArray<{ articleId?: string | null; vote: FeedbackVote; count: number }>): FeedbackTotals {
  const totals: FeedbackTotals = { publisherId, briefing: { up: 0, down: 0 }, stories: { up: 0, down: 0 }, topStories: [] };
  const byArticle = new Map<string, { up: number; down: number }>();
  for (const row of rows) {
    if (!row.articleId) { totals.briefing[row.vote] += row.count; continue; }
    totals.stories[row.vote] += row.count;
    const entry = byArticle.get(row.articleId) ?? { up: 0, down: 0 };
    entry[row.vote] += row.count;
    byArticle.set(row.articleId, entry);
  }
  totals.topStories = [...byArticle.entries()].map(([articleId, counts]) => ({ articleId, ...counts }))
    .sort((left, right) => right.up + right.down - (left.up + left.down) || left.articleId.localeCompare(right.articleId)).slice(0, 10);
  return totals;
}

/** In memory (development, tests); at most `limit` entries, oldest first out. */
export class MemoryFeedbackStore implements FeedbackStore {
  private readonly entries: FeedbackEntry[] = [];
  constructor(private readonly limit = 50_000) {}
  async record(entry: FeedbackEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
  }
  async totals(publisherId: string): Promise<FeedbackTotals> {
    const counts = new Map<string, { articleId?: string; vote: FeedbackVote; count: number }>();
    for (const entry of this.entries) {
      if (entry.publisherId !== publisherId) continue;
      const key = `${entry.articleId ?? ''}\u0000${entry.vote}`;
      const row = counts.get(key) ?? { articleId: entry.articleId, vote: entry.vote, count: 0 };
      row.count += 1;
      counts.set(key, row);
    }
    return totalsFrom(publisherId, [...counts.values()]);
  }
  async removeForReports(reportIds: readonly string[]): Promise<number> {
    const ids = new Set(reportIds);
    let removed = 0;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) if (ids.has(this.entries[index].reportId)) { this.entries.splice(index, 1); removed += 1; }
    return removed;
  }
  /** Test helper: everything stored, to check that no other fields are kept. */
  all(): readonly FeedbackEntry[] { return this.entries; }
}

export interface FeedbackSqlClient { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> }

/** Postgres adapter (migration 011). */
export class PostgresFeedbackStore implements FeedbackStore {
  constructor(private readonly client: FeedbackSqlClient) {}
  async record(entry: FeedbackEntry): Promise<void> {
    await this.client.query('INSERT INTO report_feedback (publisher_id, report_id, article_id, vote, created_at) VALUES ($1, $2, $3, $4, $5)', [entry.publisherId, entry.reportId, entry.articleId ?? null, entry.vote, entry.createdAt]);
  }
  async totals(publisherId: string): Promise<FeedbackTotals> {
    const result = await this.client.query('SELECT article_id, vote, COUNT(*)::int AS count FROM report_feedback WHERE publisher_id = $1 GROUP BY article_id, vote', [publisherId]);
    return totalsFrom(publisherId, result.rows.map((row) => ({ articleId: row.article_id as string | null, vote: row.vote as FeedbackVote, count: Number(row.count) })));
  }
  async removeForReports(reportIds: readonly string[]): Promise<number> {
    if (!reportIds.length) return 0;
    const result = await this.client.query('DELETE FROM report_feedback WHERE report_id = ANY($1::text[])', [reportIds]);
    return result.rowCount ?? 0;
  }
}
