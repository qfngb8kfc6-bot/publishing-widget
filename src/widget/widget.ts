import { ConsoleAnalytics, createEvent, createSessionId, DEFAULT_THEME, type AnalyticsClient, type DebugSink, type PublisherDefinition, type PublisherRegistry } from '../core';
import type { AIRecommendationLayer } from '../ai/types';
import { widgetStyles } from './styles';
import { generationInputMessage } from './messages';

type WidgetState = 'intro' | 'error';

const MAX_COMPANY_LENGTH = 253;
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
  private inputError = '';
  private listenersAttached = false;
  private impressionTracked = false;

  /** Configure the publisher-specific shell. Retrieval and report rendering happen on the hosted app. */
  configure(registry: PublisherRegistry, analytics?: AnalyticsClient, _debug?: DebugSink, _ai?: AIRecommendationLayer): void {
    this.analytics = analytics ?? new ConsoleAnalytics();
    this.definition = registry.get(this.dataset.publisher ?? 'demo');
    this.render();
    this.trackImpressionIfReady();
  }

  connectedCallback(): void {
    if (!this.listenersAttached) {
      this.root.addEventListener('click', (event) => this.handleClick(event));
      this.root.addEventListener('keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === 'Escape' && !this.closedByUser) this.close();
        if (keyboardEvent.key === 'Tab' && !this.closedByUser) this.trapFocus(keyboardEvent);
      });
      this.root.addEventListener('submit', (event) => {
        const form = event.target as HTMLFormElement;
        if (!form.matches('[data-profile-form]')) return;
        event.preventDefault();
        void this.submitProfessionalProfile();
      });
      this.listenersAttached = true;
    }
    this.render();
    this.trackImpressionIfReady();
  }

  /** Opens the public widget experience. The hosted application owns generation and reports. */
  openWidget(): void {
    this.closedByUser = false;
    if (!this.definition) {
      this.state = 'error';
      this.errorMessage = this.dataset.publisher ? 'This publisher guide is not available yet.' : 'This guide is not configured yet.';
    } else {
      this.state = 'intro';
      this.track('widget_opened');
      this.track('intro_viewed');
    }
    this.render();
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

  private close(): void {
    if (!this.closedByUser) this.track('widget_closed');
    this.closedByUser = true;
    this.render();
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') this.close();
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
    this.render();
    let responseStatus: number | undefined;
    let responseError: string | undefined;
    let requestId: string | undefined;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publisherId: this.dataset.publisher ?? 'demo', companyUrl: company, jobTitle: role, sessionId: this.sessionId }),
      });
      responseStatus = response.status;
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
        this.render();
        return;
      }
      if (!response.ok || (!payload.generationUrl && !payload.reportUrl && !payload.statusUrl)) throw new Error('generation_unavailable');
      this.track('generation_started');
      // Report URLs are relative to the platform that answered, not to the publisher page hosting the widget.
      this.navigateTo(new URL(payload.generationUrl ?? payload.reportUrl ?? payload.statusUrl as string, new URL(endpoint, window.location.href)).href);
    } catch (error) {
      // Visitors see the friendly message; integrators get the status and safe error code in the console.
      console.warn('[content-discovery] generation request failed', { endpoint, status: responseStatus, error: responseError ?? (error instanceof Error ? error.name : 'unknown'), requestId });
      this.closedByUser = false;
      this.starting = false;
      this.state = 'error';
      this.render();
    }
  }

  private render(): void {
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
    this.root.innerHTML = `<style>${css}</style>${content}`;
    if (!this.closedByUser) this.root.querySelector<HTMLElement>(this.starting ? '[data-action="generate"]' : this.inputError ? '[data-profile-field="companyUrl"]' : '[data-focus-start], [data-action="close"], [data-action="retry"]')?.focus();
  }

  private renderPanel(): string {
    if (this.state === 'error') return `<button class="close-control" data-action="close" aria-label="Close briefing">×</button><div class="error-state" role="alert"><h2>We could not start your briefing</h2><p>${escapeHtml(this.errorMessage)}</p><button class="briefing-submit" data-action="retry">Try again</button></div>`;
    return `<button class="close-control" data-action="close" aria-label="Close briefing">×</button><form class="briefing-bar" data-profile-form role="dialog" aria-modal="true" aria-label="Build your professional briefing"><span class="briefing-label">I work at</span><label class="briefing-field briefing-field--company"><svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V5.5h9V20M14 9h5v11M8 8.5h2M8 12h2M8 15.5h2M16.5 12h1M16.5 15.5h1M3 20h18" /></svg><input type="text" inputmode="text" data-profile-field="companyUrl" value="${escapeHtml(this.companyUrl)}" placeholder="Nike or nike.com" autocomplete="organization" spellcheck="false" data-focus-start aria-label="Company or website"${this.inputError ? ' aria-invalid="true" aria-describedby="profile-error"' : ''}${this.starting ? ' readonly' : ''}></label><span class="briefing-label">as a</span><label class="briefing-field briefing-field--role"><svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h16v11H4zM8 8.5V6h8v2.5M8 13h8M12 13v2" /></svg><input type="text" data-profile-field="jobTitle" value="${escapeHtml(this.jobTitle)}" placeholder="Software Engineer" autocomplete="organization-title" aria-label="Job role"${this.starting ? ' readonly' : ''}></label><span class="briefing-arrow" aria-hidden="true">→</span>${this.starting
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
