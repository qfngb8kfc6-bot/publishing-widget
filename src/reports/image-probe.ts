import { assertSafePublicUrl } from '../publishers/content/security';

/**
 * Server-side logo detection for story images, used when the browser cannot read an image's pixels (a host
 * without CORS). Only the first bytes of the file are fetched, from allowlisted image hosts, with a short timeout;
 * the dimensions and format in the header decide. Never blocks a report: any failure leaves the image as before.
 */

export interface ImageHeader {
  format: 'png' | 'gif' | 'jpeg' | 'webp' | 'svg';
  width: number;
  height: number;
  /** PNG colour types with an alpha channel, or a palette PNG with a transparency chunk seen in the header. */
  alpha?: boolean;
  /** Palette (indexed-colour) PNG: flat graphics such as logos, rarely a photo. */
  palette?: boolean;
}

/** Wider than this (width / height) is a banner or wordmark logo, not a photo (same as the browser check). */
export const LOGO_ASPECT_RATIO = 2.4;
export const IMAGE_PROBE_MAX_BYTES = 64 * 1024;
export const IMAGE_PROBE_TIMEOUT_MS = 1_500;
const CACHE_LIMIT = 2_000;
const LOGO_FILE_NAME = /(?:^|[/_.-])logos?(?:[_.-]|$)/i;

const u16be = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
const u16le = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
const u24le = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
const u32be = (bytes: Uint8Array, offset: number) => ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));

/** Width, height and format from the first bytes of a PNG, GIF, JPEG, WebP or SVG file; undefined otherwise. */
export function parseImageHeader(bytes: Uint8Array): ImageHeader | undefined {
  if (bytes.length >= 26 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && ascii(bytes, 12, 4) === 'IHDR') {
    const colourType = bytes[25];
    const transparency = colourType === 3 && ascii(bytes, 0, Math.min(bytes.length, 4096)).includes('tRNS');
    return { format: 'png', width: u32be(bytes, 16), height: u32be(bytes, 20), alpha: colourType === 4 || colourType === 6 || transparency, palette: colourType === 3 };
  }
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === 'GIF') return { format: 'gif', width: u16le(bytes, 6), height: u16le(bytes, 8) };
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') return { format: 'webp', width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1, alpha: Boolean(bytes[20] & 0x10) };
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, alpha: Boolean((bits >> 28) & 1) };
    }
    if (chunk === 'VP8 ') return { format: 'webp', width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    return undefined;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { offset += marker === 0xff ? 1 : 2; continue; }
      const length = u16be(bytes, offset + 2);
      // Start-of-frame markers (baseline, progressive, …), not DHT (C4), JPG (C8) or DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { format: 'jpeg', width: u16be(bytes, offset + 7), height: u16be(bytes, offset + 5) };
      if (length < 2) return undefined;
      offset += 2 + length;
    }
    return undefined;
  }
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const svg = text.match(/<svg\b[^>]*>/i)?.[0];
  if (svg) {
    const viewBox = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    const width = Number(svg.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1] ?? viewBox?.[1] ?? 0);
    const height = Number(svg.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1] ?? viewBox?.[2] ?? 0);
    return { format: 'svg', width, height };
  }
  return undefined;
}

/**
 * A logo, to show whole (contain on a tint) rather than cover-cropped: a very wide image, a file named as a logo,
 * an SVG, a GIF, a palette PNG or an image with transparency. Plain JPEG photos stay cover (the header alone cannot
 * show a JPEG logo on a white box; the browser's pixel check still catches those on CORS-enabled hosts).
 */
export function isLogoImage(url: string, header: ImageHeader | undefined): boolean {
  let path = url;
  try { path = new URL(url).pathname; } catch { /* keep the raw string */ }
  if (LOGO_FILE_NAME.test(path)) return true;
  if (!header) return false;
  if (header.width > 0 && header.height > 0 && header.width / header.height >= LOGO_ASPECT_RATIO) return true;
  return header.format === 'svg' || header.format === 'gif' || Boolean(header.alpha) || Boolean(header.palette);
}

export interface ImageProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Reads at most maxBytes of the response body, then cancels the rest. */
async function readPrefix(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, bytes.length - offset));
    bytes.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= bytes.length) break;
  }
  return bytes;
}

/** Probes story images once per URL (results, failures included, are cached; the cache is bounded). */
export class ImageProbe {
  private readonly cache = new Map<string, Promise<boolean | undefined>>();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: ImageProbeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? IMAGE_PROBE_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? IMAGE_PROBE_MAX_BYTES;
  }

  /** true / false once known; undefined when the host is not allowed or the image could not be read. */
  isLogo(url: string, allowedHostnames: readonly string[]): Promise<boolean | undefined> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const result = this.probe(url, allowedHostnames);
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(url, result);
    return result;
  }

  private async probe(url: string, allowedHostnames: readonly string[]): Promise<boolean | undefined> {
    if (!allowedHostnames.length) return undefined;
    let current: URL;
    try { current = assertSafePublicUrl(url, [...allowedHostnames]); } catch { return undefined; }
    if (LOGO_FILE_NAME.test(current.pathname)) return true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      for (let redirect = 0; redirect <= 2; redirect += 1) {
        const response = await this.fetchImpl(current, { method: 'GET', headers: { Range: `bytes=0-${this.maxBytes - 1}`, Accept: 'image/*' }, redirect: 'manual', signal: controller.signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          const location = response.headers.get('Location');
          if (!location) return undefined;
          // Every hop stays on an allowlisted public host.
          current = assertSafePublicUrl(new URL(location, current), [...allowedHostnames]);
          continue;
        }
        if (!response.ok) { await response.body?.cancel().catch(() => undefined); return undefined; }
        const type = response.headers.get('Content-Type') ?? '';
        if (type && !/^image\//i.test(type)) { await response.body?.cancel().catch(() => undefined); return undefined; }
        const header = parseImageHeader(await readPrefix(response, this.maxBytes));
        return header ? isLogoImage(current.href, header) : undefined;
      }
      return undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
