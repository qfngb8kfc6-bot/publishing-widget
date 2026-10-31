import './admin.css';
import { capabilitiesFrom, modeCopy, modeLabel, type AdminCapabilities } from './admin-mode';

interface PublisherRow { publisherId: string; name: string; enabled: boolean; environment: string; sourceType: string | null; allowedOrigins: string[]; contentCheck: ContentCheck | null; textEnrichment?: TextEnrichment; analytics?: { widgetOpens: number; reportsGenerated: number; storyClicks: number; generationSuccessRate: number }; }
interface ContentCheck { checkedAt: string; reachable: boolean; sourceType: string; recordsFetched: number; accepted: number; rejected: number; duplicates: number; warnings: string[]; elapsedMs: number; sampleTitles: string[]; coverage: { image: number; publishedAt: number; description: number }; error?: { code: string; message: string; status?: number }; }
interface TextEnrichment { enabled: boolean; recordsSynced: number; backfillComplete: boolean; backfillLastPage: number; totalPages?: number; lastSyncAt?: string; lastSuccessAt?: string; lastErrorCode?: string; lastErrorAt?: string; }
interface PublisherListResponse { publishers: PublisherRow[]; persistence?: string; capabilities?: Partial<AdminCapabilities>; }
interface PublisherDetail { publisher: Record<string, any>; analytics: PublisherRow['analytics']; lastContentCheck: ContentCheck | null; embed: string; links: { analytics: string; publicDemo: string }; persistence: string; capabilities?: Partial<AdminCapabilities>; }

const root = document.querySelector<HTMLElement>('#admin-root')!;
const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const selectorValue = (value: string): string => typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
const request = async <T>(path: string, init: RequestInit = {}): Promise<{ response: Response; data: T }> => { const response = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } }); let data = {} as T; try { data = await response.json() as T; } catch { /* diagnostic rendered from status */ } return { response, data }; };

function shell(content: string): void {
  root.innerHTML = `<div class="admin-shell"><header class="topbar"><a class="wordmark" href="/">LD Systems <span>· Publisher administration</span></a><button class="quiet" id="logout" type="button">Sign out</button></header><div class="admin-layout"><aside class="sidebar"><p class="eyebrow">Internal console</p><h1>Publisher operations</h1><p class="muted">Validate content sources, inspect publisher configuration and launch scoped tests.</p><nav aria-label="Admin sections"><a href="#publishers" data-admin-view="publishers">Publishers</a><a href="#health" data-admin-view="health">Content health</a><a href="/analytics?publisher=demo">Analytics</a></nav></aside><section class="content">${content}</section></div></div>`;
  document.querySelector('#logout')?.addEventListener('click', async () => { await request('/api/admin/logout', { method: 'POST' }); renderLogin(); });
  document.querySelector<HTMLAnchorElement>('[data-admin-view="publishers"]')?.addEventListener('click', (event) => { event.preventDefault(); window.history.replaceState(null, '', '#publishers'); void renderDashboard(); });
  document.querySelector<HTMLAnchorElement>('[data-admin-view="health"]')?.addEventListener('click', (event) => { event.preventDefault(); window.history.replaceState(null, '', '#health'); void renderContentHealth(); });
}

function renderLogin(message = ''): void {
  root.innerHTML = `<div class="login-shell"><div class="login-card"><p class="eyebrow">LD Systems · internal</p><h1>Publisher administration</h1><p class="muted">Sign in to inspect publisher configuration and run server-side content checks.</p><form id="login-form"><label for="admin-password">Admin password</label><input id="admin-password" name="password" type="password" autocomplete="current-password" required maxlength="512" /><button class="primary" type="submit">Sign in</button><p class="form-message" role="alert">${escapeHtml(message)}</p></form></div></div>`;
  document.querySelector<HTMLFormElement>('#login-form')!.addEventListener('submit', async (event) => { event.preventDefault(); const password = new FormData(event.currentTarget as HTMLFormElement).get('password'); const result = await request<{ error?: string }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) }); if (result.response.ok) await renderDashboard(); else renderLogin(result.data.error === 'admin_not_configured' ? 'Admin access is not configured on this server.' : result.data.error === 'rate_limited' ? 'Too many attempts. Try again shortly.' : 'The password was not accepted.'); });
}

function checkMarkup(check: ContentCheck | null): string {
  if (!check) return '<span class="status neutral">Not checked</span>';
  return check.reachable ? `<span class="status good">Reachable · ${check.accepted} accepted</span>` : `<span class="status bad">Unavailable · ${escapeHtml(check.error?.code ?? 'check failed')}</span>`;
}

