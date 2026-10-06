import { createPublisherRegistry } from './publishers/registry';
import { mountWidget } from './widget/mount';
import { createMockAIRecommendationLayer } from './ai/recommendation';
import { renderAnalyticsDashboard } from './analytics-dashboard';
import { PRODUCT_IDENTITY } from './product';

const isDevelopment = import.meta.env.DEV;
if (isDevelopment) {
  document.body.classList.add('development-mode');
  const previewControls = document.createElement('nav');
  previewControls.className = 'demo-preview';
  previewControls.setAttribute('aria-label', 'Development preview states');
  previewControls.innerHTML = '<a href="?preview=intro">Intro</a><a href="?preview=question-1">Q1</a><a href="?preview=question-2">Q2</a><a href="?preview=progress">Progress</a><a href="?preview=results&ai=mock">Results</a><a href="?preview=empty">Empty</a><a href="?preview=error">Error</a>';
  document.body.appendChild(previewControls);
  const salesControls = document.createElement('aside');
  salesControls.className = 'sales-mode';
  salesControls.setAttribute('aria-label', 'Sales demonstration controls');
  salesControls.innerHTML = '<strong>Demo controls</strong><a href="?sales=1&scenario=marine&preview=results&ai=mock">Marine industry</a><a href="?sales=1&scenario=finance&preview=results">Finance</a><a href="?sales=1&scenario=technology&preview=results&ai=mock">Technology</a><a href="?sales=1&scenario=science&preview=results&ai=mock">Science</a><a href="/analytics?publisher=demo&admin=1">Open publisher insights</a><a href="/embed-test.html">Open embed test</a><button type="button" data-demo-reset>Restart demo</button>';
  document.body.appendChild(salesControls);
}
document.querySelectorAll<HTMLElement>('[data-product-name]').forEach((element) => { element.textContent = PRODUCT_IDENTITY.name; });
if (window.location.pathname === '/analytics' || window.location.pathname === '/dashboard') {
  void renderAnalyticsDashboard(document.body);
} else {
  const params = new URLSearchParams(window.location.search);
  if (!isDevelopment) document.querySelector('.demo-preview')?.remove();
  const debug = isDevelopment && params.get('debug') === '1' ? (event: unknown) => console.debug('[publisher-widget-debug]', event) : undefined;
  const ai = params.get('publisher') === 'real-publisher' ? undefined : (isDevelopment || params.get('publisher') === 'demo' || !params.get('publisher')) ? createMockAIRecommendationLayer() : undefined;
  if (isDevelopment && params.get('sales') === '1') document.body.classList.add('sales-mode-active');
  if (!isDevelopment || params.get('sales') !== '1') document.querySelector('.sales-mode')?.remove();
  const widget = mountWidget(createPublisherRegistry(), params.get('publisher') ?? 'demo', undefined, document, debug, ai);
  const openLiveDemo = () => { document.querySelector('#live-demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); void widget.preview('intro'); };
  const preview = isDevelopment ? params.get('preview') as Parameters<typeof widget.preview>[0] | null : null;
  const scenarios: Record<string, Record<string, import('./core').AnswerValue>> = { marine: { interest: 'sustainability', role: 'manufacturer' }, finance: { interest: 'business', role: 'executive' }, technology: { interest: 'technology', role: 'developer' }, science: { interest: 'science', role: 'student' } };
  if (preview) void widget.preview(preview, scenarios[params.get('scenario') ?? ''] as Record<string, import('./core').AnswerValue> | undefined);
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => button.addEventListener('click', () => { void widget.preview('results', scenarios[button.dataset.scenario ?? '']); }));
  document.querySelectorAll<HTMLElement>('[data-live-demo]').forEach((element) => element.addEventListener('click', (event) => { event.preventDefault(); openLiveDemo(); }));
  document.querySelector<HTMLButtonElement>('[data-open-reader]')?.addEventListener('click', openLiveDemo);
  document.querySelector<HTMLButtonElement>('[data-demo-reset]')?.addEventListener('click', () => { void widget.preview('intro'); document.querySelector('#experience')?.scrollIntoView({ behavior: 'smooth' }); });
}
