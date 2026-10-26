import { createPublisherRegistry } from './publishers/registry';
import { mountWidget, parseWidgetPosition } from './widget/mount';
import { BatchingAnalyticsClient, attachAnalyticsPageLifecycle } from './analytics/client';
import { apiUrl, findWidgetScript, widgetApiBase } from './widget/api-base';

// Captured while widget.js executes: currentScript is null once the script has finished running.
const widgetScript = typeof document !== 'undefined' ? findWidgetScript(document, document.currentScript) : null;
const apiBase = typeof document !== 'undefined' ? widgetApiBase(widgetScript, document) : undefined;

export { mountWidget };
export const publisherRegistry = createPublisherRegistry();
export const analyticsClient = new BatchingAnalyticsClient({ endpoint: apiUrl(apiBase, '/api/analytics/events') });
if (typeof document !== 'undefined') attachAnalyticsPageLifecycle(analyticsClient);

function isDevelopmentHost(): boolean {
  return typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|::1)$/.test(location.hostname);
}

if (typeof document !== 'undefined') {
  const script = widgetScript;
  const publisherId = script?.getAttribute('data-publisher') ?? 'demo';
  const position = script?.getAttribute('data-position');
  const debug = script?.getAttribute('data-debug') === 'true' && isDevelopmentHost() && import.meta.env.DEV;
  const existing = document.querySelector('content-discovery-widget[data-content-discovery-mounted="true"]');
  if (!existing) {
    const widget = mountWidget(publisherRegistry, publisherId, analyticsClient, document, debug ? (event) => console.debug('[content-discovery]', event) : undefined, undefined, { position: parseWidgetPosition(position), generationEndpoint: script?.getAttribute('data-generation-endpoint') ?? apiUrl(apiBase, '/api/reports/generate') });
    widget.dataset.contentDiscoveryMounted = 'true';
  }
}
