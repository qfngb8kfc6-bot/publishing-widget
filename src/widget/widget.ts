import { createEvent, ConsoleAnalytics, DiscoveryError, type AnalyticsClient, type AnswerValue, createSessionId, PublisherRegistry, RecommendationService, type DebugSink, type PublisherDefinition, type RankedArticle, type ProgressStage } from '../core';
import { widgetStyles } from './styles';
import type { AIRecommendationLayer } from '../ai/types';

type WidgetState = 'closed' | 'intro' | 'questionnaire' | 'analysis' | 'results' | 'error';
type WidgetErrorCode = 'invalid-publisher' | 'api-unavailable' | 'authentication-failure' | 'rate-limit' | 'invalid-response' | 'search-timeout' | 'unexpected';

const STAGE_COPY: Record<ProgressStage, { title: string; detail: string; percent: number }> = {
  understanding: { title: 'Understanding your interests', detail: 'Turning your answers into a useful starting point.', percent: 24 },
  searching: { title: 'Searching our coverage', detail: 'Looking through the publisher’s latest stories.', percent: 48 },
  comparing: { title: 'Comparing relevant stories', detail: 'Finding the strongest matches for you.', percent: 74 },
  preparing: { title: 'Preparing your recommendations', detail: 'Adding a little context to each match.', percent: 92 },
};
const STAGE_ORDER: ProgressStage[] = ['understanding', 'searching', 'comparing', 'preparing'];

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export class ContentDiscoveryWidget extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private registry?: PublisherRegistry;
  private analytics: AnalyticsClient = new ConsoleAnalytics();
  private state: WidgetState = 'closed';
  private definition?: PublisherDefinition;
  private answers: Record<string, AnswerValue> = {};
  private step = 0;
  private sessionId = createSessionId();
  private stage: ProgressStage = 'understanding';
  private results: RankedArticle[] = [];
  private errorMessage = 'We could not load this guide right now.';
  private errorCode: WidgetErrorCode = 'unexpected';
  private impressionIds = new Set<string>();
  private debug?: DebugSink;
  private ai?: AIRecommendationLayer;
  private listenersAttached = false;
  private impressionTracked = false;

  configure(registry: PublisherRegistry, analytics?: AnalyticsClient, debug?: DebugSink, ai?: AIRecommendationLayer): void {
    this.registry = registry;
    this.analytics = analytics ?? new ConsoleAnalytics();
    this.debug = debug;
    this.ai = ai;
    this.definition = registry.get(this.dataset.publisher ?? 'demo');
    this.render();
    if (this.isConnected && this.definition && !this.impressionTracked) { this.impressionTracked = true; this.track('widget_impression'); }
  }

  connectedCallback(): void {
    if (!this.listenersAttached) {
      this.root.addEventListener('click', (event) => this.handleClick(event));
      this.root.addEventListener('change', (event) => this.handleAnswerChange(event));
      this.root.addEventListener('input', (event) => this.handleAnswerChange(event));
      this.root.addEventListener('keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === 'Escape' && this.state !== 'closed') this.close();
        if (keyboardEvent.key === 'Tab' && this.state !== 'closed') this.trapFocus(keyboardEvent);
      });
      this.listenersAttached = true;
    }
    this.render();
    if (this.definition && !this.impressionTracked) { this.impressionTracked = true; this.track('widget_impression'); }
  }

  /** Opens the real reader journey for hosts that provide a prominent CTA. */
  openWidget(): void {
    this.open();
  }

  destroy(): void {
    this.state = 'closed';
    this.remove();
  }

  private track(name: Parameters<typeof createEvent>[0], metadata?: Record<string, string | number | boolean>): void {
    if (this.definition?.manifest?.features?.analyticsEnabled === false) return;
    const publisherId = this.definition?.config.publisherId ?? this.dataset.publisher ?? 'unknown';
    void Promise.resolve(this.analytics.track(createEvent(name, publisherId, this.sessionId, metadata, this.definition?.manifest?.publisherConfigVersion))).catch(() => undefined);
  }

  private open(): void {
    if (!this.definition) {
      this.state = 'error';
      this.errorCode = 'invalid-publisher';
      this.errorMessage = this.dataset.publisher ? 'This publisher guide is not available yet.' : 'This guide is not configured yet.';
    } else {
      this.state = 'intro';
      this.step = 0;
      this.track('widget_opened');
      this.track('intro_viewed');
    }
    this.render();
  }

  private close(): void {
    if (this.state !== 'closed') this.track('widget_closed');
    this.state = 'closed';
    this.render();
    this.root.querySelector<HTMLElement>('[data-action="open"]')?.focus();
  }

  private restart(): void {
    this.answers = {};
    this.results = [];
    this.step = 0;
    this.state = 'intro';
    this.sessionId = createSessionId();
    this.track('restart_clicked');
    this.render();
  }

  private begin(): void {
    this.state = 'questionnaire';
    this.step = 0;
    this.render();
  }

  private changeAnswers(): void {
    this.track('change_answers', { answersChanged: true });
    this.state = 'questionnaire';
    this.step = 0;
    this.render();
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const actionElement = target.closest<HTMLElement>('[data-action]');
    const action = actionElement?.dataset.action;
    if (!action) return;
    if (action === 'open') this.open();
    if (action === 'close') this.close();
    if (action === 'begin') this.begin();
    if (action === 'back') { this.step = Math.max(0, this.step - 1); this.render(); }
    if (action === 'continue') this.continue();
    if (action === 'restart') this.restart();
    if (action === 'change') this.changeAnswers();
    if (action === 'retry') this.open();
    if (action === 'article') {
      const articleId = actionElement.dataset.articleId;
      if (articleId) this.track('article_clicked', { articleId, articlePosition: Number(actionElement.dataset.articlePosition) || 0, articleCategory: actionElement.dataset.articleCategory ?? 'Story', articleTitle: actionElement.dataset.articleTitle ?? '', articlePublishedAt: actionElement.dataset.articlePublishedAt ?? '', rankingMode: actionElement.dataset.rankingMode ?? 'deterministic' });
    }
  }

  private handleAnswerChange(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    const questionId = target.dataset.questionId;
    if (!questionId) return;
    const question = this.definition?.config.questions.find((item) => item.id === questionId);
    if (!question) return;
    if (question.type === 'multi-select') {
      this.answers[questionId] = [...this.root.querySelectorAll<HTMLInputElement>(`input[data-question-id="${CSS.escape(questionId)}"]:checked`)].map((input) => input.value);
    } else {
      this.answers[questionId] = target.value;
    }
    if (question.type === 'free-text') {
      this.root.querySelector<HTMLButtonElement>('[data-action="continue"]')?.toggleAttribute('disabled', !this.isStepComplete());
      return;
    }
    this.render(false);
  }

  private isStepComplete(): boolean {
    const question = this.definition?.config.questions[this.step];
    if (!question || !question.required) return true;
    const answer = this.answers[question.id];
    return typeof answer === 'string' ? answer.trim().length > 0 : Array.isArray(answer) && answer.length > 0;
  }

  private async continue(): Promise<void> {
    const question = this.definition?.config.questions[this.step];
    if (!question || !this.isStepComplete()) return;
    const answer = this.answers[question.id];
    this.track('question_answered', {
      questionId: question.id,
      questionKind: question.id.toLowerCase().includes('role') || question.id.toLowerCase().includes('persona') || question.id.toLowerCase().includes('describe') ? 'persona' : 'interest',
      answerType: question.type,
      answerCount: Array.isArray(answer) ? answer.length : answer?.trim() ? 1 : 0,
      ...(question.type === 'free-text' ? { freeTextUsed: Boolean(typeof answer === 'string' && answer.trim()) } : { [Array.isArray(answer) ? 'answerOptionIds' : 'answerOptionId']: Array.isArray(answer) ? answer.join(',') : answer ?? '' }),
    });
    if (this.step < (this.definition?.config.questions.length ?? 1) - 1) {
      this.step += 1;
      this.render();
      return;
    }
    await this.runSearch();
  }

  private async runSearch(): Promise<void> {
    if (!this.definition) return;
    this.state = 'analysis';
    this.stage = 'understanding';
    this.impressionIds.clear();
    this.track('search_started');
    this.render();
    try {
      const service = new RecommendationService(this.definition, this.debug, this.ai);
      const response = await service.recommend(this.answers, (stage) => {
        this.stage = stage;
        this.render();
      });
      this.results = response.results;
      this.state = 'results';
      const rankingMode = this.results.some((result) => result.rankingMode === 'hybrid') ? 'hybrid' : 'deterministic';
      const aiExplanationUsed = this.results.some((result) => result.explanationProvider === this.ai?.provider.providerName);
      this.track('search_completed', { resultCount: this.results.length, rankingMode, aiExplanationUsed });
      this.render();
      this.results.forEach((result, index) => {
        if (!this.impressionIds.has(result.article.id)) {
          this.impressionIds.add(result.article.id);
          this.track('result_impression', { articleId: result.article.id, articlePosition: index + 1, articleCategory: result.article.categories[0] ?? 'Story', articleTitle: result.article.title, articlePublishedAt: result.article.publishedAt ?? '', rankingMode: result.rankingMode ?? 'deterministic' });
        }
      });
    } catch (error) {
      const code = error instanceof DiscoveryError ? error.code : 'unexpected';
      if (code === 'api-unavailable' || code === 'authentication-failure' || code === 'rate-limit' || code === 'invalid-response' || code === 'search-timeout') {
        this.errorCode = code;
      } else {
        this.errorCode = 'unexpected';
      }
      this.errorMessage = this.errorCode === 'search-timeout' ? 'The search took a little too long. Please try again.' : this.errorCode === 'rate-limit' ? 'The publisher is busy right now. Please try again shortly.' : 'We could not find stories right now. Please try again in a moment.';
      this.track('search_failed', { errorCode: this.errorCode });
      this.state = 'error';
      this.render();
    }
  }

  private render(openFocus = true): void {
    const config = this.definition?.config;
    const branding = config?.branding;
    const radius = branding?.radiusPreference === 'sharp' ? { panel: '14px', card: '12px', control: '9px' } : branding?.radiusPreference === 'soft' ? { panel: '19px', card: '14px', control: '11px' } : { panel: '25px', card: '18px', control: '14px' };
    const css = widgetStyles.replace('--ss-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;', `--ss-font: ${branding?.fontFamily ?? 'Inter, ui-sans-serif, system-ui, sans-serif'};`).replace('--ss-primary: #244d3b;', `--ss-primary: ${branding?.primaryColor ?? '#244d3b'};`).replace('--ss-secondary: #e8efe6;', `--ss-secondary: ${branding?.secondaryColor ?? '#e8efe6'};`).replace('--ss-radius-panel: 25px;', `--ss-radius-panel: ${radius.panel};`).replace('--ss-radius-card: 18px;', `--ss-radius-card: ${radius.card};`).replace('--ss-radius-control: 14px;', `--ss-radius-control: ${radius.control};`);
    let content = `<button class="launcher" data-action="open" aria-label="${escapeHtml(branding?.launcherText ?? 'Open content discovery guide')}"><span class="launcher-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><span>${escapeHtml(branding?.launcherText ?? 'Find stories for you')}</span></button>`;
    if (this.state !== 'closed') content = this.renderPanel();
    this.root.innerHTML = `<style>${css}</style>${content}`;
    if (openFocus && this.state !== 'closed') this.root.querySelector<HTMLElement>('[data-focus-start], [data-action="close"], [data-action="retry"], [data-action="continue"]')?.focus();
  }

  private panelShell(body: string, copy = ''): string {
    const config = this.definition?.config;
    const branding = config?.branding;
    const title = this.state === 'results' ? config?.results.heading ?? 'Stories selected for you' : branding?.widgetTitle ?? 'Your content guide';
    const treatment = branding?.backgroundTreatment === 'glass' ? 'panel--glass' : branding?.backgroundTreatment === 'plain' ? 'panel--plain' : '';
    const logoUrl = branding?.logo ? this.safeHttpUrl(branding.logo) : '';
    return `<section class="panel panel--${this.state} ${treatment}" role="dialog" aria-modal="true" aria-labelledby="widget-title"><header class="panel-head"><div class="panel-branding">${logoUrl ? `<img class="publisher-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(config?.publisherName ?? '')}">` : `<p class="eyebrow">${escapeHtml(config?.publisherName ?? 'Content discovery')}</p>`}<h1 id="widget-title" class="panel-title">${escapeHtml(title)}</h1>${copy ? `<p class="panel-copy">${escapeHtml(copy)}</p>` : ''}</div><button class="icon-button" data-action="close" aria-label="Close guide">×</button></header>${body}</section>`;
  }

  private renderPanel(): string {
    if (this.state === 'intro') return this.panelShell(this.renderIntro());
    if (this.state === 'analysis') return this.panelShell(this.renderAnalysis());
    if (this.state === 'results') return this.panelShell(this.renderResults());
    if (this.state === 'error') return this.panelShell(this.renderError());
    return this.panelShell(this.renderQuestionnaire(), this.definition?.config.branding.introductoryCopy ?? '');
  }

  private renderIntro(): string {
    const branding = this.definition?.config.branding;
    return `<div class="content view-transition"><div class="intro"><div class="intro-visual" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 4v24M4 16h24M7.5 7.5l17 17M24.5 7.5l-17 17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="16" cy="16" r="4.5" stroke="currentColor" stroke-width="1.3"/></svg></div><p class="intro-kicker">Personalised reading</p><h2 class="intro-heading">Find the stories that matter to you</h2><p class="intro-copy">${escapeHtml(branding?.introductoryCopy ?? 'Answer two quick questions and we’ll find relevant stories from the publisher’s coverage.')}</p><div class="intro-points"><span class="intro-point">Two quick questions</span><span class="intro-point">Thoughtful recommendations</span></div><button class="button button-wide" data-action="begin" data-focus-start>Start exploring <span aria-hidden="true">→</span></button></div></div>`;
  }

  private renderQuestionnaire(): string {
    const questions = this.definition?.config.questions ?? [];
    const question = questions[this.step];
    if (!question) return '';
    const percent = Math.round(((this.step + 1) / questions.length) * 100);
    const options = question.options ?? [];
    const answer = this.answers[question.id];
    const optionMarkup = options.map((option) => {
      const checked = Array.isArray(answer) ? answer.includes(option.value) : answer === option.value;
      const inputType = question.type === 'multi-select' ? 'checkbox' : 'radio';
      return `<label class="option"><input type="${inputType}" name="${escapeHtml(question.id)}" value="${escapeHtml(option.value)}" data-question-id="${escapeHtml(question.id)}" ${checked ? 'checked' : ''}><span class="option-main"><span class="option-label">${escapeHtml(option.label)}</span>${option.description ? `<span class="option-description">${escapeHtml(option.description)}</span>` : ''}</span></label>`;
    }).join('');
    const inputMarkup = question.type === 'free-text' ? `<textarea class="free-text" data-question-id="${escapeHtml(question.id)}" placeholder="${escapeHtml(question.placeholder ?? '')}">${escapeHtml(typeof answer === 'string' ? answer : '')}</textarea>` : `<div class="options">${optionMarkup}</div>`;
    return `<div class="content view-transition"><div class="progress-meta"><span>Question ${this.step + 1} of ${questions.length}</span><span>${percent}%</span></div><div class="progress-track" aria-label="Questionnaire progress"><div class="progress-value" style="width:${percent}%"></div></div><p class="question-kicker">A little context</p><h2 class="question-heading">${escapeHtml(question.question)}</h2>${question.supportingText ? `<p class="question-support">${escapeHtml(question.supportingText)}</p>` : ''}${inputMarkup}<div class="actions">${this.step > 0 ? '<button class="button secondary" data-action="back">Back</button>' : '<span></span>'}<button class="button" data-action="continue" ${question.required && !this.isStepComplete() ? 'disabled' : ''}>${this.step === questions.length - 1 ? 'Find my stories' : 'Continue'} <span aria-hidden="true">→</span></button></div></div>`;
  }

  private renderAnalysis(): string {
    const stage = STAGE_COPY[this.stage];
    const currentIndex = STAGE_ORDER.indexOf(this.stage);
    const stages = STAGE_ORDER.map((name, index) => {
      const copy = STAGE_COPY[name];
      const complete = index < currentIndex;
      const active = index === currentIndex;
      return `<li class="analysis-stage ${complete ? 'complete' : ''} ${active ? 'active' : ''}" aria-current="${active ? 'step' : 'false'}"><span class="stage-icon" aria-hidden="true">${complete ? '✓' : active ? '•' : index + 1}</span><span>${copy.title}</span><span class="stage-status">${complete ? 'Complete' : active ? 'Working' : 'Next'}</span></li>`;
    }).join('');
    return `<div class="content analysis-content view-transition" aria-live="polite"><div class="analysis"><div class="analysis-heading"><div class="analysis-orbit" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></div><div><h2>${stage.title}</h2><p>${stage.detail}</p></div></div><ol class="analysis-stages">${stages}</ol><div class="analysis-bar" aria-label="${stage.percent}% complete"><span style="width:${stage.percent}%"></span></div></div></div>`;
  }

  private renderResults(): string {
    const config = this.definition?.config;
    if (this.results.length === 0) return `<div class="content">${this.renderEmpty()}</div>`;
    const featured = this.results[0];
    const also = this.results.slice(1);
    const summary = this.renderIntentSummary(config);
    return `<div class="content results-content view-transition"><div class="results-intro"><p class="results-kicker">Personalised reading</p><p class="results-summary">${escapeHtml(summary || (config?.results.description ?? ''))}</p></div><p class="section-label">Best match</p>${this.renderArticle(featured, true, 1)}${also.length ? `<p class="section-label">Also relevant</p><div class="article-grid">${also.map((result, index) => this.renderArticle(result, false, index + 2)).join('')}</div>` : ''}<div class="result-actions"><button class="button secondary" data-action="change">Change answers</button><button class="button secondary" data-action="restart">Start again</button></div></div>`;
  }

  private renderArticle(result: RankedArticle, featured = false, position = 0): string {
    const article = result.article;
    const date = formatDate(article.publishedAt);
    const url = this.safeHttpUrl(article.url);
    const imageUrl = article.imageUrl ? this.safeHttpUrl(article.imageUrl) : '';
    const image = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy">` : `<span class="image-fallback" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M9 34 19 23l7 7 5-6 8 10H9Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/></svg></span>`;
    const meta = `<div class="article-meta"><span>${escapeHtml(article.categories[0] ?? 'Story')}</span>${date ? `<span>${date}</span>` : ''}${article.author ? `<span>${escapeHtml(article.author)}</span>` : ''}</div>`;
    const target = this.definition?.config.results.openArticleInNewTab === false ? '' : ' target="_blank" rel="noopener noreferrer"';
    const cta = url ? `<a href="${escapeHtml(url)}"${target} data-action="article" data-article-id="${escapeHtml(article.id)}" data-article-position="${position}" data-article-category="${escapeHtml(article.categories[0] ?? 'Story')}" data-article-title="${escapeHtml(article.title)}" data-article-published-at="${escapeHtml(article.publishedAt ?? '')}" data-ranking-mode="${escapeHtml(result.rankingMode ?? 'deterministic')}">Read article <span aria-hidden="true">↗</span></a>` : '';
    if (featured) return `<article class="featured-card"><div class="featured-image">${image}</div><div class="featured-body"><span class="best-badge">Best match</span>${meta}<h3>${escapeHtml(article.title)}</h3><p class="article-description">${escapeHtml(article.description ?? '')}</p><p class="why"><strong>Why this matches you</strong>${escapeHtml(result.explanation)}</p>${cta}</div></article>`;
    return `<article class="article-card"><div class="article-image">${image}</div><div class="article-body">${meta}<h3>${escapeHtml(article.title)}</h3><p class="article-description">${escapeHtml(article.description ?? '')}</p><p class="why"><strong>Why this matches you</strong>${escapeHtml(result.explanation)}</p>${cta}</div></article>`;
  }

  private renderEmpty(): string {
    return `<div class="empty"><h2>We couldn’t find a strong match</h2><p>Try a different combination of answers and we’ll look again across the publisher’s coverage.</p><button class="button" data-action="change">Change answers</button></div>`;
  }

  private renderError(): string {
    const title = this.errorCode === 'invalid-publisher' ? 'This guide is not available' : 'We couldn’t load recommendations';
    return `<div class="content view-transition"><div class="error" role="alert"><h2>${title}</h2><p>${escapeHtml(this.errorCode === 'invalid-publisher' ? this.errorMessage : 'Please try again in a moment.')}</p>${this.errorCode === 'invalid-publisher' ? '' : '<button class="button" data-action="retry">Try again</button>'}</div></div>`;
  }

  async preview(mode: 'intro' | 'question-1' | 'question-2' | 'progress' | 'results' | 'empty' | 'error', scenarioAnswers?: Record<string, AnswerValue>): Promise<void> {
    if (mode === 'intro') { this.state = 'intro'; this.render(); return; }
    if (mode === 'question-1') { this.state = 'questionnaire'; this.step = 0; this.answers = {}; this.render(); return; }
    if (mode === 'question-2') { this.state = 'questionnaire'; this.step = 1; this.answers = { [this.definition?.config.questions[0]?.id ?? 'interest']: 'sustainability' }; this.render(); return; }
    if (mode === 'progress') { this.state = 'analysis'; this.stage = 'searching'; this.render(); return; }
    if (mode === 'empty') { this.state = 'results'; this.results = []; this.render(); return; }
    if (mode === 'error') { this.state = 'error'; this.errorCode = 'api-unavailable'; this.errorMessage = 'preview'; this.render(); return; }
    this.answers = scenarioAnswers ?? { [this.definition?.config.questions[0]?.id ?? 'interest']: 'sustainability', [this.definition?.config.questions[1]?.id ?? 'role']: 'manufacturer' };
    await this.runSearch();
  }

  private renderIntentSummary(config?: PublisherDefinition['config']): string {
    const interestQuestion = config?.questions.find((question) => question.id.toLowerCase().includes('interest') || question.id.toLowerCase().includes('topic'));
    const roleQuestion = config?.questions.find((question) => question.id.toLowerCase().includes('role') || question.id.toLowerCase().includes('persona') || question.id.toLowerCase().includes('describe'));
    const answerLabel = (question?: typeof interestQuestion): string => {
      if (!question) return '';
      const value = this.answers[question.id];
      const first = Array.isArray(value) ? value[0] : value;
      return first ? question.options?.find((option) => option.value === first)?.label ?? first : '';
    };
    const interest = answerLabel(interestQuestion).toLowerCase();
    const roleValue = roleQuestion ? this.answers[roleQuestion.id] : '';
    const roleKey = Array.isArray(roleValue) ? roleValue[0] : roleValue;
    const roleCopy: Record<string, string> = { manufacturer: 'your work making or building things', executive: 'your work leading a team or organisation', developer: 'your work with technology', student: 'your learning and research', 'curious-reader': 'your curiosity' };
    const role = roleCopy[roleKey ?? ''] ?? answerLabel(roleQuestion).toLowerCase();
    if (interest && role) return `Based on your interest in ${interest} and ${role}, these are a few thoughtful places to begin.`;
    if (interest) return `Based on your interest in ${interest}, these are a few thoughtful places to begin.`;
    return config?.results.description ?? 'A few thoughtful places to begin.';
  }

  private trapFocus(event: KeyboardEvent): void {
    const panel = this.root.querySelector<HTMLElement>('[role="dialog"]');
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]')];
    if (focusable.length === 0) return;
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

if (!customElements.get('content-discovery-widget')) customElements.define('content-discovery-widget', ContentDiscoveryWidget);
