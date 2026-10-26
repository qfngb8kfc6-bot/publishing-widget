import { ConsoleAnalytics, createEvent, createSessionId, DEFAULT_THEME, type AnalyticsClient, type DebugSink, type PublisherDefinition, type PublisherRegistry } from '../core';
import type { AIRecommendationLayer } from '../ai/types';
import { widgetStyles } from './styles';
import { generationInputMessage } from './messages';

type WidgetState = 'intro' | 'error';

const MAX_COMPANY_LENGTH = 253;
/** Below this width the widget starts minimised and opens as a bottom sheet. Matches the styles' breakpoint. */
const MOBILE_QUERY = '(max-width: 639px)';
const START_FOCUS = '[data-focus-start], [data-action="retry"]';
/** The mobile pill hides while the reader scrolls down and returns once scrolling has stopped this long. */
const SCROLL_SETTLE_MS = 500;
/** Smaller scroll steps (iOS bounce, address-bar resize) neither hide nor show the pill. */
const SCROLL_STEP_PX = 4;

function isMobileViewport(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
}

/** Session storage can be unavailable (privacy modes, sandboxed frames); the widget works without it. */
function readMinimised(key: string): boolean | undefined {
  try {
    const value = window.sessionStorage.getItem(key);
    return value === '1' ? true : value === '0' ? false : undefined;
  } catch { return undefined; }
}

function writeMinimised(key: string, minimised: boolean): void {
  try { window.sessionStorage.setItem(key, minimised ? '1' : '0'); } catch { /* not persisted */ }
}
const MAX_ROLE_LENGTH = 160;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

