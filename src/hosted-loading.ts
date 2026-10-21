import { createEvent, createSessionId, type AnalyticsClient, type AnalyticsEventName, type AnalyticsMetadata } from './core';
import type { PublisherManifest } from './publishers/manifest';
import { GENERATION_STAGES, type GenerationDetails, type GenerationStage } from './reports/generation-jobs';
import { generationInputMessage } from './widget/messages';

/**
 * The hosted loading page (/p/:publisherId/generate/:id). It polls the generation status and shows the real
 * pipeline stages; progress is weighted by typical stage durations and, within a stage, creeps toward the next
 * milestone without reaching it. Browser code: never import server modules here.
 */

/** Share of the progress bar per stage, from typical production stage durations. Sums to 100. */
export const STAGE_WEIGHTS = [10, 22, 6, 25, 32, 5] as const;
/** Typical stage durations (ms): how fast progress creeps within a stage. */
export const STAGE_TYPICAL_MS = [900, 2_500, 600, 3_000, 4_500, 400] as const;
/** Within a stage progress approaches, but never passes, this share of the stage's span. */
const MAX_STAGE_SHARE = 0.95;

/**
 * Progress (0–100) for a number of completed stages and the time spent in the active one. Within a stage it
 * follows t / (t + typical): halfway after a typical duration, still moving long after, never at the milestone.
 */
export function generationProgress(completedCount: number, activeElapsedMs: number, complete = false): number {
  if (complete) return 100;
  const count = Math.max(0, Math.min(completedCount, STAGE_WEIGHTS.length));
  const base = STAGE_WEIGHTS.slice(0, count).reduce((sum, weight) => sum + weight, 0);
  if (count >= STAGE_WEIGHTS.length) return 99;
  const elapsed = Math.max(0, activeElapsedMs);
  const share = MAX_STAGE_SHARE * (elapsed / (elapsed + STAGE_TYPICAL_MS[count]));
  return base + STAGE_WEIGHTS[count] * share;
}

export interface GenerationStatusPayload {
  status: 'running' | 'complete' | 'failed';
  stage?: string;
  completedStages?: string[];
  details?: GenerationDetails;
  reportUrl?: string;
  error?: string;
  retryable?: boolean;
  sessionId?: string;
}

