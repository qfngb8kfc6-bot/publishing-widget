import type { AnalyticsStore } from '../analytics/types';
import { MAX_ANALYTICS_PAYLOAD_BYTES, validateAnalyticsEvent } from './analytics-validation';

export interface AnalyticsRouteOptions {
  maxPayloadBytes?: number;
  isPublisherAllowed?: (publisherId: string) => boolean;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createAnalyticsIngestionRoute(store: AnalyticsStore, options: AnalyticsRouteOptions = {}) {
  const maxBytes = options.maxPayloadBytes ?? MAX_ANALYTICS_PAYLOAD_BYTES;
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const body = await request.text();
    if (byteLength(body) > maxBytes) return Response.json({ error: 'payload_too_large' }, { status: 413 });
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
    const candidates = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown }).events) ? (parsed as { events: unknown[] }).events : null;
    if (!candidates || candidates.length === 0 || candidates.length > 100) return Response.json({ error: 'events_must_be_a_non_empty_array' }, { status: 400 });
    try {
      const events = candidates.map((candidate) => validateAnalyticsEvent(candidate));
      if (events.some((event) => options.isPublisherAllowed && !options.isPublisherAllowed(event.publisherId))) return Response.json({ error: 'publisher_not_allowed' }, { status: 403 });
      await store.append(events);
      return Response.json({ accepted: events.length }, { status: 202 });
    } catch (error) {
      return Response.json({ error: 'invalid_event', detail: error instanceof Error ? error.message : 'invalid event' }, { status: 400 });
    }
  };
}
