import { BatchingAnalyticsClient } from './analytics/client';
import { createEvent, DEFAULT_THEME, normalizeToken, roleSubjectLabel, type PublisherRegistry } from './core';
import type { PublisherExperienceBranding, PublisherManifest } from './publishers/manifest';
import type { ReportRecord, ReportRecommendation } from './reports';
import { MAX_SHOWN_THEME_ARTICLE_IDS, reportThemes, themeDisplayTitle, themeInlineText, themeSupportingRecommendations } from './reports/themes';
import { allocateEditorialSections, articleIdentityKeys, type EditorialSection } from './reports/sections';
import { generationPageMarkup, runGenerationPage } from './hosted-loading';
import { generationInputMessage } from './widget/messages';
import { bindCitationChips, briefHeroMarkup, briefHeroStyle } from './hosted-hero';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' })[character] ?? character);
}

function safeUrl(value?: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
}

function cssUrl(value?: string): string {
  const url = safeUrl(value);
  return url ? `url("${url.replace(/"/g, '%22')}")` : 'none';
}

function cssColor(value: string | undefined, fallback: string): string {
  if (!value || !/^(?:#[\da-f]{3,8}|rgba?\([^)]{1,80}\)|hsla?\([^)]{1,80}\)|[a-z]+)$/i.test(value.trim())) return fallback;
  return value.trim();
}

function cssFont(value: string | undefined): string {
  if (!value || !/^[a-z\d\s,.'-]+$/i.test(value)) return 'Inter, ui-sans-serif, system-ui, sans-serif';
  return value;
}

function overlayValue(experience: PublisherExperienceBranding | undefined, fallback: string): string {
  const overlay = cssColor(experience?.overlay, fallback);
  const opacity = experience?.overlayOpacity;
  if (typeof opacity !== 'number' || !Number.isFinite(opacity)) return overlay;
  return `color-mix(in srgb, ${overlay} ${Math.round(Math.max(0, Math.min(1, opacity)) * 100)}%, transparent)`;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

function displayTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().split(' ').map((word, index) => {
    if (/^[A-Z\d-]{2,}$/.test(word)) return word;
    if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.length ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }).join(' ');
}

function displayCompany(report: ReportRecord): string {
  if (report.companyName) return report.companyName;
  return displayTitle(report.companyDomain.split('.')[0].replace(/[-_]+/g, ' '));
}

function brandMarkup(manifest: PublisherManifest, variant = ''): string {
  const logo = safeUrl(manifest.branding.logo ?? manifest.branding.report?.logo ?? manifest.branding.loading?.logo);
  const className = `hosted-brand${variant ? ` ${variant}` : ''}`;
  return `<div class="${className}" data-publisher-brand>${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(manifest.name)}">` : `<span class="hosted-brand-mark" aria-hidden="true">${escapeHtml(manifest.name.slice(0, 1))}</span><span>${escapeHtml(manifest.name)}</span>`}</div>`;
}

function routeStyle(manifest: PublisherManifest): string {
  const loading = manifest.branding.loading;
  const report = manifest.branding.report;
  const brand = cssColor(manifest.branding.primaryAccent ?? manifest.branding.primaryColor, DEFAULT_THEME.indigo);
  const secondary = cssColor(manifest.branding.secondaryColor, DEFAULT_THEME.surfaceMuted);
  const accent = cssColor(manifest.branding.primaryColor, brand);
  const loadingFallback = cssColor(loading?.backgroundFallback, DEFAULT_THEME.loadingBackground);
  const reportFallback = cssColor(report?.backgroundFallback, loadingFallback);
  const loadingInk = cssColor(loading?.textColor, DEFAULT_THEME.pageBackground);
  const reportInk = cssColor(report?.textColor, DEFAULT_THEME.text);
  const loadingOverlay = overlayValue(loading, 'rgba(21,26,58,.46)');
  const reportOverlay = overlayValue(report, 'rgba(21,26,58,.55)');
  const radius = manifest.branding.borderRadius === 'sharp' ? '12px' : manifest.branding.borderRadius === 'soft' ? '20px' : '28px';
  const font = cssFont(manifest.branding.fontFamily);
  const loadingDesktop = cssUrl(loading?.desktopBackgroundImage);
  const loadingMobile = cssUrl(loading?.mobileBackgroundImage ?? loading?.desktopBackgroundImage);
  const reportDesktop = cssUrl(report?.desktopBackgroundImage);
  const reportMobile = cssUrl(report?.mobileBackgroundImage ?? report?.desktopBackgroundImage);
  return `<style>
:root{--brand:${brand};--accent:${accent};--secondary:${secondary};--loading-ink:${loadingInk};--report-ink:${reportInk};--loading-fallback:${loadingFallback};--report-fallback:${reportFallback};--loading-overlay:${loadingOverlay};--report-overlay:${reportOverlay};--loading-cover-image:${loadingDesktop};--loading-cover-image-mobile:${loadingMobile};--report-cover-image:${reportDesktop};--report-cover-image-mobile:${reportMobile};--radius:${radius};--font:${font}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;color:var(--report-ink);background:var(--report-fallback);font:16px/1.55 var(--font)}body.modal-open{overflow:hidden}button,input{font:inherit}button,a{-webkit-tap-highlight-color:transparent}button{cursor:pointer}[hidden]{display:none!important}:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 72%,white);outline-offset:4px}
.hosted-shell{min-height:100vh;padding:clamp(20px,4vw,58px) clamp(16px,4vw,56px);background-color:var(--loading-fallback);background-image:linear-gradient(var(--loading-overlay),var(--loading-overlay)),${loadingDesktop};background-position:center;background-size:cover;background-attachment:fixed;color:var(--loading-ink)}.hosted-shell.report{padding:0;background-color:var(--report-fallback);background-image:linear-gradient(var(--report-overlay),var(--report-overlay)),${reportDesktop};background-attachment:fixed;color:var(--report-ink)}.hosted-inner{width:min(1240px,100%);margin:0 auto}.hosted-card{width:100%}.generation-card{max-width:920px;margin:clamp(10px,8vh,100px) auto;padding:clamp(28px,6vw,76px);border:1px solid rgba(255,255,255,.25);border-radius:var(--radius);background:linear-gradient(135deg,rgba(9,35,22,.68),rgba(20,58,38,.48));box-shadow:0 30px 100px rgba(4,24,14,.28);backdrop-filter:blur(16px)}.hosted-brand{display:flex;align-items:center;gap:12px;margin-bottom:clamp(36px,7vw,82px);color:inherit;font-weight:800;letter-spacing:-.02em}.hosted-brand img{display:block;max-width:190px;max-height:50px;object-fit:contain}.hosted-brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;color:var(--brand);background:#fff;font-size:.9rem;font-weight:900}.hosted-brand.compact{margin:0;color:var(--report-ink);font-size:.82rem}.hosted-brand.compact img{max-width:120px;max-height:30px}.hosted-brand.compact .hosted-brand-mark{width:27px;height:27px;border-radius:8px;font-size:.75rem}
.eyebrow{margin:0 0 14px;color:var(--accent);font-size:.72rem;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.generation-card .eyebrow{color:rgba(255,255,255,.72)}h1,h2,h3,p{margin-top:0}h1,h2,h3{font-weight:500;letter-spacing:-.045em}.generation-card h1{max-width:760px;margin-bottom:20px;color:#fff;font:500 clamp(2.8rem,7vw,6.4rem)/.94 Georgia,serif}.generation-lede{max-width:650px;margin-bottom:26px;color:rgba(255,255,255,.79);font-size:clamp(1rem,2vw,1.18rem)}.identity-pill{display:inline-flex;align-items:center;gap:10px;max-width:100%;margin:8px 0 30px;padding:10px 14px;border:1px solid rgba(255,255,255,.23);border-radius:999px;color:#fff;background:rgba(255,255,255,.12);font-weight:750}.generation-progress{display:grid;gap:8px;max-width:700px;margin:32px 0 24px;padding:0;list-style:none}.generation-stage{display:flex;align-items:center;gap:13px;padding:9px 0;color:rgba(255,255,255,.52);font-size:.91rem;transition:color .35s ease,transform .35s ease}.generation-stage.is-active{color:#fff;transform:translateX(5px)}.generation-stage.is-complete{color:rgba(255,255,255,.83)}.stage-marker{display:grid;place-items:center;width:23px;height:23px;border:1px solid rgba(255,255,255,.35);border-radius:50%;font-size:.7rem}.generation-stage.is-active .stage-marker{border-color:#fff;background:var(--accent);box-shadow:0 0 0 5px rgba(255,255,255,.1)}.generation-stage.is-complete .stage-marker{border-color:rgba(255,255,255,.65)}.generation-note{margin:0;color:rgba(255,255,255,.62);font-size:.82rem}.generation-line{height:3px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.18)}.generation-line span{display:block;width:42%;height:100%;border-radius:inherit;background:#fff;animation:progress-line 2.1s ease-in-out infinite alternate}@keyframes progress-line{from{transform:translateX(-110%)}to{transform:translateX(225%)}}
.report-page{width:min(1240px,100%);margin:0 auto;padding:clamp(18px,3vw,42px) 0 80px}.report-cover{position:relative;isolation:isolate;overflow:hidden;min-height:clamp(520px,64vh,700px);padding:clamp(26px,5vw,72px);border:1px solid rgba(255,255,255,.25);border-radius:var(--radius);color:#fff;background-color:var(--report-fallback);background-position:center;background-size:cover;box-shadow:0 32px 90px rgba(14,33,23,.24)}.report-cover::after{position:absolute;z-index:-1;inset:0;content:"";background:linear-gradient(90deg,rgba(8,25,17,.65),rgba(8,25,17,.16) 70%,rgba(8,25,17,.35))}.report-cover .hosted-brand{margin-bottom:clamp(62px,12vw,150px)}.report-cover .eyebrow{color:rgba(255,255,255,.75)}.cover-content{max-width:760px}.cover-content h1{margin-bottom:18px;color:#fff;font:500 clamp(3rem,7vw,7rem)/.9 Georgia,serif}.report-role{margin-bottom:25px;color:rgba(255,255,255,.88);font-size:clamp(1.1rem,2.5vw,1.55rem);font-weight:700}.report-role span{padding:0 5px;color:rgba(255,255,255,.55);font-weight:400}.cover-summary{max-width:680px;color:rgba(255,255,255,.82);font-size:clamp(1rem,1.8vw,1.18rem)}.cover-footer{display:flex;align-items:end;justify-content:space-between;gap:30px;margin-top:clamp(48px,7vw,90px)}.report-match{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:12px;max-width:250px}.match-meter{position:relative;display:grid;place-items:center;width:76px;height:76px;border:7px solid rgba(255,255,255,.22);border-top-color:#fff;border-right-color:var(--accent);border-radius:50%;font-weight:850}.match-meter span{font-size:1.08rem}.match-label{color:rgba(255,255,255,.68);font-size:.72rem;letter-spacing:.12em;text-transform:uppercase}.cover-edit{border:1px solid rgba(255,255,255,.46)!important;color:#fff!important;background:rgba(255,255,255,.1)!important}
.context-bar{position:sticky;z-index:30;top:0;display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;min-height:0;margin:0 auto;overflow:hidden;padding:0 18px;border:1px solid transparent;border-radius:0 0 18px 18px;opacity:0;pointer-events:none;transform:translateY(-100%);background:rgba(249,252,248,.84);box-shadow:0 12px 30px rgba(16,45,26,.08);backdrop-filter:blur(18px);transition:opacity .25s ease,transform .25s ease,padding .25s ease}.context-bar.is-visible{min-height:68px;padding-top:10px;padding-bottom:10px;border-color:#dfe8dc;opacity:1;pointer-events:auto;transform:translateY(0)}.context-bar-inner{display:flex;align-items:center;gap:16px;min-width:0}.context-label{min-width:0;overflow:hidden;color:#355340;font-size:.85rem;font-weight:750;text-overflow:ellipsis;white-space:nowrap}.bar-actions{display:flex;flex-shrink:0;gap:8px}.action-button,.text-button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:10px 15px;border:1px solid transparent;border-radius:999px;color:#fff;background:var(--brand);font-size:.84rem;font-weight:750;text-decoration:none}.text-button{border-color:#cfddce;color:var(--brand);background:transparent}.report-content{padding:clamp(36px,6vw,78px) clamp(4px,3vw,34px) 0}.report-intro{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:clamp(30px,7vw,100px);align-items:start;max-width:1080px;margin:0 auto 76px}.report-intro h2,.section-heading{margin-bottom:14px;color:#1d3a27;font:500 clamp(2rem,4.2vw,3.8rem)/.98 Georgia,serif}.report-intro p{color:#5f7165}.profile-facts{padding:22px 24px;border:1px solid #dce8da;border-radius:20px;background:color-mix(in srgb,var(--secondary) 52%,white);box-shadow:0 12px 35px rgba(22,56,29,.06)}.profile-facts dt{margin-top:13px;color:#809184;font-size:.68rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.profile-facts dt:first-child{margin-top:0}.profile-facts dd{margin:3px 0 0;color:#2d4b35;font-weight:700}.stories-section{max-width:1180px;margin:0 auto}.section-heading-row{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:22px}.section-heading-row .section-heading{margin:0}.section-kicker{margin:0 0 9px;color:var(--brand);font-size:.7rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.featured-story{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);overflow:hidden;border:1px solid #dae5d8;border-radius:var(--radius);background:#fff;box-shadow:0 20px 55px rgba(24,57,31,.08)}.featured-story .story-image{min-height:380px}.story-image{display:block;width:100%;height:100%;min-height:160px;object-fit:cover;background:linear-gradient(135deg,var(--secondary),#c4d8c1)}.story-placeholder{display:grid;place-items:center;min-height:160px;color:#6f8773;background:linear-gradient(135deg,var(--secondary),#c7d9c2);font-size:.76rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.story-body{padding:clamp(22px,4vw,42px)}.story-meta{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;min-width:0;color:#768579;font-size:.72rem;font-weight:750;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap}.story-meta>*{flex:none}.story-meta>.story-category{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}.match-badge{display:inline-flex;width:max-content;padding:5px 9px;border-radius:999px;color:var(--brand);background:var(--secondary);font-size:.7rem;font-weight:850}.story h3{margin:14px 0 12px;color:#213b29;font:500 clamp(1.7rem,3.6vw,3.2rem)/1.02 Georgia,serif}.story-summary{color:#586a5e}.why{margin:22px 0;padding:14px 16px;border-left:3px solid var(--accent);border-radius:0 12px 12px 0;color:#4a6250;background:color-mix(in srgb,var(--secondary) 60%,white);font-size:.87rem}.why strong{display:block;margin-bottom:5px;color:#2b4c34;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}.story-link{display:inline-flex;align-items:center;gap:8px;color:var(--brand);font-size:.85rem;font-weight:850;text-decoration:none}.story-link:hover{text-decoration:underline}.additional-section{margin-top:72px}.story-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.story-card{display:flex;flex-direction:column;overflow:hidden;border:1px solid #dfe8dc;border-radius:20px;background:#fff;box-shadow:0 12px 34px rgba(24,57,31,.05);transition:transform .2s ease,box-shadow .2s ease}.story-card:hover{transform:translateY(-4px);box-shadow:0 20px 42px rgba(24,57,31,.12)}.story-card .story-body{display:flex;flex:1;flex-direction:column;padding:20px}.story-card h3{margin:12px 0 9px;font-size:1.55rem}.story-card .story-summary{font-size:.9rem}.story-card .why{margin-top:auto;margin-bottom:18px}.report-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin:74px auto 0;padding-top:30px;border-top:1px solid #dce6da}.share-note{width:100%;min-height:1.6em;margin:5px 0 0;color:#4e7259;text-align:center;font-size:.82rem}.edit-backdrop{position:fixed;z-index:50;inset:0;background:rgba(10,27,17,.42);backdrop-filter:blur(4px)}.edit-sheet{position:fixed;z-index:51;top:0;right:0;bottom:0;width:min(470px,100%);overflow:auto;padding:28px clamp(22px,5vw,42px);color:#203329;background:#fbfdfb;box-shadow:-20px 0 60px rgba(10,35,18,.2);animation:sheet-in .25s ease}.edit-sheet h2{margin:20px 0 8px;color:#203c29;font:500 2.4rem/.98 Georgia,serif}.edit-sheet p{color:#64776a;font-size:.9rem}.sheet-close{float:right;width:40px;height:40px;border:1px solid #d2dfd1;border-radius:50%;color:var(--brand);background:#fff}.edit-form{display:grid;gap:17px;margin-top:28px}.edit-form label{display:grid;gap:7px;color:#41604a;font-size:.78rem;font-weight:800}.edit-form input{width:100%;padding:13px 14px;border:1px solid #cddccd;border-radius:12px;color:#203329;background:#fff}.edit-form .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}.form-status{min-height:1.5em;color:#55715b;font-size:.8rem}@keyframes sheet-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
@media(max-width:780px){.hosted-shell{background-image:linear-gradient(var(--loading-overlay),var(--loading-overlay)),${loadingMobile};background-attachment:scroll}.hosted-shell.report{background-image:linear-gradient(var(--report-overlay),var(--report-overlay)),${reportMobile};background-attachment:scroll}.generation-card{margin:0;padding:clamp(24px,7vw,40px);border-radius:22px}.generation-card .hosted-brand{margin-bottom:58px}.report-page{padding:10px 0 56px}.report-cover{min-height:590px;border-radius:22px;padding:25px 21px}.report-cover .hosted-brand{margin-bottom:90px}.cover-content h1{font-size:clamp(3rem,14vw,5.6rem)}.cover-footer{align-items:start;flex-direction:column;margin-top:50px}.featured-story{grid-template-columns:1fr}.featured-story .story-image{min-height:250px}.story-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-intro{grid-template-columns:1fr;margin-bottom:56px}.report-content{padding-inline:0}.context-bar{margin-inline:0;border-radius:0 0 14px 14px}.context-label{font-size:.76rem}.bar-actions .text-button{padding-inline:11px}}
@media(max-width:520px){.hosted-shell{padding:12px}.hosted-shell.report{padding:0}.generation-card{min-height:calc(100vh - 24px);display:flex;flex-direction:column;justify-content:center;padding:24px 20px}.generation-card h1{font-size:clamp(2.7rem,13vw,4.4rem)}.identity-pill{font-size:.87rem}.generation-stage{font-size:.84rem}.report-cover{min-height:650px;border-radius:0;padding:22px 18px}.report-cover .hosted-brand{margin-bottom:84px}.report-role{font-size:1.02rem}.match-meter{width:68px;height:68px}.report-content{padding:38px 17px 0}.report-intro h2,.section-heading{font-size:2.35rem}.story-grid{grid-template-columns:1fr}.story-card .story-image{min-height:190px}.section-heading-row{display:block}.section-heading-row .section-kicker{margin-bottom:8px}.action-button,.text-button{min-height:46px}.report-actions{margin-top:54px}.edit-sheet{width:100%;padding:22px 19px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.generation-stage,.context-bar,.story-card,.edit-sheet{transition:none;animation:none}.generation-line span{animation:none;transform:translateX(40%)}.story-card:hover{transform:none}}
:root{--palette-navy:${DEFAULT_THEME.navy};--palette-indigo:${DEFAULT_THEME.indigo};--palette-blue:${DEFAULT_THEME.blue};--palette-cyan:${DEFAULT_THEME.cyan};--palette-lilac:${DEFAULT_THEME.lilac};--palette-surface:${DEFAULT_THEME.surface};--palette-muted:${DEFAULT_THEME.muted};--palette-border:${DEFAULT_THEME.border}}
.generation-card{background:linear-gradient(135deg,color-mix(in srgb,var(--palette-navy) 84%,var(--palette-indigo)),color-mix(in srgb,var(--palette-indigo) 68%,var(--palette-cyan) 32%));box-shadow:0 30px 100px rgba(21,26,58,.24)}
.report-cover::after{background:linear-gradient(90deg,rgba(21,26,58,.68),rgba(42,44,143,.16) 70%,rgba(18,168,180,.28))}
.context-bar{background:rgba(247,248,250,.88);box-shadow:0 12px 30px rgba(21,26,58,.08)}.context-bar.is-visible{border-color:var(--palette-border)}.context-label{color:var(--palette-navy)}.text-button{border-color:var(--palette-lilac);color:var(--brand)}
.report-intro h2,.section-heading{color:var(--palette-navy)}.report-intro p,.story-summary{color:var(--palette-muted)}.profile-facts{border-color:var(--palette-lilac);box-shadow:0 12px 35px rgba(21,26,58,.06)}.profile-facts dt{color:var(--palette-muted)}.profile-facts dd{color:var(--palette-navy)}
.featured-story{border-color:var(--palette-lilac);box-shadow:0 20px 55px rgba(21,26,58,.08)}.story-image{background:linear-gradient(135deg,var(--secondary),var(--palette-lilac))}.story-placeholder{color:var(--palette-muted);background:linear-gradient(135deg,var(--secondary),#eef1f6)}.story-meta{color:var(--palette-muted)}.story h3{color:var(--palette-navy)}.why{color:var(--palette-muted);background:color-mix(in srgb,var(--secondary) 60%,white)}.why strong{color:var(--palette-navy)}.story-card{border-color:var(--palette-border);box-shadow:0 12px 34px rgba(21,26,58,.05)}.story-card:hover{box-shadow:0 20px 42px rgba(21,26,58,.12)}.report-actions{border-color:var(--palette-border)}.share-note{color:var(--palette-muted)}
.edit-backdrop{background:rgba(21,26,58,.42)}.edit-sheet{color:var(--palette-navy);background:var(--palette-surface);box-shadow:-20px 0 60px rgba(21,26,58,.2)}.edit-sheet h2{color:var(--palette-navy)}.edit-sheet p{color:var(--palette-muted)}.sheet-close{border-color:var(--palette-lilac);color:var(--brand)}.edit-form label{color:var(--palette-navy)}.edit-form input{border-color:var(--palette-border);color:var(--palette-navy)}.form-status{color:var(--palette-muted)}
.hosted-shell.generation-shell{display:grid;min-height:100vh;place-items:center;padding:clamp(14px,3vw,42px);background:#f2f4f7;color:#111318}.generation-shell .hosted-inner{width:min(1440px,100%);min-height:calc(100vh - clamp(28px,6vw,84px));display:grid}.generation-frame{position:relative;display:flex;flex-direction:column;justify-content:space-between;min-height:min(84vh,820px);overflow:hidden;padding:clamp(28px,5vw,76px);border:1px solid rgba(255,255,255,.48);border-radius:clamp(28px,4vw,48px);background-color:var(--loading-fallback);background-image:linear-gradient(var(--loading-overlay),var(--loading-overlay)),var(--loading-cover-image);background-position:center;background-size:cover;box-shadow:0 28px 90px rgba(21,26,58,.16);color:var(--loading-ink)}.generation-frame::after{position:absolute;inset:0;content:"";background:linear-gradient(180deg,rgba(21,26,58,.04),rgba(21,26,58,.28));pointer-events:none}.generation-inner,.generation-footer{position:relative;z-index:1}.generation-inner{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;margin:auto;text-align:center}.generation-logo .hosted-brand{justify-content:center;margin:0 auto clamp(36px,7vh,84px);color:inherit}.generation-logo .hosted-brand img{max-width:220px;max-height:58px}.generation-eyebrow{margin:0 0 18px;color:rgba(255,255,255,.7);font-size:.72rem;font-weight:850;letter-spacing:.18em;text-transform:uppercase}.generation-inner h1{max-width:850px;margin:0;color:#fff;font:600 clamp(3rem,8vw,7.4rem)/.9 var(--font);letter-spacing:-.07em}.generation-subtitle{max-width:620px;margin:24px auto 0;color:rgba(255,255,255,.78);font-size:clamp(1rem,2vw,1.18rem)}.generation-identity{display:flex;align-items:center;justify-content:center;gap:9px;margin:34px auto 0;padding:8px 10px 8px 18px;border:1px solid rgba(20,30,60,.08);border-radius:999px;color:#1b1d22;background:#fff;box-shadow:0 14px 34px rgba(10,18,54,.16);font-size:.9rem;font-weight:750}.generation-identity[hidden]{display:none}.generation-identity-label{color:#69707d;font-weight:650}.generation-identity-pill{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid rgba(20,30,60,.1);border-radius:999px;background:#f7f8fa}.identity-check{display:grid;width:17px;height:17px;place-items:center;border-radius:50%;color:#fff;background:#12a8b4;font-size:.7rem}.generation-status{padding:8px 3px 8px 6px;color:#2a2c8f}.generation-stage-label{margin:54px 0 12px;color:#fff;font-size:clamp(1rem,2vw,1.25rem);font-weight:700}.generation-progress{width:min(620px,100%);height:4px;margin:0;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.25)}.generation-progress span{display:block;width:38%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#b8a7ff,#12a8b4);animation:hosted-progress 2.2s ease-in-out infinite alternate}.generation-note{margin:15px 0 0;color:rgba(255,255,255,.64);font-size:.82rem}.generation-footer{display:flex;align-items:end;justify-content:space-between;gap:18px;color:rgba(255,255,255,.68);font-size:.75rem}.generation-legal{display:flex;gap:9px}.generation-legal a{color:inherit;text-decoration:none}.generation-legal a:hover{text-decoration:underline}@keyframes hosted-progress{from{transform:translateX(-110%)}to{transform:translateX(250%)}}
.hosted-shell.report-shell{padding:clamp(16px,3vw,42px);background:#f2f4f7;color:#111318}.report-shell .hosted-inner{width:min(1280px,100%)}.report-page{width:100%;margin:0 auto;padding:0 0 78px}.summary-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.summary-actions .action-button,.summary-actions .text-button{min-height:42px}.context-bar{position:sticky;z-index:30;top:14px;width:min(1100px,calc(100% - 32px));min-height:64px;margin:20px auto -84px;padding:8px 12px;border:1px solid rgba(20,30,60,.1);border-radius:999px;background:rgba(255,255,255,.86);box-shadow:0 14px 38px rgba(21,26,58,.12);backdrop-filter:blur(18px)}.context-bar.is-visible{min-height:64px;padding:8px 12px;border-color:rgba(20,30,60,.12)}.context-bar-inner{gap:12px}.context-label{color:#151a3a}.report-content{width:min(1100px,100%);margin:0 auto;padding:clamp(86px,10vw,132px) 0 0}.highlights-section{margin-bottom:clamp(72px,9vw,120px)}.highlights-section>.section-kicker,.also-relevant>.section-kicker,.top-stories>.section-heading-row .section-kicker{color:#2a2c8f}.highlights-section h2,.section-heading{color:#151a3a;font:600 clamp(2.2rem,5vw,4.7rem)/.94 var(--font);letter-spacing:-.065em}.highlight-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:30px}.highlight-card{position:relative;min-height:190px;overflow:hidden;padding:22px;border:1px solid rgba(20,30,60,.1);border-radius:22px;background:#fff;box-shadow:0 12px 34px rgba(21,26,58,.05)}.highlight-index{position:absolute;right:16px;bottom:-14px;color:#e7e9f2;font-size:5.5rem;font-weight:850;line-height:1}.highlight-card h3{position:relative;z-index:1;margin:0 0 16px;color:#171b4d;font:650 1.15rem/1.05 var(--font);letter-spacing:-.035em}.highlight-card p{position:relative;z-index:1;max-width:220px;margin:0;color:#69707d;font-size:.84rem;line-height:1.5}.top-stories{margin-bottom:80px}.section-heading-row{align-items:end;margin-bottom:24px}.section-heading-row .section-kicker{margin:0 0 10px}.section-heading-row .section-heading{margin:0}.story-count{color:#69707d;font-size:.78rem;font-weight:750}.featured-story{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);overflow:hidden;border:1px solid rgba(20,30,60,.1);border-radius:28px;background:#fff;box-shadow:0 18px 54px rgba(21,26,58,.08)}.featured-story .story-image{width:100%;height:100%;min-height:430px;object-fit:cover}.story-image{display:block;width:100%;min-height:180px;object-fit:cover;background:linear-gradient(135deg,#f2f4f7,#d7ceff)}.story-placeholder{display:grid;place-items:center;color:#69707d;background:linear-gradient(135deg,#f2f4f7,#eef1f6);font-size:.72rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.story-body{display:flex;flex-direction:column;padding:clamp(22px,4vw,44px)}.story-meta{color:#69707d}.match-badge{color:#2a2c8f;background:#eef1f6}.story h3{margin:16px 0 12px;color:#151a3a;font:650 clamp(1.6rem,3vw,2.9rem)/.98 var(--font);letter-spacing:-.055em}.story-summary{margin-bottom:6px;color:#69707d;line-height:1.55}.why{display:flex;align-items:flex-start;gap:10px;margin:22px 0;padding:14px 15px;border:1px solid #d7ceff;border-left:3px solid #12a8b4;border-radius:14px;color:#69707d;background:#f7f8fa}.why-icon{display:grid;flex:0 0 auto;width:22px;height:22px;place-items:center;border-radius:50%;color:#fff;background:#2a2c8f;font-size:.7rem}.why strong{display:block;margin:0 0 4px;color:#151a3a;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}.why p{margin:0;color:#69707d;font-size:.84rem;line-height:1.45}.story-link{margin-top:auto;color:#2a2c8f;font-weight:800}.also-relevant{margin-top:80px}.also-relevant .section-heading{margin-bottom:24px}.story-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.story-card{overflow:hidden;border:1px solid rgba(20,30,60,.1);border-radius:22px;background:#fff;box-shadow:0 12px 36px rgba(21,26,58,.06)}.story-card .story-image{height:190px}.story-card .story-body{min-height:330px;padding:22px}.story-card h3{font-size:1.45rem}.additional-section{margin-top:80px}.report-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:82px;padding-top:30px;border-top:1px solid rgba(20,30,60,.1)}.share-note{width:100%;color:#69707d}.edit-sheet{border-radius:28px 0 0 28px}.edit-form input{border-color:rgba(20,30,60,.14);border-radius:14px}.edit-form .action-button{background:#2a2c8f}.edit-form .text-button{color:#2a2c8f}
@media(max-width:780px){.generation-frame{min-height:calc(100vh - 28px);background-image:linear-gradient(var(--loading-overlay),var(--loading-overlay)),var(--loading-cover-image-mobile)}.generation-inner h1{font-size:clamp(2.8rem,13vw,5.4rem)}.generation-identity{flex-wrap:wrap;max-width:100%;border-radius:28px}.generation-footer{align-items:flex-start;flex-direction:column}.report-shell{padding:0!important}.context-bar{top:8px;width:calc(100% - 20px);margin:16px auto -70px}.context-label{font-size:.75rem}.bar-actions .text-button{padding-inline:10px}.report-content{padding:96px 17px 0}.highlight-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.featured-story{grid-template-columns:1fr}.featured-story .story-image{min-height:250px}.story-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.edit-sheet{border-radius:28px 28px 0 0}}
@media(max-width:520px){.hosted-shell.generation-shell{padding:0}.generation-frame{min-height:100vh;border-radius:0;padding:26px 20px}.generation-logo .hosted-brand{margin-bottom:48px}.generation-identity{gap:6px;padding:8px 10px;font-size:.78rem}.generation-identity-pill{padding:7px 8px}.generation-stage-label{margin-top:42px}.highlight-grid{grid-template-columns:1fr}.featured-story .story-image{min-height:220px}.story-grid{grid-template-columns:1fr}.story-card .story-body{min-height:0}.section-heading-row{display:block}.story-count{display:block;margin-top:10px}.edit-sheet{width:100%;padding:22px 19px}}
@media(prefers-reduced-motion:reduce){.generation-progress span{animation:none;transform:translateX(40%)}.context-bar,.story-card,.edit-sheet{transition:none;animation:none}}
.context-bar{top:18px;background:#fff;box-shadow:0 14px 38px rgba(21,26,58,.14)}.context-bar .hosted-brand.compact{color:#151a3a}.context-bar .context-label{color:#151a3a}.highlight-index{z-index:0;pointer-events:none}.highlight-card h3,.highlight-card p{z-index:1}.story-card .story-body{min-height:300px}
@media(max-width:780px){.context-bar{top:10px;background:#fff}}
@media(max-width:520px){.story-card .story-body{min-height:0}}
</style>`;
}

function legalMarkup(manifest: PublisherManifest): string {
  return [manifest.privacyUrl ? `<a href="${escapeHtml(safeUrl(manifest.privacyUrl) || '#')}">Privacy</a>` : '', manifest.termsUrl ? `<a href="${escapeHtml(safeUrl(manifest.termsUrl) || '#')}">Terms</a>` : ''].filter(Boolean).join('<span aria-hidden="true">·</span>');
}

function formatDate(value?: string): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value.slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(timestamp);
}

function articleImage(article: ReportRecommendation['article'], manifest: PublisherManifest): string {
  const image = safeUrl(article.imageUrl);
  // Without an image a compact labelled band stands in, never a large empty block.
  return image ? `<img class="story-image" src="${escapeHtml(image)}" alt="" loading="lazy">` : `<div class="story-placeholder" aria-hidden="true"><span>${escapeHtml(manifest.name)} coverage</span></div>`;
}

function articleLink(article: ReportRecommendation['article'], manifest: PublisherManifest): string {
  const href = safeUrl(article.url) || '#';
  const newTab = manifest.branding.articleLinkBehavior !== 'same-tab' && manifest.results.openArticleInNewTab !== false;
  return `<a class="story-link" href="${escapeHtml(href)}" ${newTab ? 'target="_blank" rel="noopener noreferrer"' : ''} data-story-id="${escapeHtml(article.id)}">Read the original story <span aria-hidden="true">↗</span></a>`;
}

function storyMarkup(recommendation: ReportRecommendation, manifest: PublisherManifest, featured = false, showWhy = true): string {
  const article = recommendation.article;
  const title = escapeHtml(article.title);
  const description = escapeHtml(article.description ?? article.summary ?? article.contentSnippet ?? '');
  // An explanation that only retold the story falls back to the excerpt's first sentence; showing it would repeat
  // the excerpt directly above, so the box is left out.
  if (recommendation.rankingMetadata?.explanationRestated) showWhy = false;
  const category = article.categories[0] ? escapeHtml(article.categories[0]) : '';
  const date = formatDate(article.publishedAt);
  return `<article class="${featured ? 'featured-story' : 'story-card'} ${safeUrl(article.imageUrl) ? 'has-image' : 'no-image'}" data-story-card="${escapeHtml(article.id)}">${articleImage(article, manifest)}<div class="story-body"><div class="story-meta"><span class="match-badge">${recommendation.displayScore}% match</span>${category ? `<span class="story-category" title="${category}">${category}</span>` : ''}${date ? `<time datetime="${escapeHtml(article.publishedAt ?? '')}">${escapeHtml(date)}</time>` : ''}</div><h3>${title}</h3>${description ? `<p class="story-summary">${description}</p>` : ''}${showWhy ? `<div class="why"><span class="why-icon" aria-hidden="true">✦</span><div><strong>Why this matters to you</strong><p class="why-text">${escapeHtml(recommendation.explanation)}</p><button class="why-toggle" type="button" aria-expanded="false" hidden>More</button></div></div>` : ''}${articleLink(article, manifest)}</div></article>`;
}

/** The AI-written line for a theme card, or the standard text when AI did not provide one. */
function themeDescription(report: ReportRecord, theme: string): string {
  const written = report.themeDescriptions?.[theme];
  if (written) return written;
  // Limited coverage: say only that some stories touch on the theme, never that it is relevant to the reader.
  if (report.professionalProfile.coverage?.limited) return `Stories in this coverage that touch on ${themeInlineText(theme)}.`;
  const focus = roleSubjectLabel(report.professionalProfile.role) ?? report.professionalProfile.role.function.toLowerCase();
  return `Relevant to your ${focus} focus and the information needs identified for this briefing.`;
}

function highlightMarkup(report: ReportRecord): string {
  const values = reportThemes(report);
  if (!values.length) return '';
  return `<section class="highlights-section" aria-labelledby="highlights-heading"><p class="section-kicker">Highlights</p><h2 id="highlights-heading">${report.professionalProfile.coverage?.limited ? 'Closest themes in this coverage' : 'Top themes in your briefing'}</h2><div class="highlight-grid">${values.map((value, index) => `<article class="highlight-card"><span class="highlight-index">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(themeDisplayTitle(value))}</h3><p>${escapeHtml(themeDescription(report, value))}</p><button class="highlight-action" type="button" data-theme-search="${escapeHtml(value)}">Find stories →</button></article>`).join('')}</div></section>`;
}

function themeResultsMarkup(): string {
  return '<section class="theme-results" data-theme-results hidden aria-live="polite" aria-busy="false"></section>';
}

/**
 * Focused reading for a theme: first the report stories that support it (what its card was written from),
 * strongest match first, then any further archive stories about the theme.
 */
function themeResultsContent(theme: string, report: ReportRecord, manifest: PublisherManifest, briefing: ReportRecommendation[], archive: ReportRecommendation[]): string {
  const heading = `<p class="section-kicker">Focused reading</p><h2 class="theme-results-heading">Stories about ${escapeHtml(themeDisplayTitle(theme))}</h2><p class="theme-results-subheading">Selected for your role as ${escapeHtml(report.jobTitle)}</p>`;
  if (!briefing.length && !archive.length) return `${heading}<p class="theme-results-status">No strong stories were found for this theme in the current coverage.</p>`;
  // Briefing stories already show their "why" in the report above, so it is not repeated here; archive stories
  // without an AI explanation show the article's own description only, not a repeat of it.
  const grid = (items: ReportRecommendation[], showWhy: (item: ReportRecommendation) => boolean) => `<div class="story-grid">${items.map((recommendation) => storyMarkup(recommendation, manifest, false, showWhy(recommendation))).join('')}</div>`;
  const briefingMarkup = briefing.length ? `<div class="theme-results-group" data-theme-group="briefing"><h3 class="theme-results-group-heading">In your briefing</h3>${grid(briefing, () => false)}</div>` : '';
  const archiveMarkup = archive.length ? `<div class="theme-results-group" data-theme-group="archive"><h3 class="theme-results-group-heading">${briefing.length ? 'More on this theme' : 'From the archive'}</h3>${grid(archive, (item) => item.rankingMetadata?.explanationSource === 'ai')}</div>` : '';
  return `${heading}${briefingMarkup}${archiveMarkup}`;
}

function optionalSectionsMarkup(manifest: PublisherManifest, sections: EditorialSection[]): string {
  const labels: Record<string, string> = { 'top-developments': 'Top developments', 'companies-to-watch': 'Companies to watch', 'market-moves': 'Market moves', 'technology-developments': 'Technology developments', 'what-to-watch-next': 'What to watch next', 'from-the-archive': 'From the archive', 'more-relevant-stories': 'More relevant stories' };
  return (manifest.reportSections ?? []).filter((section) => labels[section]).flatMap((section) => {
    const allocated = sections.find((item) => item.id === section)?.recommendations ?? [];
    if (!allocated.length) return [];
    return `<section class="additional-section stories-section" data-report-section="${escapeHtml(section)}" aria-labelledby="section-${escapeHtml(section)}"><p class="section-kicker">Additional reading</p><h2 class="section-heading" id="section-${escapeHtml(section)}">${escapeHtml(labels[section])}</h2><div class="story-grid">${allocated.map((recommendation) => storyMarkup(recommendation, manifest)).join('')}</div></section>`;
  }).join('');
}

function identityLabel(report: ReportRecord): string {
  return `${displayTitle(report.jobTitle)} at ${displayCompany(report)}`;
}

function editSheetMarkup(report: ReportRecord): string {
  return `<div class="edit-backdrop" data-edit-backdrop hidden></div><aside class="edit-sheet" data-edit-sheet hidden role="dialog" aria-modal="true" aria-labelledby="edit-heading"><button class="sheet-close" type="button" data-cancel aria-label="Close edit profile">×</button><p class="section-kicker">Update your context</p><h2 id="edit-heading">Edit your profile</h2><p>Keep this briefing, or build a new one with a different company or role.</p><form class="edit-form" data-edit-form><label for="edit-company-url">Company or website<input id="edit-company-url" name="companyUrl" type="text" value="${escapeHtml(report.companyUrl)}" placeholder="Nike or nike.com" required autocomplete="organization"></label><label for="edit-job-title">Job role<input id="edit-job-title" name="jobTitle" value="${escapeHtml(report.jobTitle)}" required autocomplete="organization-title"></label><div class="actions"><button class="action-button" type="submit">Build a new briefing</button><button class="text-button" type="button" data-cancel>Keep this report</button></div><p class="form-status" data-form-status aria-live="polite"></p></form></aside>`;
}

function reportPresentation(report: ReportRecord, manifest: PublisherManifest): { additional: ReportRecommendation[]; sections: EditorialSection[] } {
  const allocation = report.sections !== undefined ? { recommendations: report.recommendations, sections: report.sections } : allocateEditorialSections(report.recommendations, manifest.reportSections ?? []);
  const visibleSectionIds = new Set(manifest.reportSections ?? []);
  const sections = allocation.sections.filter((section) => visibleSectionIds.has(section.id));
  const assignedKeys = new Set(sections.flatMap((section) => section.recommendations.flatMap((recommendation) => articleIdentityKeys(recommendation.article))));
  return {
    sections,
    additional: allocation.recommendations.slice(1).filter((recommendation) => articleIdentityKeys(recommendation.article).every((key) => !assignedKeys.has(key))),
  };
}

export async function renderHostedRoute(documentRef: Document, registry: PublisherRegistry): Promise<void> {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'p' || !parts[1]) return;
  const publisherId = parts[1];
  const manifest = registry.get(publisherId)?.manifest;
  if (!manifest) { documentRef.body.innerHTML = '<main class="hosted-shell generation-shell"><div class="hosted-inner"><section class="generation-frame hosted-card"><div class="generation-inner"><p class="generation-eyebrow">Publisher unavailable</p><h1>Publisher not found</h1></div></section></div></main>'; return; }
  const reportId = parts[2] === 'generate' ? parts[3] : parts[2];
  const isGeneration = parts[2] === 'generate';
  documentRef.body.innerHTML = routeStyle(manifest) + `<main class="hosted-shell ${reportId && !isGeneration ? 'report-shell report' : `generation-shell generation${reportId && isGeneration ? ' loading-shell' : ''}`}"><div class="hosted-inner">${reportId && isGeneration ? generationPageMarkup(manifest, brandMarkup(manifest), legalMarkup(manifest)) : `<div class="report-loading hosted-card" id="hosted-app">${brandMarkup(manifest)}<p>Loading your briefing…</p></div>`}</div></main>`;
  if (!reportId) return;
  if (isGeneration) {
    const app = documentRef.querySelector<HTMLElement>('#hosted-app');
    if (app) runGenerationPage(app, manifest, publisherId, reportId, { analytics: new BatchingAnalyticsClient() });
    return;
  }
  const response = await fetch('/api/reports/' + encodeURIComponent(reportId) + '?publisherId=' + encodeURIComponent(publisherId));
  const app = documentRef.querySelector<HTMLElement>('#hosted-app');
  if (!response.ok) { if (app) app.innerHTML = brandMarkup(manifest) + '<p class="eyebrow">Briefing unavailable</p><h1>This report could not be found</h1><p>It may have expired or the link may be incorrect.</p>'; return; }
  const report = await response.json() as ReportRecord;
  const analytics = new BatchingAnalyticsClient();
  analytics.track(createEvent('report_viewed', publisherId, report.sessionId, { reportId }));
  renderReport(documentRef, manifest, report, analytics);
}

/**
 * The report body below the hero and the mobile report layout. Loaded after the shared styles so it refines
 * them; below 640px a layout designed for phones (swipeable theme cards, compact stories, clamped "why" with
 * More, one-line context bar). The hero itself is styled by briefHeroStyle (hosted-hero.ts), loaded after this.
 */
function compactReportStyle(): string {
  // The sticky context bar sits in flow with a negative bottom margin (-58px mobile, -84px desktop); it is only
  // shown once the hero has scrolled away (renderReport), so the content padding set in briefHeroStyle can be
  // smaller than the bar without the bar covering the HIGHLIGHTS eyebrow.
  // Story titles are serif by design (the approved production look). They used to get it only from the
  // marketing page's global h1–h3 rule leaking into the shared HTML shell; it is stated here deliberately.
  return `<style>
html{scroll-padding-top:104px}.report-page section,.report-page .theme-results,.report-page [id]{scroll-margin-top:104px}
.report-page .coverage-note{margin:0 0 12px;padding:9px 12px;border-radius:12px;color:#5b4a12;background:#fff6dc;font-size:.84rem;line-height:1.45}
.report-page .report-content{padding-top:clamp(96px,8vw,112px)}.report-page .highlights-section{margin-bottom:clamp(48px,6vw,80px)}
.report-page .highlights-section h2,.report-page .section-heading{font-size:clamp(1.75rem,3vw,2.75rem);line-height:1;letter-spacing:-.05em}
.report-page .story-placeholder{display:flex;align-items:center;justify-content:center;width:100%;height:48px;min-height:0;padding:0 16px;color:#69707d;background:linear-gradient(135deg,#f2f4f7,#eef1f6);font-size:.66rem;letter-spacing:.12em}
.report-page .featured-story.no-image{grid-template-columns:1fr}.report-page .featured-story.no-image .story-placeholder{display:none}
.report-page .featured-story h3,.report-page .story-card h3{font-family:Georgia,serif;font-weight:500;letter-spacing:-.045em}
.why-toggle{display:none;margin-top:4px;padding:0;border:0;color:#2a2c8f;background:transparent;font-size:.78rem;font-weight:800}
@media(max-width:639px){
html{scroll-padding-top:84px}.report-page section,.report-page .theme-results,.report-page [id]{scroll-margin-top:84px}
.report-page .coverage-note{font-size:.8rem}
.report-page .summary-actions{gap:8px;margin-top:14px}.report-page .summary-actions .action-button,.report-page .summary-actions .text-button{min-height:40px;padding:8px 14px;font-size:.8rem}
.report-page .report-content{padding:76px 14px 0}.report-page .highlights-section h2,.report-page .section-heading{font-size:1.5rem;letter-spacing:-.04em}.report-page .highlights-section{margin-bottom:44px}.report-page .top-stories{margin-bottom:48px}
.report-page .highlight-grid{display:flex;gap:10px;margin:16px -14px 0;padding:0 14px 6px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:0 14px;scrollbar-width:none}.report-page .highlight-grid::-webkit-scrollbar{display:none}
.report-page .highlight-card{flex:0 0 78%;min-height:0;padding:16px 16px 46px;border-radius:18px;scroll-snap-align:start}.report-page .highlight-index{display:none}.report-page .highlight-card h3{margin-bottom:8px;font-size:1rem}.report-page .highlight-card p{display:-webkit-box;max-width:none;overflow:hidden;font-size:.8rem;-webkit-box-orient:vertical;-webkit-line-clamp:3}.report-page .highlight-action{left:16px;bottom:14px}
.report-page .featured-story,.report-page .story-card{border-radius:18px}.report-page .featured-story .story-image,.report-page .story-card .story-image{width:100%;height:auto;min-height:0;max-height:180px;aspect-ratio:16/9}.report-page .story-placeholder{height:36px}
.report-page .story-body,.report-page .story-card .story-body{min-height:0;padding:14px 16px 16px}.report-page .featured-story h3,.report-page .story-card h3{display:-webkit-box;margin:10px 0 6px;overflow:hidden;font-size:1.25rem;line-height:1.1;-webkit-box-orient:vertical;-webkit-line-clamp:3}
.report-page .story-summary{display:-webkit-box;overflow:hidden;font-size:.86rem;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:3}.report-page .story-meta{font-size:.66rem}
.report-page .why{margin:12px 0;padding:10px 12px}.report-page .why-text{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3}.report-page .why.is-expanded .why-text{display:block}.report-page .why-toggle{display:inline-flex}
.report-page .story-grid{grid-template-columns:1fr;gap:12px}.report-page .also-relevant,.report-page .additional-section{margin-top:48px}
.report-page .context-bar,.report-page .context-bar.is-visible{top:8px;width:calc(100% - 16px);min-height:46px;margin:12px auto -58px;padding:5px 5px 5px 14px}.report-page .context-bar .hosted-brand{display:none}.report-page .context-bar-inner{min-width:0}.report-page .context-label{overflow:hidden;font-size:.74rem;text-overflow:ellipsis;white-space:nowrap}.report-page .bar-actions{gap:5px}.report-page .bar-actions .action-button,.report-page .bar-actions .text-button{min-height:34px;padding:6px 12px;font-size:.74rem}
.report-page .theme-results{margin:-12px 0 44px;padding:18px 14px;border-radius:18px}
}
</style>`;
}

function renderReport(documentRef: Document, manifest: PublisherManifest, report: ReportRecord, analytics: BatchingAnalyticsClient): void {
  const app = documentRef.querySelector<HTMLElement>('#hosted-app');
  if (!app) return;
  const identity = identityLabel(report);
  const reportCoverStyle = `${compactReportStyle()}<style>.highlight-action{position:absolute;z-index:1;left:22px;bottom:22px;display:inline-flex;padding:0;border:0;color:#2a2c8f;background:transparent;font-size:.8rem;font-weight:800}.highlight-action:hover{text-decoration:underline}.theme-results{max-width:1100px;margin:-58px auto 80px;padding:28px;border:1px solid rgba(20,30,60,.1);border-radius:24px;background:#fff;box-shadow:0 16px 44px rgba(21,26,58,.08)}.theme-results[hidden]{display:none}.theme-results-heading{margin:0;color:#151a3a;font:600 clamp(1.8rem,4vw,3rem)/1 var(--font);letter-spacing:-.055em}.theme-results-subheading{margin:8px 0 22px;color:#69707d;font-size:.9rem}.theme-results-group+.theme-results-group{margin-top:28px}.report-page .theme-results-group-heading{font-family:inherit}.theme-results-group-heading{margin:0 0 14px;color:#5b6170;font-size:.74rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.theme-results-status{margin:0;color:#69707d}.theme-results .story-grid{margin-top:20px}@media(max-width:520px){.theme-results{margin:-20px 0 56px;padding:22px 18px}}</style>`;
  const feature = report.recommendations[0];
  const presentation = reportPresentation(report, manifest);
  const additional = presentation.additional;
  const additionalMarkup = additional.length ? `<section class="also-relevant stories-section" aria-labelledby="additional-heading"><p class="section-kicker">Also relevant</p><h2 class="section-heading" id="additional-heading">More stories for your work</h2><div class="story-grid">${additional.map((recommendation) => storyMarkup(recommendation, manifest)).join('')}</div></section>` : '';
  const reportTitle = manifest.results.heading || 'Stories selected for your work';
  app.className = 'report-page';
  const storiesOnPage = [...(feature ? [feature] : []), ...additional, ...presentation.sections.flatMap((section) => section.recommendations)];
  const heroMarkup = `${briefHeroStyle()}${briefHeroMarkup({ report, publisherName: manifest.name, role: displayTitle(report.jobTitle), company: displayCompany(report), themeCount: reportThemes(report).length, storiesOnPage, brand: brandMarkup(manifest) })}`;
  app.innerHTML = `${reportCoverStyle}${heroMarkup}<div class="context-bar" data-sticky-context aria-hidden="true"><div class="context-bar-inner"><div>${brandMarkup(manifest, 'compact')}</div><span class="context-label">${escapeHtml(identity)}</span></div><div class="bar-actions"><button class="text-button" type="button" data-edit>Edit</button><button class="action-button" type="button" data-share>Share</button></div></div><div class="report-content">${highlightMarkup(report)}${themeResultsMarkup()}<section class="stories-section top-stories" id="top-stories" aria-labelledby="top-stories-heading"><div class="section-heading-row"><div><p class="section-kicker">Top stories</p><h2 class="section-heading" id="top-stories-heading">${escapeHtml(reportTitle)}</h2></div><span class="story-count">${report.recommendations.length} recommendations</span></div>${feature ? storyMarkup(feature, manifest, true) : '<p>No strong matches were found in the current coverage.</p>'}</section>${additionalMarkup}${optionalSectionsMarkup(manifest, presentation.sections)}<div class="report-actions"><button class="action-button" type="button" data-edit>Edit profile</button><button class="text-button" type="button" data-share>Share report</button><p class="share-note" aria-live="polite" data-share-note></p></div></div>${editSheetMarkup(report)}`;

  bindCitationChips(app, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const cover = app.querySelector<HTMLElement>('.report-hero');
  const contextBar = app.querySelector<HTMLElement>('[data-sticky-context]');
  // The bar is shown only from the scroll position where it is already stuck to the top (hero end + its in-flow
  // margin - its sticky top): in its in-flow position it would overlap the Highlights eyebrow, which now sits closer
  // to the hero. The bar's margin and top change only with the viewport; the hero's end is read on each scroll
  // because the web font swap and images can change its height after render.
  let barOffset = 0;
  const measureBar = () => {
    const style = contextBar ? window.getComputedStyle(contextBar) : undefined;
    barOffset = style ? (parseFloat(style.marginTop) || 0) - (parseFloat(style.top) || 0) : 0;
  };
  const updateSticky = () => {
    const threshold = Math.max(240, cover ? cover.offsetTop + cover.offsetHeight + barOffset : 540);
    const visible = window.scrollY > threshold;
    contextBar?.classList.toggle('is-visible', visible);
    contextBar?.setAttribute('aria-hidden', String(!visible));
  };
  window.addEventListener('scroll', updateSticky, { passive: true });
  window.addEventListener('resize', () => { measureBar(); updateSticky(); }, { passive: true });
  measureBar();
  updateSticky();

  report.recommendations.forEach((recommendation, index) => analytics.track(createEvent('story_impression', report.publisherId, report.sessionId, { reportId: report.id, articleId: recommendation.article.id, articlePosition: index + 1, articleCategory: recommendation.article.categories[0] ?? 'Coverage', articleTitle: recommendation.article.title, articlePublishedAt: recommendation.article.publishedAt ?? '', rankingMode: recommendation.rankingMetadata.rankingMode })));
  const bindStoryClicks = (scope: ParentNode) => scope.querySelectorAll<HTMLElement>('[data-story-id]').forEach((element) => {
    if (element.dataset.analyticsBound) return;
    element.dataset.analyticsBound = 'true';
    element.addEventListener('click', () => {
      const theme = element.closest<HTMLElement>('[data-theme-results]')?.dataset.theme;
      analytics.track(createEvent(theme ? 'theme_story_clicked' : 'story_clicked', report.publisherId, report.sessionId, { reportId: report.id, articleId: element.dataset.storyId ?? '', ...(theme ? { theme: normalizeToken(theme) } : {}) }));
    });
  });
  bindStoryClicks(app);
  // "Why this matters" is clamped to three lines on mobile; More appears only where the text is cut off.
  const setupWhyToggles = (scope: ParentNode) => scope.querySelectorAll<HTMLElement>('.why').forEach((why) => {
    const text = why.querySelector<HTMLElement>('.why-text');
    const toggle = why.querySelector<HTMLButtonElement>('.why-toggle');
    if (!text || !toggle) return;
    if (!toggle.dataset.bound) {
      toggle.dataset.bound = 'true';
      toggle.addEventListener('click', () => {
        const expanded = why.classList.toggle('is-expanded');
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? 'Less' : 'More';
      });
    }
    toggle.hidden = !why.classList.contains('is-expanded') && text.scrollHeight <= text.clientHeight + 1;
  });
  setupWhyToggles(app);
  let whyFrame = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(whyFrame); whyFrame = requestAnimationFrame(() => setupWhyToggles(app)); }, { passive: true });

  const themeResults = app.querySelector<HTMLElement>('[data-theme-results]');
  // Articles shown by each theme opened on this page, so another theme's results do not repeat them.
  const shownByTheme = new Map<string, string[]>();
  const shownElsewhere = (theme: string) => [...shownByTheme].filter(([key]) => key !== theme).flatMap(([, ids]) => ids).slice(-MAX_SHOWN_THEME_ARTICLE_IDS);
  app.querySelectorAll<HTMLButtonElement>('[data-theme-search]').forEach((button) => button.addEventListener('click', async () => {
    if (button.disabled || !themeResults) return;
    const theme = button.dataset.themeSearch ?? '';
    button.disabled = true;
    const originalLabel = button.textContent ?? 'Find stories →';
    button.textContent = 'Finding stories…';
    themeResults.hidden = false;
    themeResults.dataset.theme = theme;
    themeResults.setAttribute('aria-busy', 'true');
    themeResults.innerHTML = '<p class="theme-results-status">Finding stories…</p>';
    analytics.track(createEvent('theme_find_stories_clicked', report.publisherId, report.sessionId, { reportId: report.id, theme: normalizeToken(theme) }));
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(report.id)}/themes/${encodeURIComponent(theme)}/search?publisherId=${encodeURIComponent(report.publisherId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shownArticleIds: shownElsewhere(normalizeToken(theme)) }) });
      if (!response.ok) throw new Error('theme_search_failed');
      const payload = await response.json() as { theme?: string; briefingRecommendations?: ReportRecommendation[]; recommendations?: ReportRecommendation[] };
      const recommendations = Array.isArray(payload.recommendations) ? payload.recommendations : [];
      const briefing = Array.isArray(payload.briefingRecommendations) ? payload.briefingRecommendations : themeSupportingRecommendations(report, theme);
      const resolvedTheme = payload.theme ?? theme;
      shownByTheme.delete(normalizeToken(theme));
      shownByTheme.set(normalizeToken(theme), recommendations.map((recommendation) => recommendation.articleId));
      themeResults.dataset.theme = resolvedTheme;
      themeResults.innerHTML = themeResultsContent(resolvedTheme, report, manifest, briefing, recommendations);
      bindStoryClicks(themeResults);
      setupWhyToggles(themeResults);
      analytics.track(createEvent('theme_results_loaded', report.publisherId, report.sessionId, { reportId: report.id, theme: normalizeToken(resolvedTheme), resultCount: briefing.length + recommendations.length }));
    } catch {
      themeResults.innerHTML = '<p class="theme-results-status">We couldn’t find stories for this theme right now.</p>';
      analytics.track(createEvent('theme_results_loaded', report.publisherId, report.sessionId, { reportId: report.id, theme: normalizeToken(theme), resultCount: 0 }));
    } finally {
      themeResults.setAttribute('aria-busy', 'false');
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }));

  const share = async () => {
    const url = window.location.href;
    const canShare = typeof navigator.share === 'function';
    try {
      if (canShare) await navigator.share({ title: 'My personalised briefing', url });
      else await navigator.clipboard?.writeText(url);
    } catch { /* Sharing can be cancelled without affecting the report. */ }
    app.querySelectorAll<HTMLElement>('[data-share-note]').forEach((note) => { note.textContent = canShare ? 'Report ready to share.' : 'Report link copied.'; });
    analytics.track(createEvent('report_shared', report.publisherId, report.sessionId, { reportId: report.id, shareMethod: canShare ? 'native' : 'clipboard' }));
  };
  app.querySelectorAll<HTMLButtonElement>('[data-share]').forEach((button) => button.addEventListener('click', () => { void share(); }));

  const sheet = app.querySelector<HTMLElement>('[data-edit-sheet]');
  const backdrop = app.querySelector<HTMLElement>('[data-edit-backdrop]');
  const openEdit = () => { sheet?.removeAttribute('hidden'); backdrop?.removeAttribute('hidden'); documentRef.body.classList.add('modal-open'); app.querySelector<HTMLInputElement>('#edit-job-title')?.focus(); analytics.track(createEvent('profile_edit_clicked', report.publisherId, report.sessionId, { reportId: report.id })); };
  const closeEdit = () => { sheet?.setAttribute('hidden', ''); backdrop?.setAttribute('hidden', ''); documentRef.body.classList.remove('modal-open'); };
  app.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((button) => button.addEventListener('click', openEdit));
  app.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((button) => button.addEventListener('click', closeEdit));
  backdrop?.addEventListener('click', closeEdit);
  documentRef.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !sheet?.hasAttribute('hidden')) closeEdit(); });
  app.querySelector<HTMLFormElement>('[data-edit-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const status = app.querySelector<HTMLElement>('[data-form-status]');
    if (status) status.textContent = 'Building your new briefing…';
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.setAttribute('disabled', '');
    try {
      const nextResponse = await fetch('/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: report.publisherId, companyUrl: String(data.get('companyUrl') ?? ''), jobTitle: String(data.get('jobTitle') ?? ''), sessionId: report.sessionId }) });
      const next = await nextResponse.json() as { generationUrl?: string; reportUrl?: string; error?: string };
      if (nextResponse.ok && (next.generationUrl || next.reportUrl)) { window.location.assign(next.generationUrl ?? next.reportUrl!); return; }
      if (status) status.textContent = generationInputMessage(next.error, String(data.get('companyUrl') ?? '')) ?? 'We could not start that briefing. Check the details and try again.';
    } catch { if (status) status.textContent = 'We could not reach the briefing service. Please try again.'; }
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.removeAttribute('disabled');
  });
}
