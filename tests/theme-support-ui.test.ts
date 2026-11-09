// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDemoRegistry } from '../src/demo/definition';
import { renderHostedRoute } from '../src/hosted';
import { briefHeroStyle } from '../src/hosted-hero';
import type { ReportRecord, ReportRecommendation } from '../src/reports';
import { createProductionApp } from '../src/server/production';

let base: ReportRecord;

beforeAll(async () => {
  const app = createProductionApp({ environment: 'test' });
  const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }) }));
  const { reportId } = await generated.json() as { reportId: string };
  base = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json() as ReportRecord;
});

/** The demo report with lowercase themes linked to its stories, a long category on the first story and a story that only retold the news. */
function shaped(): ReportRecord {
  const [first, ...rest] = base.recommendations;
  const recommendations = [
    { ...first, displayScore: 40, article: { ...first.article, categories: ['CSR and sustainability'] } },
    ...rest.map((item, index) => ({ ...item, displayScore: 70 - index, rankingMetadata: { ...item.rankingMetadata, ...(index === 0 ? { explanationRestated: true, explanationSource: 'deterministic' as const } : {}) } })),
  ];
  const ids = recommendations.map((item) => item.articleId);
  return { ...base, recommendations, sections: [], professionalProfile: { ...base.professionalProfile, coverage: undefined, themes: ['connected fitness', 'ai coaching', 'unsupported theme'], themeArticleIds: { 'connected fitness': ids, 'ai coaching': ids.slice(0, 1) } } };
}

async function render(report: ReportRecord, archive: ReportRecommendation[] = []): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/analytics/events')) return Response.json({ accepted: true });
    // An older server without briefingRecommendations: the page falls back to the report's own theme links.
    if (url.includes('/themes/')) return Response.json({ theme: decodeURIComponent(url.split('/themes/')[1].split('/search')[0]), recommendations: archive });
    return Response.json(report);
  }));
  window.history.replaceState({}, '', `/p/demo/${report.id}`);
  await renderHostedRoute(document, createDemoRegistry());
}

describe('theme cards and focused reading', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('shows sentence-case theme titles, hides themes no story supports and lists supporting stories by match score', async () => {
    const report = shaped();
    const archived = { ...report.recommendations[0], articleId: 'archive-1', article: { ...report.recommendations[0].article, id: 'archive-1', title: 'Archive story' } };
    await render(report, [archived]);
    expect([...document.querySelectorAll('.highlight-card h3')].map((node) => node.textContent)).toEqual(['Connected fitness', 'AI coaching']);
    // The search request still uses the stored theme.
    expect(document.querySelector<HTMLElement>('[data-theme-search]')?.dataset.themeSearch).toBe('connected fitness');
    document.querySelector<HTMLButtonElement>('[data-theme-search]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-theme-results]')?.getAttribute('aria-busy')).toBe('false'));
    // Running text keeps the theme in lower case (acronyms and brands aside); the card title is sentence case.
    expect(document.querySelector('.theme-results-heading')?.textContent).toBe('Stories about connected fitness');
    const briefing = [...document.querySelectorAll<HTMLElement>('[data-theme-group="briefing"] [data-story-card]')].map((card) => card.dataset.storyCard);
    expect(briefing).toEqual([...report.recommendations].sort((left, right) => right.displayScore - left.displayScore).map((item) => item.articleId));
    expect(document.querySelectorAll('[data-theme-group="briefing"] .why')).toHaveLength(0);
    expect([...document.querySelectorAll<HTMLElement>('[data-theme-group="archive"] [data-story-card]')].map((card) => card.dataset.storyCard)).toEqual(['archive-1']);
    expect(document.querySelector('[data-theme-group="archive"] .theme-results-group-heading')?.textContent).toBe('More on this theme');
  });

  it('keeps match, category and date on one line by truncating the category, with the full text in its title', async () => {
    await render(shaped());
    const category = document.querySelector<HTMLElement>('.story-category')!;
    expect(category.textContent).toBe('CSR and sustainability');
    expect(category.title).toBe('CSR and sustainability');
    const css = [...document.querySelectorAll('style')].map((node) => node.textContent).join('');
    expect(css).toContain('.story-meta{display:flex;flex-wrap:nowrap');
    expect(css).toContain('.story-meta>.story-category{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}');
  });

  it('leaves out the "why" box only for a story whose explanation retold the news', async () => {
    const report = shaped();
    await render(report);
    const restated = document.querySelector(`[data-story-card="${report.recommendations[1].articleId}"]`)!;
    expect(restated.querySelector('.why')).toBeNull();
    expect(document.querySelector(`[data-story-card="${report.recommendations[0].articleId}"] .why`)).not.toBeNull();
  });

  it('sets the summary lead one step smaller on phones only', () => {
    const css = briefHeroStyle();
    expect(css).toContain('.report-page .brief-lead{margin:0;color:#151a3a;font:400 clamp(1.08rem,1.35vw,1.24rem)/1.4');
    const mobile = css.slice(css.indexOf('@media(max-width:639px)'));
    expect(mobile).toContain('.report-page .brief-lead{font-size:.98rem;line-height:1.38}');
  });
});
