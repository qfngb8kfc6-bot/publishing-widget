import type { AnalyticsClient, DebugSink, PublisherRegistry } from '../core';
import type { AIRecommendationLayer } from '../ai/types';
import { ContentDiscoveryWidget } from './widget';

export type WidgetPosition = 'bottom-right' | 'bottom-left';

export interface MountOptions {
  position?: WidgetPosition;
  debug?: DebugSink;
  ai?: AIRecommendationLayer;
}

export function mountWidget(registry: PublisherRegistry, publisherId = 'demo', analytics?: AnalyticsClient, target: Element | Document = document, debug?: DebugSink, ai?: AIRecommendationLayer, options?: MountOptions): ContentDiscoveryWidget {
  const element = document.createElement('content-discovery-widget') as ContentDiscoveryWidget;
  element.dataset.publisher = publisherId;
  element.dataset.position = options?.position ?? 'bottom-right';
  element.configure(registry, analytics, debug, ai);
  const container = target instanceof Document ? (target.body ?? target.documentElement) : target;
  container.appendChild(element);
  return element;
}
