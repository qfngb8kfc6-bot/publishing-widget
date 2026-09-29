import { ANALYTICS_SCHEMA_VERSION } from '../core';
import type { AnalyticsEvent, AnalyticsEventName, AnalyticsMetadata, AnalyticsMetadataValue } from '../core';
import type { StoredAnalyticsEvent } from '../analytics/types';

export const MAX_ANALYTICS_PAYLOAD_BYTES = 32_000;
const EVENT_NAMES = new Set<AnalyticsEventName>(['widget_impression', 'widget_opened', 'intro_viewed', 'question_answered', 'search_started', 'search_completed', 'result_impression', 'article_clicked', 'change_answers', 'restart_clicked', 'widget_closed', 'search_failed']);
const ALLOWED_METADATA_KEYS = new Set(['answerType', 'answerCount', 'questionId', 'questionKind', 'answerOptionId', 'answerOptionIds', 'freeTextUsed', 'articleId', 'articlePosition', 'articleCategory', 'articleTitle', 'articlePublishedAt', 'rankingMode', 'resultCount', 'aiExplanationUsed', 'errorCode', 'answersChanged', 'userRestarted']);

function isValue(value: unknown): value is AnalyticsMetadataValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function validateAnalyticsEvent(input: unknown, now = Date.now()): StoredAnalyticsEvent {
  if (!input || typeof input !== 'object') throw new Error('event must be an object');
  const value = input as Record<string, unknown>;
  if (typeof value.eventId !== 'string' || value.eventId.length < 4 || value.eventId.length > 120) throw new Error('eventId is required');
  if (value.schemaVersion !== ANALYTICS_SCHEMA_VERSION) throw new Error('unsupported analytics schema version');
  if (typeof value.name !== 'string' || !EVENT_NAMES.has(value.name as AnalyticsEventName)) throw new Error('unsupported event name');
  if (typeof value.publisherId !== 'string' || !/^[a-z][a-z0-9-]{1,80}$/.test(value.publisherId)) throw new Error('invalid publisherId');
  if (typeof value.sessionId !== 'string' || value.sessionId.length < 4 || value.sessionId.length > 160) throw new Error('invalid sessionId');
  if (typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) || Date.parse(value.timestamp) > now + 300_000) throw new Error('invalid timestamp');
  if (value.widgetVersion !== undefined && (typeof value.widgetVersion !== 'string' || value.widgetVersion.length > 40)) throw new Error('invalid widgetVersion');
  if (value.publisherConfigVersion !== undefined && (typeof value.publisherConfigVersion !== 'string' || value.publisherConfigVersion.length > 40)) throw new Error('invalid publisherConfigVersion');
  const metadata: AnalyticsMetadata = {};
  if (value.metadata !== undefined) {
    if (!value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata)) throw new Error('metadata must be an object');
    for (const [key, item] of Object.entries(value.metadata as Record<string, unknown>)) {
      if (!ALLOWED_METADATA_KEYS.has(key)) throw new Error(`metadata key is not allowed: ${key}`);
      if (!isValue(item) || (typeof item === 'string' && item.length > 500)) throw new Error(`invalid metadata value: ${key}`);
      metadata[key] = item;
    }
  }
  if (value.name === 'question_answered' && metadata.answerType === 'free-text' && 'answerOptionId' in metadata) throw new Error('free-text events may not include answer values');
  return { eventId: value.eventId, schemaVersion: value.schemaVersion, name: value.name as AnalyticsEventName, publisherId: value.publisherId, sessionId: value.sessionId, timestamp: value.timestamp, widgetVersion: typeof value.widgetVersion === 'string' ? value.widgetVersion : undefined, publisherConfigVersion: typeof value.publisherConfigVersion === 'string' ? value.publisherConfigVersion : undefined, metadata, receivedAt: new Date(now).toISOString() };
}
