import { BatchingAnalyticsClient } from './analytics/client';
import { createEvent, type PublisherRegistry } from './core';
import type { PublisherManifest } from './publishers/manifest';
import type { ReportRecord } from './reports';

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
  return url ? 'url("' + url.replace(/"/g, '%22') + '")' : 'none';
}

function brandMarkup(manifest: PublisherManifest): string {
  const logo = safeUrl(manifest.branding.logo);
  return '<div class="hosted-brand">' + (logo ? '<img src="' + escapeHtml(logo) + '" alt="' + escapeHtml(manifest.name) + '">' : escapeHtml(manifest.name)) + '</div>';
}

function routeStyle(manifest: PublisherManifest): string {
  const loading = manifest.branding.loading;
  const report = manifest.branding.report;
  const fallback = report?.backgroundFallback ?? loading?.backgroundFallback ?? '#eef4ed';
  const textColor = report?.textColor ?? '#203329';
  return '<style>' +
    ':root{--brand:' + (manifest.branding.primaryColor ?? '#244d3b') + ';--loading-ink:' + (loading?.textColor ?? textColor) + ';--report-ink:' + (report?.textColor ?? textColor) + ';--loading-fallback:' + (loading?.backgroundFallback ?? fallback) + ';--report-fallback:' + (report?.backgroundFallback ?? fallback) + '}' +
    '*{box-sizing:border-box}body{margin:0;min-width:320px;color:var(--loading-ink);background:var(--loading-fallback);font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}a{color:inherit}' +
    '.hosted-shell{min-height:100vh;padding:clamp(28px,6vw,90px) 20px;color:var(--loading-ink);background-color:var(--loading-fallback);background-image:linear-gradient(' + (loading?.overlay ?? 'rgba(20,46,30,.42)') + ',' + (loading?.overlay ?? 'rgba(20,46,30,.42)') + '),' + cssUrl(loading?.desktopBackgroundImage) + ';background-size:cover;background-position:center}' +
    '.hosted-shell.report{color:var(--report-ink);background-color:var(--report-fallback);background-image:linear-gradient(' + (report?.overlay ?? 'rgba(20,46,30,.42)') + ',' + (report?.overlay ?? 'rgba(20,46,30,.42)') + '),' + cssUrl(report?.desktopBackgroundImage) + '}' +
    '.hosted-inner{width:min(1060px,100%);margin:auto}.hosted-card{border:1px solid rgba(255,255,255,.34);border-radius:28px;padding:clamp(24px,5vw,58px);background:rgba(255,255,255,.94);box-shadow:0 28px 80px rgba(10,33,18,.18)}' +
    '.hosted-brand{display:flex;align-items:center;gap:12px;margin-bottom:42px;color:var(--brand);font-weight:800}.hosted-brand img{max-width:170px;max-height:48px;object-fit:contain}.eyebrow{margin:0 0 12px;color:var(--brand);font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{max-width:760px;margin:0 0 18px;font:500 clamp(2.35rem,6vw,5rem)/.98 Georgia,serif;letter-spacing:-.04em}h2{margin:0 0 13px;font:500 clamp(1.6rem,3vw,2.5rem)/1.05 Georgia,serif}p{color:inherit}.context{color:inherit;font-size:1.12rem}.progress{height:7px;margin:34px 0 26px;overflow:hidden;border-radius:99px;background:#e2ebe0}.progress span{display:block;width:72%;height:100%;border-radius:inherit;background:var(--brand);animation:progress 2.4s ease-in-out infinite alternate}@keyframes progress{from{width:30%}to{width:88%}}' +
    '.report-hero{padding:clamp(24px,5vw,54px);border-radius:24px;color:#fff;background-color:#28583f;background-size:cover;background-position:center}.report-hero p,.report-hero .eyebrow{color:rgba(255,255,255,.78)}.match{display:inline-flex;margin-top:18px;padding:8px 12px;border-radius:99px;background:rgba(255,255,255,.16);font-weight:800}' +
    '.report-section{margin-top:34px}.story-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px}.story{overflow:hidden;border:1px solid #dfe8dc;border-radius:18px;background:#fff}.story img{display:block;width:100%;height:170px;object-fit:cover}.story-body{padding:20px}.story-meta{color:#708175;font-size:.74rem}.story h3{margin:10px 0;color:#244d3b;font:500 1.45rem/1.1 Georgia,serif}.why{padding:12px 14px;border-left:3px solid var(--brand);color:#53695a;font-size:.88rem}.story a,button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:10px;padding:11px 15px;color:#fff;background:var(--brand);font:inherit;text-decoration:none;cursor:pointer}button.secondary,.secondary{color:var(--brand);background:#eaf2e8}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.share-note{min-height:1.5em;color:#54715c}form{display:grid;gap:14px;max-width:560px;margin-top:24px}label{display:grid;gap:6px;color:#486050;font-weight:700}input{width:100%;border:1px solid #ccd9ca;border-radius:11px;padding:13px;font:inherit}@media(max-width:680px){.hosted-shell{background-image:linear-gradient(' + (loading?.overlay ?? 'rgba(20,46,30,.42)') + ',' + (loading?.overlay ?? 'rgba(20,46,30,.42)') + '),' + cssUrl(loading?.mobileBackgroundImage ?? loading?.desktopBackgroundImage) + '}.hosted-shell.report{background-image:linear-gradient(' + (report?.overlay ?? 'rgba(20,46,30,.42)') + ',' + (report?.overlay ?? 'rgba(20,46,30,.42)') + '),' + cssUrl(report?.mobileBackgroundImage ?? report?.desktopBackgroundImage) + '}.story-grid{grid-template-columns:1fr}}' +
    '</style>';
}

