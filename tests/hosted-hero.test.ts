// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDemoRegistry } from '../src/demo/definition';
import { renderHostedRoute } from '../src/hosted';
import { bindCitationChips, companyMonogram, heroVariant, summaryParts, summarySentences } from '../src/hosted-hero';
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

/** A report with the given summary whose 1st and 3rd recommendations are cited, plus one cited article that is not on the page. */
function shaped(overrides: Partial<ReportRecord> = {}): ReportRecord {
  const recommendations = base.recommendations.map((recommendation, index) => ({ ...recommendation, rankingMetadata: { ...recommendation.rankingMetadata, citedInSummary: index === 0 || index === 2 ? true : undefined } }));
  return { ...base, companyName: 'LD Systems', jobTitle: 'technology professional', generatedSummary: SUMMARY, overallMatchScore: 72, recommendations, sections: [], professionalProfile: { ...base.professionalProfile, coverage: undefined }, ...overrides };
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
    const parts = summaryParts('One fact here. Another fact there. A third implication.');
    expect(parts).toEqual({ lead: 'One fact here.', body: 'Another fact there. A third implication.' });
    expect(summaryParts('Only one sentence.')).toEqual({ lead: 'Only one sentence.', body: '' });
  });

  it('builds a monogram and reads the variant from the URL', () => {
    expect(companyMonogram('LD Systems')).toBe('LD');
    expect(companyMonogram('Nike')).toBe('N');
    expect(companyMonogram('Foot Locker')).toBe('FL');
    expect(heroVariant('?hero=a')).toBe('a');
    expect(heroVariant('?hero=B')).toBe('b');
    expect(heroVariant('?hero=c')).toBeUndefined();
    expect(heroVariant('')).toBeUndefined();
  });
});

describe('report hero variants', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('keeps the current hero when no variant is requested', async () => {
    await render(shaped());
    expect(document.querySelector('#report-heading')?.textContent).toBe('Your personalised briefing');
    expect(document.querySelector('.match-summary-card .relevance-ring')).not.toBeNull();
    expect(document.querySelector('.brief-hero, .brief-card')).toBeNull();
  });

  it('variant A: personal headline, meta line, stats and the restructured summary card below the hero', async () => {
    const report = shaped();
    await render(report, '?hero=a');
    const hero = document.querySelector<HTMLElement>('.report-hero.brief-hero-a')!;
    expect(hero.querySelector('h1')?.textContent).toBe('Technology Professional at LD Systems');
    expect(hero.querySelector('.brief-mark')?.textContent).toBe('LD');
    const count = report.professionalProfile.catalogueArticleCount!;
    expect(count).toBeGreaterThan(0);
    expect(hero.querySelector('.brief-meta')?.textContent).toMatch(new RegExp(`^Prepared \\d{1,2} \\w{3} \\d{4} from ${count} ${PUBLISHER} articles?$`));
    const stats = [...hero.querySelectorAll('.brief-stat dt .brief-dt-full, .brief-stat dt:not(:has(.brief-dt-full))')].map((node) => node.textContent);
    expect(stats).toEqual(['Stories selected', 'Themes', 'Newest story', 'Relevance']);
    expect(hero.querySelector('.brief-stat-relevance dd')?.textContent).toBe('72%');
    expect(hero.querySelector('.brief-card')).toBeNull();
    const card = hero.nextElementSibling!;
    expect(card.classList.contains('brief-card')).toBe(true);
    expect(card.querySelector('.brief-card-kicker')?.textContent).toBe('The signal');
    expect(card.querySelector('.brief-lead')?.textContent).toMatch(/^Brands are pulling/);
    expect(card.querySelector('.brief-body')?.textContent).toMatch(/^Intersport/);
    expect(card.querySelector('.brief-watch-label')?.textContent).toBe('Watch next');
    expect(card.querySelector('.brief-watch-text')?.textContent).toMatch(/^Watch whether/);
    expect(document.querySelector('.relevance-ring')).toBeNull();
  });

  it('variant B puts the summary card inside the hero', async () => {
    await render(shaped(), '?hero=b');
    const hero = document.querySelector('.report-hero.brief-hero-b')!;
    expect(hero.querySelector('.brief-masthead h1')).not.toBeNull();
    expect(hero.querySelector('.brief-card .brief-lead')).not.toBeNull();
  });

  it('citation chips are buttons numbered by page position, only for stories on the page, and move focus to the story', async () => {
    const report = shaped();
    await render(report, '?hero=a');
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

  it('shows the limited-coverage note first and does not call the closest stories a signal', async () => {
    const note = 'Coverage for software engineering is limited. These are the closest stories.';
    const report = shaped({ generatedSummary: 'These are the closest stories in the current coverage; read them as context.', professionalProfile: { ...base.professionalProfile, coverage: { limited: true, note } } });
    for (const variant of ['a', 'b']) {
      await render(report, `?hero=${variant}`);
      const card = document.querySelector('.brief-card')!;
      expect(card.firstElementChild?.getAttribute('data-coverage-note')).not.toBeNull();
      expect(card.firstElementChild?.textContent).toBe(note);
      expect(card.querySelector('.brief-card-kicker')?.textContent).toBe('In this coverage');
      expect(card.querySelector('.brief-watch')).toBeNull();
    }
  });

  it('falls back to publisher coverage without a catalogue count and escapes reader input', async () => {
    const report = shaped({ jobTitle: '<img src=x onerror=alert(1)>', professionalProfile: { ...base.professionalProfile, catalogueArticleCount: undefined } });
    await render(report, '?hero=a');
    expect(document.querySelector('.brief-meta')?.textContent).toMatch(new RegExp(` from ${PUBLISHER} coverage$`));
    expect(document.querySelector('.brief-hero img[onerror]')).toBeNull();
    expect(document.querySelector('.brief-hero h1')?.textContent).toContain('<img');
  });

  it('has no animated background and honours reduced motion', async () => {
    await render(shaped(), '?hero=a');
    const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('');
    const heroCss = css.slice(css.indexOf('.brief-hero'));
    expect(heroCss).not.toMatch(/@keyframes|animation:/);
    expect(heroCss).toMatch(/prefers-reduced-motion:reduce/);
  });
});
