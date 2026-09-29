import { createPublisherRegistry } from './publishers/registry';
import { mountWidget } from './widget/mount';
import { createMockAIRecommendationLayer } from './ai/recommendation';
import { renderAnalyticsDashboard } from './analytics-dashboard';

if (window.location.pathname === '/analytics') {
  void renderAnalyticsDashboard(document.body);
} else {
  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === '1' ? (event: unknown) => console.debug('[publisher-widget-debug]', event) : undefined;
  const ai = params.get('ai') === 'mock' ? createMockAIRecommendationLayer() : undefined;
  const widget = mountWidget(createPublisherRegistry(), params.get('publisher') ?? 'demo', undefined, document, debug, ai);
  const preview = params.get('preview') as Parameters<typeof widget.preview>[0] | null;
  if (preview) void widget.preview(preview);
}