export async function renderHostedRoute(documentRef: Document, registry: PublisherRegistry): Promise<void> {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'p' || !parts[1]) return;
  const publisherId = parts[1];
  const manifest = registry.get(publisherId)?.manifest;
  if (!manifest) { documentRef.body.innerHTML = '<main class="hosted-shell"><div class="hosted-card"><h1>Publisher not found</h1></div></main>'; return; }
  const reportId = parts[2] === 'generate' ? parts[3] : parts[2];
  const isGeneration = parts[2] === 'generate';
  documentRef.body.innerHTML = routeStyle(manifest) + '<main class="hosted-shell ' + (reportId && !isGeneration ? 'report' : '') + '"><div class="hosted-inner"><div class="hosted-card" id="hosted-app">' + brandMarkup(manifest) + '<p>Loading your briefing…</p></div></div></main>';
  if (!reportId) return;
  if (parts[2] === 'generate') {
    documentRef.querySelector('#hosted-app')!.innerHTML = brandMarkup(manifest) + '<p class="eyebrow">Generation in progress</p><h1>Building your professional briefing</h1><p class="context">Understanding your company, interpreting your role and reviewing the publisher archive.</p><div class="progress" aria-label="Briefing generation in progress"><span></span></div><p>We’ll take you to the persisted report as soon as it is ready.</p>';
    const statusResponse = await fetch('/api/generations/' + encodeURIComponent(reportId) + '/status?publisherId=' + encodeURIComponent(publisherId));
    if (!statusResponse.ok) { documentRef.querySelector('#hosted-app')!.innerHTML = brandMarkup(manifest) + '<h1>Generation unavailable</h1><p>We could not load this briefing. Please start again.</p>'; return; }
    const status = await statusResponse.json() as { reportUrl?: string; companyName?: string; companyDomain?: string; jobTitle?: string };
    const context = status.jobTitle && (status.companyName || status.companyDomain) ? documentRef.querySelector<HTMLElement>('#hosted-app')?.querySelector('.context') : undefined;
    if (context) context.textContent = `${status.jobTitle} at ${status.companyName ?? status.companyDomain}`;
    if (status.reportUrl) window.location.assign(status.reportUrl);
    return;
  }
  const response = await fetch('/api/reports/' + encodeURIComponent(reportId) + '?publisherId=' + encodeURIComponent(publisherId));
  if (!response.ok) { documentRef.querySelector('#hosted-app')!.innerHTML = brandMarkup(manifest) + '<h1>Report unavailable</h1><p>This report may have expired or the link may be incorrect.</p>'; return; }
  const report = await response.json() as ReportRecord;
  const analytics = new BatchingAnalyticsClient();
  analytics.track(createEvent('report_viewed', publisherId, report.sessionId, { reportId }));
  renderReport(documentRef, manifest, report, analytics);
}

