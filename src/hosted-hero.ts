/**
 * Report header ("intelligence brief" masthead) for the hosted report page, in two variants selectable with
 * ?hero=a / ?hero=b while the design is chosen; without the parameter the page keeps the current hero.
 * Browser code: never import server modules here. It only re-arranges data the report already has.
 */
import type { ReportRecord, ReportRecommendation } from './reports';

export type HeroVariant = 'a' | 'b';

/** The variant requested in the page URL, or undefined for the current (default) design. */
export function heroVariant(search: string): HeroVariant | undefined {
  const value = new URLSearchParams(search).get('hero')?.trim().toLowerCase();
  return value === 'a' || value === 'b' ? value : undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' })[character] ?? character);
}

// Abbreviations that end in a full stop without ending a sentence ("U.S. retail", "Inc. reported").
const ABBREVIATION = /(?:\b(?:[A-Z]\.){1,3}|\b(?:Mr|Mrs|Ms|Dr|St|Inc|Ltd|Co|Corp|vs|etc|approx|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.)$/;

/** Splits a summary into sentences without breaking on decimals ("3.5%") or common abbreviations. */
export function summarySentences(summary: string): string[] {
  const text = summary.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const sentences: string[] = [];
  let start = 0;
  const boundary = /[.!?]["'’”)]*\s+(?=["'‘“(]?[A-Z0-9])/g;
  for (let match = boundary.exec(text); match; match = boundary.exec(text)) {
    const end = match.index + match[0].trimEnd().length;
    const candidate = text.slice(start, end).trim();
    if (ABBREVIATION.test(text.slice(start, match.index + 1))) continue;
    if (candidate) sentences.push(candidate);
    start = match.index + match[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

export interface SummaryParts {
  /** First sentence: "The signal". */
  lead: string;
  /** Sentences between the lead and the watch line. */
  body: string;
  /** The final sentence when it says what to watch ("Watch whether…", "…worth watching."). */
  watch?: string;
}

const WATCH = /\bwatch(?:ing|es)?\b|\bkeep an eye\b|\blook out for\b/i;

export function summaryParts(summary: string): SummaryParts {
  const sentences = summarySentences(summary);
  if (!sentences.length) return { lead: '', body: '' };
  const [lead, ...rest] = sentences;
  const last = rest.at(-1);
  const watch = last && WATCH.test(last) ? last : undefined;
  return { lead, body: (watch ? rest.slice(0, -1) : rest).join(' '), ...(watch ? { watch } : {}) };
}

/** Up to three characters for the company mark ("LD Systems" → "LD", "Nike" → "N", "Foot Locker" → "FL"). */
export function companyMonogram(company: string): string {
  const words = company.replace(/[^\p{L}\p{N}\s&-]/gu, ' ').split(/[\s-]+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (!words.length) return '·';
  // Keep a short acronym whole ("LD Systems" → "LD", "JD Sports" → "JD").
  if (/^[\p{Lu}\p{N}&]{2,3}$/u.test(words[0])) return words[0];
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0].slice(0, 1) + words[1].slice(0, 1)).toUpperCase();
}

function shortDate(value?: string): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(timestamp);
}

export interface HeroContext {
  variant: HeroVariant;
  report: ReportRecord;
  publisherName: string;
  /** "Technology Professional" (the corrected, title-cased role). */
  role: string;
  /** "LD Systems" (title-cased display company). */
  company: string;
  themeCount: number;
  /** Recommendations rendered on the page, in page order: citation chips are numbered and linked from these. */
  storiesOnPage: ReportRecommendation[];
  /** Publisher logo / name markup (already escaped). */
  brand: string;
}

function citationChips(context: HeroContext): string {
  const chips = context.storiesOnPage.flatMap((recommendation, index) => {
    if (!recommendation.rankingMetadata?.citedInSummary) return [];
    const title = recommendation.article.title;
    return `<button class="brief-cite" type="button" data-cite="${escapeHtml(recommendation.article.id)}" aria-label="Source ${index + 1}: ${escapeHtml(title)}" title="${escapeHtml(title)}">${index + 1}</button>`;
  });
  if (!chips.length) return '';
  return `<div class="brief-cites" data-brief-cites><span class="brief-cites-label">Sources</span>${chips.join('')}</div>`;
}

function newestStory(report: ReportRecord): string | undefined {
  const timestamps = report.recommendations.map((item) => Date.parse(item.article.publishedAt ?? '')).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : undefined;
}

function metaLine(context: HeroContext): string {
  const prepared = shortDate(context.report.createdAt);
  const count = context.report.professionalProfile.catalogueArticleCount;
  const source = typeof count === 'number' && count > 0
    ? `${count.toLocaleString('en-GB')} ${context.publisherName} ${count === 1 ? 'article' : 'articles'}`
    : `${context.publisherName} coverage`;
  return `${prepared ? `Prepared ${prepared} from ` : 'Prepared from '}${source}`;
}

/** A stat label with a shorter visible form on phones; screen readers always get the full label. */
function label(full: string, short: string): string {
  return `<span class="brief-dt-full">${full}</span><span class="brief-dt-short" aria-hidden="true">${short}</span>`;
}

function statsMarkup(context: HeroContext): string {
  const { report } = context;
  const score = Math.max(0, Math.min(100, Math.round(report.overallMatchScore)));
  const newest = shortDate(newestStory(report));
  const stats = [
    `<div class="brief-stat"><dt>${label('Stories selected', 'Stories')}</dt><dd>${report.recommendations.length}</dd></div>`,
    context.themeCount ? `<div class="brief-stat"><dt>Themes</dt><dd>${context.themeCount}</dd></div>` : '',
    newest ? `<div class="brief-stat"><dt>${label('Newest story', 'Newest')}</dt><dd>${escapeHtml(newest)}</dd></div>` : '',
    `<div class="brief-stat brief-stat-relevance"><dt>Relevance</dt><dd><span>${score}%</span><span class="brief-meter" aria-hidden="true"><span style="width:${score}%"></span></span></dd></div>`,
  ];
  return `<dl class="brief-stats">${stats.join('')}</dl>`;
}

function cardMarkup(context: HeroContext): string {
  const { report } = context;
  const parts = summaryParts(report.generatedSummary);
  const coverage = report.professionalProfile.coverage?.limited ? `<p class="coverage-note brief-coverage" data-coverage-note>${escapeHtml(report.professionalProfile.coverage.note)}</p>` : '';
  const watch = parts.watch ? `<div class="brief-watch"><span class="brief-watch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></span><div><p class="brief-watch-label">Watch next</p><p class="brief-watch-text">${escapeHtml(parts.watch)}</p></div></div>` : '';
  const actions = `<div class="summary-actions brief-actions"><a class="action-button" href="#top-stories">View top stories <span aria-hidden="true">↓</span></a><button class="text-button" type="button" data-share>Share report <span aria-hidden="true">↗</span></button></div>`;
  return `<section class="brief-card" aria-labelledby="brief-signal-label">${coverage}<div class="brief-card-main"><p class="brief-card-kicker" id="brief-signal-label">${report.professionalProfile.coverage?.limited ? 'In this coverage' : 'The signal'}</p><p class="brief-lead match-summary-text">${escapeHtml(parts.lead)}</p>${parts.body ? `<p class="brief-body">${escapeHtml(parts.body)}</p>` : ''}</div><div class="brief-card-side">${watch}<div class="brief-card-foot">${citationChips(context)}${actions}</div></div></section>`;
}

export function briefHeroMarkup(context: HeroContext): string {
  const { variant } = context;
  const masthead = `<div class="brief-masthead"><div class="brief-topline">${context.brand}<button class="brief-edit" type="button" data-edit>Edit profile</button></div><div class="brief-who"><span class="brief-mark" aria-hidden="true">${escapeHtml(companyMonogram(context.company))}</span><div class="brief-who-text"><p class="brief-kicker">Your briefing</p><h1 id="report-heading"><span class="brief-role">${escapeHtml(context.role)}</span> <span class="brief-at">at ${escapeHtml(context.company)}</span></h1></div></div><p class="brief-meta">${escapeHtml(metaLine(context))}</p>${statsMarkup(context)}</div>`;
  const hero = `<section class="report-hero brief-hero brief-hero-${variant}" data-hero-variant="${variant}" aria-labelledby="report-heading"><div class="brief-hero-inner">${masthead}${variant === 'b' ? cardMarkup(context) : ''}</div></section>`;
  return variant === 'a' ? `${hero}${cardMarkup(context)}` : hero;
}

/**
 * Numbers citation chips by the story's position on the page and drops chips whose story is not shown (some
 * sections are not rendered), then makes each chip scroll to its story card and move focus there.
 */
export function bindCitationChips(scope: ParentNode, reducedMotion: boolean): void {
  const cards = [...scope.querySelectorAll<HTMLElement>('[data-story-card]')].filter((card) => !card.closest('[data-theme-results]'));
  const order = [...new Set(cards.map((card) => card.dataset.storyCard ?? ''))];
  scope.querySelectorAll<HTMLButtonElement>('[data-cite]').forEach((chip) => {
    const position = order.indexOf(chip.dataset.cite ?? '');
    if (position < 0) { chip.remove(); return; }
    chip.textContent = String(position + 1);
    chip.setAttribute('aria-label', `Source ${position + 1}: ${chip.title}`);
    chip.addEventListener('click', () => {
      const target = cards.find((card) => card.dataset.storyCard === chip.dataset.cite);
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
      target.classList.add('is-cited');
      window.setTimeout(() => target.classList.remove('is-cited'), 1600);
    });
  });
  scope.querySelectorAll<HTMLElement>('[data-brief-cites]').forEach((group) => { if (!group.querySelector('[data-cite]')) group.remove(); });
}

/*
 * Background: the publisher accent mixed into a near-black base, two soft accent glows and a fine grid faded out
 * with a mask. The mix ratios are chosen so small text (white at 86% opacity) stays at or above 4.5:1 at the
 * brightest point of the background for any accent, including white and yellow. Static: no
 * animation, so prefers-reduced-motion needs nothing beyond the citation highlight.
 */
export function briefHeroStyle(): string {
  return `<style>
.report-page .report-hero.brief-hero{--hero-base:color-mix(in srgb,var(--brand) 26%,#0a0d18);--hero-glow:color-mix(in srgb,var(--brand) 78%,white);position:relative;min-height:0;overflow:hidden;padding:clamp(20px,2.2vw,28px) clamp(20px,3vw,44px) 0;border-radius:clamp(22px,2.6vw,34px);color:#fff;background-color:var(--hero-base);background-image:radial-gradient(60% 120% at 100% 0%,color-mix(in srgb,var(--hero-glow) 16%,transparent),transparent 62%),radial-gradient(45% 90% at 0% 115%,color-mix(in srgb,var(--hero-glow) 10%,transparent),transparent 70%),linear-gradient(160deg,color-mix(in srgb,var(--hero-base) 90%,white) 0%,var(--hero-base) 55%);box-shadow:0 24px 70px rgba(10,13,24,.2)}
.report-page .report-hero.brief-hero::after{z-index:0;background:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px) 0 0/28px 28px,linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px) 0 0/28px 28px;-webkit-mask-image:radial-gradient(80% 100% at 85% 0%,#000,transparent 75%);mask-image:radial-gradient(80% 100% at 85% 0%,#000,transparent 75%)}
.brief-hero-inner{position:relative;z-index:1}.brief-masthead{min-width:0}
.brief-topline{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.brief-topline .hosted-brand{margin:0;color:#fff}.brief-topline .hosted-brand img{max-width:170px;max-height:32px}
.brief-edit{min-height:34px;padding:6px 14px;border:1px solid rgba(255,255,255,.34);border-radius:999px;color:#fff;background:rgba(255,255,255,.06);font-size:.78rem;font-weight:750}.brief-edit:hover{background:rgba(255,255,255,.1)}
.brief-who{display:flex;align-items:center;gap:16px}.brief-who-text{min-width:0}
.brief-mark{display:grid;flex:none;width:52px;height:52px;place-items:center;border:1px solid rgba(255,255,255,.3);border-radius:14px;color:#fff;background:linear-gradient(145deg,rgba(255,255,255,.2),rgba(255,255,255,.05));font:600 1.2rem/1 Georgia,serif;letter-spacing:.02em}
.brief-kicker{margin:0 0 4px;color:rgba(255,255,255,.86);font-size:.7rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
.report-page .brief-hero h1{margin:0;color:#fff;font:500 clamp(1.9rem,2.9vw,2.6rem)/1.05 Georgia,serif;letter-spacing:-.025em;text-align:left}.brief-at{color:rgba(255,255,255,.84)}
.brief-meta{margin:10px 0 0;color:rgba(255,255,255,.86);font-size:.84rem}
.brief-stats{display:flex;flex-wrap:wrap;gap:0;margin:14px 0 0;padding:0;border-top:1px solid rgba(255,255,255,.18)}
.brief-stat{position:relative;display:flex;flex-direction:column;gap:2px;min-width:0;padding:10px 26px 0 0;margin-right:26px;border-right:1px solid rgba(255,255,255,.14)}.brief-stat:last-child{margin-right:0;border-right:0}
.brief-stat dt{color:rgba(255,255,255,.86);font-size:.64rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.brief-stat dd{display:flex;align-items:center;gap:10px;margin:0;color:#fff;font-size:1.05rem;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
.brief-meter{position:relative;display:inline-block;width:64px;height:5px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.22)}.brief-meter>span{position:absolute;inset:0 auto 0 0;border-radius:inherit;background:#fff}
.brief-card{--card-accent:color-mix(in srgb,var(--brand) 62%,#10131f);position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px clamp(22px,3vw,40px);padding:clamp(18px,1.6vw,22px) clamp(20px,2.4vw,30px);border:1px solid rgba(20,30,60,.08);border-radius:24px;color:#151a3a;background:#fff;box-shadow:0 22px 60px rgba(21,26,58,.14)}
.report-page .brief-card>.brief-coverage{grid-area:auto;grid-column:1/-1;grid-row:1;margin:0;padding:9px 12px;border-radius:12px;color:#5b4a12;background:#fff6dc;font-size:.84rem;line-height:1.45}
.brief-card-kicker{margin:0 0 6px;color:var(--card-accent);font-size:.68rem;font-weight:850;letter-spacing:.16em;text-transform:uppercase}
.report-page .brief-lead{max-width:none;margin:0;color:#151a3a;font:500 clamp(1.08rem,1.35vw,1.24rem)/1.38 Georgia,serif;letter-spacing:-.01em}
.brief-body{margin:8px 0 0;color:#3d4250;font-size:.9rem;line-height:1.5}
.brief-card-side{display:flex;flex-direction:column;gap:12px;min-width:0}
.brief-watch{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-left:3px solid var(--card-accent);border-radius:12px;background:color-mix(in srgb,var(--brand) 7%,#f7f8fa)}
.brief-watch-icon{display:grid;flex:none;width:26px;height:26px;place-items:center;border-radius:50%;color:#fff;background:var(--card-accent)}
.brief-watch-label{margin:0 0 2px;color:#151a3a;font-size:.66rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.brief-watch-text{margin:0;color:#3d4250;font-size:.86rem;line-height:1.45}
.brief-card-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:auto}
.brief-cites{display:flex;flex-wrap:wrap;align-items:center;gap:5px}.brief-cites-label{margin-right:3px;color:#5b6170;font-size:.66rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}
.brief-cite{display:inline-grid;min-width:26px;height:26px;place-items:center;padding:0 7px;border:1px solid color-mix(in srgb,var(--card-accent) 35%,white);border-radius:8px;color:var(--card-accent);background:#fff;font-size:.74rem;font-weight:800;font-variant-numeric:tabular-nums}.brief-cite:hover,.brief-cite:focus-visible{color:#fff;background:var(--card-accent)}.brief-cite:focus-visible{outline-offset:2px}
.report-page .brief-actions{margin:0;gap:8px}.report-page .brief-actions .action-button,.report-page .brief-actions .text-button{gap:6px;min-height:38px;padding:8px 14px;font-size:.8rem}
[data-story-card].is-cited{outline:3px solid color-mix(in srgb,var(--brand) 55%,white);outline-offset:4px;transition:outline-color .6s ease}
.report-page .report-hero.brief-hero-a{padding-bottom:52px}
.brief-hero-a .brief-masthead{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"who top" "meta meta" "stats stats";align-items:start;column-gap:24px}.brief-hero-a .brief-topline{grid-area:top;gap:18px;margin:0}.brief-hero-a .brief-who{grid-area:who}.brief-hero-a .brief-meta{grid-area:meta}.brief-hero-a .brief-stats{grid-area:stats}
.brief-hero-a .brief-topline .hosted-brand{padding-right:18px;border-right:1px solid rgba(255,255,255,.2)}
.brief-dt-short{display:none}
.report-page .brief-hero-a+.brief-card{width:min(1100px,calc(100% - 48px));margin:-40px auto 0}
.report-page .report-hero.brief-hero-b{padding-bottom:clamp(20px,2.2vw,28px)}
.brief-hero-b .brief-hero-inner{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);align-items:center;gap:clamp(24px,3vw,44px)}
.brief-hero-b .brief-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px;padding-top:14px}.brief-hero-b .brief-stat{margin:0;padding:0;border:0}
.brief-hero-b .brief-card{grid-template-columns:1fr;box-shadow:0 18px 50px rgba(5,8,18,.28)}.brief-hero-b .brief-card-side{gap:10px}
.report-page .brief-hero-b~.report-content{padding-top:clamp(96px,8vw,112px)}
@media(max-width:1023px){.brief-hero-b .brief-hero-inner{grid-template-columns:1fr}.brief-card{grid-template-columns:1fr}}
@media(max-width:639px){
.report-page .report-hero.brief-hero{padding:16px 16px 0;border-radius:0 0 22px 22px}.brief-topline{margin-bottom:14px}.brief-topline .hosted-brand img{max-height:26px}.brief-edit{min-height:32px;padding:5px 12px;font-size:.72rem}
.brief-who{gap:12px}.brief-mark{width:42px;height:42px;border-radius:12px;font-size:1rem}.report-page .brief-hero h1{font-size:1.5rem;line-height:1.1}.brief-meta{margin-top:8px;font-size:.76rem}
.brief-stats,.brief-hero-b .brief-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin-top:12px;padding-top:10px}.brief-stat,.brief-hero-b .brief-stat{margin:0;padding:0 8px;border:0;border-left:1px solid rgba(255,255,255,.14)}.brief-stat:first-child{padding-left:0;border-left:0}
.brief-stat dt{font-size:.56rem;letter-spacing:.06em;line-height:1.2}.brief-stat dd{flex-wrap:wrap;gap:4px;font-size:.86rem;white-space:normal;line-height:1.2}.brief-meter{width:100%;max-width:56px;height:4px}
.report-page .report-hero.brief-hero-a{padding-bottom:50px}.brief-hero-a .brief-masthead{display:block}.brief-hero-a .brief-topline{margin-bottom:14px}.brief-hero-a .brief-topline .hosted-brand{padding-right:0;border-right:0}.brief-dt-full{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.brief-dt-short{display:inline}.report-page .brief-hero-a+.brief-card{width:calc(100% - 24px);margin-top:-38px}
.report-page .report-hero.brief-hero-b{padding-bottom:12px}.brief-hero-b .brief-hero-inner{gap:16px}.brief-hero-b .brief-card{margin:0 -4px}
.brief-card{gap:12px;padding:16px;border-radius:20px}.report-page .brief-lead{font-size:1.06rem}.brief-body{font-size:.86rem}.brief-watch-text{font-size:.82rem}
.report-page .brief-hero-b~.report-content{padding-top:76px}
}
@media(prefers-reduced-motion:reduce){[data-story-card].is-cited{transition:none}}
</style>`;
}
