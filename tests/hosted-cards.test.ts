// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { summaryQualityWarnings } from '../src/ai/content-quality';
import { REPORT_SUMMARY_ONLY_INSTRUCTIONS } from '../src/ai/providers/openai-compatible';
import { renderHostedRoute } from '../src/hosted';
import { cardDate, categoryTint, panelText, displayStories, displayTitle, focusHeading, focusResultsMarkup } from '../src/hosted-cards';
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

describe('report body (magazine layout)', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; document.body.className = ''; });

  it('is the only layout: no ?cards switch, no old sections, one "Your 7 stories" section with sections as card labels', async () => {
    for (const search of ['', '?cards=a', '?cards=b']) {
      const report = sgiReport();
      await render(report, search);
      expect(document.querySelector('[data-cards], .cx-a, .cx-b, .cx-list, .additional-section, .also-relevant, .highlight-card, .story-card, .featured-story')).toBeNull();
      const section = document.querySelector<HTMLElement>('#top-stories.cx-stories')!;
      expect(section.querySelector('h2')?.textContent).toBe('Your 7 stories');
      expect(storyIds(section)).toEqual(report.recommendations.map((item) => item.articleId));
      expect(storyIds(document)).toEqual(storyIds(section));
      expect(document.body.textContent).not.toContain('Additional reading');
      const lead = section.querySelector<HTMLElement>('.cx-lead')!;
      expect(lead.dataset.storyCard).toBe('s-0');
      expect(lead.querySelector('.cx-label')?.textContent).toBe('Top match');
      expect(section.querySelector('[data-story-card="s-3"] .cx-label')?.textContent).toBe('Companies to watch');
      expect(section.querySelector('[data-story-card="s-6"] .cx-label')?.textContent).toBe('Market moves');
      expect(section.querySelector('[data-story-card="s-1"] .cx-label')).toBeNull();
      expect(section.querySelectorAll('.cx-grid > .cx-rest-card')).toHaveLength(6);
    }
  });

  it('shows stories by match % descending (lead = highest) without changing the selection, and Source N follows the cards', async () => {
    const report = sgiReport();
    // Ranking order s-0..s-6 with display scores out of order: the lead was 33% and the next story 42%.
    const scores = [33, 42, 61, 38, 58, 42, 47];
    report.recommendations.forEach((item, index) => { item.displayScore = scores[index]; });
    const ranked = report.recommendations.map((item) => item.articleId);
    await render(report, '');
    const section = document.querySelector<HTMLElement>('#top-stories')!;
    // Ties (s-1 and s-5 at 42%) keep their ranking order.
    expect(storyIds(section)).toEqual(['s-2', 's-4', 's-6', 's-1', 's-5', 's-3', 's-0']);
    const shown = [...section.querySelectorAll('.cx-match b')].map((node) => Number.parseInt(node.textContent ?? '', 10));
    expect(shown).toEqual([...shown].sort((left, right) => right - left));
    expect(section.querySelector<HTMLElement>('.cx-lead')?.dataset.storyCard).toBe('s-2');
    expect(section.querySelector('.cx-lead .cx-label')?.textContent).toBe('Top match');
    expect(section.querySelector('[data-story-card="s-6"] .cx-label')?.textContent).toBe('Market moves');
    expect(report.recommendations.map((item) => item.articleId)).toEqual(ranked);
    // s-4 and s-6 are cited: chips 1, 2 follow the display order and each card's tag matches its chip.
    const chips = [...document.querySelectorAll<HTMLElement>('[data-cite]')];
    expect(chips.map((chip) => `${chip.textContent}:${chip.dataset.cite}`)).toEqual(['1:s-4', '2:s-6']);
    expect(document.querySelector('[data-story-card="s-4"] .source-tag')?.textContent).toBe('Source 1');
    expect(document.querySelector('[data-story-card="s-6"] .source-tag')?.textContent).toBe('Source 2');
    expect(displayStories([{ recommendations: [] }])).toEqual([]);
  });

  it('keeps every card element and gives image-less stories a typographic panel, not an empty block', async () => {
    const report = sgiReport();
    report.recommendations[1].article.description = 'Garmin is moving adaptive training plans from its phone app onto the watch itself this year.';
    report.recommendations[3].article.description = 'Retailers are cutting packaging waste in their European stores, with new targets for 2027. More follows.';
    await render(report, '');
    const withImage = document.querySelector<HTMLElement>('[data-story-card="s-2"]')!;
    expect(withImage.querySelector<HTMLImageElement>('.cx-media img')?.src).toBe('https://www.sgieurope.com/Pictures/s-2.jpg');
    expect(withImage.querySelector('.cx-type')).toBeNull();
    const noImage = document.querySelector<HTMLElement>('[data-story-card="s-3"]')!;
    const panel = noImage.querySelector<HTMLElement>('.cx-media .cx-type')!;
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.className).toBe(`cx-type cx-tint-${categoryTint('CSR and sustainability')} is-long`);
    expect(panel.querySelector('.cx-type-label')?.textContent).toBe('CSR and sustainability');
    expect(panel.querySelector('.cx-type-line')?.textContent).toBe('Retailers are cutting packaging waste in their European stores');
    // The excerpt starts after the panel's clause, so the card never says it twice; the headline is never on the panel.
    expect(noImage.querySelector('.story-summary')?.textContent).toBe('With new targets for 2027. More follows.');
    for (const card of document.querySelectorAll<HTMLElement>('#top-stories .no-image')) {
      const line = card.querySelector('.cx-type-line')?.textContent ?? '';
      expect(line).not.toBe(card.querySelector('.cx-title')?.textContent);
      expect(card.querySelector('.story-summary')?.textContent ?? '').not.toContain(line);
    }
    // No usable clause (a 13-word first sentence): the category is set large, the excerpt stays whole.
    const categoryPanel = document.querySelector<HTMLElement>('[data-story-card="s-1"] .cx-type')!;
    expect(categoryPanel.classList.contains('is-category')).toBe(true);
    expect(categoryPanel.querySelector('.cx-type-line')?.textContent).toBe('Technology');
    expect(categoryPanel.querySelector('.cx-type-label')?.textContent).toBe('SGI Europe');
    expect(document.querySelector('[data-story-card="s-1"] .story-summary')?.textContent).toBe('Garmin is moving adaptive training plans from its phone app onto the watch itself this year.');
    // A long clause is set smaller rather than cut off, and hyphenated words are kept whole.
    report.recommendations[5].article.description = 'Decathlon is expanding its camera-based self-checkout after a year-long pilot, saying queues fell by a third across its stores.';
    await render(report, '');
    const long = document.querySelector<HTMLElement>('[data-story-card="s-5"] .cx-type')!;
    expect(long.classList.contains('is-long')).toBe(true);
    expect(long.querySelector('.cx-type-line')?.textContent).toBe('Decathlon is expanding its camera-based self-checkout after a year-long pilot');
    expect([...long.querySelectorAll('.cx-nb')].map((node) => node.textContent)).toEqual(['camera-based', 'self-checkout', 'year-long']);
    expect(document.querySelector('[data-story-card="s-5"] .story-summary')?.textContent).toBe('Saying queues fell by a third across its stores.');
    expect(document.querySelector('.story-placeholder, .cx-tile')).toBeNull();
    // Match first and alone in the top row; category and date as one line, untruncated.
    expect(noImage.querySelector('.cx-top .match-badge')?.textContent).toBe('55% match');
    expect(noImage.querySelector('.cx-meta')?.textContent).toBe(`CSR and sustainability·${cardDate('2026-10-13T09:00:00Z')}`);
    expect(cardDate('2026-10-13T09:00:00Z')).toBe('13 Oct 2026');
    expect(noImage.querySelector('.cx-title')?.textContent).toBe('Story 3 headline');
    expect(noImage.querySelector('.why .why-text')?.textContent).toMatch(/^Your roadmap gets a benchmark/);
    expect(noImage.querySelector('.why-toggle')?.textContent).toBe('More');
    const link = noImage.querySelector<HTMLAnchorElement>('a.story-link')!;
    expect(link.href).toBe('https://www.sgieurope.com/s-3.article');
    expect(link.dataset.storyId).toBe('s-3');
    expect(document.querySelector('[data-story-card="s-4"] .cx-top .match-badge + .source-tag')?.textContent).toBe('Source 1');
  });

  it('styles: no hyphenation, accent capped for AA on the panel, mobile clamps, equal-height grid rows', async () => {
    await render(sgiReport(), '');
    const css = [...document.querySelectorAll('style')].map((node) => node.textContent).join('');
    expect(css).not.toMatch(/hyphens:auto/);
    expect(css).toContain('.cx,.cx-panel{hyphens:manual;-webkit-hyphens:manual;overflow-wrap:normal;word-break:normal}');
    // The panel blends at most 30% of the accent into a near-black tint (white text stays above 4.5:1).
    expect(css).toContain('color-mix(in srgb,var(--brand) 30%,var(--tint))');
    expect(css).not.toMatch(/var\(--brand\) (?:3[1-9]|[4-9]\d|100)%,var\(--tint\)/);
    expect(css).toMatch(/\.cx-type-line\{[^}]*font:600 [^}]*'Source Serif 4'/);
    // The panel line is never clamped to fewer lines than a 12-word clause needs; long clauses are set smaller.
    expect(css).toMatch(/\.cx-type-line\{[^}]*-webkit-line-clamp:5\}/);
    expect(css).toContain('.cx-type.is-long .cx-type-line{max-width:28ch;font-size:clamp(1.02rem,4.3cqi,1.6rem)');
    // Excerpt and "why" clamp to three lines on phones (lead included), with More for the why.
    expect(css).toMatch(/\.cx-card \.story-summary\{[^}]*-webkit-line-clamp:3/);
    expect(css).toMatch(/\.cx-card \.why-text\{[^}]*-webkit-line-clamp:3/);
    expect(css).toContain('.cx-card.cx-lead .story-summary{-webkit-line-clamp:3}');
    // Grid rows stretch and the link is pushed to the card bottom.
    expect(css).toMatch(/\.cx-card \.cx-body\{grid-area:body;display:flex;flex-direction:column/);
    expect(css).toMatch(/\.cx-card \.story-link\{[^}]*margin-top:auto/);
    expect(css).toContain('grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch');
  });

  it('theme cards show the count, how many briefing stories each groups, and a Find stories button', async () => {
    await render(sgiReport(), '');
    const cards = [...document.querySelectorAll<HTMLElement>('.cx-theme')];
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual(['Connected fitness', 'AI coaching', 'Wearables']);
    expect(cards[0].querySelector('.cx-theme-index')?.textContent).toBe('01 / 03');
    expect(cards[0].querySelector('.cx-theme-count')?.textContent).toBe('2 stories in your briefing');
    expect(document.querySelector('.cx-theme-total')?.textContent).toBe('3 themes · swipe for more');
    expect(cards[0].querySelector('[data-theme-search]')?.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('opens focused reading in a dialog panel, briefing stories first, and closes it with Escape, the button or the backdrop', async () => {
    const report = sgiReport();
    await render(report, '');
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
    // Archive results carry the theme search's own % as a quieter "Theme match" pill; briefing stories keep their
    // report % and the normal "match" pill.
    const pill = (group: string) => [...panel.querySelectorAll(`[data-theme-group="${group}"] .match-badge`)];
    expect(pill('archive').map((node) => node.textContent)).toEqual(['70% Theme match']);
    expect(pill('archive').every((node) => node.classList.contains('cx-theme-match'))).toBe(true);
    expect(pill('briefing').map((node) => node.textContent)).toEqual(['60% match', '70% match']);
    expect(pill('briefing').some((node) => node.classList.contains('cx-theme-match'))).toBe(false);
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
    await render(sgiReport(), '');
    const css = [...document.querySelectorAll('style')].map((node) => node.textContent).join('');
    expect(css).toContain('@media(prefers-reduced-motion:reduce){.cx-panel{animation:none}}');
    expect(css).toMatch(/\.cx \.cx-theme-action:focus-visible[^{]*\{outline:3px solid/);
    expect(css).toContain('.cx-close{display:inline-grid;flex:none;width:44px;height:44px');
  });
});

describe('typographic panel helpers', () => {
  it('uses the first 4-12 word clause on the panel and starts the visible excerpt after it, never repeating it', () => {
    const text = (description?: string) => panelText({ description, summary: undefined, contentSnippet: undefined });
    // The reported case: a 13-word first clause is too long for the panel, so it shows the category and the excerpt stays whole.
    const rubber = 'Prices for synthetic rubber used in outsoles have risen for a third month, as two Asian producers cut output for maintenance.';
    expect(text(rubber)).toEqual({ excerpt: rubber });
    // Clause cut at a comma: the excerpt continues after it, "as" and punctuation trimmed, capitalised.
    expect(text('Rubber prices have risen for a third month, as two Asian producers cut output for maintenance.')).toEqual({ keyLine: 'Rubber prices have risen for a third month', excerpt: 'Two Asian producers cut output for maintenance.' });
    // Whole first sentence as the clause: the excerpt is the following sentences.
    expect(text('Container rates from Asia climbed 12% in October. Carriers removed capacity ahead of the peak season.')).toEqual({ keyLine: 'Container rates from Asia climbed 12% in October', excerpt: 'Carriers removed capacity ahead of the peak season.' });
    // Fewer than six words left: the excerpt is hidden rather than showing a fragment.
    expect(text('Puma tests nearshore production in Turkey, for fast lines.')).toEqual({ keyLine: 'Puma tests nearshore production in Turkey', excerpt: '' });
    expect(text('Shoe makers face higher freight costs.')).toEqual({ keyLine: 'Shoe makers face higher freight costs', excerpt: '' });
    // Too short a clause or no excerpt at all: no key line (the panel shows the category), the excerpt unchanged.
    expect(text('Up 4%. Prices rose again across Europe this month.')).toEqual({ excerpt: 'Up 4%. Prices rose again across Europe this month.' });
    expect(text(undefined)).toEqual({ excerpt: '' });
  });

  it('gives each category a stable tint out of six', () => {
    expect(categoryTint('Technology')).toBe(categoryTint(' technology '));
    const tints = new Set(['Technology', 'Retail', 'CSR and sustainability', 'Supply chain', 'Finance', 'People', 'Wearables', 'Legal'].map(categoryTint));
    expect(tints.size).toBeGreaterThan(2);
    for (const tint of tints) expect(tint).toBeLessThan(6);
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

  it('flags "you are seeing" anywhere in the summary as meta_phrase, a soft warning that keeps the text', () => {
    expect(REPORT_SUMMARY_ONLY_INSTRUCTIONS).toMatch(/Never write "you are seeing" or "you're seeing" anywhere in the summary/);
    const mid = summaryQualityWarnings('Nike and Adidas cut wholesale accounts. In China you are seeing distributors hold stock. Watch Q3 orders.', ['a', 'b'], {});
    expect(mid).toContain('meta_phrase');
    expect(mid).not.toContain('meta_opening');
    expect(summaryQualityWarnings("Puma closed 40 stores, and you're seeing rivals follow. Watch rents.", ['a', 'b'], {})).toContain('meta_phrase');
    expect(summaryQualityWarnings('Puma closed 40 stores, and you’re seeing rivals follow.', ['a', 'b'], {})).toContain('meta_phrase');
    // A lead that opens with it is meta_opening, not logged twice.
    expect(summaryQualityWarnings('You are seeing brands move coaching onto devices. Fitbit leads.', ['a', 'b'], {})).not.toContain('meta_phrase');
    expect(summaryQualityWarnings('Fitbit and Peloton moved coaching onto devices; sightseeing apps lag. Watch prices.', ['a', 'b'], {})).not.toContain('meta_phrase');
  });

  it('names the role in title case in the focused-reading intro ("Head of Retail", not "head of retail")', () => {
    const report = { ...sgiReport(), jobTitle: 'head of retail' };
    const html = focusResultsMarkup(report, [report.recommendations[0]], [], { publisherName: 'SGI Europe', link: (article) => `<a href="${article.url}">Read</a>` });
    expect(html).toContain('Selected for your role as Head of Retail<');
    expect(displayTitle('VP of CRM and loyalty')).toBe('VP of CRM and Loyalty');
  });
});
