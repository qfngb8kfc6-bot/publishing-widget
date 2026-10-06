import type { AnalyticsClient, DebugSink, PublisherRegistry } from '../core';
import type { AIRecommendationLayer } from '../ai/types';
import { ContentDiscoveryWidget } from './widget';
import { CONTENT_DISCOVERY_ELEMENT_NAME, ensureContentDiscoveryElementRegistered } from './registration';

export type WidgetPosition = 'bottom-right' | 'bottom-left';

export interface MountOptions {
  position?: WidgetPosition;
  debug?: DebugSink;
  generationEndpoint?: string;
}

export function mountWidget(registry: PublisherRegistry, publisherId = 'demo', analytics?: AnalyticsClient, target: Element | Document = document, debug?: DebugSink, ai?: AIRecommendationLayer, options?: MountOptions): ContentDiscoveryWidget {
  ensureContentDiscoveryElementRegistered(ContentDiscoveryWidget);
  const element = document.createElement(CONTENT_DISCOVERY_ELEMENT_NAME) as ContentDiscoveryWidget;
  if (typeof element.configure !== 'function' || typeof element.openWidget !== 'function') {
    throw new Error(`[${CONTENT_DISCOVERY_ELEMENT_NAME}] registered element is incompatible; configure() and openWidget() are required before mounting.`);
  }
  element.dataset.publisher = publisherId;
  element.dataset.position = options?.position ?? 'bottom-right';
  if (options?.generationEndpoint) element.dataset.generationEndpoint = options.generationEndpoint;
  element.configure(registry, analytics, debug, ai);
  const container = target instanceof Document ? (target.body ?? target.documentElement) : target;
  container.appendChild(element);
  return element;
}
