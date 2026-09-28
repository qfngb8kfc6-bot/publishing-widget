import type { AnswerValue, Intent, PublisherConfig } from './types';

export function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeToken(value)
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

export function buildIntent(config: PublisherConfig, answers: Record<string, AnswerValue>): Intent {
  const keywords = new Set<string>();
  const interests: string[] = [];
  const personas: string[] = [];
  const queryParts: string[] = [];

  for (const question of config.questions) {
    const answer = answers[question.id];
    if (!answer || (Array.isArray(answer) && answer.length === 0)) continue;
    const values = Array.isArray(answer) ? answer : [answer];
    const labels = values.map((value) => question.options?.find((option) => option.value === value)?.label ?? value);
    queryParts.push(...labels);
    labels.flatMap(tokenize).forEach((token) => keywords.add(token));
    values.flatMap(tokenize).forEach((token) => keywords.add(token));
    if (question.id.toLowerCase().includes('interest') || question.id.toLowerCase().includes('topic')) interests.push(...labels);
    if (question.id.toLowerCase().includes('role') || question.id.toLowerCase().includes('describe') || question.id.toLowerCase().includes('persona')) personas.push(...labels);
  }

  return {
    publisherId: config.publisherId,
    answers,
    queryText: queryParts.join(' '),
    keywords: [...keywords],
    interests,
    personas,
  };
}
