// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindCardImages, cardsStyle, classifyCardImage } from '../src/hosted-cards';

const SIZE = 24;
/** RGBA for a SIZE×SIZE image: `paint(x, y)` returns [r, g, b, a]. */
function pixels(paint: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) data.set(paint(x, y), (y * SIZE + x) * 4);
  return data;
}
const photo = pixels((x, y) => [40 + x * 5, 90 + y * 3, 120, 255]);
// A blank white box with a small dark wordmark in the middle (the Fabletics lead card).
const whiteBoxLogo = pixels((x, y) => (x > 8 && x < 16 && y > 10 && y < 14 ? [20, 20, 20, 255] : [255, 255, 255, 255]));
// A centred mark covering most of the box, but on near-white edges.
const edgedLogo = pixels((x, y) => (x > 1 && x < SIZE - 2 && y > 1 && y < SIZE - 2 ? [200, 30, 60, 255] : [248, 248, 248, 255]));
const transparentLogo = pixels((x, y) => (x > 6 && x < 18 && y > 9 && y < 15 ? [0, 0, 0, 255] : [0, 0, 0, 0]));

describe('classifyCardImage', () => {
  it('treats very wide images as logos and normal photos as photos', () => {
    expect(classifyCardImage({ width: 1200, height: 300 })).toBe('logo');
    expect(classifyCardImage({ width: 1200, height: 675 }, photo)).toBe('photo');
    expect(classifyCardImage({ width: 1200, height: 675 })).toBe('photo');
  });

  it('treats mostly white, transparent or white-edged images as logos', () => {
    expect(classifyCardImage({ width: 1200, height: 630 }, whiteBoxLogo)).toBe('logo');
    expect(classifyCardImage({ width: 800, height: 800 }, edgedLogo)).toBe('logo');
    expect(classifyCardImage({ width: 800, height: 600 }, transparentLogo)).toBe('logo');
  });
});

describe('bindCardImages', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  function card(src: string, width: number, height: number): HTMLImageElement {
    document.body.innerHTML = `<div id="app"><article class="cx-card cx-lead has-image"><div class="cx-media"><img class="cx-image" src="${src}" alt=""></div></article></div>`;
    const image = document.querySelector<HTMLImageElement>('img.cx-image')!;
    Object.defineProperty(image, 'naturalWidth', { value: width });
    Object.defineProperty(image, 'naturalHeight', { value: height });
    return image;
  }
  function stubCanvas(data: Uint8ClampedArray) {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ drawImage: () => undefined, getImageData: () => ({ data }) })) as never);
  }

  it('shows a mostly white logo whole (contain, padded, tinted) instead of cover', () => {
    stubCanvas(whiteBoxLogo);
    const image = card('/images/story.png', 1200, 630);
    bindCardImages(document.getElementById('app')!, document);
    image.dispatchEvent(new Event('load'));
    expect(image.classList.contains('is-logo')).toBe(true);
    expect(image.closest('.cx-media')?.classList.contains('is-logo')).toBe(true);
    expect(cardsStyle()).toMatch(/\.cx-card \.cx-media\.is-logo\{background:#f4f6fa\}/);
    expect(cardsStyle()).toMatch(/\.cx-card \.cx-image\.is-logo\{[^}]*padding:[^}]*object-fit:contain\}/);
  });

  it('keeps a photo as cover, and marks a wide or logo-named image without reading pixels', () => {
    stubCanvas(photo);
    const image = card('/images/story.jpg', 1200, 675);
    bindCardImages(document.getElementById('app')!, document);
    image.dispatchEvent(new Event('load'));
    expect(image.classList.contains('is-logo')).toBe(false);
    expect(image.dataset.imageKind).toBe('photo');

    const wide = card('/images/banner.png', 1500, 400);
    bindCardImages(document.getElementById('app')!, document);
    wide.dispatchEvent(new Event('load'));
    expect(wide.classList.contains('is-logo')).toBe(true);

    const named = card('/images/fabletics-logo.png', 1200, 675);
    bindCardImages(document.getElementById('app')!, document);
    named.dispatchEvent(new Event('load'));
    expect(named.classList.contains('is-logo')).toBe(true);
  });

  it('classifies cards added later (focused reading) through the captured load event', () => {
    stubCanvas(whiteBoxLogo);
    document.body.innerHTML = '<div id="app"><div data-theme-results></div></div>';
    bindCardImages(document.getElementById('app')!, document);
    document.querySelector('[data-theme-results]')!.innerHTML = '<article class="cx-card cx-compact"><div class="cx-media"><img class="cx-image" src="/x.png" alt=""></div></article>';
    const image = document.querySelector<HTMLImageElement>('img.cx-image')!;
    Object.defineProperty(image, 'naturalWidth', { value: 600 });
    Object.defineProperty(image, 'naturalHeight', { value: 600 });
    image.dispatchEvent(new Event('load'));
    expect(image.classList.contains('is-logo')).toBe(true);
  });
});

describe('server-side logo flag', () => {
  it('renders an image the server marked as a logo with contain from the start', async () => {
    const { cardMarkup } = await import('../src/hosted-cards');
    const recommendation = { articleId: 'a1', rank: 1, rawScore: 70, displayScore: 70, explanation: 'Why.', article: { id: 'a1', publisherId: 'sgi-europe', title: 'Decathlon', description: 'Decathlon.', url: 'https://www.sgieurope.com/a1.article', imageUrl: 'https://www.sgieurope.com/Pictures/decathlon.png', categories: [], tags: [] }, rankingMetadata: { relevanceSignals: [], rankingMode: 'deterministic', rankingVersion: '1.7', imageIsLogo: true } } as never;
    document.body.innerHTML = cardMarkup(recommendation, { publisherName: 'SGI Europe', link: () => '' }, { lead: true });
    expect(document.querySelector('.cx-media')?.classList.contains('is-logo')).toBe(true);
    const image = document.querySelector<HTMLImageElement>('img.cx-image')!;
    expect(image.classList.contains('is-logo')).toBe(true);
    expect(image.dataset.imageKind).toBe('logo');
  });
});
