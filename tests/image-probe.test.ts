import { describe, expect, it } from 'vitest';
import { IMAGE_PROBE_MAX_BYTES, ImageProbe, isLogoImage, parseImageHeader } from '../src/reports/image-probe';
import { imageHostsFor } from '../src/reports/generate';
import { validatePublisherManifest } from '../src/core/config';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';

function png(width: number, height: number, colourType: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = colourType;
  return bytes;
}
function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  // SOI, an APP0 segment, then SOF0 with height and width.
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array.from({ length: 14 }, () => 0)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, ...Array.from({ length: 9 }, () => 0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}
const gif = (width: number, height: number) => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 255, width >> 8, height & 255, height >> 8, 0, 0]);

describe('image header parsing', () => {
  it('reads PNG, JPEG, GIF and SVG dimensions', () => {
    expect(parseImageHeader(png(800, 600, 6))).toEqual({ format: 'png', width: 800, height: 600, alpha: true, palette: false });
    expect(parseImageHeader(jpeg(1200, 675))).toEqual({ format: 'jpeg', width: 1200, height: 675 });
    expect(parseImageHeader(gif(300, 100))).toEqual({ format: 'gif', width: 300, height: 100 });
    expect(parseImageHeader(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100">'))).toEqual({ format: 'svg', width: 400, height: 100 });
    expect(parseImageHeader(new TextEncoder().encode('<html>not an image</html>'))).toBeUndefined();
  });

  it('calls wide images, transparent or palette PNGs, SVGs, GIFs and logo file names logos; JPEG photos are not', () => {
    expect(isLogoImage('https://img.example/a.jpg', { format: 'jpeg', width: 1200, height: 675 })).toBe(false);
    expect(isLogoImage('https://img.example/a.jpg', { format: 'jpeg', width: 1500, height: 400 })).toBe(true);
    expect(isLogoImage('https://img.example/decathlon.png', parseImageHeader(png(800, 800, 6)))).toBe(true);
    expect(isLogoImage('https://img.example/decathlon.png', parseImageHeader(png(800, 800, 3)))).toBe(true);
    expect(isLogoImage('https://img.example/photo.png', parseImageHeader(png(800, 600, 2)))).toBe(false);
    expect(isLogoImage('https://img.example/Decathlon-Logo.jpg', undefined)).toBe(true);
  });
});

describe('ImageProbe', () => {
  const allowed = ['www.sgieurope.com'];
  const respond = (bytes: Uint8Array<ArrayBuffer>, type = 'image/png') => new Response(bytes, { status: 206, headers: { 'Content-Type': type } });

  it('fetches only the first bytes of allowlisted images, once per URL', async () => {
    const calls: Array<{ url: string; range: string | null }> = [];
    const probe = new ImageProbe({ fetchImpl: async (input, init) => { calls.push({ url: String(input), range: new Headers(init?.headers).get('Range') }); return respond(png(600, 600, 6)); } });
    expect(await probe.isLogo('https://www.sgieurope.com/Pictures/a.png', allowed)).toBe(true);
    expect(await probe.isLogo('https://www.sgieurope.com/Pictures/a.png', allowed)).toBe(true);
    expect(calls).toEqual([{ url: 'https://www.sgieurope.com/Pictures/a.png', range: `bytes=0-${IMAGE_PROBE_MAX_BYTES - 1}` }]);
  });

  it('never fetches other or private hosts, and follows redirects only within the allowlist', async () => {
    const calls: string[] = [];
    const probe = new ImageProbe({ fetchImpl: async (input) => {
      calls.push(String(input));
      if (String(input).endsWith('/moved.png')) return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest' } });
      return respond(png(600, 600, 6));
    } });
    expect(await probe.isLogo('https://cdn.elsewhere.example/a.png', allowed)).toBeUndefined();
    expect(await probe.isLogo('http://127.0.0.1/a.png', ['127.0.0.1'])).toBeUndefined();
    expect(await probe.isLogo('https://www.sgieurope.com/moved.png', allowed)).toBeUndefined();
    expect(calls).toEqual(['https://www.sgieurope.com/moved.png']);
    expect(await new ImageProbe({ fetchImpl: async () => respond(png(600, 600, 6)) }).isLogo('https://www.sgieurope.com/a.png', [])).toBeUndefined();
  });

  it('caps the bytes read, gives up on a slow host and ignores non-images', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; controller.enqueue(pulled === 1 ? jpeg(1200, 675) : new Uint8Array(16 * 1024)); } });
    expect(await new ImageProbe({ fetchImpl: async () => new Response(endless, { headers: { 'Content-Type': 'image/jpeg' } }) }).isLogo('https://www.sgieurope.com/big.jpg', allowed)).toBe(false);
    expect(pulled).toBeLessThanOrEqual(Math.ceil(IMAGE_PROBE_MAX_BYTES / (16 * 1024)) + 2);
    const slow = new ImageProbe({ timeoutMs: 20, fetchImpl: (_input, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) });
    expect(await slow.isLogo('https://www.sgieurope.com/slow.png', allowed)).toBeUndefined();
    expect(await new ImageProbe({ fetchImpl: async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) }).isLogo('https://www.sgieurope.com/page.png', allowed)).toBeUndefined();
  });

  it('uses the manifest imageHostnames, else the content source hosts', () => {
    expect(imageHostsFor(sgiEuropeManifest)).toEqual(['www.sgieurope.com', 'sgieurope.com']);
    expect(imageHostsFor({ ...sgiEuropeManifest, imageHostnames: ['img.sgieurope.com'] })).toEqual(['img.sgieurope.com']);
    expect(imageHostsFor(undefined)).toEqual([]);
  });

  it('takes SGI\'s CloudFront image host from the Content source JSON (admin-editable, not hardcoded)', () => {
    const configured = { ...sgiEuropeManifest, contentSource: { ...sgiEuropeManifest.contentSource!, imageHostnames: ['d1f00kj7ad54bu.cloudfront.net'] } } as typeof sgiEuropeManifest;
    expect(() => validatePublisherManifest(configured)).not.toThrow();
    expect(imageHostsFor(configured)).toEqual(['www.sgieurope.com', 'sgieurope.com', 'd1f00kj7ad54bu.cloudfront.net']);
    expect(imageHostsFor(sgiEuropeManifest)).not.toContain('d1f00kj7ad54bu.cloudfront.net');
  });

  it('rejects image hosts that are URLs, wildcards, IP addresses or private names', () => {
    for (const bad of ['https://d1f00kj7ad54bu.cloudfront.net', 'd1f00kj7ad54bu.cloudfront.net/images', '*.cloudfront.net', '10.0.0.5', 'localhost', 'images.local', 'metadata.google.internal']) {
      const manifest = { ...sgiEuropeManifest, contentSource: { ...sgiEuropeManifest.contentSource!, imageHostnames: [bad] } } as typeof sgiEuropeManifest;
      expect(() => validatePublisherManifest(manifest), bad).toThrow(/public hostnames/);
    }
    expect(() => validatePublisherManifest({ ...sgiEuropeManifest, imageHostnames: ['https://x.example'] })).toThrow(/public hostnames/);
  });
});