export class ContentDiscoveryWidget extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private definition?: PublisherDefinition;
  private analytics: AnalyticsClient = new ConsoleAnalytics();
  private state: WidgetState = 'intro';
  private closedByUser = false;
  private sessionId = createSessionId();
  private companyUrl = '';
  private jobTitle = '';
  private errorMessage = 'We could not start your briefing right now. Please try again.';
  /** True between submit and navigation: the form shows "Starting your briefing…". */
  private starting = false;
  /** True only while the generation POST is awaited; "starting" can outlive it once navigation begins. */
  private requestInFlight = false;
  /**
   * Back from the hosted report restores this page from the back/forward cache with the widget still showing
   * "Starting your briefing…" (navigation had begun). Reset it to the idle form, keeping the entered values.
   */
  private readonly handlePageShow = (event: PageTransitionEvent) => { if (event.persisted) this.resetAfterHandOff(); };
  private readonly handleVisibility = () => { if (document.visibilityState === 'visible' && this.starting && !this.requestInFlight) this.resetAfterHandOff(); };
  private inputError = '';
  private lastScrollY = 0;
  private scrollSettleTimer?: number;
  /** Mobile only: the minimised pill steps aside while the reader scrolls down so it never sits on publisher CTAs. */
  private readonly handleScroll = () => {
    const y = window.scrollY;
    const delta = y - this.lastScrollY;
    if (Math.abs(delta) < SCROLL_STEP_PX) return;
    this.lastScrollY = y;
    window.clearTimeout(this.scrollSettleTimer);
    const hide = delta > 0 && this.minimised && isMobileViewport();
    this.toggleAttribute('data-scroll-hidden', hide);
    if (hide) this.scrollSettleTimer = window.setTimeout(() => this.removeAttribute('data-scroll-hidden'), SCROLL_SETTLE_MS);
  };
  /** Collapsed to the bottom-centre pill. Starts minimised on mobile, expanded on desktop, then per session. */
  private minimised = false;
  private listenersAttached = false;
  private impressionTracked = false;

  /** Configure the publisher-specific shell. Retrieval and report rendering happen on the hosted app. */
  configure(registry: PublisherRegistry, analytics?: AnalyticsClient, _debug?: DebugSink, _ai?: AIRecommendationLayer): void {
    this.analytics = analytics ?? new ConsoleAnalytics();
    this.definition = registry.get(this.dataset.publisher ?? 'demo');
    this.minimised = readMinimised(this.storageKey()) ?? isMobileViewport();
    this.render();
    this.trackImpressionIfReady();
  }

  connectedCallback(): void {
    if (!this.listenersAttached) {
      this.root.addEventListener('click', (event) => this.handleClick(event));
      this.root.addEventListener('keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === 'Escape' && !this.closedByUser && !this.minimised) this.close();
        if (keyboardEvent.key === 'Tab' && !this.closedByUser && !this.minimised) this.trapFocus(keyboardEvent);
      });
      // Typed values survive re-renders (minimise/expand, Back) without a submit.
      this.root.addEventListener('input', (event) => {
        const field = (event.target as HTMLElement).closest<HTMLInputElement>('[data-profile-field]');
        if (field?.dataset.profileField === 'companyUrl') this.companyUrl = field.value;
        if (field?.dataset.profileField === 'jobTitle') this.jobTitle = field.value;
      });
      this.root.addEventListener('submit', (event) => {
        const form = event.target as HTMLFormElement;
        if (!form.matches('[data-profile-form]')) return;
        event.preventDefault();
        void this.submitProfessionalProfile();
      });
      this.listenersAttached = true;
    }
    window.addEventListener('pageshow', this.handlePageShow);
    this.lastScrollY = window.scrollY;
    window.addEventListener('scroll', this.handleScroll, { passive: true });
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.render();
    this.trackImpressionIfReady();
  }

  disconnectedCallback(): void {
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('scroll', this.handleScroll);
    window.clearTimeout(this.scrollSettleTimer);
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  /** Returns a widget left in "Starting your briefing…" (or its error state) to the editable form. */
  private resetAfterHandOff(): void {
    if (!this.starting && this.state !== 'error') return;
    this.starting = false;
    this.requestInFlight = false;
    this.inputError = '';
    if (this.definition) this.state = 'intro';
    this.render();
  }

  /** Opens the public widget experience. The hosted application owns generation and reports. */
  openWidget(): void {
    this.closedByUser = false;
    this.minimised = false;
    if (!this.definition) {
      this.state = 'error';
      this.errorMessage = this.dataset.publisher ? 'This publisher guide is not available yet.' : 'This guide is not configured yet.';
    } else {
      this.state = 'intro';
      this.track('widget_opened');
      this.track('intro_viewed');
    }
    this.render(START_FOCUS);
  }

  /** Prefills the two fields used by sales/demo scenarios without bypassing the hosted flow. */
  prefillProfile(companyUrl: string, jobTitle: string): void {
    this.companyUrl = companyUrl.trim();
    this.jobTitle = jobTitle.trim();
    if (!this.closedByUser) this.render();
  }

  destroy(): void {
    this.closedByUser = true;
    this.remove();
  }

  private trackImpressionIfReady(): void {
    if (this.isConnected && this.definition && !this.impressionTracked) {
      this.impressionTracked = true;
      this.track('widget_impression');
    }
  }

  private track(name: Parameters<typeof createEvent>[0], metadata?: Record<string, string | number | boolean>): void {
    if (this.definition?.manifest?.features?.analyticsEnabled === false) return;
    const publisherId = this.definition?.config.publisherId ?? this.dataset.publisher ?? 'unknown';
    void Promise.resolve(this.analytics.track(createEvent(name, publisherId, this.sessionId, metadata, this.definition?.manifest?.publisherConfigVersion))).catch(() => undefined);
  }

  private storageKey(): string {
    return `ld-briefing-widget:${this.dataset.publisher ?? 'demo'}:minimised`;
  }

  /** The × (and Escape) minimise to the pill; the widget stays on the page. */
  private close(): void {
    this.setMinimised(true);
  }

  private setMinimised(minimised: boolean): void {
    if (this.minimised === minimised) return;
    this.minimised = minimised;
    writeMinimised(this.storageKey(), minimised);
    this.track(minimised ? 'widget_minimised' : 'widget_expanded');
    this.render(minimised ? '[data-action="expand"]' : START_FOCUS);
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') this.close();
    if (action === 'expand') this.setMinimised(false);
    if (action === 'retry') this.openWidget();
  }

  private async submitProfessionalProfile(): Promise<void> {
    const company = this.root.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')?.value.trim() ?? this.companyUrl;
    const role = this.root.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')?.value.trim() ?? this.jobTitle;
    const error = this.root.querySelector<HTMLElement>('[data-profile-error]');
    this.companyUrl = company;
    this.jobTitle = role;
    if (this.starting) return;
    const invalid = !company || !role ? 'Enter your company website and job role to continue.'
      : company.length > MAX_COMPANY_LENGTH ? 'That company name or website is too long.'
      : role.length > MAX_ROLE_LENGTH ? 'That job role is too long. Try a shorter title.' : '';
    if (invalid) {
      error?.replaceChildren(document.createTextNode(invalid));
      return;
    }
    this.track('company_entered');
    this.track('role_entered', { roleFunction: role.toLowerCase().includes('engineer') ? 'engineering' : 'professional' });
    this.track('report_requested');
    const endpoint = this.dataset.generationEndpoint ?? '/api/reports/generate';
    this.starting = true;
    this.inputError = '';
    this.render('[data-action="generate"]');
    let responseStatus: number | undefined;
    let responseError: string | undefined;
    let requestId: string | undefined;
    try {
      this.requestInFlight = true;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publisherId: this.dataset.publisher ?? 'demo', companyUrl: company, jobTitle: role, sessionId: this.sessionId }),
      });
      responseStatus = response.status;
      this.requestInFlight = false;
      let payload: { generationUrl?: string; reportUrl?: string; statusUrl?: string; error?: unknown; requestId?: unknown } = {};
      try { payload = await response.json() as typeof payload; } catch { /* The development diagnostic below retains the HTTP status. */ }
      responseError = typeof payload.error === 'string' && /^[a-z0-9_-]{1,80}$/i.test(payload.error) ? payload.error : undefined;
      const headerRequestId = response.headers.get('X-Request-ID') ?? undefined;
      requestId = typeof payload.requestId === 'string' && /^[a-z0-9_-]{1,120}$/i.test(payload.requestId)
        ? payload.requestId
        : headerRequestId && /^[a-z0-9_-]{1,120}$/i.test(headerRequestId) ? headerRequestId : undefined;
      const inputMessage = response.ok ? undefined : generationInputMessage(responseError, company);
      if (inputMessage) {
        // No job exists yet: the visitor corrects the input here instead of seeing a failed loading page.
        console.warn('[content-discovery] generation request rejected', { endpoint, status: responseStatus, error: responseError, requestId });
        this.starting = false;
        this.inputError = inputMessage;
        this.render('[data-profile-field="companyUrl"]');
        return;
      }
      if (!response.ok || (!payload.generationUrl && !payload.reportUrl && !payload.statusUrl)) throw new Error('generation_unavailable');
      this.track('generation_started');
      // Report URLs are relative to the platform that answered, not to the publisher page hosting the widget.
      this.navigateTo(new URL(payload.generationUrl ?? payload.reportUrl ?? payload.statusUrl as string, new URL(endpoint, window.location.href)).href);
    } catch (error) {
      // Visitors see the friendly message; integrators get the status and safe error code in the console.
      this.requestInFlight = false;
      console.warn('[content-discovery] generation request failed', { endpoint, status: responseStatus, error: responseError ?? (error instanceof Error ? error.name : 'unknown'), requestId });
      this.closedByUser = false;
      this.starting = false;
      this.state = 'error';
      this.render('[data-action="retry"]');
    }
  }

  /** Renders the current state; focus moves only when an action asks for it, never on page load. */
  private render(focus?: string): void {
    const config = this.definition?.config;
    const branding = config?.branding;
    const radius = branding?.radiusPreference === 'sharp' ? { panel: '24px', control: '16px' } : branding?.radiusPreference === 'soft' ? { panel: '30px', control: '19px' } : { panel: '38px', control: '23px' };
    const css = widgetStyles
      .replace('--ss-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;', `--ss-font: ${branding?.fontFamily ?? 'Inter, ui-sans-serif, system-ui, sans-serif'};`)
      .replace(`--ss-primary: ${DEFAULT_THEME.indigo};`, `--ss-primary: ${branding?.primaryColor ?? DEFAULT_THEME.indigo};`)
      .replace('--ss-radius-panel: 38px;', `--ss-radius-panel: ${radius.panel};`)
      .replace('--ss-radius-control: 23px;', `--ss-radius-control: ${radius.control};`);
    const content = this.closedByUser ? '' : this.renderPanel();
    this.hidden = this.closedByUser;
    this.dataset.state = this.minimised ? 'minimised' : 'expanded';
    if (!this.minimised) this.removeAttribute('data-scroll-hidden');
    this.root.innerHTML = `<style>${css}</style>${content}`;
    if (!this.closedByUser && focus) this.root.querySelector<HTMLElement>(focus)?.focus();
  }

  private renderPanel(): string {
    if (this.minimised) return '<button class="briefing-pill" type="button" data-action="expand" aria-expanded="false" aria-controls="ld-briefing-panel"><span class="briefing-pill-spark" aria-hidden="true">✦</span><span class="pill-label-full">Get your personalised briefing</span><span class="pill-label-short">Your briefing</span></button>';
    const minimise = '<button class="close-control" type="button" data-action="close" aria-label="Minimise briefing" aria-expanded="true" aria-controls="ld-briefing-panel"><span class="icon-close" aria-hidden="true">×</span><svg class="icon-minimise" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6" /></svg></button>';
    if (this.state === 'error') return `${minimise}<div class="error-state" id="ld-briefing-panel" role="alert"><h2>We could not start your briefing</h2><p>${escapeHtml(this.errorMessage)}</p><button class="briefing-submit" data-action="retry">Try again</button></div>`;
    return `${minimise}<form class="briefing-bar" id="ld-briefing-panel" data-profile-form role="dialog" aria-modal="true" aria-label="Build your professional briefing"><span class="briefing-label">I work at</span><label class="briefing-field briefing-field--company"><svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V5.5h9V20M14 9h5v11M8 8.5h2M8 12h2M8 15.5h2M16.5 12h1M16.5 15.5h1M3 20h18" /></svg><input type="text" inputmode="text" data-profile-field="companyUrl" value="${escapeHtml(this.companyUrl)}" placeholder="Nike or nike.com" autocomplete="organization" spellcheck="false" data-focus-start aria-label="Company or website"${this.inputError ? ' aria-invalid="true" aria-describedby="profile-error"' : ''}${this.starting ? ' readonly' : ''}></label><span class="briefing-label">as a</span><label class="briefing-field briefing-field--role"><svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h16v11H4zM8 8.5V6h8v2.5M8 13h8M12 13v2" /></svg><input type="text" data-profile-field="jobTitle" value="${escapeHtml(this.jobTitle)}" placeholder="Software Engineer" autocomplete="organization-title" aria-label="Job role"${this.starting ? ' readonly' : ''}></label><span class="briefing-arrow" aria-hidden="true">→</span>${this.starting
      ? '<button class="briefing-submit" type="submit" data-action="generate" aria-busy="true" aria-disabled="true"><span class="briefing-spinner" aria-hidden="true"></span>Starting your briefing…</button><p class="ss-visually-hidden" role="status" data-starting-status>Starting your briefing…</p>'
      : '<button class="briefing-submit" type="submit" data-action="generate"><span class="briefing-spark" aria-hidden="true">✦</span>Build my briefing</button>'}<p class="profile-error" id="profile-error" data-profile-error role="alert">${escapeHtml(this.inputError)}</p></form>`;
  }

  private trapFocus(event: KeyboardEvent): void {
    const panel = this.root.querySelector<HTMLElement>('[role="dialog"]');
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && this.root.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && this.root.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /** Navigation seam for the post-generation redirect. */
  protected navigateTo(url: string): void {
    window.location.assign(url);
  }


}
