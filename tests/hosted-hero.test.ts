// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDemoRegistry } from '../src/demo/definition';
import { renderHostedRoute } from '../src/hosted';
import { bindCitationChips, briefHeroStyle, companyMonogram, isLimitedFallbackSummary, storyDate, summaryParts, summarySentences } from '../src/hosted-hero';
import type { ReportRecord } from '../src/reports';
import { createProductionApp } from '../src/server/production';

const SUMMARY = 'Brands are pulling distribution back into owned stores: Adidas added 41 doors while Puma cut wholesale accounts by 18%. Intersport reported a 6.2% rise in U.S. like-for-like sales. For your team, shelf space will tighten. Watch whether JD Sports’ new flagship format changes what partners expect.';

let base: ReportRecord;
const PUBLISHER = createDemoRegistry().get('demo')!.manifest!.name;

beforeAll(async () => {
  const app = createProductionApp({ environment: 'test' });
  const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Chief Technology Officer' }) }));
  const { reportId } = await generated.json() as { reportId: string };
  base = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json() as ReportRecord;
});

/** A full-coverage report with an AI-style summary whose 1st and 3rd recommendations are cited. */
function shaped(overrides: Partial<ReportRecord> = {}): ReportRecord {
  const recommendations = base.recommendations.map((recommendation, index) => ({ ...recommendation, rankingMetadata: { ...recommendation.rankingMetadata, citedInSummary: index === 0 || index === 2 ? true : undefined } }));
  return { ...base, companyName: 'LD Systems', jobTitle: 'technology professional', generatedSummary: SUMMARY, summarySource: 'ai', overallMatchScore: 72, recommendations, sections: [], professionalProfile: { ...base.professionalProfile, coverage: undefined }, ...overrides };
}

async function render(report: ReportRecord, search = ''): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(report)));
  window.history.replaceState({}, '', `/p/demo/${report.id}${search}`);
  await renderHostedRoute(document, createDemoRegistry());
}

describe('summary parts', () => {
  it('splits lead, body and the final watch sentence without breaking on decimals or abbreviations', () => {
    expect(summarySentences(SUMMARY)).toHaveLength(4);
    const parts = summaryParts(SUMMARY);
    expect(parts.lead).toBe('Brands are pulling distribution back into owned stores: Adidas added 41 doors while Puma cut wholesale accounts by 18%.');
    expect(parts.body).toBe('Intersport reported a 6.2% rise in U.S. like-for-like sales. For your team, shelf space will tighten.');
    expect(parts.watch).toMatch(/^Watch whether JD Sports/);
  });

  it('keeps every sentence when the last one is not a watch line', () => {
    expect(summaryParts('One fact here. Another fact there. A third implication.')).toEqual({ lead: 'One fact here.', body: 'Another fact there. A third implication.' });
    expect(summaryParts('Only one sentence.')).toEqual({ lead: 'Only one sentence.', body: '' });
  });

  it('builds a monogram that keeps short acronyms', () => {
    expect(companyMonogram('LD Systems')).toBe('LD');
    expect(companyMonogram('Nike')).toBe('N');
    expect(companyMonogram('Foot Locker')).toBe('FL');
  });

  it('dates stories as "5 Nov", adding the year only outside the current year', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    expect(storyDate('2026-11-05T09:00:00Z', now)).toBe('5 Nov');
    expect(storyDate('2025-12-30T09:00:00Z', now)).toBe('30 Dec 2025');
    expect(storyDate(undefined, now)).toBe('');
    expect(storyDate('not a date', now)).toBe('');
  });

  it('recognises the generic limited-coverage summary, not an AI summary written for limited coverage', () => {
    const limited = { ...base.professionalProfile, coverage: { limited: true as const, note: 'Limited.' } };
    expect(isLimitedFallbackSummary({ professionalProfile: limited, generatedSummary: 'These are the closest stories in the current coverage; read them as context.', summarySource: undefined })).toBe(true);
    expect(isLimitedFallbackSummary({ professionalProfile: limited, generatedSummary: 'Anything', summarySource: 'deterministic' })).toBe(true);
    expect(isLimitedFallbackSummary({ professionalProfile: limited, generatedSummary: SUMMARY, summarySource: 'ai' })).toBe(false);
    expect(isLimitedFallbackSummary({ professionalProfile: { ...limited, coverage: undefined }, generatedSummary: 'These are the closest stories in the current coverage.', summarySource: 'deterministic' })).toBe(false);
  });
});

