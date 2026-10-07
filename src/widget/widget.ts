import { ConsoleAnalytics, createEvent, createSessionId, type AnalyticsClient, type DebugSink, type PublisherDefinition, type PublisherRegistry } from '../core';
import type { AIRecommendationLayer } from '../ai/types';
import { widgetStyles } from './styles';

type WidgetState = 'closed' | 'intro' | 'error';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

export class ContentDiscoveryWidget extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private definition?: PublisherDefinition;
  private analytics: AnalyticsClient = new ConsoleAnalytics();
  private state: WidgetState = 'closed';
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
        if (keyboardEvent.key === 'Escape' && this.state !== 'closed') this.close();
        if (keyboardEvent.key === 'Tab' && this.state !== 'closed') this.trapFocus(keyboardEvent);
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
    if (this.state !== 'closed') this.render();
  }

  destroy(): void {
    this.state = 'closed';
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
    if (this.state !== 'closed') this.track('widget_closed');
    this.state = 'closed';
    this.render();
    this.root.querySelector<HTMLElement>('[data-action="open"]')?.focus();
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'open') this.openWidget();
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
      this.state = 'error';
      this.render();
    }
  }

  private render(): void {
    const config = this.definition?.config;
    const branding = config?.branding;
    const radius = branding?.radiusPreference === 'sharp' ? { panel: '14px', control: '9px' } : branding?.radiusPreference === 'soft' ? { panel: '19px', control: '11px' } : { panel: '25px', control: '14px' };
    const css = widgetStyles
      .replace('--ss-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;', `--ss-font: ${branding?.fontFamily ?? 'Inter, ui-sans-serif, system-ui, sans-serif'};`)
      .replace('--ss-primary: #244d3b;', `--ss-primary: ${branding?.primaryColor ?? '#244d3b'};`)
      .replace('--ss-secondary: #e8efe6;', `--ss-secondary: ${branding?.secondaryColor ?? '#e8efe6'};`)
      .replace('--ss-radius-panel: 25px;', `--ss-radius-panel: ${radius.panel};`)
      .replace('--ss-radius-control: 14px;', `--ss-radius-control: ${radius.control};`);
    const launcherText = branding?.launcherText ?? 'Open professional briefing';
    const content = this.state === 'closed' ? this.renderLauncher(launcherText) : this.renderPanel();
    this.root.innerHTML = `<style>${css}</style>${content}`;
    if (this.state !== 'closed') this.root.querySelector<HTMLElement>('[data-focus-start], [data-action="close"], [data-action="retry"]')?.focus();
  }

  private renderLauncher(label: string): string {
    const publisherName = this.definition?.config.publisherName ?? 'Publisher briefing';
    const visibleLabel = label === 'Open professional briefing' ? 'Find stories relevant to your business' : label;
    return `<button class="launcher" data-action="open" aria-label="${escapeHtml(label)}"><span class="launcher-mark" aria-hidden="true">↗</span><span class="launcher-copy"><small>${escapeHtml(publisherName)}</small><strong>${escapeHtml(visibleLabel)}</strong></span><span class="launcher-arrow" aria-hidden="true">→</span></button>`;
  }

  private renderPanel(): string {
    const config = this.definition?.config;
    const branding = config?.branding;
    const logo = branding?.logo && this.safeHttpUrl(branding.logo);
    const title = branding?.widgetTitle ?? 'Build your professional briefing';
    const introCopy = branding?.introductoryCopy ?? 'Start with the context behind your work. We’ll take you to a publisher-branded briefing built from real coverage.';
    const brand = logo ? `<img class="publisher-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(config?.publisherName ?? '')}">` : `<span class="publisher-mark" aria-hidden="true">${escapeHtml((config?.publisherName ?? 'C').slice(0, 1))}</span>`;
    const body = this.state === 'error' ? `<div class="error-state" role="alert"><p class="intro-kicker">Briefing unavailable</p><h2>We could not start your briefing</h2><p>${escapeHtml(this.errorMessage)}</p><button class="button" data-action="retry">Try again</button></div>` : `<form class="profile-form" data-profile-form aria-describedby="widget-supporting-copy"><div class="capsule-brand"><div class="capsule-brand-mark">${brand}</div><div class="capsule-brand-copy"><span>${escapeHtml(config?.publisherName ?? 'Professional intelligence')}</span><h1 id="widget-title">${escapeHtml(title)}</h1></div></div><label class="profile-field"><span>I work at</span><span class="input-shell"><span class="field-icon" aria-hidden="true">⌂</span><input type="url" data-profile-field="companyUrl" value="${escapeHtml(this.companyUrl)}" placeholder="company.com" autocomplete="url" data-focus-start required></span></label><span class="field-flow" aria-hidden="true">as a</span><label class="profile-field"><span class="mobile-role-label">as a</span><span class="input-shell"><span class="field-icon" aria-hidden="true">◌</span><input type="text" data-profile-field="jobTitle" value="${escapeHtml(this.jobTitle)}" placeholder="Software Engineer" autocomplete="organization-title" aria-label="Job role" required></span></label><span class="field-arrow" aria-hidden="true">→</span><button class="button button-wide" type="submit" data-action="generate">Build my briefing <span class="button-spark" aria-hidden="true">✦</span></button><p class="profile-error" data-profile-error role="alert"></p><p class="content-note" id="widget-supporting-copy">${escapeHtml(introCopy)}</p></form>`;
    return `<section class="panel" role="dialog" aria-modal="true" aria-labelledby="widget-title"><div class="panel-inner"><button class="icon-button" data-action="close" aria-label="Close briefing">×</button>${body}</div></section>`;
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