function renderReport(documentRef: Document, manifest: PublisherManifest, report: ReportRecord, analytics: BatchingAnalyticsClient): void {
  const app = documentRef.querySelector<HTMLElement>('#hosted-app');
  if (!app) return;
  const stories = report.recommendations.map((recommendation) => {
    const article = recommendation.article;
    const image = safeUrl(article.imageUrl);
    const date = article.publishedAt ? ' · ' + article.publishedAt.slice(0, 10) : '';
    return '<article class="story">' + (image ? '<img src="' + escapeHtml(image) + '" alt="" loading="lazy">' : '') + '<div class="story-body"><div class="story-meta">' + recommendation.displayScore + '% match · ' + escapeHtml(article.categories[0] ?? 'Coverage') + escapeHtml(date) + '</div><h3>' + escapeHtml(article.title) + '</h3><p>' + escapeHtml(article.description ?? article.summary ?? '') + '</p><p class="why"><strong>Why this matters to you</strong><br>' + escapeHtml(recommendation.explanation) + '</p><a href="' + escapeHtml(safeUrl(article.url)) + '" target="_blank" rel="noopener noreferrer" data-story-id="' + escapeHtml(article.id) + '">Read the original story ↗</a></div></article>';
  }).join('');
  const reportBranding = manifest.branding.report;
  const reportHeroStyle = 'background-image:linear-gradient(' + (reportBranding?.overlay ?? 'rgba(20,46,30,.42)') + ',' + (reportBranding?.overlay ?? 'rgba(20,46,30,.42)') + '),' + cssUrl(reportBranding?.desktopBackgroundImage) + ';background-color:' + (reportBranding?.backgroundFallback ?? '#28583f');
  app.innerHTML = brandMarkup(manifest) + '<section class="report-hero" style="' + reportHeroStyle + '"><p class="eyebrow">Personalised briefing</p><h1>' + escapeHtml(report.jobTitle) + ' at ' + escapeHtml(report.companyName ?? report.companyDomain) + '</h1><p>' + escapeHtml(report.generatedSummary) + '</p><span class="match">' + report.overallMatchScore + '% relevance</span></section><section class="report-section"><h2>Top stories for you</h2><div class="story-grid">' + (stories || '<p>No strong matches were found in the current coverage.</p>') + '</div></section><div class="actions"><button class="secondary" data-edit>Edit profile</button><button data-share>Share report</button></div><p class="share-note" aria-live="polite" data-share-note></p><form hidden data-edit-form><label>Company website<input name="companyUrl" value="' + escapeHtml(report.companyUrl) + '" required></label><label>Job role<input name="jobTitle" value="' + escapeHtml(report.jobTitle) + '" required></label><div class="actions"><button type="submit">Build a new briefing</button><button type="button" class="secondary" data-cancel>Edit later</button></div></form>';
  report.recommendations.forEach((recommendation, index) => analytics.track(createEvent('story_impression', report.publisherId, report.sessionId, { reportId: report.id, articleId: recommendation.article.id, articlePosition: index + 1, articleCategory: recommendation.article.categories[0] ?? 'Coverage', articleTitle: recommendation.article.title, articlePublishedAt: recommendation.article.publishedAt ?? '', rankingMode: recommendation.rankingMetadata.rankingMode })));
  app.querySelectorAll<HTMLElement>('[data-story-id]').forEach((element) => element.addEventListener('click', () => analytics.track(createEvent('story_clicked', report.publisherId, report.sessionId, { reportId: report.id, articleId: element.dataset.storyId ?? '' }))));
  app.querySelector<HTMLButtonElement>('[data-share]')?.addEventListener('click', async () => { const url = window.location.href; const canShare = typeof navigator.share === 'function'; if (canShare) await navigator.share({ title: 'My personalised briefing', url }); else await navigator.clipboard?.writeText(url); const note = app.querySelector<HTMLElement>('[data-share-note]'); if (note) note.textContent = 'Report link copied.'; analytics.track(createEvent('report_shared', report.publisherId, report.sessionId, { reportId: report.id, shareMethod: canShare ? 'native' : 'clipboard' })); });
  app.querySelector<HTMLButtonElement>('[data-edit]')?.addEventListener('click', () => { app.querySelector<HTMLElement>('[data-edit-form]')?.removeAttribute('hidden'); analytics.track(createEvent('profile_edit_clicked', report.publisherId, report.sessionId, { reportId: report.id })); });
  app.querySelector<HTMLButtonElement>('[data-cancel]')?.addEventListener('click', () => app.querySelector<HTMLElement>('[data-edit-form]')?.setAttribute('hidden', ''));
  app.querySelector<HTMLFormElement>('[data-edit-form]')?.addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const response = await fetch('/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: report.publisherId, companyUrl: String(data.get('companyUrl') ?? ''), jobTitle: String(data.get('jobTitle') ?? ''), sessionId: report.sessionId }) }); const next = await response.json() as { reportUrl?: string }; if (response.ok && next.reportUrl) window.location.assign(next.reportUrl); });
}
