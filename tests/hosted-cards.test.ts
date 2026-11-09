// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { summaryQualityWarnings } from '../src/ai/content-quality';
import { REPORT_SUMMARY_ONLY_INSTRUCTIONS } from '../src/ai/providers/openai-compatible';
import { renderHostedRoute } from '../src/hosted';
import { cardDate, cardsVariant, focusHeading } from '../src/hosted-cards';
import { createPublisherRegistry } from '../src/publishers/registry';
import type { ReportRecord, ReportRecommendation } from '../src/reports';
import { createProductionApp } from '../src/server/production';

let base: ReportRecord;

beforeAll(async () => {
  const app = createProductionApp({ environment: 'test' });
  const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Technology Professional' }) }));
  const { reportId } = await generated.json() as { reportId: string };
  base = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json() as ReportRecord;
});

/** An SGI report with seven stories: a lead, two unsectioned, and four in two editorial sections; odd ones lack images. */
function sgiReport(): ReportRecord {
  const seed = base.recommendations[0];
  const story = (index: number): ReportRecommendation => ({
    ...seed,
    articleId: `s-${index}`,
    rank: index + 1,
    displayScore: 70 - index * 5,
    explanation: `Your roadmap gets a benchmark from story ${index}, which customers will compare your offer against within a year.`,
    article: { ...seed.article, id: `s-${index}`, url: `https://www.sgieurope.com/s-${index}.article`, title: `Story ${index} headline`, description: `Excerpt for story ${index}.`, categories: [index === 3 ? 'CSR and sustainability' : 'Technology'], publishedAt: `2026-10-${String(10 + index).padStart(2, '0')}T09:00:00Z`, imageUrl: index % 2 === 0 ? `https://www.sgieurope.com/Pictures/s-${index}.jpg` : undefined },
    rankingMetadata: { ...seed.rankingMetadata, explanationSource: 'ai', citedInSummary: index === 4 || index === 6 ? true : undefined },
  });
  const recommendations = Array.from({ length: 7 }, (_, index) => story(index));
  return {
    ...base,
    id: 'report-cards-1234',
    publisherId: 'sgi-europe',
    companyName: 'LD Systems',
    jobTitle: 'Technology Professional',
    generatedSummary: 'Fitbit and Peloton put coaching on their devices. Garmin grew wearables revenue 20%. Watch subscription prices.',
    summarySource: 'ai',
    recommendations,
    sections: [
      { id: 'companies-to-watch', recommendations: recommendations.slice(3, 5) },
      { id: 'market-moves', recommendations: recommendations.slice(5, 7) },
    ],
    professionalProfile: { ...base.professionalProfile, coverage: undefined, themes: ['connected fitness', 'AI coaching', 'wearables'], themeArticleIds: { 'connected fitness': ['s-2', 's-0'], 'AI coaching': ['s-1'], wearables: ['s-5'] } },
  };
}

const archive = (report: ReportRecord): ReportRecommendation[] => [{ ...report.recommendations[0], articleId: 'archive-1', article: { ...report.recommendations[0].article, id: 'archive-1', title: 'Archive story' }, rankingMetadata: { ...report.recommendations[0].rankingMetadata, explanationSource: 'deterministic' } }];

async function render(report: ReportRecord, search: string): Promise<void> {
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/analytics/events')) return Response.json({ accepted: true });
    if (url.includes('/themes/')) {
      const theme = decodeURIComponent(url.split('/themes/')[1].split('/search')[0]);
      return Response.json({ theme, briefingRecommendations: [report.recommendations[2], report.recommendations[0]], recommendations: archive(report) });
    }
    return Response.json(report);
  }));
  window.history.replaceState({}, '', `/p/sgi-europe/${report.id}${search}`);
  await renderHostedRoute(document, createPublisherRegistry());
}

const storyIds = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>('[data-story-card]')].filter((card) => !card.closest('[data-theme-results]')).map((card) => card.dataset.storyCard);