async function renderDashboard(): Promise<void> {
  const result = await request<PublisherListResponse>('/api/admin/publishers');
  if (result.response.status === 401) return renderLogin();
  if (!result.response.ok) return renderLogin('Admin data could not be loaded.');
  const rows = result.data.publishers ?? [];
  const capabilities = capabilitiesFrom(result.data);
  const createButton = capabilities.createAllowed ? '<button class="primary" id="new-publisher" type="button">Create publisher</button>' : '<button class="primary" id="new-publisher" type="button" disabled>Create publisher</button>';
  shell(`<div class="page-heading"><div><p class="eyebrow">Publisher registry</p><h2>Publishers</h2><p class="muted">Manage persistent publisher configuration, source access and approved embed origins.</p></div>${createButton}</div><div class="card mode-card" data-admin-mode="${capabilities.persistenceMode}"><div class="card-heading"><div><p class="eyebrow">Runtime registry</p><h3>${escapeHtml(modeLabel(capabilities))}</h3></div><span class="read-only">${capabilities.writable ? 'Operational' : 'Read-only'}</span></div><p class="muted">${escapeHtml(modeCopy(capabilities))}</p></div><div class="card table-card"><div class="table-wrap"><table><caption class="sr-only">Registered publishers</caption><thead><tr><th>Publisher</th><th>Content source</th><th>Health</th><th>Usage</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map((publisher) => `<tr><td><strong>${escapeHtml(publisher.name)}</strong><small>${escapeHtml(publisher.publisherId)} · ${escapeHtml(publisher.environment)} · ${publisher.enabled ? 'enabled' : 'disabled'}</small></td><td>${escapeHtml(publisher.sourceType ?? 'Unknown')}</td><td>${checkMarkup(publisher.contentCheck)}</td><td><small>${publisher.analytics ? `${publisher.analytics.widgetOpens} opens · ${publisher.analytics.reportsGenerated} reports · ${publisher.analytics.storyClicks} clicks` : 'Available in Analytics'}</small></td><td><button class="secondary open-publisher" data-publisher="${escapeHtml(publisher.publisherId)}" type="button">Manage</button></td></tr>`).join('')}</tbody></table></div></div><div class="card note-card" id="health"><p class="eyebrow">Operating model</p><h3>Persistent publisher control plane</h3><p class="muted">Credentials remain server-side. Saved source configuration, branding and approved origins are resolved by the runtime publisher store.</p></div>`);
  document.querySelector<HTMLButtonElement>('#new-publisher:not(:disabled)')?.addEventListener('click', () => void renderCreatePublisher());
  document.querySelectorAll<HTMLButtonElement>('.open-publisher').forEach((button) => button.addEventListener('click', () => void renderPublisher(button.dataset.publisher!)));
}

function textEnrichmentMarkup(publisherId: string, status: TextEnrichment | undefined): string {
  if (!status) return '';
  const backfill = status.backfillComplete ? 'backfill complete' : `backfill page ${status.backfillLastPage}${status.totalPages ? ` of ${status.totalPages}` : ''}`;
  const parts = [`Full text ${status.enabled ? 'on' : 'off'}`, `${status.recordsSynced.toLocaleString()} records synced`, backfill, `last sync ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'never'}`, `last error ${status.lastErrorCode ? `${status.lastErrorCode}${status.lastErrorAt ? ` (${new Date(status.lastErrorAt).toLocaleString()})` : ''}` : 'none'}`];
  return `<small class="health-detail" data-text-sync="${escapeHtml(publisherId)}">${escapeHtml(parts.join(' · '))}</small>`;
}

function healthRowMarkup(publisher: PublisherRow): string {
  const check = publisher.contentCheck;
  const detail = check ? `${check.recordsFetched} fetched · ${check.accepted} accepted · ${check.rejected} rejected · ${check.duplicates} duplicates${check.error ? ` · ${check.error.message}` : ''}` : 'Not checked';
  return `<tr><td><strong>${escapeHtml(publisher.name)}</strong><small>${escapeHtml(publisher.publisherId)} · ${publisher.enabled ? 'enabled' : 'disabled'}</small></td><td>${escapeHtml(publisher.sourceType ?? 'Unknown')}</td><td><span class="health-status" data-health-status="${escapeHtml(publisher.publisherId)}">${checkMarkup(check)}</span><small class="health-detail" data-health-detail="${escapeHtml(publisher.publisherId)}">${escapeHtml(detail)}</small>${textEnrichmentMarkup(publisher.publisherId, publisher.textEnrichment)}</td><td><small>${check ? escapeHtml(new Date(check.checkedAt).toLocaleString()) : 'Not checked'}</small></td><td><button class="secondary run-health-check" data-publisher="${escapeHtml(publisher.publisherId)}" type="button">Run check</button></td></tr>`;
}

