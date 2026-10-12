import type { PublisherConfig } from './types';
import type { PublisherManifest } from '../publishers/manifest';
import { DEFAULT_THEME } from './theme';

export function isValidPublisherId(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

export function normalizeAllowedOrigin(value: string): string {
  const origin = new URL(value).origin;
  if (origin !== value.replace(/\/$/, '')) throw new Error('Allowed origins must be exact HTTP(S) origins without paths or credentials.');
  return origin;
}

export function validateAllowedOrigins(origins: string[] | undefined): void {
  if (!origins) return;
  const normalized = origins.map((origin) => {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || /[*\s]/.test(origin)) throw new Error('invalid');
      return parsed.origin;
    } catch {
      throw new Error('Publisher manifest contains an invalid allowed origin. Use an exact HTTP(S) origin without a path.');
    }
  });
  if (new Set(normalized).size !== normalized.length) throw new Error('Publisher manifest contains duplicate allowed origins.');
}

const sensitiveHeader = /authorization|api[-_]?key|token|secret|password|cookie|set-cookie/i;

export function validatePublicHeaders(headers: Record<string, string> | undefined): void {
  if (Object.keys(headers ?? {}).some((name) => sensitiveHeader.test(name))) throw new Error('Content source headers may not contain credentials; use a server-side secret reference.');
}

export function validatePublisherConfig(config: PublisherConfig): void {
  if (!config.publisherId.trim()) throw new Error('Publisher configuration requires publisherId.');
  if (!config.publisherName.trim()) throw new Error('Publisher configuration requires publisherName.');
  const questions = config.questions ?? [];
  const questionIds = new Set<string>();
  for (const question of questions) {
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

export function validatePublisherManifest(manifest: PublisherManifest, options: { allowDisabled?: boolean } = {}): void {
  if (!isValidPublisherId(manifest.publisherId)) throw new Error('Publisher id must be kebab-case and start with a letter.');
  if (!manifest.name.trim()) throw new Error('Publisher manifest requires name.');
  if (!manifest.enabled && !options.allowDisabled) throw new Error(`Publisher ${manifest.publisherId} is disabled.`);
  if (!manifest.publisherConfigVersion.trim()) throw new Error('Publisher manifest requires publisherConfigVersion.');
  if (!manifest.content.adapterId.trim()) throw new Error('Publisher manifest requires content.adapterId.');
  validateAllowedOrigins(manifest.allowedOrigins);
  if (manifest.api?.timeoutMs !== undefined && manifest.api.timeoutMs < 1) throw new Error('Publisher API timeout must be positive.');
  const source = manifest.contentSource;
  if (source?.type === 'rest-json') {
    if (!source.baseUrl.trim() || !source.endpoint.trim()) throw new Error('REST content source requires baseUrl and endpoint.');
    if (source.timeoutMs !== undefined && source.timeoutMs < 1) throw new Error('Content source timeout must be positive.');
    if (source.candidateLimit !== undefined && (source.candidateLimit < 1 || source.candidateLimit > 100)) throw new Error('Content source candidateLimit must be between 1 and 100.');
    if (source.pagination?.pageSize !== undefined && source.pagination.pageSize < 1) throw new Error('Content source pageSize must be positive.');
    if (source.pagination?.maxPages !== undefined && (source.pagination.maxPages < 1 || source.pagination.maxPages > 20)) throw new Error('Content source maxPages must be between 1 and 20.');
    validatePublicHeaders(source.headers);
  }
  if ((source?.type === 'rss' || source?.type === 'atom') && !source.feedUrl.trim()) throw new Error('Feed content source requires feedUrl.');
  if (source?.type === 'rss' || source?.type === 'atom') validatePublicHeaders(source.headers);
  if (source?.type === 'sitemap' && !source.sitemapUrl.trim()) throw new Error('Sitemap content source requires sitemapUrl.');
  if (manifest.ranking) {
    const deterministic = manifest.ranking.deterministicWeight ?? 0.7;
    const semantic = manifest.ranking.semanticWeight ?? 0.3;
    if (deterministic < 0 || semantic < 0 || deterministic + semantic <= 0) throw new Error('Publisher ranking weights must be non-negative and non-zero.');
  }
  validatePublisherConfig({
    publisherId: manifest.publisherId,
    publisherName: manifest.name,
    branding: {
      primaryColor: manifest.branding.primaryAccent ?? manifest.branding.primaryColor ?? DEFAULT_THEME.indigo,
      secondaryColor: manifest.branding.secondaryColor ?? DEFAULT_THEME.surfaceMuted,
      widgetTitle: manifest.branding.widgetTitle ?? `Build your ${manifest.name} briefing`,
      introductoryCopy: manifest.branding.introductoryCopy ?? 'Tell us where you work and what you do. We will build a briefing from this publisher’s coverage.',
    },
    questions: manifest.questions,
    content: { adapterType: manifest.content.adapterId, resultLimit: manifest.content.resultLimit, candidateRetrievalLimit: manifest.content.candidateRetrievalLimit },
    results: manifest.results,
  });
}
