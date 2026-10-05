import { WIDGET_VERSION } from '../version';
import type { PublisherRegistry } from '../core';
import { validatePublisherServerConfig } from './env';
import type { ServerEnvironment } from './env';

export function createGlobalHealthResponse(environment: 'development' | 'test' | 'production', commitSha?: string): Response {
  return Response.json({ status: 'ok', version: WIDGET_VERSION, environment, ...(commitSha ? { commitSha } : {}) });
}

export function createReadinessResponse(environment: 'development' | 'test' | 'production', analyticsStore: 'memory' | 'postgres', commitSha?: string): Response {
  const ready = environment !== 'production' || analyticsStore === 'postgres';
  return Response.json({ status: ready ? 'ready' : 'not_ready', version: WIDGET_VERSION, environment, analyticsStore, ...(commitSha ? { commitSha } : {}) }, { status: ready ? 200 : 503 });
}

export function createPublisherHealthResponse(registry: PublisherRegistry, publisherId: string, environment: 'development' | 'test' | 'production', serverEnvironment: ServerEnvironment): Response {
  const definition = registry.get(publisherId);
  if (!definition) return Response.json({ status: 'not_found' }, { status: 404 });
  try {
    if (definition.manifest) validatePublisherServerConfig(definition.manifest, serverEnvironment);
    return Response.json({ status: 'ok', publisherId, manifest: 'registered', serverConfig: 'valid' });
  } catch {
    return Response.json({ status: 'degraded', publisherId, manifest: 'registered', serverConfig: 'missing' }, { status: 503 });
  }
}
