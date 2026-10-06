import { defaultAIConfig } from './config';
import { MockAIProvider } from './providers/mock';
import type { AIRecommendationLayer } from './types';

/** Test-only compatibility provider. It is never activated by the sales or production embed. */
export function createMockAIRecommendationLayer(): AIRecommendationLayer {
  return { config: { ...defaultAIConfig, enabled: true, provider: 'mock' }, provider: new MockAIProvider() };
}
