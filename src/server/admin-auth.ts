import { SlidingWindowRateLimiter, requestRateLimitKey } from './rate-limit';

const SESSION_COOKIE = 'ld_admin_session';
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface AdminSession { expiresAt: number; }

function sessionToken(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function equalSecret(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  return difference === 0;
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.get('Cookie')?.split(';') ?? [];
  const prefix = `${name}=`;
  return cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
}

function ttlFromEnvironment(environment: Record<string, string | undefined>): number {
  const configured = Number(environment.ADMIN_SESSION_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, MAX_SESSION_TTL_MS) : DEFAULT_SESSION_TTL_MS;
}

export class AdminAuth {
  private readonly sessions = new Map<string, AdminSession>();
  private readonly password?: string;
  private readonly ttlMs: number;

  constructor(private readonly environment: 'development' | 'test' | 'production', serverEnvironment: Record<string, string | undefined>, private readonly limiter = new SlidingWindowRateLimiter({ limit: 8, windowMs: 60_000 })) {
    this.password = serverEnvironment.ADMIN_PASSWORD?.trim() || undefined;
    this.ttlMs = ttlFromEnvironment(serverEnvironment);
  }

  get configured(): boolean { return Boolean(this.password); }

  async verify(password: string, request: Request): Promise<{ ok: boolean; retryAfterSeconds?: number; cookie?: string }> {
    const decision = this.limiter.check(requestRateLimitKey(request, 'admin-login'));
    if (!decision.allowed) return { ok: false, retryAfterSeconds: decision.retryAfterSeconds };
    if (!this.password || password.length > 512 || !(await equalSecret(password, this.password))) return { ok: false };
    const token = sessionToken();
    this.sessions.set(token, { expiresAt: Date.now() + this.ttlMs });
    return { ok: true, cookie: this.cookie(token) };
  }

  isAuthenticated(request: Request): boolean {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) { this.sessions.delete(token); return false; }
    return true;
  }

  logout(request: Request): string {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) this.sessions.delete(token);
    return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${this.environment === 'production' ? '; Secure' : ''}`;
  }

  cookie(token: string): string {
    return `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(this.ttlMs / 1000)}; Path=/; HttpOnly; SameSite=Strict${this.environment === 'production' ? '; Secure' : ''}`;
  }
}

export function adminOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