async function renderContentHealth(): Promise<void> {
  let result: { response: Response; data: PublisherListResponse };
  try { result = await request<PublisherListResponse>('/api/admin/publishers'); } catch { shell('<div class="page-heading"><div><p class="eyebrow">Source operations</p><h2>Content health</h2><p class="form-message" role="alert">Publisher health could not be loaded.</p></div></div>'); return; }
  if (result.response.status === 401) return renderLogin();
  if (!result.response.ok) return renderLogin('Admin data could not be loaded.');
  const rows = result.data.publishers ?? [];
  shell(`<div class="page-heading"><div><p class="eyebrow">Source operations</p><h2>Content health</h2><p class="muted">Run bounded checks against each publisher’s saved content source. Results are current to this admin session.</p></div></div><div class="card table-card"><div class="table-wrap"><table><caption class="sr-only">Publisher content health</caption><thead><tr><th>Publisher</th><th>Source</th><th>Status</th><th>Last check</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.length ? rows.map(healthRowMarkup).join('') : '<tr><td colspan="5"><p class="muted">No publishers are registered.</p></td></tr>'}</tbody></table></div></div>`);
  document.querySelectorAll<HTMLButtonElement>('.run-health-check').forEach((button) => button.addEventListener('click', () => void runHealthCheck(button.dataset.publisher!)));
}