describe('report hero', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ''; });

  it('renders one hero with headline, meta, stats and the summary card inside it; the URL has no say', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T12:00:00Z'), toFake: ['Date'] });
    const report = shaped({ recommendations: shaped().recommendations.map((item, index) => ({ ...item, article: { ...item.article, publishedAt: index === 0 ? '2026-11-05T09:00:00Z' : '2026-10-01T09:00:00Z' } })) });
    for (const search of ['', '?hero=a', '?hero=b']) {
      await render(report, search);
      expect(document.querySelectorAll('.report-hero')).toHaveLength(1);
      const hero = document.querySelector<HTMLElement>('.report-hero.brief-hero')!;
      expect(hero.querySelector('h1')?.textContent).toBe('Technology Professional at LD Systems');
      expect(hero.querySelector('h1 .brief-company')?.textContent).toBe('LD Systems');
      expect(hero.querySelector('.brief-mark')?.textContent).toBe('LD');
      const count = report.professionalProfile.catalogueArticleCount!;
      expect(count).toBeGreaterThan(0);
      expect(hero.querySelector('.brief-meta')?.textContent).toMatch(new RegExp(`^Prepared \\d{1,2} \\w{3} \\d{4} from ${count} ${PUBLISHER} articles?$`));
      const labels = [...hero.querySelectorAll('.brief-stat dt')].map((node) => node.querySelector('.brief-dt-full')?.textContent ?? node.textContent);
      expect(labels).toEqual(['Stories selected', 'Themes', 'Newest story', 'Relevance']);
      expect(hero.querySelectorAll('.brief-stat dd')[2]?.textContent).toBe('5 Nov');
      expect(hero.querySelector('.brief-stat-relevance dd')?.textContent).toBe('72%');
      const card = hero.querySelector('.brief-hero-inner > .brief-card')!;
      expect(card.querySelector('.brief-card-kicker')?.textContent).toBe('The signal');
      expect(card.querySelector('.brief-lead')?.textContent).toMatch(/^Brands are pulling/);
      expect(card.querySelector('.brief-body')?.textContent).toMatch(/^Intersport/);
      expect(card.querySelector('.brief-watch-label')?.textContent).toBe('Watch next');
      expect(card.querySelector('.brief-watch-text')?.textContent).toMatch(/^Watch whether/);
      expect(document.querySelector('.relevance-ring, .match-summary-card, .report-identity, [data-hero-variant]')).toBeNull();
    }
  });

  it('lets a very long company name wrap rather than overflow a phone', async () => {
    await render(shaped({ companyName: 'International Federation of Sporting Goods Retailers' }));
    expect(document.querySelector('.brief-hero h1 .brief-company')).toBeNull();
  });

  it('citation chips are buttons numbered by page position that move focus to the story', async () => {
    const report = shaped();
    await render(report);
    const order = [...document.querySelectorAll<HTMLElement>('[data-story-card]')].map((card) => card.dataset.storyCard);
    const chips = [...document.querySelectorAll<HTMLButtonElement>('.brief-cite')];
    const cited = report.recommendations.filter((item) => item.rankingMetadata.citedInSummary && order.includes(item.article.id));
    expect(chips.map((chip) => chip.dataset.cite)).toEqual(cited.map((item) => item.article.id));
    chips.forEach((chip) => {
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.textContent).toBe(String(order.indexOf(chip.dataset.cite) + 1));
      expect(chip.getAttribute('aria-label')).toMatch(/^Source \d+: /);
    });
    const target = document.querySelector<HTMLElement>(`[data-story-card="${chips[0].dataset.cite}"]`)!;
    const scrolled = vi.fn();
    target.scrollIntoView = scrolled;
    chips[0].click();
    expect(scrolled).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
  });

  it('drops chips for cited stories that are not rendered (e.g. in a section the page does not show)', () => {
    const scope = document.createElement('div');
    scope.innerHTML = '<div data-brief-cites><button data-cite="b" title="B">9</button><button data-cite="gone" title="Gone">9</button></div><article data-story-card="a"></article><article data-story-card="b"></article><section data-theme-results><article data-story-card="gone"></article></section>';
    bindCitationChips(scope, true);
    expect([...scope.querySelectorAll<HTMLElement>('[data-cite]')].map((chip) => `${chip.dataset.cite}:${chip.textContent}`)).toEqual(['b:2']);
    scope.querySelector<HTMLElement>('[data-cite="b"]')!.remove();
    bindCitationChips(scope, true);
    expect(scope.querySelector('[data-brief-cites]')).toBeNull();
  });

  it('limited coverage with the generic fallback summary shows only the note and the buttons', async () => {
    const note = 'Coverage for software engineering is limited. These are the closest stories.';
    await render(shaped({ generatedSummary: 'These are the closest stories in the current coverage; read them as context rather than a direct briefing on software engineering.', summarySource: 'deterministic', professionalProfile: { ...base.professionalProfile, coverage: { limited: true, note } } }));
    const card = document.querySelector('.brief-card')!;
    expect(card.firstElementChild?.getAttribute('data-coverage-note')).not.toBeNull();
    expect(card.firstElementChild?.textContent).toBe(note);
    expect(card.querySelector('.brief-card-kicker, .brief-lead, .brief-body, .brief-watch, .brief-cites')).toBeNull();
    expect(card.querySelector('[href="#top-stories"]')).not.toBeNull();
    expect(card.querySelector('[data-share]')).not.toBeNull();
    expect(card.textContent).not.toMatch(/closest stories in the current coverage/);
  });

  it('limited coverage with an AI summary keeps the summary, labelled as coverage rather than a signal', async () => {
    await render(shaped({ professionalProfile: { ...base.professionalProfile, coverage: { limited: true, note: 'Limited coverage.' } } }));
    const card = document.querySelector('.brief-card')!;
    expect(card.firstElementChild?.textContent).toBe('Limited coverage.');
    expect(card.querySelector('.brief-card-kicker')?.textContent).toBe('In this coverage');
    expect(card.querySelector('.brief-lead')?.textContent).toMatch(/^Brands/);
  });

  it('falls back to publisher coverage without a catalogue count and escapes reader input', async () => {
    await render(shaped({ jobTitle: '<img src=x onerror=alert(1)>', professionalProfile: { ...base.professionalProfile, catalogueArticleCount: undefined } }));
    expect(document.querySelector('.brief-meta')?.textContent).toMatch(new RegExp(` from ${PUBLISHER} coverage$`));
    expect(document.querySelector('.brief-hero img[onerror]')).toBeNull();
    expect(document.querySelector('.brief-hero h1')?.textContent).toContain('<img');
  });

  it('balances the headline, keeps the company on one line and has no animated background', () => {
    const css = briefHeroStyle();
    expect(css).toMatch(/\.brief-hero h1\{[^}]*text-wrap:balance/);
    expect(css).toContain('.brief-company{white-space:nowrap}');
    expect(css).not.toMatch(/@keyframes|animation:/);
    expect(css).toMatch(/prefers-reduced-motion:reduce/);
  });
});

