import { createPublisherRegistry } from './publishers/registry';
import { mountWidget } from './widget/mount';
import { BatchingAnalyticsClient, attachAnalyticsPageLifecycle } from './analytics/client';

export { mountWidget };
export const publisherRegistry = createPublisherRegistry();
export const analyticsClient = new BatchingAnalyticsClient();
if (typeof document !== 'undefined') attachAnalyticsPageLifecycle(analyticsClient);

function isDevelopmentHost(): boolean {
  return typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|::1)$/.test(location.hostname);
}

if (typeof document !== 'undefined') {
  const script = document.currentScript;
  const publisherId = script?.getAttribute('data-publisher') ?? 'demo';
  const position = script?.getAttribute('data-position');
  const debug = script?.getAttribute('data-debug') === 'true' && isDevelopmentHost() && import.meta.env.DEV;
  const existing = document.querySelector('content-discovery-widget[data-content-discovery-mounted="true"]');
  if (!existing) {
    const widget = mountWidget(publisherRegistry, publisherId, analyticsClient, document, debug ? (event) => console.debug('[content-discovery]', event) : undefined, undefined, { position: position === 'bottom-left' ? 'bottom-left' : 'bottom-right', generationEndpoint: script?.getAttribute('data-generation-endpoint') ?? '/api/reports/generate' });
    widget.dataset.contentDiscoveryMounted = 'true';
  }
}