async function renderPublisher(publisherId: string): Promise<void> {
  const result = await request<PublisherDetail>(`/api/admin/publishers/${encodeURIComponent(publisherId)}`);
  if (!result.response.ok) return renderDashboard();
  const detail = result.data;
  const capabilities = capabilitiesFrom(detail);
  const editable = capabilities.editAllowed;
  const publisher = detail.publisher;
  const source = publisher.contentSource ? JSON.stringify(publisher.contentSource, null, 2) : '';
  shell(`<div class="page-heading"><div><a class="back" href="#publishers" id="back">← Publishers</a><p class="eyebrow">Publisher detail</p><h2>${escapeHtml(publisher.name)}</h2><p class="muted">${escapeHtml(publisher.publisherId)} · ${escapeHtml(publisher.environment)} · ${escapeHtml(modeLabel(capabilities))}</p></div><div class="heading-actions"><a class="secondary button-link" href="${escapeHtml(detail.links.analytics)}">Analytics</a><a class="secondary button-link" href="${escapeHtml(detail.links.publicDemo)}" target="_blank" rel="noreferrer">Public route</a></div></div><div class="detail-grid"><div class="card"><div class="card-heading"><div><p class="eyebrow">Configuration editor</p><h3>Saved publisher settings</h3></div><span class="read-only">${editable ? 'Save changes' : 'Read-only'}</span></div><form id="draft-form"><label for="publisher-name">Publisher name</label><input id="publisher-name" name="name" value="${escapeHtml(publisher.name)}" required ${editable ? '' : 'disabled'} /><label for="publisher-logo">Logo URL</label><input id="publisher-logo" name="logo" value="${escapeHtml(publisher.branding?.logo ?? '')}" placeholder="https://..." ${editable ? '' : 'disabled'} /><label for="publisher-accent">Primary accent</label><input id="publisher-accent" name="accent" value="${escapeHtml(publisher.branding?.primaryAccent ?? publisher.branding?.primaryColor ?? '')}" ${editable ? '' : 'disabled'} /><label class="check-label"><input id="publisher-enabled" name="enabled" type="checkbox" ${publisher.enabled !== false ? 'checked' : ''} ${editable ? '' : 'disabled'} /> Publisher enabled</label><label for="publisher-origins">Allowed origins <span class="hint">one exact origin per line</span></label><textarea id="publisher-origins" name="origins" rows="3" ${editable ? '' : 'disabled'}>${escapeHtml((publisher.allowedOrigins ?? []).join('\n'))}</textarea>${publisher.contentSource?.type === 'wvc' ? `<label class="check-label"><input id="publisher-private-excerpts" name="privateExcerpts" type="checkbox" ${publisher.contentSource.showPrivateExcerpts ? 'checked' : ''} ${editable ? '' : 'disabled'} /> ${PRIVATE_EXCERPTS_LABEL}</label><small class="muted">${PRIVATE_EXCERPTS_HINT}</small>` : ''}<label for="publisher-source">Content source JSON <span class="hint">public metadata only; use secretRef for credentials</span></label><textarea id="publisher-source" name="source" rows="12" ${editable ? '' : 'disabled'}>${escapeHtml(source)}</textarea><div class="form-actions"><button class="secondary" type="submit" ${editable ? '' : 'disabled'}>Save changes</button><button class="secondary" id="check-draft" type="button">Check draft</button><button class="primary" id="export-draft" type="button">Export config</button></div><p class="form-message" id="draft-message" role="status"></p></form></div><div class="stack"><div class="card"><div class="card-heading"><div><p class="eyebrow">Content health</p><h3>Adapter check</h3></div><button class="secondary" id="run-check" type="button">Run saved check</button></div><div id="check-output">${renderCheck(detail.lastContentCheck)}</div></div><div class="card"><p class="eyebrow">Preview & embed</p><h3>Current integration</h3><pre class="embed-code" id="embed-code">${escapeHtml(detail.embed)}</pre><button class="secondary" id="copy-embed" type="button">Copy embed code</button></div><div class="card"><p class="eyebrow">Test report</p><h3>Use the saved generation pipeline</h3><form id="report-form"><label for="company-url">Company or website</label><input id="company-url" name="companyUrl" type="text" value="https://ldsystems.uk/" placeholder="Nike or nike.com" autocomplete="organization" required /><label for="job-title">Job role</label><input id="job-title" name="jobTitle" value="Technology professional" required /><button class="primary" type="submit">Generate test briefing</button><p class="form-message" id="report-message" role="status"></p></form></div></div></div>`);
  document.querySelector('#back')?.addEventListener('click', (event) => { event.preventDefault(); void renderDashboard(); });
  document.querySelector<HTMLFormElement>('#draft-form')!.addEventListener('submit', (event) => void saveDraft(event, publisher));
  document.querySelector<HTMLButtonElement>('#check-draft')!.addEventListener('click', () => void runDraftCheck(publisherId, publisher));
  document.querySelector<HTMLButtonElement>('#export-draft')!.addEventListener('click', () => void exportDraft(publisher));
  document.querySelector<HTMLButtonElement>('#run-check')!.addEventListener('click', () => void runCheck(publisherId));
  document.querySelector<HTMLButtonElement>('#copy-embed')!.addEventListener('click', async () => { await navigator.clipboard?.writeText(detail.embed); document.querySelector('#copy-embed')!.textContent = 'Copied'; });
  document.querySelector<HTMLFormElement>('#report-form')!.addEventListener('submit', (event) => void runTestReport(event, publisherId));
}