describe('report body variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; document.body.className = ''; });

  it('reads only ?cards=a and ?cards=b; anything else keeps the current layout', async () => {
    expect(cardsVariant('?cards=a')).toBe('a');
    expect(cardsVariant('?cards=B')).toBe('b');
    expect(cardsVariant('?cards=c')).toBeUndefined();
    expect(cardsVariant('')).toBeUndefined();
    await render(sgiReport(), '');
    expect(document.querySelector('.cx')).toBeNull();
    expect(document.querySelectorAll('.additional-section').length).toBeGreaterThan(0);
  });

  it.each(['a', 'b'] as const)('variant %s: one "Your 7 stories" section with every story, lead first, sections as card labels', async (variant) => {
    const report = sgiReport();
    await render(report, `?cards=${variant}`);
    const section = document.querySelector<HTMLElement>('#top-stories')!;
    expect(section.querySelector('h2')?.textContent).toBe('Your 7 stories');
    expect(storyIds(section)).toEqual(report.recommendations.map((item) => item.articleId));
    expect(storyIds(document)).toEqual(storyIds(section));
    expect(document.querySelector('.additional-section, .also-relevant')).toBeNull();
    expect(document.body.textContent).not.toContain('Additional reading');
    const lead = section.querySelector<HTMLElement>('.cx-lead')!;
    expect(lead.dataset.storyCard).toBe('s-0');
    expect(lead.querySelector('.cx-label')?.textContent).toBe('Top match');
    expect(section.querySelector('[data-story-card="s-3"] .cx-label')?.textContent).toBe('Companies to watch');
    expect(section.querySelector('[data-story-card="s-6"] .cx-label')?.textContent).toBe('Market moves');
    expect(section.querySelector('[data-story-card="s-1"] .cx-label')).toBeNull();
    // Variant A: one list of horizontal cards; variant B: the lead, then a grid.
    if (variant === 'a') expect(section.querySelectorAll('.cx-list > .cx-rest-card')).toHaveLength(6);
    else expect(section.querySelectorAll('.cx-grid > .cx-rest-card')).toHaveLength(6);
  });

  it('keeps every card element, gives image-less stories a designed tile and a quiet one-line meta', async () => {
    const report = sgiReport();
    await render(report, '?cards=a');
    const withImage = document.querySelector<HTMLElement>('[data-story-card="s-2"]')!;
    expect(withImage.querySelector<HTMLImageElement>('.cx-media img')?.src).toBe('https://www.sgieurope.com/Pictures/s-2.jpg');
    const noImage = document.querySelector<HTMLElement>('[data-story-card="s-3"]')!;
    expect(noImage.querySelector('.cx-media .cx-tile')?.textContent).toBe('SGI EuropeCSR and sustainability');
    expect(document.querySelector('.story-placeholder')).toBeNull();
    // Match first and alone in the top row; category and date as one line, untruncated.
    expect(noImage.querySelector('.cx-top .match-badge')?.textContent).toBe('55% match');
    expect(noImage.querySelector('.cx-meta')?.textContent).toBe(`CSR and sustainability·${cardDate('2026-10-13T09:00:00Z')}`);
    expect(cardDate('2026-10-13T09:00:00Z')).toBe('13 Oct 2026');
    expect(noImage.querySelector('.cx-title')?.textContent).toBe('Story 3 headline');
    expect(noImage.querySelector('.story-summary')?.textContent).toBe('Excerpt for story 3.');
    expect(noImage.querySelector('.why .why-text')?.textContent).toMatch(/^Your roadmap gets a benchmark/);
    expect(noImage.querySelector('.why-toggle')?.textContent).toBe('More');
    const link = noImage.querySelector<HTMLAnchorElement>('a.story-link')!;
    expect(link.href).toBe('https://www.sgieurope.com/s-3.article');
    expect(link.dataset.storyId).toBe('s-3');
    // Citation chips number 1, 2 in page order and tag the cited cards in the top row, after the match.
    expect([...document.querySelectorAll('[data-cite]')].map((chip) => chip.textContent)).toEqual(['1', '2']);
    expect(document.querySelector('[data-story-card="s-4"] .cx-top .match-badge + .source-tag')?.textContent).toBe('Source 1');
    expect(document.querySelector('[data-story-card="s-6"] .source-tag')?.textContent).toBe('Source 2');
  });

  it('theme cards show the count, how many briefing stories each groups, and a Find stories button', async () => {
    await render(sgiReport(), '?cards=b');
    const cards = [...document.querySelectorAll<HTMLElement>('.cx-theme')];
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual(['Connected fitness', 'AI coaching', 'Wearables']);
    expect(cards[0].querySelector('.cx-theme-index')?.textContent).toBe('01 / 03');
    expect(cards[0].querySelector('.cx-theme-count')?.textContent).toBe('2 stories in your briefing');
    expect(document.querySelector('.cx-theme-total')?.textContent).toBe('3 themes · swipe for more');
    expect(cards[0].querySelector('[data-theme-search]')?.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('opens focused reading in a dialog panel, briefing stories first, and closes it with Escape, the button or the backdrop', async () => {
    const report = sgiReport();
    await render(report, '?cards=a');
    const panel = document.querySelector<HTMLElement>('[data-focus-panel]')!;
    const backdrop = document.querySelector<HTMLElement>('[data-focus-backdrop]')!;
    expect(panel.hidden).toBe(true);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const button = document.querySelector<HTMLButtonElement>('[data-theme-search="AI coaching"]')!;
    button.click();
    expect(panel.hidden).toBe(false);
    expect(backdrop.hidden).toBe(false);
    expect(document.body.classList.contains('modal-open')).toBe(true);
    expect(document.activeElement?.id).toBe('cx-panel-title');
    await vi.waitFor(() => expect(panel.querySelector('[data-theme-results]')?.getAttribute('aria-busy')).toBe('false'));
    // Running text keeps the theme's own casing for acronyms, lower case otherwise.
    expect(panel.querySelector('#cx-panel-title')?.textContent).toBe('Stories about AI coaching');
    expect([...panel.querySelectorAll('.theme-results-group-heading')].map((node) => node.textContent)).toEqual(['In your briefing 2', 'More on this theme 1']);
    expect(storyIdsIn(panel, 'briefing')).toEqual(['s-2', 's-0']);
    expect(storyIdsIn(panel, 'archive')).toEqual(['archive-1']);
    // Briefing stories do not repeat their "why"; the stories section stays where it was (nothing inserted above it).
    expect(panel.querySelectorAll('[data-theme-group="briefing"] .why')).toHaveLength(0);
    expect(document.querySelector('.cx-themes + #top-stories')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
    expect(backdrop.hidden).toBe(true);
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(document.activeElement).toBe(button);
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    document.querySelector<HTMLButtonElement>('[data-focus-close]')!.click();
    expect(panel.hidden).toBe(true);
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    backdrop.click();
    expect(panel.hidden).toBe(true);
  });

  it('keeps the panel styles accessible: reduced motion stops the slide, focus rings are visible', async () => {
    await render(sgiReport(), '?cards=b');
    const css = [...document.querySelectorAll('style')].map((node) => node.textContent).join('');
    expect(css).toContain('@media(prefers-reduced-motion:reduce){.cx-panel{animation:none}}');
    expect(css).toMatch(/\.cx \.cx-theme-action:focus-visible[^{]*\{outline:3px solid/);
    expect(css).toContain('.cx-close{display:inline-grid;flex:none;width:44px;height:44px');
  });
});

function storyIdsIn(panel: HTMLElement, group: string): Array<string | undefined> {
  return [...panel.querySelectorAll<HTMLElement>(`[data-theme-group="${group}"] [data-story-card]`)].map((card) => card.dataset.storyCard);
}

describe('focused-reading heading and summary opening', () => {
  it('keeps the theme in lower case mid-sentence, except acronyms and brands', () => {
    expect(focusHeading('wearables')).toBe('Stories about wearables');
    expect(focusHeading('Connected fitness')).toBe('Stories about Connected fitness');
    expect(focusHeading('connected fitness')).toBe('Stories about connected fitness');
    expect(focusHeading('ai coaching')).toBe('Stories about AI coaching');
    expect(focusHeading('ebay marketplace')).toBe('Stories about eBay marketplace');
  });

  it('asks the summary to open with the news, and flags a "You are seeing" lead as a soft warning only', () => {
    expect(REPORT_SUMMARY_ONLY_INSTRUCTIONS).toMatch(/never with the reader or the briefing \("You are seeing"/);
    expect(summaryQualityWarnings('You are seeing brands move coaching onto devices. Fitbit and Peloton lead.', ['a', 'b'], {})).toContain('meta_opening');
    expect(summaryQualityWarnings('Fitbit and Peloton moved coaching onto devices. Watch prices.', ['a', 'b'], {})).not.toContain('meta_opening');
  });
});
