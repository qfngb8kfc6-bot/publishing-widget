import type { PublisherConfig } from './types';

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
