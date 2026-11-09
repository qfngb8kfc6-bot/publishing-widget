/**
 * Report body below the hero: the magazine layout (lead story large, the rest in a two-column grid on desktop,
 * full-width cards on phones), theme cards and the focused-reading panel. Each card keeps the image, headline,
 * excerpt, match %, "why this matters" (+ More) and link to the original story. Browser code: never import server
 * modules here.
 */
import type { ReportRecommendation, ReportRecord } from './reports';
import { themeDisplayTitle, themeInlineText, themeSupportingRecommendations } from './reports/themes';

const SERIF = "'Source Serif 4',Georgia,serif";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' })[character] ?? character);
}

function safeImageUrl(value?: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
}

/** "24 Oct 2026": the same day-month-year order as the hero. */
export function cardDate(value?: string): string {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(timestamp) : '';
}

export interface CardContext {
  publisherName: string;
  /** The page's own "Read the original story" link markup (link target and new-tab behaviour unchanged). */
  link: (article: ReportRecommendation['article']) => string;
}

export interface CardOptions {
  lead?: boolean;
  /** Section grouping shown as a small label inside the card ("Companies to watch"). */
  label?: string;
  showWhy?: boolean;
  /** Compact list card inside the focused-reading panel. */
  compact?: boolean;
}

function whyMarkup(explanation: string): string {
  return `<div class="why"><span class="why-icon" aria-hidden="true">✦</span><div><strong>Why this matters to you</strong><p class="why-text">${escapeHtml(explanation)}</p><button class="why-toggle" type="button" aria-expanded="false" hidden>More</button></div></div>`;
}

const KEY_LINE_MIN_WORDS = 4;
const KEY_LINE_MAX_WORDS = 12;
const MIN_REMAINING_EXCERPT_WORDS = 6;
const LONG_KEY_LINE_CHARS = 56;

export interface PanelText {
  /** The excerpt's first clause, set large on the panel; absent when no 4-12 word clause exists. */
  keyLine?: string;
  /** The excerpt shown under the headline: what follows the key line, or nothing when too little is left. */
  excerpt: string;
}

const wordCount = (value: string) => value.split(/\s+/).filter(Boolean).length;

/**
 * Text for an image-less card. The panel line is the excerpt's first clause (cut at the first sentence end, or at a
 * comma, colon, semicolon or spaced dash once it has four words) when it is 4-12 words, never truncated; the headline
 * is never used (it sits right below). So the card does not say the same thing twice, the visible excerpt then
 * starts after that clause (leading punctuation and "as" trimmed, first letter capitalised), and is left out when
 * fewer than six words remain. Without a usable clause the panel shows the category instead and the excerpt is whole.
 */
export function panelText(article: Pick<ReportRecommendation['article'], 'description' | 'summary' | 'contentSnippet'>): PanelText {
  const excerpt = (article.description ?? article.summary ?? article.contentSnippet ?? '').replace(/\s+/g, ' ').trim();
  if (!excerpt) return { excerpt: '' };
  const sentenceEnd = excerpt.search(/[.!?](?:\s|$)/);
  const sentence = sentenceEnd < 0 ? excerpt : excerpt.slice(0, sentenceEnd);
  const clause = sentence.match(/^(.+?)\s*(?:[,;:]|\s[\u2013\u2014-])\s/);
  const keyLine = (clause && wordCount(clause[1]) >= KEY_LINE_MIN_WORDS ? clause[1] : sentence).trim();
  const words = wordCount(keyLine);
  if (words < KEY_LINE_MIN_WORDS || words > KEY_LINE_MAX_WORDS) return { excerpt };
  const rest = excerpt.slice(excerpt.indexOf(keyLine) + keyLine.length).replace(/^[\s.,;:!?\u2013\u2014-]+/, '').replace(/^as\s+/i, '');
  const remaining = wordCount(rest) >= MIN_REMAINING_EXCERPT_WORDS ? `${rest.charAt(0).toUpperCase()}${rest.slice(1)}` : '';
  return { keyLine, excerpt: remaining };
}