function renderCheck(check: ContentCheck | null): string { if (!check) return '<p class="muted">No check has run for this publisher.</p>'; const coverage = check.coverage ?? { image: 0, publishedAt: 0, description: 0 }; const sampleTitles = Array.isArray(check.sampleTitles) ? check.sampleTitles : []; return `<div class="check-summary ${check.reachable ? 'is-good' : 'is-bad'}"><strong>${check.reachable ? 'Source reachable' : 'Source unavailable'}</strong><span>${check.recordsFetched} fetched · ${check.accepted} accepted · ${check.rejected} rejected · ${check.duplicates} duplicates · ${check.elapsedMs}ms</span></div><dl class="coverage"><div><dt>Images</dt><dd>${coverage.image}%</dd></div><div><dt>Dates</dt><dd>${coverage.publishedAt}%</dd></div><div><dt>Descriptions</dt><dd>${coverage.description}%</dd></div></dl>${sampleTitles.length ? `<h4>Sample titles</h4><ul class="sample-list">${sampleTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul>` : ''}${check.error ? `<p class="form-message" role="alert">${escapeHtml(check.error.message)}</p>` : ''}`; }

function draftFromForm(publisher: Record<string, any>): Record<string, any> { const form = new FormData(document.querySelector('#draft-form') as HTMLFormElement); let source: unknown; const sourceText = String(form.get('source') ?? '').trim(); if (sourceText) source = JSON.parse(sourceText); const privateExcerpts = document.querySelector<HTMLInputElement>('#publisher-private-excerpts'); if (privateExcerpts && source && typeof source === 'object' && (source as Record<string, unknown>).type === 'wvc') { if (privateExcerpts.checked) (source as Record<string, unknown>).showPrivateExcerpts = true; else delete (source as Record<string, unknown>).showPrivateExcerpts; } const draft: Record<string, any> = { ...publisher, name: String(form.get('name') ?? '').trim(), enabled: document.querySelector<HTMLInputElement>('#publisher-enabled')?.checked ?? true, branding: { ...publisher.branding, logo: String(form.get('logo') ?? '').trim() || undefined, primaryAccent: String(form.get('accent') ?? '').trim() || undefined }, allowedOrigins: String(form.get('origins') ?? '').split('\n').map((value) => value.trim()).filter(Boolean), contentSource: source }; delete draft.admin; return draft; }
async function saveDraft(event: SubmitEvent, publisher: Record<string, any>): Promise<void> { event.preventDefault(); const message = document.querySelector('#draft-message')!; try { const draft = draftFromForm(publisher); const result = await request<{ publisher?: Record<string, any>; error?: string }>(`/api/admin/publishers/${encodeURIComponent(publisher.publisherId)}/config`, { method: 'PATCH', body: JSON.stringify(draft) }); message.textContent = result.response.ok ? 'Publisher saved.' : result.data.error ?? 'Publisher could not be saved.'; if (result.response.ok) await renderPublisher(publisher.publisherId); } catch { message.textContent = 'Content source JSON is not valid.'; } }
async function exportDraft(publisher: Record<string, any>): Promise<void> { const message = document.querySelector('#draft-message')!; try { const draft = draftFromForm(publisher); const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${publisher.publisherId}-publisher-manifest.json`; link.click(); URL.revokeObjectURL(link.href); message.textContent = 'Safe manifest exported.'; } catch { message.textContent = 'Content source JSON is not valid.'; } }
async function runDraftCheck(publisherId: string, publisher: Record<string, any>): Promise<void> { const output = document.querySelector('#check-output')!; try { const draft = draftFromForm(publisher); output.innerHTML = '<p class="muted">Checking the draft source…</p>'; const result = await request<ContentCheck>(`/api/admin/publishers/${encodeURIComponent(publisherId)}/content-check`, { method: 'POST', body: JSON.stringify(draft) }); output.innerHTML = renderCheck(result.data); } catch { output.innerHTML = '<p class="form-message" role="alert">Content source JSON is not valid.</p>'; } }
function checkFailureMarkup(response: Pick<Response, 'status'>, message?: string): string { const detail = message ?? (response.status ? `Content check failed (HTTP ${response.status}).` : 'Content check failed.'); return `<p class="form-message" role="alert">${escapeHtml(detail)}</p>`; }
function applyHealthResult(publisherId: string, result: { response: Response; data: ContentCheck }): void { const value = selectorValue(publisherId); const status = document.querySelector(`[data-health-status="${value}"]`); const detail = document.querySelector(`[data-health-detail="${value}"]`); if (!status || !detail) return; if (result.data && typeof result.data.reachable === 'boolean') { status.innerHTML = checkMarkup(result.data); detail.textContent = `${result.data.recordsFetched} fetched · ${result.data.accepted} accepted · ${result.data.rejected} rejected · ${result.data.duplicates} duplicates${result.data.error ? ` · ${result.data.error.message}` : ''}`; return; } status.innerHTML = checkFailureMarkup(result.response); detail.textContent = 'Check failed'; }
async function runHealthCheck(publisherId: string): Promise<void> { const value = selectorValue(publisherId); const button = document.querySelector<HTMLButtonElement>(`.run-health-check[data-publisher="${value}"]`); const status = document.querySelector(`[data-health-status="${value}"]`); const detail = document.querySelector(`[data-health-detail="${value}"]`); if (!button || !status || !detail) return; button.disabled = true; button.textContent = 'Checking…'; status.innerHTML = '<span class="status neutral">Checking…</span>'; detail.textContent = 'Contacting saved source…'; try { const result = await request<ContentCheck>(`/api/admin/publishers/${encodeURIComponent(publisherId)}/content-check`, { method: 'POST' }); applyHealthResult(publisherId, result); } catch { status.innerHTML = checkFailureMarkup({ status: 0 }, 'Content check could not be completed.'); detail.textContent = 'Check failed'; } finally { button.disabled = false; button.textContent = 'Run check'; } }
async function runCheck(publisherId: string): Promise<void> { const output = document.querySelector('#check-output')!; output.innerHTML = '<p class="muted">Checking the configured adapter…</p>'; try { const result = await request<ContentCheck>(`/api/admin/publishers/${encodeURIComponent(publisherId)}/content-check`, { method: 'POST' }); output.innerHTML = result.data && typeof result.data.reachable === 'boolean' ? renderCheck(result.data) : checkFailureMarkup(result.response); } catch { output.innerHTML = '<p class="form-message" role="alert">Content check could not be completed.</p>'; } }
async function runTestReport(event: SubmitEvent, publisherId: string): Promise<void> { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const message = document.querySelector('#report-message')!; message.textContent = 'Generating with the production report service…'; const result = await request<{ reportUrl?: string; generationUrl?: string; error?: string }>(`/api/admin/publishers/${encodeURIComponent(publisherId)}/test-report`, { method: 'POST', body: JSON.stringify({ companyUrl: form.get('companyUrl'), jobTitle: form.get('jobTitle') }) }); if (result.response.ok && result.data.reportUrl) { message.innerHTML = `Complete: <a href="${escapeHtml(result.data.reportUrl)}" target="_blank" rel="noreferrer">open report</a>`; } else if (result.data.error === 'generation_unavailable') message.textContent = 'Generation is unavailable: the saved publisher source is not reachable or is not configured for this server.'; else message.textContent = result.data.error ?? 'Generation failed.'; }

const PRIVATE_EXCERPTS_LABEL = 'Show text excerpt as description for subscriber-only stories';
const PRIVATE_EXCERPTS_HINT = 'Off: subscriber-only stories show headline, category and date only. Free stories always show their first one or two sentences.';

/** Guided setup source choices, recommended first. */
const SOURCE_KINDS = [
  { id: 'wvc', label: 'WVC API (recommended)', hint: 'The publisher’s story-list API is the catalogue; full text stays server-side.' },
  { id: 'wvc-rss', label: 'WVC API + RSS', hint: 'The API is the catalogue; the RSS feed adds images and categories.' },
  { id: 'rss', label: 'RSS', hint: 'A public RSS or Atom feed.' },
  { id: 'sitemap', label: 'Sitemap', hint: 'A sitemap index plus article pages.' },
] as const;

function hostOf(value: string): string { try { return new URL(value).hostname; } catch { return ''; } }

function sourceFromForm(form: FormData): Record<string, any> {
  const overrideText = String(form.get('source') ?? '').trim();
  if (overrideText) return JSON.parse(overrideText);
  const kind = String(form.get('sourceKind') ?? 'wvc');
  const value = (name: string) => String(form.get(name) ?? '').trim();
  if (kind === 'wvc' || kind === 'wvc-rss') {
    const baseUrl = value('wvcBaseUrl');
    const imageHosts = value('wvcImageHosts').split(/[\s,]+/).filter(Boolean);
    return { type: 'wvc', baseUrl, profileName: value('wvcProfile'), pageSize: Number(value('wvcPageSize') || 50), secretRef: `env:${value('wvcSecretEnv')}`, allowedHostnames: [hostOf(baseUrl)].filter(Boolean), ...(imageHosts.length ? { imageHostnames: [hostOf(baseUrl), ...imageHosts].filter(Boolean) } : {}), ...(form.get('wvcPrivateExcerpts') ? { showPrivateExcerpts: true } : {}), ...(kind === 'wvc-rss' ? { rss: { feedUrl: value('feedUrl') } } : {}) };
  }
  if (kind === 'rss') return { type: 'rss', feedUrl: value('feedUrl'), allowedHostnames: [hostOf(value('feedUrl'))].filter(Boolean), deriveCategoryFromUrl: true };
  return { type: 'sitemap', sitemapUrl: value('sitemapUrl'), allowedHostnames: [hostOf(value('sitemapUrl'))].filter(Boolean) };
}

function newPublisherManifest(): Record<string, any> { const form = new FormData(document.querySelector('#new-publisher-form') as HTMLFormElement); const publisherId = String(form.get('publisherId') ?? '').trim(); const name = String(form.get('name') ?? '').trim(); const source = sourceFromForm(form); const accent = String(form.get('accent') ?? '').trim() || '#36566c'; return { publisherId, name, enabled: true, environment: 'production', publisherConfigVersion: '1', branding: { primaryAccent: accent, widgetTitle: `Build your ${name} briefing`, introductoryCopy: `Tell us where you work and what you do. We’ll build a briefing from ${name} coverage.` }, content: { adapterId: source.type === 'static-demo' ? 'demo' : source.type, resultLimit: 8, candidateRetrievalLimit: 30, searchBehavior: 'keywords' }, contentSource: source, results: { heading: 'Stories selected for you', description: 'A few relevant places to begin, chosen from the publisher’s coverage.', maximumRecommendations: 8, openArticleInNewTab: true }, ranking: { mode: 'deterministic', deterministicWeight: 1, semanticWeight: 0 }, features: { aiEnabled: false, explanationsEnabled: true, analyticsEnabled: true }, allowedOrigins: String(form.get('origins') ?? '').split('\n').map((value) => value.trim()).filter(Boolean) }; }

interface WvcInspection { reachable: boolean; errorCode?: string; totalPages?: number; totalRecords?: number; lastPage?: { page: number; stories: number; newestDatePublished?: string; privateCount: number; textLength?: { min: number; median: number; max: number }; coverage: { title: number; url: number; publishedAt: number; description: number; image: number }; titleField?: string; sampleTitles: string[] } }

/** Test step output: counts, dates, lengths and coverage only. */
function renderSourceTest(data: { wvc?: WvcInspection; rss?: ContentCheck; content?: ContentCheck; error?: string }): string {
  if (data.error) return `<p class="form-message" role="alert">${escapeHtml(data.error)}</p>`;
  if (data.content) return renderCheck(data.content);
  const wvc = data.wvc;
  if (!wvc) return '<p class="form-message" role="alert">The source could not be tested.</p>';
  if (!wvc.reachable) return `<div class="check-summary is-bad"><strong>WVC API not usable</strong><span>${escapeHtml(wvc.errorCode ?? 'unknown error')}</span></div>`;
  const last = wvc.lastPage;
  const row = (label: string, value: string) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  const rows = [
    row('Pages', String(wvc.totalPages ?? 'n/a')), row('Stories', String(wvc.totalRecords ?? 'n/a')),
    ...(last ? [
      row('Newest story', last.newestDatePublished ? new Date(last.newestDatePublished).toLocaleDateString() : 'n/a'),
      row(`Newest page (${last.page})`, `${last.stories} stories · ${last.privateCount} subscriber-only`),
      row('Text length', last.textLength ? `min ${last.textLength.min} · median ${last.textLength.median} · max ${last.textLength.max} chars` : 'n/a'),
      row('Titles', `${last.coverage.title}%${last.titleField ? ` (${last.titleField})` : ' (no title field found: set titleFields)'}`),
      row('Story URLs', `${last.coverage.url}%`), row('Dates', `${last.coverage.publishedAt}%`), row('Descriptions', `${last.coverage.description}%`), row('Images in text', `${last.coverage.image}%`),
    ] : []),
  ];
  const titles = last?.sampleTitles.length ? `<h4>Sample titles</h4><ul class="sample-list">${last.sampleTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join('')}</ul>` : '';
  const rss = data.rss ? `<h4>RSS supplement</h4>${renderCheck(data.rss)}` : '';
  return `<div class="check-summary is-good"><strong>WVC API reachable</strong><span>Key read from the server environment; it is never shown.</span></div><dl class="coverage">${rows.join('')}</dl>${titles}${rss}`;
}

async function runSourceTest(): Promise<void> {
  const output = document.querySelector('#source-test-output')!;
  output.innerHTML = '<p class="muted">Testing the source…</p>';
  try {
    const result = await request<{ wvc?: WvcInspection; rss?: ContentCheck; content?: ContentCheck; error?: string }>('/api/admin/source-test', { method: 'POST', body: JSON.stringify(newPublisherManifest()) });
    output.innerHTML = renderSourceTest(result.data ?? { error: `Source test failed (HTTP ${result.response.status}).` });
  } catch {
    output.innerHTML = '<p class="form-message" role="alert">Source configuration is not valid JSON.</p>';
  }
}

function showSourceFields(): void {
  const kind = (document.querySelector<HTMLInputElement>('input[name="sourceKind"]:checked')?.value) ?? 'wvc';
  document.querySelectorAll<HTMLElement>('[data-source-kinds]').forEach((group) => {
    const visible = group.dataset.sourceKinds!.split(' ').includes(kind);
    group.hidden = !visible;
    group.querySelectorAll<HTMLInputElement>('input[data-required]').forEach((input) => { input.required = visible; });
  });
}

async function renderCreatePublisher(): Promise<void> {
  const kinds = SOURCE_KINDS.map((kind, index) => `<label class="source-kind"><input type="radio" name="sourceKind" value="${kind.id}"${index === 0 ? ' checked' : ''} /> <strong>${index + 1}. ${escapeHtml(kind.label)}</strong><small>${escapeHtml(kind.hint)}</small></label>`).join('');
  shell(`<div class="page-heading"><div><a class="back" href="#publishers" id="back">← Publishers</a><p class="eyebrow">Publisher onboarding</p><h2>Add publisher</h2><p class="muted">Create a persistent publisher configuration. Secrets are referenced by name and remain in the server environment.</p></div></div><div class="card"><form id="new-publisher-form"><label for="new-publisher-id">Publisher ID</label><input id="new-publisher-id" name="publisherId" pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*" required /><label for="new-publisher-name">Publisher name</label><input id="new-publisher-name" name="name" required /><fieldset class="source-kinds"><legend>Content source</legend>${kinds}</fieldset>`
    + `<div data-source-kinds="wvc wvc-rss"><label for="wvc-base">WVC API base URL</label><input id="wvc-base" name="wvcBaseUrl" type="url" data-required placeholder="https://www.publisher.example/abaapi/storylistpagination/json" /><label for="wvc-profile">Profile name</label><input id="wvc-profile" name="wvcProfile" value="Editorial Finder" data-required /><label for="wvc-page-size">Page size</label><input id="wvc-page-size" name="wvcPageSize" type="number" min="50" max="200" value="50" data-required /><label for="wvc-secret">Key environment variable</label><input id="wvc-secret" name="wvcSecretEnv" pattern="[A-Z][A-Z0-9_]*_WVC_API_KEY" placeholder="ACME_WVC_API_KEY" data-required /><small class="muted">Set this variable on the server. The key itself is never entered here.</small><label for="wvc-image-hosts">Extra image hosts (optional)</label><input id="wvc-image-hosts" name="wvcImageHosts" placeholder="images.publisher.example" /><label class="check-label"><input id="wvc-private-excerpts" name="wvcPrivateExcerpts" type="checkbox" /> ${PRIVATE_EXCERPTS_LABEL}</label><small class="muted">${PRIVATE_EXCERPTS_HINT}</small></div>`
    + `<div data-source-kinds="wvc-rss rss" hidden><label for="feed-url">RSS feed URL</label><input id="feed-url" name="feedUrl" type="url" data-required placeholder="https://www.publisher.example/feed.rss" /></div>`
    + `<div data-source-kinds="sitemap" hidden><label for="sitemap-url">Sitemap URL</label><input id="sitemap-url" name="sitemapUrl" type="url" data-required placeholder="https://www.publisher.example/sitemap.xml" /></div>`
    + `<label for="new-publisher-accent">Primary accent</label><input id="new-publisher-accent" name="accent" value="#36566c" /><label for="new-publisher-origins">Allowed origins</label><textarea id="new-publisher-origins" name="origins" rows="3" placeholder="https://publisher.example"></textarea><label for="new-publisher-source">Optional source JSON override</label><textarea id="new-publisher-source" name="source" rows="6" placeholder='{"type":"wvc",...}'></textarea><div class="form-actions"><button class="secondary" type="button" id="test-source">Test</button><button class="primary" type="submit">Create publisher</button></div><div id="source-test-output" aria-live="polite"></div><p class="form-message" id="new-publisher-message" role="status"></p></form></div>`);
  document.querySelector('#back')?.addEventListener('click', (event) => { event.preventDefault(); void renderDashboard(); });
  document.querySelectorAll<HTMLInputElement>('input[name="sourceKind"]').forEach((input) => input.addEventListener('change', showSourceFields));
  showSourceFields();
  document.querySelector<HTMLButtonElement>('#test-source')!.addEventListener('click', () => void runSourceTest());
  document.querySelector<HTMLFormElement>('#new-publisher-form')!.addEventListener('submit', async (event) => { event.preventDefault(); const message = document.querySelector('#new-publisher-message')!; try { const result = await request<{ publisher?: { publisherId: string }; error?: string }>('/api/admin/publishers', { method: 'POST', body: JSON.stringify(newPublisherManifest()) }); if (result.response.ok && result.data.publisher?.publisherId) await renderPublisher(result.data.publisher.publisherId); else message.textContent = result.data.error ?? 'Publisher could not be created.'; } catch { message.textContent = 'Publisher configuration is not valid JSON.'; } });
}

async function start(): Promise<void> { const session = await request<{ authenticated: boolean; configured: boolean }>('/api/admin/session'); if (!session.data.authenticated) return renderLogin(session.data.configured ? '' : 'Admin access is not configured on this server.'); await renderDashboard(); }
void start();
