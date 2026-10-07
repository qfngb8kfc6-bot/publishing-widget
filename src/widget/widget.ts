import { ConsoleAnalytics, createEvent, createSessionId, DEFAULT_THEME, type AnalyticsClient, type DebugSink, type PublisherDefinition, type PublisherRegistry } from '../core';
import type { AIRecommendationLayer } from '../ai/types';
import { widgetStyles } from './styles';

type WidgetState = 'intro' | 'error';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

export class ContentDiscoveryWidget extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private definition?: PublisherDefinition;
  private analytics: AnalyticsClient = new ConsoleAnalytics();
  private state: WidgetState = 'intro';
  private isVisible = true;
  private sessionId = createSessionId();
  private companyUrl = '';
  private jobTitle = '';
  private errorMessage = 'We could not start your briefing right now. Please try again.';
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
        if (keyboardEvent.key === 'Escape' && this.isVisible) this.close();
        if (keyboardEvent.key === 'Tab' && this.isVisible) this.trapFocus(keyboardEvent);
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
    this.isVisible = true;
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
    if (this.isVisible) this.render();
  }

  destroy(): void {
    this.isVisible = false;
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
    if (this.isVisible) this.track('widget_closed');
    this.isVisible = false;
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
    this.companyUrl = company;
    this.jobTitle = role;
    if (!company || !role) {
      this.root.querySelector<HTMLElement>('[data-profile-error]')?.replaceChildren(document.createTextNode('Enter your company website and job role to continue.'));
      return;
    }
    this.track('company_entered');
    this.track('role_entered', { roleFunction: role.toLowerCase().includes('engineer') ? 'engineering' : 'professional' });
    this.track('report_requested');
    const endpoint = this.dataset.generationEndpoint ?? '/api/reports/generate';
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="generate"]');
    if (button) button.disabled = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publisherId: this.dataset.publisher ?? 'demo', companyUrl: company, jobTitle: role, sessionId: this.sessionId }),
      });
      const payload = await response.json() as { generationUrl?: string; reportUrl?: string; statusUrl?: string };
      if (!response.ok || (!payload.generationUrl && !payload.reportUrl && !payload.statusUrl)) throw new Error('generation_unavailable');
      this.track('generation_started');
      window.location.assign(payload.generationUrl ?? payload.reportUrl ?? payload.statusUrl as string);
    } catch {
      this.isVisible = true;
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
    const content = this.isVisible ? this.renderPanel() : '';
    this.hidden = !this.isVisible;
    this.root.innerHTML = `<style>${css}</style>${content}`;
    if (this.isVisible) this.root.querySelector<HTMLElement>('[data-focus-start], [data-action="close"], [data-action="retry"]')?.focus();
  }

  private renderPanel(): string {
    if (this.state === 'error') return `<button class="close-control" data-action="close" aria-label="Close briefing">×</button><div class="error-state" role="alert"><h2>We could not start your briefing</h2><p>${escapeHtml(this.errorMessage)}</p><button class="briefing-submit" data-action="retry">Try again</button></div>`;
    return `<button class="close-control" data-action="close" aria-label="Close briefing">×</button><form class="briefing-bar" data-profile-form role="dialog" aria-modal="true" aria-label="Build your professional briefing"><span class="briefing-label">I work at</span><label class="briefing-field briefing-field--company"><svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V5.5h9V20M14 9h5v11M8 8.5h2M8 12h2M8 15.5h2M16.5 12h1M16.5 15.5h1M3 20h18" /></svg><input type="url" data-profile-field="companyUrl" value="${escapeHtml(this.companyUrl)}" placeholder="company.com" autocomplete="url" data-focus-start required></label><span class="briefing-label">as a</span><label class="briefing-field briefing-field--role"><svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h16v11H4zM8 8.5V6h8v2.5M8 13h8M12 13v2" /></svg><input type="text" data-profile-field="jobTitle" value="${escapeHtml(this.jobTitle)}" placeholder="Software Engineer" autocomplete="organization-title" aria-label="Job role" required></label><span class="briefing-arrow" aria-hidden="true">→</span><button class="briefing-submit" type="submit" data-action="generate"><span class="briefing-spark" aria-hidden="true">✦</span>Build my briefing</button><p class="profile-error" data-profile-error role="alert"></p></form>`;
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

  private safeHttpUrl(value: string): string {
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  }
}
