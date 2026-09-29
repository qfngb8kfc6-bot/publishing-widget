import type { PublisherConfig } from './types';
import type { PublisherManifest } from '../publishers/manifest';

export function validatePublisherConfig(config: PublisherConfig): void {
  if (!config.publisherId.trim()) throw new Error('Publisher configuration requires publisherId.');
  if (!config.publisherName.trim()) throw new Error('Publisher configuration requires publisherName.');
  if (config.questions.length === 0) throw new Error('Publisher configuration requires at least one question.');
  const questionIds = new Set<string>();
  for (const question of config.questions) {
    if (!question.id.trim() || questionIds.has(question.id)) throw new Error(`Question id must be unique: ${question.id}`);
    questionIds.add(question.id);
    if (!question.question.trim()) throw new Error(`Question ${question.id} requires question text.`);
    if (question.type !== 'free-text' && (!question.options || question.options.length === 0)) {
      throw new Error(`Question ${question.id} requires options.`);
    }
  }
  if (config.content.resultLimit < 1 || config.content.candidateRetrievalLimit < config.content.resultLimit) {
    throw new Error('Content limits must be positive and candidateRetrievalLimit must cover resultLimit.');
  }
}

export function validatePublisherManifest(manifest: PublisherManifest): void {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(manifest.publisherId)) throw new Error('Publisher id must be kebab-case and start with a letter.');
  if (!manifest.name.trim()) throw new Error('Publisher manifest requires name.');
  if (!manifest.enabled) throw new Error(`Publisher ${manifest.publisherId} is disabled.`);
  if (!manifest.publisherConfigVersion.trim()) throw new Error('Publisher manifest requires publisherConfigVersion.');
  if (!manifest.content.adapterId.trim()) throw new Error('Publisher manifest requires content.adapterId.');
  if (manifest.allowedOrigins?.some((origin) => !/^https?:\/\/[^\s/]+(?:\/.*)?$/i.test(origin))) throw new Error('Publisher manifest contains an invalid allowed origin.');
  if (manifest.api?.timeoutMs !== undefined && manifest.api.timeoutMs < 1) throw new Error('Publisher API timeout must be positive.');
  if (manifest.ranking) {
    const deterministic = manifest.ranking.deterministicWeight ?? 0.7;
    const semantic = manifest.ranking.semanticWeight ?? 0.3;
    if (deterministic < 0 || semantic < 0 || deterministic + semantic <= 0) throw new Error('Publisher ranking weights must be non-negative and non-zero.');
  }
  validatePublisherConfig({
    publisherId: manifest.publisherId,
    publisherName: manifest.name,
    branding: {
      primaryColor: manifest.branding.primaryAccent ?? manifest.branding.primaryColor ?? '#244d3b',
      secondaryColor: manifest.branding.secondaryColor ?? '#e8efe6',
      launcherText: manifest.branding.launcherText ?? 'Find stories for you',
      widgetTitle: manifest.branding.widgetTitle ?? `Your ${manifest.name} guide`,
      introductoryCopy: manifest.branding.introductoryCopy ?? 'Answer a few questions and we will find relevant stories.',
    },
    questions: manifest.questions,
    content: { adapterType: manifest.content.adapterId, resultLimit: manifest.content.resultLimit, candidateRetrievalLimit: manifest.content.candidateRetrievalLimit },
    results: manifest.results,
  });
}
