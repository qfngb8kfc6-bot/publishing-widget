/**
 * Report header ("intelligence brief" masthead) for the hosted report page: headline, meta line and stats on the
 * left, the summary card on the right inside the hero (stacked below 1024px).
 * Browser code: never import server modules here. It only re-arranges data the report already has.
 */
import type { ReportRecord, ReportRecommendation } from './reports';

// Self-hosted (OFL, see assets/fonts/SourceSerif4-OFL.txt); emitted as hashed same-origin assets by Vite.
const SERIF_400 = new URL('./assets/fonts/source-serif-4-latin-400-normal.woff2', import.meta.url).href;
const SERIF_600 = new URL('./assets/fonts/source-serif-4-latin-600-normal.woff2', import.meta.url).href;
const SERIF = "'Source Serif 4',Georgia,serif";
const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

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

/** "5 Nov" for a date in the current year, "5 Nov 2025" otherwise, so the stat stays on one line on phones. */
export function storyDate(value: string | undefined, now = new Date()): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const sameYear = new Date(timestamp).getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(timestamp);
}

const LIMITED_FALLBACK = /^These are the closest stories in the current coverage\b/;

/** The generic limited-coverage summary repeats the coverage note, so the card shows only the note. */
export function isLimitedFallbackSummary(report: Pick<ReportRecord, 'professionalProfile' | 'generatedSummary' | 'summarySource'>): boolean {
  if (!report.professionalProfile.coverage?.limited) return false;
  return report.summarySource === 'deterministic' || LIMITED_FALLBACK.test(report.generatedSummary.trim());
}

// Short company names never break across lines; a very long one may, rather than overflow a phone screen.
const NOWRAP_COMPANY_MAX = 28;