/** Six tints the publisher accent is blended into; each category keeps the same one on every card. */
export const PANEL_TINTS = 6;

export function categoryTint(category: string): number {
  let hash = 0;
  for (const character of category.trim().toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % PANEL_TINTS;
}

/**
 * Without an image: a designed typographic panel in the media slot (same height as an image would be). A gradient
 * from the publisher accent tinted per category, a fine dot texture, a small label and, set large in Source Serif 4,
 * the excerpt's first clause, or the category itself when there is no usable clause. Decorative (aria-hidden): the
 * clause is not repeated in the visible excerpt, so the headline and excerpt below still carry the story.
 */
function typePanelMarkup(keyLine: string | undefined, category: string, context: CardContext): string {
  const name = category || context.publisherName;
  const label = keyLine ? name : category ? context.publisherName : '';
  // A long clause is set smaller so all of it fits (it is never cut off); hyphenated words never break at the hyphen.
  const size = !keyLine ? ' is-category' : keyLine.length > LONG_KEY_LINE_CHARS ? ' is-long' : '';
  const line = escapeHtml(keyLine ?? name).replace(/\S+-\S+/g, (word) => `<span class="cx-nb">${word}</span>`);
  return `<div class="cx-type cx-tint-${categoryTint(name)}${size}" aria-hidden="true">${label ? `<span class="cx-type-label">${escapeHtml(label)}</span>` : '<span></span>'}<p class="cx-type-line">${line}</p><span class="cx-type-mark">${escapeHtml(name.charAt(0).toUpperCase())}</span></div>`;
}

/**
 * One story. The image, or without one a typographic panel, sits in a media slot with the same proportions either
 * way. The top row holds only the match (and the "Source N" tag the citation chips add), so category and date get
 * their own quiet line that wraps instead of truncating.
 */
export function cardMarkup(recommendation: ReportRecommendation, context: CardContext, options: CardOptions = {}): string {
  const article = recommendation.article;
  const image = safeImageUrl(article.imageUrl);
  const category = article.categories[0] ?? '';
  const date = cardDate(article.publishedAt);
  // The panel's clause is not repeated in the excerpt (compact cards show a monogram, so they keep the whole text).
  const panel = !image && !options.compact ? panelText(article) : undefined;
  const description = panel ? panel.excerpt : article.description ?? article.summary ?? article.contentSnippet ?? '';
  // An explanation that only retold the story is the excerpt's first sentence: the box is left out (as before).
  const showWhy = (options.showWhy ?? true) && !recommendation.rankingMetadata?.explanationRestated && Boolean(recommendation.explanation);
  const media = image ? `<img class="cx-image" src="${escapeHtml(image)}" alt="" loading="lazy">` : typePanelMarkup(panel?.keyLine, category, context);
  const meta = [category ? `<span>${escapeHtml(category)}</span>` : '', date ? `<time datetime="${escapeHtml(article.publishedAt ?? '')}">${escapeHtml(date)}</time>` : ''].filter(Boolean).join('<span class="cx-dot" aria-hidden="true">·</span>');
  const classes = ['cx-card', options.lead ? 'cx-lead' : options.compact ? 'cx-compact' : 'cx-rest-card', image ? 'has-image' : 'no-image'].join(' ');
  return `<article class="${classes}" data-story-card="${escapeHtml(article.id)}"><div class="cx-media">${media}</div><div class="cx-head"><div class="story-meta cx-top"><span class="match-badge cx-match"><b>${recommendation.displayScore}%</b> match</span></div>${options.label ? `<p class="cx-label">${escapeHtml(options.label)}</p>` : ''}<h3 class="cx-title">${escapeHtml(article.title)}</h3>${meta ? `<p class="cx-meta">${meta}</p>` : ''}</div><div class="cx-body">${description ? `<p class="story-summary">${escapeHtml(description)}</p>` : ''}${showWhy ? whyMarkup(recommendation.explanation) : ''}${context.link(article)}</div></article>`;
}

export interface StoryGroup {
  recommendations: ReportRecommendation[];
  /** Editorial section label, shown on each of its cards. */
  label?: string;
}

export interface DisplayStory {
  recommendation: ReportRecommendation;
  label?: string;
}

/**
 * Display order only: every story on the page (sections flattened, labels kept), highest match % first so the lead
 * is the strongest match. Ties keep the ranking order. Selection and ranking are unchanged; the hero numbers its
 * "Source N" chips from this same order, so they match the cards.
 */
export function displayStories(groups: StoryGroup[]): DisplayStory[] {
  const stories = groups.flatMap((group) => group.recommendations.map((recommendation) => ({ recommendation, label: group.label })));
  return stories.map((story, index) => ({ story, index })).sort((left, right) => (right.story.recommendation.displayScore - left.story.recommendation.displayScore) || (left.index - right.index)).map(({ story }) => story);
}

/**
 * One "Your N stories" section: the lead story large, then every other story in a grid. Editorial section
 * groupings become small labels on their cards, inside the count, never separate "Additional reading" sections.
 */
export function storiesSectionMarkup(stories: DisplayStory[], context: CardContext, heading: string): string {
  const count = stories.length;
  const head = `<div class="cx-section-head"><div><p class="section-kicker">Top stories</p><h2 class="section-heading" id="top-stories-heading">${count ? `Your ${count} ${count === 1 ? 'story' : 'stories'}` : escapeHtml(heading)}</h2></div>${count > 1 ? '<p class="cx-section-note">Strongest match first</p>' : ''}</div>`;
  if (!count) return `<section class="stories-section top-stories cx-stories" id="top-stories" aria-labelledby="top-stories-heading">${head}<p>No strong matches were found in the current coverage.</p></section>`;
  const [lead, ...rest] = stories;
  const leadMarkup = cardMarkup(lead.recommendation, context, { lead: true, label: lead.label ?? 'Top match' });
  const restMarkup = rest.map((story) => cardMarkup(story.recommendation, context, { label: story.label })).join('');
  return `<section class="stories-section top-stories cx-stories" id="top-stories" aria-labelledby="top-stories-heading">${head}${leadMarkup}${rest.length ? `<div class="cx-grid">${restMarkup}</div>` : ''}</section>`;
}

/**
 * Theme cards: all in a row on desktop; on phones a snapping row whose next card peeks in, with the count in the
 * heading so it is clear there are more. Each card says how many briefing stories it groups.
 */
export function themesSectionMarkup(report: ReportRecord, themes: string[], describe: (theme: string) => string): string {
  if (!themes.length) return '';
  const limited = report.professionalProfile.coverage?.limited;
  const cards = themes.map((theme, index) => {
    const supporting = themeSupportingRecommendations(report, theme).length;
    return `<article class="cx-theme"><p class="cx-theme-index">${String(index + 1).padStart(2, '0')} <span>/ ${String(themes.length).padStart(2, '0')}</span></p><h3>${escapeHtml(themeDisplayTitle(theme))}</h3><p class="cx-theme-text">${escapeHtml(describe(theme))}</p><div class="cx-theme-foot"><span class="cx-theme-count">${supporting} ${supporting === 1 ? 'story' : 'stories'}<span class="cx-theme-count-more"> in your briefing</span></span><button class="cx-theme-action" type="button" data-theme-search="${escapeHtml(theme)}" aria-haspopup="dialog">Find stories <span aria-hidden="true">→</span></button></div></article>`;
  }).join('');
  return `<section class="highlights-section cx-themes" aria-labelledby="highlights-heading"><div class="cx-section-head"><div><p class="section-kicker">Highlights</p><h2 id="highlights-heading">${limited ? 'Closest themes in this coverage' : 'Top themes in your briefing'}</h2></div><p class="cx-section-note cx-theme-total">${themes.length} ${themes.length === 1 ? 'theme' : 'themes'}${themes.length > 1 ? '<span class="cx-swipe"> · swipe for more</span>' : ''}</p></div><div class="cx-theme-row" tabindex="0" aria-label="Themes">${cards}</div></section>`;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

/** The role or company as a title: "head of retail" → "Head of Retail"; acronyms ("VP", "CTO") stay as typed. */
export function displayTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().split(' ').map((word, index) => {
    if (/^[A-Z\d-]{2,}$/.test(word)) return word;
    if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.length ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }).join(' ');
}

/** The focused-reading panel: a bottom sheet on phones, a side panel on desktop. Its body is [data-theme-results]. */
export function focusPanelMarkup(): string {
  return `<div class="cx-backdrop" data-focus-backdrop hidden></div><div class="cx-panel" data-focus-panel role="dialog" aria-modal="true" aria-labelledby="cx-panel-title" hidden><div class="cx-panel-head"><div><p class="section-kicker">Focused reading</p><h2 class="theme-results-heading" id="cx-panel-title" tabindex="-1">Stories</h2></div><button class="cx-close" type="button" data-focus-close aria-label="Close focused reading"><span aria-hidden="true">×</span></button></div><div class="cx-panel-body theme-results" data-theme-results aria-live="polite" aria-busy="false"></div></div>`;
}

/** "Stories about connected fitness": the theme in running text keeps lower case, acronyms and brands. */
export function focusHeading(theme: string): string {
  return `Stories about ${themeInlineText(theme)}`;
}

/** Panel contents: "In your briefing" first (no repeated "why"), then "More on this theme". */
export function focusResultsMarkup(report: ReportRecord, briefing: ReportRecommendation[], archive: ReportRecommendation[], context: CardContext): string {
  const intro = `<p class="theme-results-subheading">Selected for your role as ${escapeHtml(displayTitle(report.jobTitle))}</p>`;
  if (!briefing.length && !archive.length) return `${intro}<p class="theme-results-status">No strong stories were found for this theme in the current coverage.</p>`;
  const list = (items: ReportRecommendation[], showWhy: (item: ReportRecommendation) => boolean) => `<div class="cx-focus-list">${items.map((item) => cardMarkup(item, context, { compact: true, showWhy: showWhy(item) })).join('')}</div>`;
  const briefingMarkup = briefing.length ? `<div class="theme-results-group" data-theme-group="briefing"><h3 class="theme-results-group-heading">In your briefing <span>${briefing.length}</span></h3>${list(briefing, () => false)}</div>` : '';
  const archiveMarkup = archive.length ? `<div class="theme-results-group" data-theme-group="archive"><h3 class="theme-results-group-heading">${briefing.length ? 'More on this theme' : 'From the archive'} <span>${archive.length}</span></h3>${list(archive, (item) => item.rankingMetadata?.explanationSource === 'ai')}</div>` : '';
  return `${intro}${briefingMarkup}${archiveMarkup}`;
}

export interface FocusPanel {
  open: (theme: string, trigger: HTMLElement) => void;
  close: () => void;
}

/**
 * Opens and closes the focused-reading panel: focus moves to its heading and back to the theme button on close;
 * Escape, the close button and the backdrop close it; Tab stays inside while it is open.
 */
export function bindFocusPanel(scope: HTMLElement, documentRef: Document): FocusPanel | undefined {
  const panel = scope.querySelector<HTMLElement>('[data-focus-panel]');
  const backdrop = scope.querySelector<HTMLElement>('[data-focus-backdrop]');
  const title = scope.querySelector<HTMLElement>('#cx-panel-title');
  if (!panel || !backdrop || !title) return undefined;
  let trigger: HTMLElement | undefined;
  const isOpen = () => !panel.hidden;
  const close = () => {
    if (!isOpen()) return;
    panel.hidden = true;
    backdrop.hidden = true;
    documentRef.body.classList.remove('modal-open');
    trigger?.focus();
  };
  const open = (theme: string, from: HTMLElement) => {
    trigger = from;
    title.textContent = focusHeading(theme);
    panel.hidden = false;
    backdrop.hidden = false;
    documentRef.body.classList.add('modal-open');
    panel.scrollTop = 0;
    scope.querySelector<HTMLElement>('.cx-panel-body')?.scrollTo?.({ top: 0 });
    title.focus();
  };
  scope.querySelectorAll<HTMLElement>('[data-focus-close]').forEach((button) => button.addEventListener('click', close));
  backdrop.addEventListener('click', close);
  documentRef.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]):not([hidden]),[tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = documentRef.activeElement;
    if (event.shiftKey && (active === first || active === title)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  });
  return { open, close };
}

