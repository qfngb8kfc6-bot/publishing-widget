export interface ServerLogFields { requestId?: string; publisherId?: string; route?: string; durationMs?: number; status?: number; errorType?: string; }

export interface StructuredLogger { info(message: string, fields?: ServerLogFields): void; error(message: string, fields?: ServerLogFields): void; }

export function createStructuredLogger(environment: 'development' | 'test' | 'production' = 'production'): StructuredLogger {
  const write = (level: 'info' | 'error', message: string, fields: ServerLogFields = {}) => {
    const payload = { timestamp: new Date().toISOString(), level, message, ...fields };
    if (level === 'error' || environment !== 'production') console[level]('[publisher-widget]', JSON.stringify(payload));
  };
  return { info: (message, fields) => write('info', message, fields), error: (message, fields) => write('error', message, fields) };
}

export function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
