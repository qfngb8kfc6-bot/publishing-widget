import { describe, expect, it } from 'vitest';
import { MemoryFeedbackStore, parseFeedbackBody, PostgresFeedbackStore } from '../src/reports/feedback';
import { createProductionApp } from '../src/server/production';

async function setup(feedbackLimit = 30) {
  const feedbackStore = new MemoryFeedbackStore();
  const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' }, feedbackStore, rateLimits: { feedback: feedbackLimit } });
  const generated = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Technology professional' }) }));
  const { reportId } = await generated.json() as { reportId: string };
  const report = (await app.reportStore.get(reportId, 'demo'))!;
  const vote = (body: unknown, id = reportId, publisherId = 'demo') => app.handle(new Request(`https://discovery.ldsystems.uk/api/reports/${id}/feedback?publisherId=${publisherId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { app, feedbackStore, report, vote };
}

describe('briefing feedback API', () => {
  it('stores a briefing vote and a story vote with report ID, article ID, vote and time only', async () => {
    const { feedbackStore, report, vote } = await setup();
    expect((await vote({ vote: 'up' })).status).toBe(204);
    expect((await vote({ vote: 'down', articleId: report.recommendations[0].articleId })).status).toBe(204);
    const stored = feedbackStore.all();
    expect(stored).toHaveLength(2);
    expect(Object.keys(stored[0]).sort()).toEqual(['createdAt', 'publisherId', 'reportId', 'vote']);
    expect(Object.keys(stored[1]).sort()).toEqual(['articleId', 'createdAt', 'publisherId', 'reportId', 'vote']);
    expect(stored[1]).toMatchObject({ reportId: report.id, articleId: report.recommendations[0].articleId, vote: 'down' });
  });

  it('rejects bad votes, stories not in the report and unknown reports', async () => {
    const { feedbackStore, report, vote } = await setup();
    expect((await vote({ vote: 'maybe' })).status).toBe(400);
    expect((await vote({ vote: 'up', articleId: 'not-in-this-report' })).status).toBe(400);
    expect((await vote({ vote: 'up' }, 'missing-report-123')).status).toBe(404);
    expect((await vote({ vote: 'up' }, report.id, 'sgi-europe')).status).toBe(404);
    expect(feedbackStore.all()).toHaveLength(0);
    expect(parseFeedbackBody({ vote: 'up', articleId: 'x'.repeat(600) })).toBeNull();
  });

  it('is rate limited', async () => {
    const { vote } = await setup(3);
    const statuses = [];
    for (let index = 0; index < 4; index += 1) statuses.push((await vote({ vote: 'up' })).status);
    expect(statuses).toEqual([204, 204, 204, 429]);
  });

  it('shows totals per publisher in admin', async () => {
    const { app, report, vote } = await setup();
    await vote({ vote: 'up' });
    await vote({ vote: 'up' });
    await vote({ vote: 'down' });
    await vote({ vote: 'up', articleId: report.recommendations[0].articleId });
    const login = await app.handle(new Request('https://admin.example/api/admin/login', { method: 'POST', headers: { Origin: 'https://admin.example' }, body: JSON.stringify({ password: 'test-admin-password' }) }));
    const cookie = login.headers.get('Set-Cookie')!.split(';', 1)[0];
    expect((await app.handle(new Request('https://admin.example/api/admin/publishers/demo/feedback', { headers: { Origin: 'https://admin.example' } }))).status).toBe(401);
    const totals = await (await app.handle(new Request('https://admin.example/api/admin/publishers/demo/feedback', { headers: { Origin: 'https://admin.example', Cookie: cookie } }))).json();
    expect(totals).toEqual({ publisherId: 'demo', briefing: { up: 2, down: 1 }, stories: { up: 1, down: 0 }, topStories: [{ articleId: report.recommendations[0].articleId, up: 1, down: 0 }] });
  });

  it('Postgres store writes only those columns and counts per publisher', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = new PostgresFeedbackStore({ query: async (text, values) => { queries.push({ text, values }); return { rows: text.startsWith('SELECT') ? [{ article_id: null, vote: 'up', count: 4 }, { article_id: 'a1', vote: 'down', count: 2 }] : [] }; } });
    await store.record({ publisherId: 'demo', reportId: 'r1', vote: 'up', createdAt: '2026-11-25T10:00:00.000Z' });
    expect(queries[0].text).toContain('INSERT INTO report_feedback (publisher_id, report_id, article_id, vote, created_at)');
    expect(queries[0].values).toEqual(['demo', 'r1', null, 'up', '2026-11-25T10:00:00.000Z']);
    expect(await store.totals('demo')).toEqual({ publisherId: 'demo', briefing: { up: 4, down: 0 }, stories: { up: 0, down: 2 }, topStories: [{ articleId: 'a1', up: 0, down: 2 }] });
  });
});