export interface HeroContext {
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

/** Chips are numbered 1, 2, 3 in citation order (page order of the cited stories), never by page position. */
function citationChips(context: HeroContext): string {
  const cited = context.storiesOnPage.filter((recommendation) => recommendation.rankingMetadata?.citedInSummary);
  const chips = cited.map((recommendation, index) => {
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
  const newest = storyDate(newestStory(report));
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
  const limited = report.professionalProfile.coverage?.limited ? report.professionalProfile.coverage : undefined;
  const coverage = limited ? `<p class="coverage-note brief-coverage" data-coverage-note>${escapeHtml(limited.note)}</p>` : '';
  const actions = `<div class="summary-actions brief-actions"><a class="action-button" href="#top-stories">View top stories <span aria-hidden="true">↓</span></a><button class="text-button" type="button" data-share>Share report <span aria-hidden="true">↗</span></button></div>`;
  if (isLimitedFallbackSummary(report)) return `<section class="brief-card brief-card-note" aria-label="About this briefing">${coverage}<div class="brief-card-foot">${actions}</div></section>`;
  const parts = summaryParts(report.generatedSummary);
  const watch = parts.watch ? `<div class="brief-watch"><span class="brief-watch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></span><div><p class="brief-watch-label">Watch next</p><p class="brief-watch-text">${escapeHtml(parts.watch)}</p></div></div>` : '';
  return `<section class="brief-card" aria-labelledby="brief-signal-label">${coverage}<p class="brief-card-kicker" id="brief-signal-label">${limited ? 'In this coverage' : 'The signal'}</p><p class="brief-lead">${escapeHtml(parts.lead)}</p>${parts.body ? `<p class="brief-body">${escapeHtml(parts.body)}</p>` : ''}${watch}<div class="brief-card-foot">${citationChips(context)}${actions}</div></section>`;
}

export function briefHeroMarkup(context: HeroContext): string {
  const company = escapeHtml(context.company);
  const companyMarkup = context.company.length <= NOWRAP_COMPANY_MAX ? `<span class="brief-company">${company}</span>` : company;
  const headline = `<h1 id="report-heading"><span class="brief-role">${escapeHtml(context.role)}</span> <span class="brief-at">at&nbsp;${companyMarkup}</span></h1>`;
  const masthead = `<div class="brief-masthead"><div class="brief-topline">${context.brand}<button class="brief-edit" type="button" data-edit>Edit profile</button></div><div class="brief-who"><span class="brief-mark" aria-hidden="true">${escapeHtml(companyMonogram(context.company))}</span><p class="brief-kicker">Your briefing</p></div>${headline}<p class="brief-meta">${escapeHtml(metaLine(context))}</p>${statsMarkup(context)}</div>`;
  return `<section class="report-hero brief-hero" aria-labelledby="report-heading"><div class="brief-hero-inner">${masthead}${cardMarkup(context)}</div></section>`;
}

/**
 * Drops chips whose story is not shown (some sections are not rendered), puts the rest in page order and numbers
 * them 1, 2, 3 in that order, tags each cited story card "Source N" to match, and makes each chip scroll to its
 * story card and move focus there.
 */
export function bindCitationChips(scope: ParentNode, reducedMotion: boolean): void {
  const cards = [...scope.querySelectorAll<HTMLElement>('[data-story-card]')].filter((card) => !card.closest('[data-theme-results]'));
  const order = [...new Set(cards.map((card) => card.dataset.storyCard ?? ''))];
  scope.querySelectorAll('[data-source-tag]').forEach((tag) => tag.remove());
  const chips = [...scope.querySelectorAll<HTMLButtonElement>('[data-cite]')];
  const shown = chips.filter((chip) => {
    if (order.includes(chip.dataset.cite ?? '')) return true;
    chip.remove();
    return false;
  }).sort((left, right) => order.indexOf(left.dataset.cite ?? '') - order.indexOf(right.dataset.cite ?? ''));
  shown.forEach((chip, index) => {
    const number = index + 1;
    chip.parentElement?.appendChild(chip);
    chip.textContent = String(number);
    chip.setAttribute('aria-label', `Source ${number}: ${chip.title}`);
    const card = cards.find((candidate) => candidate.dataset.storyCard === chip.dataset.cite);
    const meta = card?.querySelector('.story-meta');
    if (meta) {
      const tag = document.createElement('span');
      tag.className = 'source-tag';
      tag.dataset.sourceTag = '';
      tag.textContent = `Source ${number}`;
      const badge = meta.querySelector('.match-badge');
      if (badge) badge.after(tag); else meta.prepend(tag);
    }
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
 * brightest point of the background for any accent, including white and yellow. Static: no animation, so
 * prefers-reduced-motion needs nothing beyond the citation highlight.
 * The gap to Highlights is set here (report-content padding); the sticky bar only appears once the hero has
 * scrolled away (see renderReport), so it never sits over the Highlights eyebrow in its in-flow position.
 */
export function briefHeroStyle(): string {
  return `<style>
@font-face{font-family:'Source Serif 4';font-style:normal;font-weight:400;font-display:swap;src:url("${SERIF_400}") format("woff2");unicode-range:${LATIN_RANGE}}
@font-face{font-family:'Source Serif 4';font-style:normal;font-weight:600;font-display:swap;src:url("${SERIF_600}") format("woff2");unicode-range:${LATIN_RANGE}}
.report-page .report-hero.brief-hero{--hero-base:color-mix(in srgb,var(--brand) 26%,#0a0d18);--hero-glow:color-mix(in srgb,var(--brand) 78%,white);position:relative;min-height:0;overflow:hidden;padding:clamp(20px,2.2vw,28px) clamp(20px,3vw,44px);border-radius:clamp(22px,2.6vw,34px);color:#fff;background-color:var(--hero-base);background-image:radial-gradient(60% 120% at 100% 0%,color-mix(in srgb,var(--hero-glow) 16%,transparent),transparent 62%),radial-gradient(45% 90% at 0% 115%,color-mix(in srgb,var(--hero-glow) 10%,transparent),transparent 70%),linear-gradient(160deg,color-mix(in srgb,var(--hero-base) 90%,white) 0%,var(--hero-base) 55%);box-shadow:0 24px 70px rgba(10,13,24,.2)}
.report-page .report-hero.brief-hero::after{position:absolute;z-index:0;inset:0;content:"";background:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px) 0 0/28px 28px,linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px) 0 0/28px 28px;-webkit-mask-image:radial-gradient(80% 100% at 85% 0%,#000,transparent 75%);mask-image:radial-gradient(80% 100% at 85% 0%,#000,transparent 75%)}
.brief-hero-inner{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);align-items:center;gap:clamp(24px,3vw,44px)}.brief-masthead{min-width:0}
.brief-topline{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.brief-topline .hosted-brand{margin:0;color:#fff}.brief-topline .hosted-brand img{max-width:170px;max-height:32px}
.brief-edit{min-height:34px;padding:6px 14px;border:1px solid rgba(255,255,255,.34);border-radius:999px;color:#fff;background:rgba(255,255,255,.06);font-size:.78rem;font-weight:750}.brief-edit:hover{background:rgba(255,255,255,.1)}
.brief-who{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.brief-mark{display:grid;flex:none;width:38px;height:38px;place-items:center;border:1px solid rgba(255,255,255,.3);border-radius:11px;color:#fff;background:linear-gradient(145deg,rgba(255,255,255,.2),rgba(255,255,255,.05));font:600 .95rem/1 ${SERIF};letter-spacing:.02em}
.brief-kicker{margin:0;color:rgba(255,255,255,.86);font-size:.7rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
.report-page .brief-hero h1{margin:0;color:#fff;font:600 clamp(1.85rem,2.6vw,2.4rem)/1.08 ${SERIF};letter-spacing:-.02em;text-align:left;text-wrap:balance}.brief-at{color:rgba(255,255,255,.84)}.brief-company{white-space:nowrap}
.brief-meta{margin:10px 0 0;color:rgba(255,255,255,.86);font-size:.84rem}
.brief-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px;margin:14px 0 0;padding:14px 0 0;border-top:1px solid rgba(255,255,255,.18)}
.brief-stat{display:flex;flex-direction:column;gap:2px;min-width:0}
.brief-stat dt{color:rgba(255,255,255,.86);font-size:.64rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.brief-stat dd{display:flex;align-items:center;gap:10px;margin:0;color:#fff;font-size:1.05rem;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
.brief-dt-short{display:none}
.brief-meter{position:relative;display:inline-block;width:64px;height:5px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.22)}.brief-meter>span{position:absolute;inset:0 auto 0 0;border-radius:inherit;background:#fff}
.brief-card{--card-accent:color-mix(in srgb,var(--brand) 62%,#10131f);display:flex;flex-direction:column;gap:10px;min-width:0;padding:clamp(18px,1.6vw,22px) clamp(20px,2.4vw,30px);border:1px solid rgba(20,30,60,.08);border-radius:24px;color:#151a3a;background:#fff;box-shadow:0 18px 50px rgba(5,8,18,.28)}
.report-page .brief-card>.brief-coverage{margin:0;padding:9px 12px;border-radius:12px;color:#5b4a12;background:#fff6dc;font-size:.84rem;line-height:1.45}
.brief-card-kicker{margin:0 0 -4px;color:var(--card-accent);font-size:.68rem;font-weight:850;letter-spacing:.16em;text-transform:uppercase}
.report-page .brief-lead{margin:0;color:#151a3a;font:400 clamp(1.08rem,1.35vw,1.24rem)/1.4 ${SERIF};letter-spacing:-.005em}
.brief-body{margin:0;color:#3d4250;font-size:.9rem;line-height:1.5}
.brief-watch{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-left:3px solid var(--card-accent);border-radius:12px;background:color-mix(in srgb,var(--brand) 7%,#f7f8fa)}
.brief-watch-icon{display:grid;flex:none;width:26px;height:26px;place-items:center;border-radius:50%;color:#fff;background:var(--card-accent)}
.brief-watch-label{margin:0 0 2px;color:#151a3a;font-size:.66rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.brief-watch-text{margin:0;color:#3d4250;font-size:.86rem;line-height:1.45}
.brief-card-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}
.brief-card-note .brief-card-foot{justify-content:flex-start}
.brief-cites{display:flex;flex-wrap:wrap;align-items:center;gap:5px}.brief-cites-label{margin-right:3px;color:#5b6170;font-size:.66rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}
.brief-cite{display:inline-grid;min-width:26px;height:26px;place-items:center;padding:0 7px;border:1px solid color-mix(in srgb,var(--card-accent) 35%,white);border-radius:8px;color:var(--card-accent);background:#fff;font-size:.74rem;font-weight:800;font-variant-numeric:tabular-nums}.brief-cite:hover,.brief-cite:focus-visible{color:#fff;background:var(--card-accent)}.brief-cite:focus-visible{outline-offset:2px}
.report-page .brief-actions{margin:0;gap:8px}.report-page .brief-actions .action-button,.report-page .brief-actions .text-button{gap:6px;min-height:38px;padding:8px 14px;font-size:.8rem}
.source-tag{display:inline-flex;align-items:center;padding:4px 8px;border:1px solid color-mix(in srgb,var(--brand) 35%,white);border-radius:999px;color:var(--brand);background:#fff;font-size:.64rem;font-weight:850;letter-spacing:.04em;text-transform:none}
[data-story-card].is-cited{outline:3px solid color-mix(in srgb,var(--brand) 55%,white);outline-offset:4px;transition:outline-color .6s ease}
.report-page .report-content{padding-top:clamp(64px,5vw,72px)}
@media(max-width:1023px){.brief-hero-inner{grid-template-columns:1fr}}
@media(max-width:639px){
.report-page .report-hero.brief-hero{padding:16px 16px 12px;border-radius:0 0 22px 22px}.brief-hero-inner{gap:16px}.brief-topline{margin-bottom:14px}.brief-topline .hosted-brand img{max-height:26px}.brief-edit{min-height:32px;padding:5px 12px;font-size:.72rem}
.brief-who{gap:10px;margin-bottom:8px}.brief-mark{width:32px;height:32px;border-radius:9px;font-size:.82rem}.report-page .brief-hero h1{font-size:1.5rem;line-height:1.12}.brief-meta{margin-top:8px;font-size:.76rem}
.brief-stats{grid-template-columns:repeat(4,auto);justify-content:space-between;gap:0;margin-top:12px;padding-top:10px}.brief-stat{padding:0 10px;border-left:1px solid rgba(255,255,255,.14)}.brief-stat:first-child{padding-left:0;border-left:0}.brief-stat:last-child{padding-right:0}
.brief-stat dt{font-size:.58rem;letter-spacing:.08em;line-height:1.2}.brief-stat dd{gap:6px;font-size:.9rem;line-height:1.2}.brief-meter{width:28px;height:4px}
.brief-dt-full{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.brief-dt-short{display:inline}
.brief-card{margin:0 -4px;padding:16px;border-radius:20px}.report-page .brief-lead{font-size:.98rem;line-height:1.38}.brief-body{font-size:.86rem}.brief-watch-text{font-size:.82rem}
.report-page .report-content{padding-top:50px}
}
@media(prefers-reduced-motion:reduce){[data-story-card].is-cited{transition:none}}
</style>`;
}
