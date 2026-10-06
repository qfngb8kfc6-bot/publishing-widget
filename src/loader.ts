import { createPublisherRegistry } from './publishers/registry';
import { mountWidget } from './widget/mount';
import { BatchingAnalyticsClient, attachAnalyticsPageLifecycle } from './analytics/client';

const script = document.currentScript as HTMLScriptElement | null;
const publisherId = script?.dataset.publisher ?? 'demo';
const registry = createPublisherRegistry();
const analyticsClient = new BatchingAnalyticsClient();
attachAnalyticsPageLifecycle(analyticsClient);

if (!document.querySelector('content-discovery-widget[data-content-discovery-mounted="true"]')) {
  const widget = mountWidget(registry, publisherId, analyticsClient, document, undefined, undefined, { position: script?.dataset.position === 'bottom-left' ? 'bottom-left' : 'bottom-right', generationEndpoint: script?.dataset.generationEndpoint ?? '/api/reports/generate' });
  widget.dataset.contentDiscoveryMounted = 'true';
}
