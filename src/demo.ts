import { createPublisherRegistry } from './publishers/registry';
import { mountWidget } from './widget/mount';
import { renderAnalyticsDashboard } from './analytics-dashboard';
import { PRODUCT_IDENTITY } from './product';
import { wireLiveDemoButtons } from './demo/live-demo';
import { renderHostedRoute } from './hosted';

const isDevelopment = import.meta.env.DEV;

if (isDevelopment) {
  document.body.classList.add('development-mode');
  const salesControls = document.createElement('aside');
  salesControls.className = 'sales-mode';
  salesControls.setAttribute('aria-label', 'Sales demonstration controls');
  salesControls.innerHTML = '<strong>Demo controls</strong><button type="button" data-demo-scenario="marine">Marine industry</button><button type="button" data-demo-scenario="finance">Finance</button><button type="button" data-demo-scenario="technology">Technology</button><button type="button" data-demo-scenario="science">Science</button><a href="/analytics?publisher=demo&admin=1&sample=1">Open publisher insights</a><a href="/embed-test.html">Open embed test</a><button type="button" data-demo-reset>Restart demo</button>';
  document.body.appendChild(salesControls);
}

document.querySelectorAll<HTMLElement>('[data-product-name]').forEach((element) => { element.textContent = PRODUCT_IDENTITY.name; });

if (window.location.pathname.startsWith('/p/')) {
  void renderHostedRoute(document, createPublisherRegistry());
} else if (window.location.pathname === '/analytics' || window.location.pathname === '/dashboard') {
  void renderAnalyticsDashboard(document.body);
} else {
  const params = new URLSearchParams(window.location.search);
  const debug = isDevelopment && params.get('debug') === '1' ? (event: unknown) => console.debug('[publisher-widget-debug]', event) : undefined;
  const widget = mountWidget(createPublisherRegistry(), params.get('publisher') ?? 'demo', undefined, document, debug, undefined, { generationEndpoint: '/api/reports/generate' });
  const openLiveDemo = () => {
    document.querySelector('#live-demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    widget.openWidget();
  };
  const scenarioProfiles: Record<string, [string, string]> = {
    marine: ['sunseeker.com', 'Head of Procurement'],
    finance: ['jpmorgan.com', 'Investment Analyst'],
    technology: ['microsoft.com', 'Chief Technology Officer'],
    science: ['ldsystems.uk', 'Research professional'],
  };
  document.querySelectorAll<HTMLButtonElement>('[data-scenario], [data-demo-scenario]').forEach((button) => button.addEventListener('click', () => {
    const profile = scenarioProfiles[button.dataset.scenario ?? button.dataset.demoScenario ?? ''];
    if (profile) { widget.prefillProfile(profile[0], profile[1]); openLiveDemo(); }
  }));
  wireLiveDemoButtons(document, openLiveDemo);
  document.querySelector<HTMLButtonElement>('[data-demo-reset]')?.addEventListener('click', openLiveDemo);
}
