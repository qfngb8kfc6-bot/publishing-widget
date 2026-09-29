import { defaultAIConfig } from './config';
import { MockAIProvider } from './providers/mock';
import type { AIRecommendationLayer } from './types';

export function createMockAIRecommendationLayer(): AIRecommendationLayer {
  return { config: { ...defaultAIConfig, enabled: true, provider: 'mock' }, provider: new MockAIProvider() };
}
