import { BatchingAnalyticsClient } from './analytics/client';
import { createEvent, DEFAULT_THEME, type PublisherRegistry } from './core';
import type { PublisherExperienceBranding, PublisherManifest } from './publishers/manifest';
import type { ReportRecord, ReportRecommendation } from './reports';

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

function displayTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().split(' ').map((word) => {
    if (/^[A-Z\d-]{2,}$/.test(word)) return word;
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
.eyebrow{margin:0 0 14px;color:var(--accent);font-size:.72rem;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.generation-card .eyebrow{color:rgba(255,255,255,.72)}h1,h2,h3,p{margin-top:0}h1,h2,h3{font-weight:500;letter-spacing:-.045em}.generation-card h1{max-width:760px;margin-bottom:20px;color:#fff;font:500 clamp(2.8rem,7vw,6.4rem)/.94 Georgia,serif}.generation-lede{max-width:650px;margin-bottom:26px;color:rgba(255,255,255,.79);font-size:clamp(1rem,2vw,1.18rem)}.identity-pill{display:inline-flex;align-items:center;gap:10px;max-width:100%;margin:8px 0 30px;padding:10px 14px;border:1px solid rgba(255,255,255,.23);border-radius:999px;color:#fff;background:rgba(255,255,255,.12);font-weight:750}.identity-icon{display:grid;place-items:center;width:27px;height:27px;border-radius:50%;color:var(--brand);background:#fff;font-size:.76rem;font-weight:900}.generation-progress{display:grid;gap:8px;max-width:700px;margin:32px 0 24px;padding:0;list-style:none}.generation-stage{display:flex;align-items:center;gap:13px;padding:9px 0;color:rgba(255,255,255,.52);font-size:.91rem;transition:color .35s ease,transform .35s ease}.generation-stage.is-active{color:#fff;transform:translateX(5px)}.generation-stage.is-complete{color:rgba(255,255,255,.83)}.stage-marker{display:grid;place-items:center;width:23px;height:23px;border:1px solid rgba(255,255,255,.35);border-radius:50%;font-size:.7rem}.generation-stage.is-active .stage-marker{border-color:#fff;background:var(--accent);box-shadow:0 0 0 5px rgba(255,255,255,.1)}.generation-stage.is-complete .stage-marker{border-color:rgba(255,255,255,.65)}.generation-note{margin:0;color:rgba(255,255,255,.62);font-size:.82rem}.generation-line{height:3px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.18)}.generation-line span{display:block;width:42%;height:100%;border-radius:inherit;background:#fff;animation:progress-line 2.1s ease-in-out infinite alternate}@keyframes progress-line{from{transform:translateX(-110%)}to{transform:translateX(225%)}}
.report-page{width:min(1240px,100%);margin:0 auto;padding:clamp(18px,3vw,42px) 0 80px}.report-cover{position:relative;isolation:isolate;overflow:hidden;min-height:clamp(520px,64vh,700px);padding:clamp(26px,5vw,72px);border:1px solid rgba(255,255,255,.25);border-radius:var(--radius);color:#fff;background-color:var(--report-fallback);background-position:center;background-size:cover;box-shadow:0 32px 90px rgba(14,33,23,.24)}.report-cover::after{position:absolute;z-index:-1;inset:0;content:"";background:linear-gradient(90deg,rgba(8,25,17,.65),rgba(8,25,17,.16) 70%,rgba(8,25,17,.35))}.report-cover .hosted-brand{margin-bottom:clamp(62px,12vw,150px)}.report-cover .eyebrow{color:rgba(255,255,255,.75)}.cover-content{max-width:760px}.cover-content h1{margin-bottom:18px;color:#fff;font:500 clamp(3rem,7vw,7rem)/.9 Georgia,serif}.report-role{margin-bottom:25px;color:rgba(255,255,255,.88);font-size:clamp(1.1rem,2.5vw,1.55rem);font-weight:700}.report-role span{padding:0 5px;color:rgba(255,255,255,.55);font-weight:400}.cover-summary{max-width:680px;color:rgba(255,255,255,.82);font-size:clamp(1rem,1.8vw,1.18rem)}.cover-footer{display:flex;align-items:end;justify-content:space-between;gap:30px;margin-top:clamp(48px,7vw,90px)}.report-match{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:12px;max-width:250px}.match-meter{position:relative;display:grid;place-items:center;width:76px;height:76px;border:7px solid rgba(255,255,255,.22);border-top-color:#fff;border-right-color:var(--accent);border-radius:50%;font-weight:850}.match-meter span{font-size:1.08rem}.match-label{color:rgba(255,255,255,.68);font-size:.72rem;letter-spacing:.12em;text-transform:uppercase}.cover-edit{border:1px solid rgba(255,255,255,.46)!important;color:#fff!important;background:rgba(255,255,255,.1)!important}
.context-bar{position:sticky;z-index:30;top:0;display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;min-height:0;margin:0 auto;overflow:hidden;padding:0 18px;border:1px solid transparent;border-radius:0 0 18px 18px;opacity:0;pointer-events:none;transform:translateY(-100%);background:rgba(249,252,248,.84);box-shadow:0 12px 30px rgba(16,45,26,.08);backdrop-filter:blur(18px);transition:opacity .25s ease,transform .25s ease,padding .25s ease}.context-bar.is-visible{min-height:68px;padding-top:10px;padding-bottom:10px;border-color:#dfe8dc;opacity:1;pointer-events:auto;transform:translateY(0)}.context-bar-inner{display:flex;align-items:center;gap:16px;min-width:0}.context-label{min-width:0;overflow:hidden;color:#355340;font-size:.85rem;font-weight:750;text-overflow:ellipsis;white-space:nowrap}.bar-actions{display:flex;flex-shrink:0;gap:8px}.action-button,.text-button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:10px 15px;border:1px solid transparent;border-radius:999px;color:#fff;background:var(--brand);font-size:.84rem;font-weight:750;text-decoration:none}.text-button{border-color:#cfddce;color:var(--brand);background:transparent}.report-content{padding:clamp(36px,6vw,78px) clamp(4px,3vw,34px) 0}.report-intro{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:clamp(30px,7vw,100px);align-items:start;max-width:1080px;margin:0 auto 76px}.report-intro h2,.section-heading{margin-bottom:14px;color:#1d3a27;font:500 clamp(2rem,4.2vw,3.8rem)/.98 Georgia,serif}.report-intro p{color:#5f7165}.profile-facts{padding:22px 24px;border:1px solid #dce8da;border-radius:20px;background:color-mix(in srgb,var(--secondary) 52%,white);box-shadow:0 12px 35px rgba(22,56,29,.06)}.profile-facts dt{margin-top:13px;color:#809184;font-size:.68rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.profile-facts dt:first-child{margin-top:0}.profile-facts dd{margin:3px 0 0;color:#2d4b35;font-weight:700}.stories-section{max-width:1180px;margin:0 auto}.section-heading-row{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:22px}.section-heading-row .section-heading{margin:0}.section-kicker{margin:0 0 9px;color:var(--brand);font-size:.7rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.featured-story{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);overflow:hidden;border:1px solid #dae5d8;border-radius:var(--radius);background:#fff;box-shadow:0 20px 55px rgba(24,57,31,.08)}.featured-story .story-image{min-height:380px}.story-image{display:block;width:100%;height:100%;min-height:160px;object-fit:cover;background:linear-gradient(135deg,var(--secondary),#c4d8c1)}.story-placeholder{display:grid;place-items:center;min-height:160px;color:#6f8773;background:linear-gradient(135deg,var(--secondary),#c7d9c2);font-size:.76rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.story-body{padding:clamp(22px,4vw,42px)}.story-meta{display:flex;flex-wrap:wrap;gap:8px;color:#768579;font-size:.72rem;font-weight:750;letter-spacing:.03em;text-transform:uppercase}.match-badge{display:inline-flex;width:max-content;padding:5px 9px;border-radius:999px;color:var(--brand);background:var(--secondary);font-size:.7rem;font-weight:850}.story h3{margin:14px 0 12px;color:#213b29;font:500 clamp(1.7rem,3.6vw,3.2rem)/1.02 Georgia,serif}.story-summary{color:#586a5e}.why{margin:22px 0;padding:14px 16px;border-left:3px solid var(--accent);border-radius:0 12px 12px 0;color:#4a6250;background:color-mix(in srgb,var(--secondary) 60%,white);font-size:.87rem}.why strong{display:block;margin-bottom:5px;color:#2b4c34;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}.story-link{display:inline-flex;align-items:center;gap:8px;color:var(--brand);font-size:.85rem;font-weight:850;text-decoration:none}.story-link:hover{text-decoration:underline}.additional-section{margin-top:72px}.story-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.story-card{display:flex;flex-direction:column;overflow:hidden;border:1px solid #dfe8dc;border-radius:20px;background:#fff;box-shadow:0 12px 34px rgba(24,57,31,.05);transition:transform .2s ease,box-shadow .2s ease}.story-card:hover{transform:translateY(-4px);box-shadow:0 20px 42px rgba(24,57,31,.12)}.story-card .story-body{display:flex;flex:1;flex-direction:column;padding:20px}.story-card h3{margin:12px 0 9px;font-size:1.55rem}.story-card .story-summary{font-size:.9rem}.story-card .why{margin-top:auto;margin-bottom:18px}.report-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin:74px auto 0;padding-top:30px;border-top:1px solid #dce6da}.share-note{width:100%;min-height:1.6em;margin:5px 0 0;color:#4e7259;text-align:center;font-size:.82rem}.edit-backdrop{position:fixed;z-index:50;inset:0;background:rgba(10,27,17,.42);backdrop-filter:blur(4px)}.edit-sheet{position:fixed;z-index:51;top:0;right:0;bottom:0;width:min(470px,100%);overflow:auto;padding:28px clamp(22px,5vw,42px);color:#203329;background:#fbfdfb;box-shadow:-20px 0 60px rgba(10,35,18,.2);animation:sheet-in .25s ease}.edit-sheet h2{margin:20px 0 8px;color:#203c29;font:500 2.4rem/.98 Georgia,serif}.edit-sheet p{color:#64776a;font-size:.9rem}.sheet-close{float:right;width:40px;height:40px;border:1px solid #d2dfd1;border-radius:50%;color:var(--brand);background:#fff}.edit-form{display:grid;gap:17px;margin-top:28px}.edit-form label{display:grid;gap:7px;color:#41604a;font-size:.78rem;font-weight:800}.edit-form input{width:100%;padding:13px 14px;border:1px solid #cddccd;border-radius:12px;color:#203329;background:#fff}.edit-form .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}.form-status{min-height:1.5em;color:#55715b;font-size:.8rem}@keyframes sheet-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
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
</style>`;
}

function generationMarkup(manifest: PublisherManifest): string {
  return `<div class="generation-card hosted-card" id="hosted-app">${brandMarkup(manifest)}<p class="eyebrow">Personalised intelligence</p><h1 id="generation-heading">Building your personalised briefing</h1><div class="identity-pill" data-generation-identity hidden><span class="identity-icon" aria-hidden="true">↗</span><span data-generation-context></span></div><p class="generation-lede">We are turning your professional context into a focused view of the publisher’s coverage.</p><ol class="generation-progress" aria-label="Briefing generation progress"><li class="generation-stage is-active" data-stage="0"><span class="stage-marker">●</span><span>Understanding your company</span></li><li class="generation-stage" data-stage="1"><span class="stage-marker">○</span><span>Analysing your role</span></li><li class="generation-stage" data-stage="2"><span class="stage-marker">○</span><span>Reviewing relevant coverage</span></li><li class="generation-stage" data-stage="3"><span class="stage-marker">○</span><span>Ranking the strongest matches</span></li><li class="generation-stage" data-stage="4"><span class="stage-marker">○</span><span>Building your briefing</span></li></ol><div class="generation-line progress" aria-hidden="true"><span></span></div><p class="generation-note" data-generation-note>Taking a considered look at what may matter to your work.</p></div>`;
}

function formatDate(value?: string): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value.slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(timestamp);
}

function articleImage(article: ReportRecommendation['article']): string {
  const image = safeUrl(article.imageUrl);
  return image ? `<img class="story-image" src="${escapeHtml(image)}" alt="" loading="lazy">` : '<div class="story-placeholder" aria-hidden="true">Northstar coverage</div>';
}

function articleLink(article: ReportRecommendation['article'], manifest: PublisherManifest): string {
  const href = safeUrl(article.url) || '#';
  const newTab = manifest.branding.articleLinkBehavior !== 'same-tab' && manifest.results.openArticleInNewTab !== false;
  return `<a class="story-link" href="${escapeHtml(href)}" ${newTab ? 'target="_blank" rel="noopener noreferrer"' : ''} data-story-id="${escapeHtml(article.id)}">Read the original story <span aria-hidden="true">↗</span></a>`;
}

function storyMarkup(recommendation: ReportRecommendation, manifest: PublisherManifest, featured = false): string {
  const article = recommendation.article;
  const title = escapeHtml(article.title);
  const description = escapeHtml(article.description ?? article.summary ?? article.contentSnippet ?? '');
  const category = escapeHtml(article.categories[0] ?? 'Coverage');
  const date = formatDate(article.publishedAt);
  return `<article class="${featured ? 'featured-story' : 'story-card'}" data-story-card="${escapeHtml(article.id)}">${articleImage(article)}<div class="story-body"><div class="story-meta"><span class="match-badge">${recommendation.displayScore}% match</span><span>${category}</span>${date ? `<time datetime="${escapeHtml(article.publishedAt ?? '')}">${escapeHtml(date)}</time>` : ''}</div><h3>${title}</h3>${description ? `<p class="story-summary">${description}</p>` : ''}<p class="why"><strong>Why this matters to you</strong>${escapeHtml(recommendation.explanation)}</p>${articleLink(article, manifest)}</div></article>`;
}

function whyMattersMarkup(report: ReportRecord): string {
  const profile = report.professionalProfile;
  const company = displayCompany(report);
  const industry = profile.company.industry ? ` operates in ${profile.company.industry}` : '';
  const themes = [...new Set([...profile.role.professionalThemes, ...profile.professionalInterests])].slice(0, 4).join(', ');
  return `<section class="report-intro" aria-labelledby="why-heading"><div><p class="section-kicker">Context behind the matches</p><h2 id="why-heading">Why this briefing matters to you</h2><p>${escapeHtml(`${company}${industry}. As a ${displayTitle(report.jobTitle)}, the strongest areas of relevance are ${themes || 'the developments closest to your work'}.`)}</p></div><dl class="profile-facts"><dt>Company context</dt><dd>${escapeHtml(profile.company.description ?? `${company}${industry}.`)}</dd><dt>Role lens</dt><dd>${escapeHtml(displayTitle(report.jobTitle))} · ${escapeHtml(profile.role.function)}</dd></dl></section>`;
}

function optionalSectionsMarkup(manifest: PublisherManifest, recommendations: ReportRecommendation[]): string {
  const additional = recommendations.slice(1);
  const labels: Record<string, string> = { 'top-developments': 'Top developments', 'companies-to-watch': 'Companies to watch', 'market-moves': 'Market moves', 'technology-developments': 'Technology developments', 'what-to-watch-next': 'What to watch next', 'from-the-archive': 'From the archive', 'more-relevant-stories': 'More relevant stories' };
  return (manifest.reportSections ?? []).filter((section) => labels[section] && additional.length > 0).map((section) => `<section class="additional-section stories-section" data-report-section="${escapeHtml(section)}" aria-labelledby="section-${escapeHtml(section)}"><p class="section-kicker">Additional reading</p><h2 class="section-heading" id="section-${escapeHtml(section)}">${escapeHtml(labels[section])}</h2><div class="story-grid">${additional.map((recommendation) => storyMarkup(recommendation, manifest)).join('')}</div></section>`).join('');
}

function identityLabel(report: ReportRecord): string {
  return `${displayTitle(report.jobTitle)} at ${displayCompany(report)}`;
}

function editSheetMarkup(report: ReportRecord): string {
  return `<div class="edit-backdrop" data-edit-backdrop hidden></div><aside class="edit-sheet" data-edit-sheet hidden role="dialog" aria-modal="true" aria-labelledby="edit-heading"><button class="sheet-close" type="button" data-cancel aria-label="Close edit profile">×</button><p class="section-kicker">Update your context</p><h2 id="edit-heading">Edit your profile</h2><p>Keep this briefing, or build a new one with a different company or role.</p><form class="edit-form" data-edit-form><label for="edit-company-url">Company website<input id="edit-company-url" name="companyUrl" value="${escapeHtml(report.companyUrl)}" required autocomplete="url"></label><label for="edit-job-title">Job role<input id="edit-job-title" name="jobTitle" value="${escapeHtml(report.jobTitle)}" required autocomplete="organization-title"></label><div class="actions"><button class="action-button" type="submit">Build a new briefing</button><button class="text-button" type="button" data-cancel>Keep this report</button></div><p class="form-status" data-form-status aria-live="polite"></p></form></aside>`;
}

export async function renderHostedRoute(documentRef: Document, registry: PublisherRegistry): Promise<void> {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'p' || !parts[1]) return;
  const publisherId = parts[1];
  const manifest = registry.get(publisherId)?.manifest;
  if (!manifest) { documentRef.body.innerHTML = '<main class="hosted-shell"><div class="hosted-inner"><div class="generation-card hosted-card"><h1>Publisher not found</h1></div></div></main>'; return; }
  const reportId = parts[2] === 'generate' ? parts[3] : parts[2];
  const isGeneration = parts[2] === 'generate';
  documentRef.body.innerHTML = routeStyle(manifest) + `<main class="hosted-shell ${reportId && !isGeneration ? 'report' : 'generation'}"><div class="hosted-inner">${reportId && isGeneration ? generationMarkup(manifest) : `<div class="generation-card hosted-card" id="hosted-app">${brandMarkup(manifest)}<p>Loading your briefing…</p></div>`}</div></main>`;
  if (!reportId) return;
  if (isGeneration) {
    const app = documentRef.querySelector<HTMLElement>('#hosted-app');
    if (!app) return;
    const stages = [...app.querySelectorAll<HTMLElement>('[data-stage]')];
    let currentStage = 0;
    const advanceStage = () => {
      stages.forEach((stage, index) => {
        stage.classList.toggle('is-active', index === currentStage);
        stage.classList.toggle('is-complete', index < currentStage);
        const marker = stage.querySelector<HTMLElement>('.stage-marker');
        if (marker) marker.textContent = index < currentStage ? '✓' : index === currentStage ? '●' : '○';
      });
      currentStage = Math.min(currentStage + 1, stages.length - 1);
    };
    const timer = setInterval(advanceStage, 850);
    const statusResponse = await fetch('/api/generations/' + encodeURIComponent(reportId) + '/status?publisherId=' + encodeURIComponent(publisherId));
    clearInterval(timer);
    if (!statusResponse.ok) { app.innerHTML = brandMarkup(manifest) + '<p class="eyebrow">Briefing unavailable</p><h1>We could not complete this briefing</h1><p class="generation-lede">Please start again and we will take another look.</p>'; return; }
    const status = await statusResponse.json() as { reportUrl?: string; companyName?: string; companyDomain?: string; jobTitle?: string };
    const context = app.querySelector<HTMLElement>('[data-generation-context]');
    const identity = app.querySelector<HTMLElement>('[data-generation-identity]');
    if (context && status.jobTitle && (status.companyName || status.companyDomain)) { context.textContent = `${displayTitle(status.jobTitle)} at ${status.companyName ?? displayTitle(status.companyDomain ?? '')}`; identity?.removeAttribute('hidden'); }
    if (status.reportUrl) window.location.assign(status.reportUrl);
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

function renderReport(documentRef: Document, manifest: PublisherManifest, report: ReportRecord, analytics: BatchingAnalyticsClient): void {
  const app = documentRef.querySelector<HTMLElement>('#hosted-app');
  if (!app) return;
  const title = displayTitle(report.jobTitle);
  const company = displayCompany(report);
  const identity = identityLabel(report);
  const reportBranding = manifest.branding.report;
  const reportBackground = 'background-color:var(--report-fallback)';
  const reportCoverStyle = `<style>.report-cover{background-image:linear-gradient(var(--report-overlay),var(--report-overlay)),${cssUrl(reportBranding?.desktopBackgroundImage)}}@media(max-width:780px){.report-cover{background-image:linear-gradient(var(--report-overlay),var(--report-overlay)),${cssUrl(reportBranding?.mobileBackgroundImage ?? reportBranding?.desktopBackgroundImage)}}}</style>`;
  const feature = report.recommendations[0];
  const additional = report.recommendations.slice(1);
  const additionalMarkup = additional.length ? `<section class="additional-section stories-section" aria-labelledby="additional-heading"><p class="section-kicker">Continue exploring</p><h2 class="section-heading" id="additional-heading">Also relevant</h2><div class="story-grid">${additional.map((recommendation) => storyMarkup(recommendation, manifest)).join('')}</div></section>` : '';
  app.className = 'report-page';
  app.innerHTML = `${reportCoverStyle}<section class="report-cover" style="${reportBackground}" aria-labelledby="report-heading"><div class="cover-content">${brandMarkup(manifest)}<p class="eyebrow">Your personalised briefing</p><h1 id="report-heading">A sharper view of what matters.</h1><p class="report-role">${escapeHtml(title)} <span>at</span> ${escapeHtml(company)}</p><button class="identity-pill cover-edit" type="button" data-edit><span class="identity-icon" aria-hidden="true">↗</span><span>${escapeHtml(identity)}</span><span aria-hidden="true">Edit</span></button><p class="cover-summary">${escapeHtml(report.generatedSummary)}</p><div class="cover-footer"><div class="report-match" aria-label="${report.overallMatchScore}% relevance"><span class="match-meter"><span>${report.overallMatchScore}%</span></span><span class="match-label">overall relevance<br><small>based on your context</small></span></div><button class="text-button cover-edit" type="button" data-share>Share report <span aria-hidden="true">↗</span></button></div></div></section><div class="context-bar" data-sticky-context aria-hidden="true"><div class="context-bar-inner"><div>${brandMarkup(manifest, 'compact')}</div><span class="context-label">${escapeHtml(identity)}</span></div><div class="bar-actions"><button class="text-button" type="button" data-edit>Edit</button><button class="action-button" type="button" data-share>Share</button></div></div><div class="report-content">${whyMattersMarkup(report)}<section class="stories-section" aria-labelledby="top-stories-heading"><div class="section-heading-row"><div><p class="section-kicker">Selected for your work</p><h2 class="section-heading" id="top-stories-heading">Top stories</h2></div><span class="section-kicker">${report.recommendations.length} recommendations</span></div>${feature ? storyMarkup(feature, manifest, true) : '<p>No strong matches were found in the current coverage.</p>'}</section>${additionalMarkup}${optionalSectionsMarkup(manifest, report.recommendations)}<div class="report-actions"><button class="action-button" type="button" data-edit>Edit profile</button><button class="text-button" type="button" data-share>Share report</button><p class="share-note" aria-live="polite" data-share-note></p></div></div>${editSheetMarkup(report)}`;

  const cover = app.querySelector<HTMLElement>('.report-cover');
  const contextBar = app.querySelector<HTMLElement>('[data-sticky-context]');
  const updateSticky = () => {
    const threshold = Math.max(240, (cover?.offsetHeight ?? 540) - 120);
    const visible = window.scrollY > threshold;
    contextBar?.classList.toggle('is-visible', visible);
    contextBar?.setAttribute('aria-hidden', String(!visible));
  };
  window.addEventListener('scroll', updateSticky, { passive: true });
  updateSticky();

  report.recommendations.forEach((recommendation, index) => analytics.track(createEvent('story_impression', report.publisherId, report.sessionId, { reportId: report.id, articleId: recommendation.article.id, articlePosition: index + 1, articleCategory: recommendation.article.categories[0] ?? 'Coverage', articleTitle: recommendation.article.title, articlePublishedAt: recommendation.article.publishedAt ?? '', rankingMode: recommendation.rankingMetadata.rankingMode })));
  app.querySelectorAll<HTMLElement>('[data-story-id]').forEach((element) => element.addEventListener('click', () => analytics.track(createEvent('story_clicked', report.publisherId, report.sessionId, { reportId: report.id, articleId: element.dataset.storyId ?? '' }))));

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
      const next = await nextResponse.json() as { generationUrl?: string; reportUrl?: string };
      if (nextResponse.ok && (next.generationUrl || next.reportUrl)) { window.location.assign(next.generationUrl ?? next.reportUrl!); return; }
      if (status) status.textContent = 'We could not start that briefing. Check the details and try again.';
    } catch { if (status) status.textContent = 'We could not reach the briefing service. Please try again.'; }
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.removeAttribute('disabled');
  });
}