export interface GenerationPageOptions {
  fetchImpl?: typeof fetch;
  analytics?: AnalyticsClient;
  /** Leaves the loader; replaces the history entry so Back does not return to it. */
  navigate?: (url: string) => void;
  now?: () => number;
  reducedMotion?: boolean;
  pollMs?: number;
  timeoutMs?: number;
  messageMs?: number;
  readyMs?: number;
  tickMs?: number;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' })[character] ?? character);
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

/** "head of retail" → "Head of Retail"; acronyms stay as typed. Matches the report's identity pill. */
function displayTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().split(' ').map((word, index) => {
    if (/^[A-Z\d-]{2,}$/.test(word) || !word) return word;
    if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

/** "a Head of Retail", "an Editor", "an HR Director". */
function withArticle(role: string): string {
  const first = role.split(' ')[0] ?? '';
  const acronym = /^[A-Z]{2,}$/.test(first);
  return `${(acronym ? /^[AEFHILMNORSX]/.test(first) : /^[aeiou]/i.test(first)) ? 'an' : 'a'} ${role}`;
}

interface StageCopy { label: string; messages: string[] }

/** Step labels and the rotating sub-messages for each stage. Each message describes something the pipeline does. */
function stageCopy(details: GenerationDetails, publisherName: string): StageCopy[] {
  const company = details.companyName;
  const role = details.jobTitle ? displayTitle(details.jobTitle) : undefined;
  const articles = details.articlesSearched ? `${details.articlesSearched.toLocaleString('en-GB')} ${publisherName} articles` : `${publisherName} articles`;
  return [
    { label: company ? `Understanding ${company}` : 'Understanding your company', messages: [company ? `Reading ${company}’s public website` : 'Reading your company’s public website', company ? `Noting the market ${company} works in` : 'Noting the market your company works in'] },
    { label: role ? `Mapping what ${withArticle(role)} focuses on` : 'Mapping what your role focuses on', messages: ['Identifying the topics your role covers', 'Separating core topics from adjacent ones', 'Adding the vocabulary your field uses'] },
    { label: `Searching ${articles}`, messages: [`Scanning the full ${publisherName} archive`, 'Looking beyond the latest headlines'] },
    { label: 'Ranking the stories that matter most to you', messages: ['Scoring each story against your role', 'Giving recent coverage extra weight', 'Setting aside loosely related stories'] },
    { label: 'Writing your briefing', messages: ['Spotting patterns across stories', 'Comparing competitor moves', 'Checking what’s changed recently', 'Explaining why each story matters to you', 'Summarising the themes in your coverage'] },
    { label: 'Ready', messages: ['Saving your briefing'] },
  ];
}

const FAILURE_COPY: Record<string, string> = {
  generation_interrupted: 'Our service was interrupted while building your briefing. Trying again usually works.',
  generation_timeout: 'This is taking longer than usual. You can try again now.',
  client_timeout: 'This is taking longer than usual. You can try again now.',
  generation_not_found: 'We couldn’t find this briefing. The link may have expired; you can start a new one.',
  company_resolution_failed: 'We couldn’t look up your company. Check the name or enter its website.',
  company_resolution_timeout: 'Looking up your company took too long. Try again, or enter its website.',
};

function sharedStyles(): string {
  return `<style>
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.loading-frame .generation-inner{transition:opacity .35s ease,transform .35s ease}.loading-frame .generation-logo .hosted-brand{margin-bottom:clamp(24px,5vh,56px)}.loading-frame .generation-inner h1{font-size:clamp(2.4rem,6vw,4.8rem);outline:none}.loading-frame .generation-subtitle{min-height:1.5em;margin-top:18px}
.loading-panel{width:min(560px,100%);margin:clamp(26px,5vh,44px) auto 0;padding:20px 24px 18px;border:1px solid rgba(255,255,255,.18);border-radius:24px;background:rgba(10,14,40,.3);box-shadow:0 18px 50px rgba(10,14,40,.18);backdrop-filter:blur(14px);text-align:left}
.loading-steps{display:grid;gap:2px;margin:0;padding:0;list-style:none}.loading-step{display:grid;grid-template-columns:24px minmax(0,1fr);gap:13px;align-items:start;padding:7px 0;color:rgba(255,255,255,.48);transition:color .4s ease}.loading-step[data-state=active]{color:#fff}.loading-step[data-state=complete]{color:rgba(255,255,255,.84)}
.loading-marker{position:relative;display:grid;place-items:center;width:22px;height:22px;margin-top:1px;border:1.5px solid rgba(255,255,255,.32);border-radius:50%;transition:background .35s ease,border-color .35s ease}.loading-step[data-state=active] .loading-marker{border-color:#fff}.loading-step[data-state=active] .loading-marker::before{width:8px;height:8px;border-radius:50%;background:#fff;content:""}.loading-step[data-state=active] .loading-marker::after{position:absolute;inset:-6px;border:1.5px solid rgba(255,255,255,.45);border-radius:50%;content:"";animation:loading-pulse 1.8s ease-out infinite}.loading-step[data-state=complete] .loading-marker{border-color:#fff;background:#fff}
.loading-check{color:var(--brand);font-size:.7rem;font-weight:900;opacity:0;transform:scale(.5);transition:opacity .3s ease,transform .3s ease}.loading-step[data-state=complete] .loading-check{opacity:1;transform:none}.loading-step[data-state=active] .loading-check{display:none}
.loading-step-label{display:block;font-size:.95rem;font-weight:650;line-height:1.35}.loading-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.loading-chips:empty{display:none}.loading-chip{padding:4px 10px;border:1px solid rgba(255,255,255,.24);border-radius:999px;color:#fff;background:rgba(255,255,255,.1);font-size:.74rem;font-weight:650;opacity:0;transform:translateY(4px);animation:loading-chip-in .45s ease forwards;animation-delay:calc(var(--i) * 90ms)}
.loading-progress{height:4px;margin:16px 0 0;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.18)}.loading-progress span{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#b8a7ff,#12a8b4);transition:width .3s linear}
.loading-message{min-height:1.4em;margin:12px 0 0;color:rgba(255,255,255,.72);font-size:.84rem;transition:opacity .25s ease}.loading-message.is-fading{opacity:0}
.loading-frame.is-ready .loading-progress span{background:#fff}.loading-frame.is-leaving .generation-inner{opacity:0;transform:translateY(-8px)}
.loading-failure{width:min(560px,100%);margin:clamp(26px,5vh,44px) auto 0;padding:24px;border:1px solid rgba(255,255,255,.22);border-radius:24px;background:rgba(10,14,40,.4);backdrop-filter:blur(14px);text-align:left}.loading-failure h2{margin:0 0 8px;color:#fff;font:650 1.35rem/1.2 var(--font);font-weight:650;letter-spacing:-.02em;outline:none}.loading-failure p{margin:0;color:rgba(255,255,255,.78);font-size:.92rem}.loading-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.loading-actions button,.loading-edit button{min-height:44px;padding:10px 18px;border:1px solid rgba(255,255,255,.5);border-radius:999px;color:#fff;background:transparent;font-size:.88rem;font-weight:750}.loading-actions button.is-primary,.loading-edit button.is-primary{border-color:#fff;color:var(--brand);background:#fff}.loading-actions button:disabled,.loading-edit button:disabled{cursor:progress;opacity:.6}
.loading-edit{display:grid;gap:12px;margin-top:18px}.loading-edit label{display:grid;gap:6px;color:rgba(255,255,255,.82);font-size:.78rem;font-weight:750}.loading-edit input{width:100%;min-height:44px;padding:10px 13px;border:1px solid rgba(255,255,255,.3);border-radius:12px;color:#151a3a;background:#fff}.loading-edit-status{min-height:1.3em;margin:0;color:#fff;font-size:.84rem}
@keyframes loading-pulse{from{opacity:.9;transform:scale(.8)}to{opacity:0;transform:scale(1.35)}}@keyframes loading-chip-in{to{opacity:1;transform:none}}
@media(max-width:520px){.loading-panel,.loading-failure{padding:16px 16px 14px;border-radius:20px}.loading-step-label{font-size:.88rem}.loading-frame .generation-inner h1{font-size:clamp(2.1rem,10vw,3rem)}}
@media(prefers-reduced-motion:reduce){.loading-step,.loading-marker,.loading-check,.loading-progress span,.loading-message,.loading-frame .generation-inner{transition:none}.loading-step[data-state=active] .loading-marker::after{display:none;animation:none}.loading-chip{opacity:1;transform:none;animation:none}}
.loading-frame.reduced-motion .loading-step,.loading-frame.reduced-motion .loading-marker,.loading-frame.reduced-motion .loading-check,.loading-frame.reduced-motion .loading-progress span,.loading-frame.reduced-motion .loading-message,.loading-frame.reduced-motion .generation-inner{transition:none}.loading-frame.reduced-motion .loading-step[data-state=active] .loading-marker::after{display:none;animation:none}.loading-frame.reduced-motion .loading-chip{opacity:1;transform:none;animation:none}
</style>`;
}

/** Markup for the loading page frame. brand is the publisher brand markup from the hosted shell. */
export function generationPageMarkup(manifest: PublisherManifest, brand: string, legal: string): string {
  const poweredBy = manifest.poweredBy === false ? '' : `<span class="generation-powered">Powered by ${escapeHtml(manifest.name)}</span>`;
  const steps = stageCopy({}, manifest.name).map((copy, index) => `<li class="loading-step" data-step="${index}" data-state="${index === 0 ? 'active' : 'pending'}"><span class="loading-marker" aria-hidden="true"><span class="loading-check">✓</span></span><span><span class="loading-step-label" data-step-label>${escapeHtml(copy.label)}</span>${index === 1 ? '<span class="loading-chips" data-theme-chips></span>' : ''}<span class="sr-only" data-step-state>${index === 0 ? 'In progress' : 'Not started'}</span></span></li>`).join('');
  return `${sharedStyles()}<section class="generation-frame hosted-card loading-frame" id="hosted-app" aria-labelledby="generation-heading" data-loading-state="running"><div class="generation-inner"><div class="generation-logo">${brand}</div><p class="generation-eyebrow">Personalised intelligence</p><h1 id="generation-heading" tabindex="-1" data-loading-heading>Building your briefing</h1><p class="generation-subtitle" data-loading-identity>${escapeHtml(manifest.branding.introductoryCopy ?? 'A focused view of the coverage most relevant to your work.')}</p><div class="loading-panel" data-loading-panel aria-busy="true"><ol class="loading-steps" aria-label="Briefing progress steps">${steps}</ol><div class="loading-progress" role="progressbar" aria-label="Briefing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-loading-progress><span data-progress-fill></span></div><p class="loading-message" data-loading-message aria-hidden="true"></p><p class="sr-only" aria-live="polite" data-loading-live></p></div><div class="loading-failure" data-loading-failure hidden><h2 tabindex="-1" data-failure-heading>We couldn’t finish your briefing</h2><p data-failure-message></p><div class="loading-actions"><button type="button" class="is-primary" data-retry>Try again</button><button type="button" data-edit>Edit details</button></div><form class="loading-edit" data-edit-form hidden><label for="loading-company">Company or website<input id="loading-company" name="companyUrl" type="text" autocomplete="organization" required></label><label for="loading-role">Job role<input id="loading-role" name="jobTitle" type="text" autocomplete="organization-title" required></label><div class="loading-actions"><button type="submit" class="is-primary">Build my briefing</button></div><p class="loading-edit-status" data-edit-status aria-live="polite"></p></form></div></div><div class="generation-footer">${poweredBy}<span class="generation-legal">${legal}</span></div></section>`;
}

/**
 * Drives the loading page: polls status, updates stages, progress, chips and messages, records analytics, and
 * leaves for the report (replacing this history entry) or shows a failure with Retry and Edit.
 * Returns a stop function (tests and page teardown).
 */
export function runGenerationPage(root: HTMLElement, manifest: PublisherManifest, publisherId: string, generationId: string, options: GenerationPageOptions = {}): () => void {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Date.now());
  const navigate = options.navigate ?? ((url: string) => window.location.replace(url));
  const pollMs = options.pollMs ?? 600;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const messageMs = options.messageMs ?? 2_500;
  const tickMs = options.tickMs ?? 120;
  const reducedMotion = options.reducedMotion ?? (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const readyMs = options.readyMs ?? (reducedMotion ? 300 : 900);
  const frame = root.querySelector<HTMLElement>('.loading-frame') ?? root;
  frame.classList.toggle('reduced-motion', reducedMotion);
  frame.dataset.reducedMotion = String(reducedMotion);
  const query = <T extends HTMLElement>(selector: string) => frame.querySelector<T>(selector);
  const steps = [...frame.querySelectorAll<HTMLElement>('[data-step]')];
  const progressBar = query('[data-loading-progress]');
  const progressFill = query('[data-progress-fill]');
  const message = query('[data-loading-message]');
  const live = query('[data-loading-live]');
  const statusUrl = `/api/generations/${encodeURIComponent(generationId)}/status?publisherId=${encodeURIComponent(publisherId)}`;

  const startedAt = now();
  let details: GenerationDetails = {};
  let completed: GenerationStage[] = [];
  let activeSince = startedAt;
  let lastStageAt = startedAt;
  let shownProgress = 0;
  let finished = false;
  let stopped = false;
  let sessionId: string | undefined;
  let startedTracked = false;
  let messageIndex = 0;
  let messageToken = 0;
  let activeMessages: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (work: () => void, ms: number) => { const timer = setTimeout(() => { timers.delete(timer); if (!stopped) work(); }, ms); timers.add(timer); };
  const intervals = [setInterval(() => updateProgress(), tickMs), setInterval(() => rotateMessage(), messageMs)];

  const track = (name: AnalyticsEventName, metadata: AnalyticsMetadata = {}) => {
    if (!options.analytics || manifest.features?.analyticsEnabled === false) return;
    options.analytics.track(createEvent(name, publisherId, sessionId ?? (sessionId = createSessionId()), { surface: 'loading_page', ...metadata }, manifest.publisherConfigVersion));
  };
  const currentStage = () => (finished && completed.length === GENERATION_STAGES.length ? 'report_persisted' : GENERATION_STAGES[completed.length] ?? 'report_persisted');

  /** Shows a sub-message, fading unless reduced motion is on; a newer message cancels a pending one. */
  function setMessage(text: string, immediate = reducedMotion) {
    if (!message) return;
    const token = ++messageToken;
    if (immediate) { message.classList.remove('is-fading'); message.textContent = text; return; }
    if (message.textContent === text) return;
    message.classList.add('is-fading');
    later(() => { if (token !== messageToken) return; message.textContent = text; message.classList.remove('is-fading'); }, 250);
  }

  function rotateMessage() {
    if (finished || activeMessages.length < 2) return;
    messageIndex = (messageIndex + 1) % activeMessages.length;
    setMessage(activeMessages[messageIndex]);
  }

  function updateProgress(complete = false) {
    const value = generationProgress(completed.length, now() - activeSince, complete);
    shownProgress = Math.max(shownProgress, value);
    if (progressFill) progressFill.style.width = `${shownProgress.toFixed(1)}%`;
    progressBar?.setAttribute('aria-valuenow', String(Math.round(shownProgress)));
  }

  function renderStages(complete = false) {
    const copy = stageCopy(details, manifest.name);
    const activeIndex = complete ? -1 : completed.length;
    steps.forEach((step, index) => {
      const state = complete || index < completed.length ? 'complete' : index === activeIndex ? 'active' : 'pending';
      step.dataset.state = state;
      const label = step.querySelector<HTMLElement>('[data-step-label]');
      if (label && label.textContent !== copy[index].label) label.textContent = copy[index].label;
      const stateLabel = step.querySelector<HTMLElement>('[data-step-state]');
      if (stateLabel) stateLabel.textContent = state === 'complete' ? 'Done' : state === 'active' ? 'In progress' : 'Not started';
      if (state === 'active') step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    const chips = query('[data-theme-chips]');
    if (chips && details.themes?.length && chips.childElementCount !== details.themes.length) {
      chips.innerHTML = details.themes.map((theme, index) => `<span class="loading-chip" style="--i:${index}">${escapeHtml(theme)}</span>`).join('');
    }
    const identity = query('[data-loading-identity]');
    if (identity && details.jobTitle) identity.textContent = `For ${withArticle(displayTitle(details.jobTitle))}${details.companyName ? ` at ${details.companyName}` : ''}`;
    if (!complete && activeIndex >= 0 && activeIndex < copy.length) {
      const messages = copy[activeIndex].messages;
      if (messages.join('|') !== activeMessages.join('|')) {
        const stageChanged = messages[0] !== activeMessages[0] || messages.length !== activeMessages.length;
        activeMessages = messages;
        if (stageChanged) messageIndex = 0;
        setMessage(messages[messageIndex % messages.length]);
      }
    }
  }

  function announce(text: string) { if (live) live.textContent = text; }

  function apply(payload: GenerationStatusPayload) {
    if (payload.sessionId && !sessionId) sessionId = payload.sessionId.slice(0, 160);
    if (!startedTracked) { startedTracked = true; track('generation_started'); }
    details = { ...details, ...(payload.details ?? {}) };
    const reached = (payload.completedStages ?? []).filter((stage): stage is GenerationStage => (GENERATION_STAGES as readonly string[]).includes(stage));
    const nextCompleted = payload.status === 'complete' ? [...GENERATION_STAGES] : GENERATION_STAGES.filter((stage) => reached.includes(stage) || completed.includes(stage));
    const newlyCompleted = nextCompleted.filter((stage) => !completed.includes(stage));
    if (newlyCompleted.length) {
      const at = now();
      newlyCompleted.forEach((stage, index) => track('generation_stage_completed', { generationStage: stage, elapsedMs: at - startedAt, stageMs: index === 0 ? at - lastStageAt : 0 }));
      lastStageAt = at;
      activeSince = at;
      completed = nextCompleted;
      const copy = stageCopy(details, manifest.name);
      if (payload.status !== 'complete' && completed.length < copy.length) announce(`Step ${completed.length + 1} of ${copy.length}: ${copy[completed.length].label}`);
    }
    if (payload.status === 'complete' && payload.reportUrl) return complete(payload.reportUrl);
    renderStages();
    if (payload.status === 'failed') return fail(payload.error ?? 'generation_unavailable', payload.retryable !== false);
    updateProgress();
  }

  function complete(reportUrl: string) {
    finished = true;
    renderStages(true);
    updateProgress(true);
    frame.classList.add('is-ready');
    frame.dataset.loadingState = 'ready';
    query('[data-loading-panel]')?.setAttribute('aria-busy', 'false');
    const heading = query('[data-loading-heading]');
    if (heading) heading.textContent = 'Your briefing is ready';
    setMessage('Opening your briefing…', true);
    announce('Your briefing is ready. Opening it now.');
    track('generation_completed', { elapsedMs: now() - startedAt });
    if (!reducedMotion) later(() => frame.classList.add('is-leaving'), Math.max(0, readyMs - 350));
    later(() => { teardown(); navigate(reportUrl); }, readyMs);
  }

  function fail(code: string, retryable: boolean) {
    finished = true;
    clearAllTimers();
    frame.classList.remove('is-ready');
    frame.dataset.loadingState = 'failed';
    query('[data-loading-panel]')?.setAttribute('hidden', '');
    const failure = query('[data-loading-failure]');
    failure?.removeAttribute('hidden');
    failure?.setAttribute('role', 'alert');
    const text = query('[data-failure-message]');
    if (text) text.textContent = FAILURE_COPY[code] ?? 'Something went wrong on our side. Please try again.';
    const retry = query<HTMLButtonElement>('[data-retry]');
    if (retry) retry.hidden = !retryable || code === 'generation_not_found';
    const heading = query('[data-loading-heading]');
    if (heading) heading.textContent = 'Your briefing is paused';
    track('generation_failed', { errorCode: code, generationStage: currentStage(), elapsedMs: now() - startedAt });
    (retry && !retry.hidden ? retry : query<HTMLElement>('[data-failure-heading]'))?.focus();
  }

  async function poll(): Promise<void> {
    if (!frame.isConnected) { teardown(); return; }
    if (stopped || finished) return;
    if (now() - startedAt > timeoutMs) { fail('client_timeout', true); return; }
    let delay = pollMs;
    try {
      const response = await fetchImpl(statusUrl, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (stopped) return;
      if (response.status === 404) { fail('generation_not_found', false); return; }
      if (response.status === 429) delay = Math.max(pollMs, Number(response.headers.get('Retry-After') ?? 1) * 1000);
      else if (response.ok) apply(await response.json() as GenerationStatusPayload);
    } catch {
      // A dropped poll is retried on the next tick; the timeout above bounds the wait.
    }
    if (!stopped && !finished) later(() => { void poll(); }, delay);
  }

  async function start(path: string, body?: Record<string, unknown>, status?: HTMLElement | null) {
    const response = await fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json().catch(() => ({})) as { generationUrl?: string; reportUrl?: string; error?: string };
    if ((response.ok || response.status === 409) && (payload.generationUrl || payload.reportUrl)) {
      teardown();
      navigate(response.status === 409 && payload.reportUrl ? payload.reportUrl : payload.generationUrl ?? payload.reportUrl!);
      return true;
    }
    if (status) status.textContent = generationInputMessage(payload.error, String(body?.companyUrl ?? '')) ?? 'We couldn’t start that briefing. Please try again in a moment.';
    return false;
  }

  query<HTMLButtonElement>('[data-retry]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    const text = query('[data-failure-message]');
    try {
      if (!await start(`/api/generations/${encodeURIComponent(generationId)}/retry?publisherId=${encodeURIComponent(publisherId)}`, undefined, text)) button.disabled = false;
    } catch {
      if (text) text.textContent = 'We couldn’t reach the briefing service. Please check your connection and try again.';
      button.disabled = false;
    }
  });
  query<HTMLButtonElement>('[data-edit]')?.addEventListener('click', () => {
    const form = query<HTMLFormElement>('[data-edit-form]');
    if (!form) return;
    form.hidden = false;
    const company = form.querySelector<HTMLInputElement>('[name="companyUrl"]');
    const role = form.querySelector<HTMLInputElement>('[name="jobTitle"]');
    if (company && !company.value) company.value = details.companyName ?? '';
    if (role && !role.value) role.value = details.jobTitle ?? '';
    company?.focus();
  });
  query<HTMLFormElement>('[data-edit-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const status = form.querySelector<HTMLElement>('[data-edit-status]');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const companyUrl = String(data.get('companyUrl') ?? '').trim();
    const jobTitle = String(data.get('jobTitle') ?? '').trim();
    if (!companyUrl || !jobTitle) { if (status) status.textContent = 'Enter your company and job role to continue.'; return; }
    if (submit) submit.disabled = true;
    if (status) status.textContent = 'Starting your briefing…';
    try {
      if (!await start('/api/reports/generate', { publisherId, companyUrl, jobTitle, ...(sessionId ? { sessionId } : {}) }, status) && submit) submit.disabled = false;
    } catch {
      if (status) status.textContent = 'We couldn’t reach the briefing service. Please check your connection and try again.';
      if (submit) submit.disabled = false;
    }
  });

  const onPageHide = () => { if (!finished) track('loading_abandoned', { generationStage: currentStage(), elapsedMs: now() - startedAt }); };
  window.addEventListener('pagehide', onPageHide);

  function clearAllTimers() {
    intervals.forEach((interval) => clearInterval(interval));
    intervals.length = 0;
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  }
  function teardown() {
    stopped = true;
    clearAllTimers();
    window.removeEventListener('pagehide', onPageHide);
  }

  renderStages();
  updateProgress();
  void poll();
  return teardown;
}
