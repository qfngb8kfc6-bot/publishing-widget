import { tokenize, type Intent } from '../core';
import type { AIExplanationResult, EnrichedIntent, SemanticCandidate } from './types';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown, max = 12, maxLength = 80): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().slice(0, maxLength)))].slice(0, max);
}

export function sanitizeEnrichedIntent(raw: unknown, baseIntent: Intent): EnrichedIntent | null {
  const value = record(raw);
  if (!value) return null;
  const primaryThemes = strings(value.primaryThemes, 8);
  const relatedThemes = strings(value.relatedThemes, 16);
  const searchTerms = strings(value.searchTerms, 20);
  const entities = strings(value.entities, 12);
  const excludedConcepts = strings(value.excludedConcepts, 12);
  const safeSearchTerms = searchTerms.length > 0 ? searchTerms : [...relatedThemes, ...baseIntent.keywords];
  const keywords = [...new Set([...baseIntent.keywords, ...safeSearchTerms.flatMap(tokenize)])];
  return {
    ...baseIntent,
    baseIntent,
    primaryThemes: primaryThemes.length > 0 ? primaryThemes : baseIntent.interests,
    relatedThemes,
    searchTerms: safeSearchTerms,
    entities,
    excludedConcepts,
    // Persona remains answer-derived; the model cannot silently invent a user attribute.
    persona: baseIntent.personas[0] ?? '',
    industry: undefined,
    keywords,
    queryText: [...new Set([baseIntent.queryText, ...safeSearchTerms])].filter(Boolean).join(' '),
  };
}

export interface ValidatedSemanticResult {
  articleId: string;
  semanticScore: number;
  signals: string[];
}

export function validateSemanticResults(raw: unknown, candidates: SemanticCandidate[]): ValidatedSemanticResult[] {
  const value = record(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(value?.results) ? value.results : [];
  const validIds = new Set(candidates.map((candidate) => candidate.articleId));
  const seen = new Set<string>();
  return list.flatMap((item) => {
    const result = record(item);
    const articleId = result?.articleId;
    const semanticScore = result?.semanticScore;
    if (typeof articleId !== 'string' || !validIds.has(articleId) || seen.has(articleId) || typeof semanticScore !== 'number' || !Number.isFinite(semanticScore) || semanticScore < 0 || semanticScore > 100) return [];
    seen.add(articleId);
    return [{ articleId, semanticScore, signals: strings(result?.signals, 3, 100) }];
  });
}

export function validateExplanationResults(raw: unknown, candidateIds: Set<string>): AIExplanationResult[] {
  const value = record(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(value?.results) ? value.results : [];
  const seen = new Set<string>();
  return list.flatMap((item) => {
    const result = record(item);
    const articleId = result?.articleId;
    const explanation = result?.explanation;
    if (typeof articleId !== 'string' || !candidateIds.has(articleId) || seen.has(articleId) || typeof explanation !== 'string' || !explanation.trim() || explanation.length > 600) return [];
    seen.add(articleId);
    return [{ articleId, explanation: explanation.trim() }];
  });
}