describe('report generation stores imageIsLogo per story', () => {
  const stories = [
    ['Decathlon reports first-half sales growth of 4%', 'https://www.sgieurope.com/Pictures/decathlon.png'],
    ['Intersport posts record retail store revenue', 'https://www.sgieurope.com/Pictures/intersport-store.jpg'],
    ['JD Sports retail stores expand in Europe', 'https://cdn.elsewhere.example/jd.png'],
  ];
  const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>SGI</title>${stories.map(([title, image], i) => `<item><title>${title}</title><link>https://www.sgieurope.com/retail/s-${i}/17000${i}.article</link><guid>https://www.sgieurope.com/retail/s-${i}/17000${i}.article</guid><description>${title}: retail stores and omnichannel distribution.</description><enclosure url="${image}" type="image/jpeg" /><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;

  it('probes SGI images on the configured CloudFront host and marks the logo', async () => {
    const cdnStories = [['Decathlon reports first-half retail sales growth', 'https://d1f00kj7ad54bu.cloudfront.net/Pictures/decathlon-store.png']];
    const cdnRss = rss.replace(stories[0][1], cdnStories[0][1]);
    const probed: string[] = [];
    const manifest = { ...sgiEuropeManifest, contentSource: { ...sgiEuropeManifest.contentSource!, imageHostnames: ['d1f00kj7ad54bu.cloudfront.net'] } } as typeof sgiEuropeManifest;
    const app = createProductionApp({
      environment: 'test',
      publisherStore: new MemoryPublisherStore([manifest]),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('cloudfront.net')) { probed.push(url); return new Response(png(500, 500, 6), { headers: { 'Content-Type': 'image/png' } }); }
        if (url.includes('/Pictures/') || url.includes('cdn.elsewhere')) return new Response(jpeg(1200, 675), { headers: { 'Content-Type': 'image/jpeg' } });
        return new Response(cdnRss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
    const { reportId } = await response.json() as { reportId: string };
    const report = (await app.reportStore.get(reportId, 'sgi-europe'))!;
    expect(probed).toEqual([cdnStories[0][1]]);
    expect(report.recommendations.find((item) => item.article.imageUrl === cdnStories[0][1])?.rankingMetadata.imageIsLogo).toBe(true);
  });

  it('marks the logo, keeps the photo, and never probes an image off the allowlist', async () => {
    const imageCalls: string[] = [];
    const app = createProductionApp({
      environment: 'test',
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/Pictures/') || url.includes('cdn.elsewhere')) {
          imageCalls.push(url);
          return url.endsWith('.png') ? new Response(png(500, 500, 6), { headers: { 'Content-Type': 'image/png' } }) : new Response(jpeg(1200, 675), { headers: { 'Content-Type': 'image/jpeg' } });
        }
        return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
    const { reportId } = await response.json() as { reportId: string };
    const report = (await app.reportStore.get(reportId, 'sgi-europe'))!;
    const byTitle = new Map(report.recommendations.map((item) => [item.article.title, item]));
    expect(byTitle.get(stories[0][0])?.rankingMetadata.imageIsLogo).toBe(true);
    expect(byTitle.get(stories[1][0])?.rankingMetadata.imageIsLogo).toBeUndefined();
    expect(byTitle.get(stories[2][0])?.rankingMetadata.imageIsLogo).toBeUndefined();
    expect(imageCalls.some((url) => url.includes('cdn.elsewhere'))).toBe(false);
  });
});