/**
 * Styles. Colours come from the publisher tokens (--brand, --secondary); small text stays at or above 4.5:1 on white
 * (#5b6170, #151a3a). The typographic panel blends at most 30% of the accent into a near-black tint, so its white
 * text stays above 4.5:1 for any accent, white included. Words are never split or hyphenated. Motion is limited to
 * the panel slide, off under reduced motion.
 */
export function cardsStyle(): string {
  return `<style>
.cx,.cx-panel{hyphens:manual;-webkit-hyphens:manual;overflow-wrap:normal;word-break:normal}
.cx .section-kicker{margin:0 0 8px}
.cx .cx-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}
.cx .cx-section-head h2{margin:0}
.cx .cx-section-note{margin:0;color:#5b6170;font-size:.84rem;font-weight:650;white-space:nowrap}
.cx .highlights-section h2,.cx .section-heading{font-size:clamp(1.75rem,3vw,2.6rem);line-height:1.02;letter-spacing:-.045em}
.cx .cx-themes{margin-bottom:clamp(44px,6vw,72px)}
.cx .cx-theme-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;outline:0}
.cx .cx-theme-row:focus-visible{outline:3px solid color-mix(in srgb,var(--brand) 55%,white);outline-offset:4px;border-radius:20px}
.cx .cx-theme{position:relative;display:flex;flex-direction:column;min-width:0;padding:18px 18px 16px;border:1px solid rgba(20,30,60,.1);border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(21,26,58,.05)}
.cx .cx-theme-index{margin:0 0 10px;color:var(--brand);font-size:.72rem;font-weight:850;letter-spacing:.08em}.cx .cx-theme-index span{color:#5b6170;font-weight:700}
.cx .cx-theme h3{margin:0 0 8px;color:#151a3a;font:600 1.12rem/1.2 var(--font);letter-spacing:-.02em}
.cx .cx-theme-text{flex:1;margin:0 0 14px;color:#4b5160;font-size:.88rem;line-height:1.45}
.cx .cx-theme-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:12px;border-top:1px solid rgba(20,30,60,.08)}
.cx .cx-theme-count{color:#5b6170;font-size:.76rem;font-weight:650}
.cx .cx-theme-action{display:inline-flex;align-items:center;gap:4px;min-height:36px;padding:6px 12px;border:1px solid color-mix(in srgb,var(--brand) 30%,white);border-radius:999px;color:var(--brand);background:#fff;font-size:.8rem;font-weight:800;white-space:nowrap;cursor:pointer}
.cx .cx-theme-action:hover{color:#fff;background:var(--brand)}
.cx .cx-theme-action:focus-visible,.cx .story-link:focus-visible,.cx .why-toggle:focus-visible,.cx-close:focus-visible{outline:3px solid color-mix(in srgb,var(--brand) 55%,white);outline-offset:2px}
.cx .cx-theme-action:disabled{opacity:.7;cursor:progress}
.cx .cx-stories{margin-bottom:clamp(48px,6vw,80px)}
.cx-card{position:relative;display:grid;grid-template-rows:auto auto 1fr;grid-template-areas:"media" "head" "body";min-width:0;overflow:hidden;border:1px solid rgba(20,30,60,.1);border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(21,26,58,.05)}
.cx-card .cx-media{grid-area:media;position:relative;min-width:0;overflow:hidden;aspect-ratio:16/9;background:#eef1f6;container-type:inline-size}
.cx-card .cx-image{display:block;width:100%;height:100%;object-fit:cover}
/* Typographic panel for stories without an image. */
.cx-type{--tint:#10203f;position:relative;isolation:isolate;display:flex;flex-direction:column;justify-content:space-between;gap:12px;width:100%;height:100%;padding:clamp(16px,5.5cqi,30px);overflow:hidden;color:#fff;background:linear-gradient(155deg,color-mix(in srgb,var(--brand) 30%,var(--tint)) 0%,color-mix(in srgb,var(--brand) 16%,var(--tint)) 48%,color-mix(in srgb,var(--tint) 62%,#05060c) 100%)}
.cx-type::before{content:"";position:absolute;inset:0;z-index:-1;background-image:radial-gradient(rgba(255,255,255,.1) .8px,transparent 1.3px);background-size:11px 11px;-webkit-mask-image:linear-gradient(200deg,#000 0%,transparent 62%);mask-image:linear-gradient(200deg,#000 0%,transparent 62%)}
.cx-type::after{content:"";position:absolute;right:-18%;bottom:-38%;z-index:-1;width:62%;aspect-ratio:1;border:1px solid rgba(255,255,255,.1);border-radius:50%;box-shadow:0 0 0 22px rgba(255,255,255,.025),0 0 0 23px rgba(255,255,255,.07)}
.cx-tint-1{--tint:#0b3638}.cx-tint-2{--tint:#2e1538}.cx-tint-3{--tint:#123020}.cx-tint-4{--tint:#3a1418}.cx-tint-5{--tint:#1d2431}
.cx-type-label{display:flex;align-items:center;gap:10px;max-width:100%;color:#fff;font:800 .68rem/1.3 var(--font);letter-spacing:.16em;text-transform:uppercase}
.cx-type-label::before{content:"";flex:none;width:22px;height:2px;border-radius:2px;background:color-mix(in srgb,var(--brand) 45%,white)}
.cx-type-line{display:-webkit-box;max-width:22ch;margin:0;overflow:hidden;color:#fff;font:600 clamp(1.15rem,5.4cqi,2rem)/1.14 ${SERIF};letter-spacing:-.015em;text-wrap:balance;-webkit-box-orient:vertical;-webkit-line-clamp:5}
.cx-type.is-long .cx-type-line{max-width:28ch;font-size:clamp(1.02rem,4.3cqi,1.6rem);line-height:1.18}
.cx-type .cx-nb{white-space:nowrap}
.cx-type.is-category .cx-type-line{max-width:none;font-size:clamp(1.5rem,8cqi,2.6rem);line-height:1.05;letter-spacing:-.02em}
.cx-card.cx-lead .cx-type.is-category .cx-type-line{font-size:clamp(1.8rem,9cqi,3.2rem)}
.cx-type-mark{display:none}
.cx-card .cx-head{grid-area:head;min-width:0;padding:16px 18px 0}
.cx-card .cx-body{grid-area:body;display:flex;flex-direction:column;min-width:0;padding:8px 18px 14px}
.cx-card .story-meta.cx-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0;color:inherit;font-size:inherit;font-weight:inherit;letter-spacing:0;text-transform:none;white-space:normal}
.cx-card .cx-match{display:inline-flex;align-items:baseline;gap:4px;padding:4px 10px;border-radius:999px;color:var(--brand);background:var(--secondary,#eef1f6);font-size:.74rem;font-weight:700;line-height:1.2;white-space:nowrap}
.cx-card .cx-match b{font-size:1.02rem;font-weight:850;letter-spacing:-.01em}
.cx-card .source-tag{padding:2px 8px;font-size:.66rem;line-height:1.4;white-space:nowrap}
.cx-card .cx-label{margin:10px 0 0;color:var(--brand);font-size:.68rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}
.cx-card .cx-title{margin:8px 0 6px;color:#151a3a;font:600 1.18rem/1.22 ${SERIF};letter-spacing:-.01em}
.cx-card .cx-meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;margin:0;color:#5b6170;font-size:.8rem;line-height:1.4}
.cx-card .cx-dot{color:#8a909c}
.cx-card .story-summary{display:-webkit-box;margin:0 0 4px;overflow:hidden;color:#4b5160;font-size:.92rem;line-height:1.5;-webkit-box-orient:vertical;-webkit-line-clamp:3}
.cx-card .why{display:flex;gap:10px;margin:12px 0 4px;padding:12px 14px;border:0;border-left:3px solid var(--brand);border-radius:0 12px 12px 0;background:color-mix(in srgb,var(--secondary,#eef1f6) 70%,white)}
.cx-card .why-icon{display:inline-grid;flex:none;width:22px;height:22px;place-items:center;border-radius:50%;color:#fff;background:var(--brand);font-size:.68rem;line-height:1}
.cx-card .why strong{display:block;margin-bottom:2px;color:#151a3a;font-size:.72rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}
.cx-card .why-text{display:-webkit-box;margin:0;overflow:hidden;color:#2f3443;font-size:.88rem;line-height:1.5;-webkit-box-orient:vertical;-webkit-line-clamp:3}
.cx-card .why.is-expanded .why-text{display:block}
.cx-card .why-toggle{display:inline-flex;margin-top:4px;padding:0;border:0;color:var(--brand);background:transparent;font-size:.78rem;font-weight:800;cursor:pointer}
.cx-card .why-toggle[hidden]{display:none}
/* "Read the original story" sits at the bottom of every card, so cards in a grid row end on one line. */
.cx-card .story-link{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;min-height:40px;margin-top:auto;padding-top:6px;color:var(--brand);font-size:.86rem;font-weight:800;text-decoration:none}
.cx-card .story-link:hover{text-decoration:underline}
.cx-card.cx-lead{margin-bottom:16px;border-color:color-mix(in srgb,var(--brand) 22%,white);box-shadow:0 18px 48px rgba(21,26,58,.09)}
.cx-card.cx-lead .cx-title{font-size:clamp(1.45rem,2.4vw,2.1rem);line-height:1.12;letter-spacing:-.02em}
.cx-card.cx-lead .story-summary{-webkit-line-clamp:4}
.cx-card.cx-lead .cx-head{padding:20px 22px 0}.cx-card.cx-lead .cx-body{padding:10px 22px 18px}
.cx-card.cx-lead .cx-type-line{max-width:20ch;font-size:clamp(1.35rem,6cqi,2.5rem)}.cx-card.cx-lead .cx-type.is-long .cx-type-line{max-width:26ch;font-size:clamp(1.2rem,4.8cqi,2rem)}
@media(min-width:900px){.cx-card.cx-lead{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);grid-template-areas:"media head" "media body";grid-template-rows:auto 1fr}.cx-card.cx-lead .cx-media{aspect-ratio:auto;min-height:100%}.cx-card.cx-lead .cx-type{min-height:320px}.cx-card.cx-lead .cx-head{padding:28px 30px 0}.cx-card.cx-lead .cx-body{padding:12px 30px 24px}}
.cx .cx-grid{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:760px){.cx .cx-grid{grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:18px}}
[data-story-card].cx-card.is-cited{outline:3px solid color-mix(in srgb,var(--brand) 55%,white);outline-offset:4px}
/* Focused reading: side panel on desktop, bottom sheet on phones. */
.cx-backdrop{position:fixed;inset:0;z-index:60;background:rgba(11,13,26,.48)}
.cx-backdrop[hidden],.cx-panel[hidden]{display:none}
.cx-panel{position:fixed;z-index:61;top:0;right:0;bottom:0;display:flex;flex-direction:column;width:min(560px,100%);background:#f6f7fa;box-shadow:-24px 0 60px rgba(11,13,26,.22);animation:cx-panel-in .22s ease-out}
.cx-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 24px 14px;border-bottom:1px solid rgba(20,30,60,.08);background:#fff}
.cx-panel-head .section-kicker{margin:0 0 6px}
.cx-panel .theme-results-heading{margin:0;color:#151a3a;font:600 clamp(1.35rem,2.4vw,1.75rem)/1.12 var(--font);letter-spacing:-.03em;outline:0}
.cx-close{display:inline-grid;flex:none;width:44px;height:44px;place-items:center;border:1px solid rgba(20,30,60,.14);border-radius:999px;color:#151a3a;background:#fff;font-size:1.5rem;line-height:1;cursor:pointer}
.cx-close:hover{background:#eef1f6}
.cx-panel-body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:16px 24px 32px}
.cx-panel .theme-results-subheading{margin:0 0 16px;color:#5b6170;font-size:.86rem}
.cx-panel .theme-results-group+.theme-results-group{margin-top:24px}
.cx-panel .theme-results-group-heading{display:flex;align-items:center;gap:8px;margin:0 0 10px;color:#4b5160;font:850 .72rem/1.2 var(--font);letter-spacing:.12em;text-transform:uppercase}
.cx-panel .theme-results-group-heading span{padding:2px 8px;border-radius:999px;color:var(--brand);background:#fff;letter-spacing:0}
.cx-panel .theme-results-status{margin:0;color:#5b6170}
.cx-focus-list{display:grid;gap:10px}
.cx-card.cx-compact{grid-template-columns:88px minmax(0,1fr);grid-template-rows:auto 1fr;grid-template-areas:"media head" "body body";border-radius:14px;box-shadow:none}
.cx-card.cx-compact .cx-media{aspect-ratio:1/1;margin:12px 0 0 12px;border-radius:10px}
.cx-card.cx-compact .cx-type{justify-content:center;align-items:center;padding:0}.cx-card.cx-compact .cx-type-label,.cx-card.cx-compact .cx-type-line{display:none}
.cx-card.cx-compact .cx-type-mark{display:block;color:#fff;font:600 2.4rem/1 ${SERIF}}
.cx-card.cx-compact .cx-head{padding:12px 14px 0}.cx-card.cx-compact .cx-title{margin:6px 0 4px;font-size:1rem}
.cx-card.cx-compact .cx-body{padding:8px 14px 10px}.cx-card.cx-compact .story-summary{font-size:.86rem;-webkit-line-clamp:2}
@keyframes cx-panel-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes cx-sheet-in{from{transform:translateY(32px);opacity:0}to{transform:none;opacity:1}}
@media(max-width:639px){
.cx .cx-section-head{align-items:flex-start;flex-direction:column;gap:4px;margin-bottom:12px}
.cx .highlights-section h2,.cx .section-heading{font-size:1.5rem;letter-spacing:-.035em}
.cx .cx-themes{margin-bottom:36px}
.cx .cx-theme-row{display:flex;gap:10px;margin:0 -14px;padding:2px 14px 10px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 14px;scrollbar-width:none}.cx .cx-theme-row::-webkit-scrollbar{display:none}
.cx .cx-theme{flex:0 0 82%;scroll-snap-align:start}
.cx .cx-grid{gap:12px}
.cx-card .cx-head{padding:12px 16px 0}.cx-card .cx-body{padding:6px 16px 10px}
.cx-card .cx-label{margin-top:8px}.cx-card .cx-title{margin:6px 0 4px;font-size:1.12rem}
.cx-card .story-summary{font-size:.9rem;line-height:1.45}
.cx-card .why{margin:10px 0 2px;padding:10px 12px}
.cx-card .story-link{min-height:36px;padding-top:4px}
.cx-card.cx-lead{margin-bottom:12px}.cx-card.cx-lead .cx-head{padding:14px 16px 0}.cx-card.cx-lead .cx-body{padding:6px 16px 12px}.cx-card.cx-lead .cx-title{font-size:1.4rem}.cx-card.cx-lead .story-summary{-webkit-line-clamp:3}
.cx-panel{top:auto;left:0;width:100%;max-height:88vh;border-radius:20px 20px 0 0;box-shadow:0 -20px 50px rgba(11,13,26,.25);animation-name:cx-sheet-in}
.cx-panel-head{position:relative;padding:22px 16px 12px;border-radius:20px 20px 0 0}
.cx-panel-head::before{content:"";position:absolute;top:8px;left:50%;width:40px;height:4px;margin-left:-20px;border-radius:4px;background:#c9cdd6}
.cx-panel-body{padding:14px 14px calc(24px + env(safe-area-inset-bottom))}
}
@media(min-width:640px){.cx .cx-swipe{display:none}}
@media(max-width:639px){.cx .cx-theme-count-more{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
@media(prefers-reduced-motion:reduce){.cx-panel{animation:none}}
</style>`;
}