describe('self-hosted serif', () => {
  it('declares Source Serif 4 at 400 and 600 from same-origin woff2 files with font-display swap', () => {
    const css = briefHeroStyle();
    const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(2);
    for (const [face, weight] of faces.map((face, index) => [face, [400, 600][index]] as const)) {
      expect(face).toContain("font-family:'Source Serif 4'");
      expect(face).toContain(`font-weight:${weight}`);
      expect(face).toContain('font-display:swap');
      expect(face).toMatch(new RegExp(`src:url\\("[^"]*source-serif-4-latin-${weight}-normal\\.woff2"\\) format\\("woff2"\\)`));
      expect(face).not.toMatch(/https?:\/\/(?!localhost)/);
      expect(face).toContain('unicode-range:U+0000-00FF');
    }
    expect(css).toMatch(/\.brief-hero h1\{[^}]*'Source Serif 4',Georgia,serif/);
    expect(css).toMatch(/\.brief-lead\{[^}]*'Source Serif 4',Georgia,serif/);
  });

  it('ships the two latin woff2 files and the OFL licence', () => {
    for (const weight of [400, 600]) expect(readFileSync(path.resolve('src/assets/fonts', `source-serif-4-latin-${weight}-normal.woff2`)).subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(readFileSync(path.resolve('src/assets/fonts/SourceSerif4-OFL.txt'), 'utf8')).toContain('SIL Open Font License');
  });
});
