export async function readJsonBody(request: Request, maxBytes = 32_000): Promise<unknown> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) throw new Error('payload_too_large');
  try { return JSON.parse(body); } catch { throw new Error('invalid_json'); }
}

export function safeRouteId(value: string | undefined): string | null {
  return value && /^[a-z][a-z0-9-]{1,80}$/.test(value) ? value : null;
}
