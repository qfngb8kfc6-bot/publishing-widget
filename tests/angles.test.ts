import { describe, expect, it } from 'vitest';
import { ALLOWED_ANGLES, angleForArticle, normalizeAngle } from '../src/ai/angles';
import { validateExplanationResults } from '../src/ai/validation';

describe('angle labels', () => {
  it('has a fixed list of about fifteen angles', () => {
    expect(ALLOWED_ANGLES).toHaveLength(15);
    for (const angle of ALLOWED_ANGLES) expect(normalizeAngle(angle.toUpperCase())).toBe(angle);
  });

  it.each([
    ['Competitive benchmark', 'competitor benchmark'],
    ['rival move', 'competitor benchmark'],
    ['pricing pressure', 'cost signal'],
    ['tariff risk', 'cost signal'],
    ['supplier consolidation', 'supplier risk'],
    ['nearshoring', 'sourcing shift'],
    ['factory expansion', 'capacity signal'],
    ['DTC shift', 'channel shift'],
    ['store expansion', 'channel shift'],
    ['EU regulation', 'regulatory exposure'],
    ['ESG disclosure', 'compliance pressure'],
    ['trademark dispute', 'legal risk'],
    ['carbon target', 'sustainability pressure'],
    ['brand collaboration', 'partnership signal'],
    ['product launch', 'product innovation'],
    ['executive hire', 'leadership move'],
    ['consumer demand', 'demand signal'],
    ['growth outlook', 'market signal'],
  ])('maps %s to %s', (label, angle) => {
    expect(normalizeAngle(label)).toBe(angle);
  });

  it('drops labels with nothing close and non-strings', () => {
    expect(normalizeAngle('a very long angle label that is far too long')).toBeUndefined();
    expect(normalizeAngle('interesting')).toBeUndefined();
    expect(normalizeAngle(42)).toBeUndefined();
    expect(normalizeAngle('')).toBeUndefined();
  });

  it('stores only allowed angles on validated explanations', () => {
    const results = validateExplanationResults([
      { articleId: 'a', explanation: 'Acme cut 12 suppliers.', angle: 'Supplier consolidation' },
      { articleId: 'b', explanation: 'Northwind opened 12 stores.', angle: 'whatever' },
    ], new Set(['a', 'b']));
    expect(results.map((result) => result.angle)).toEqual(['supplier risk', undefined]);
  });
});

describe('collaborations and launches are never leadership moves', () => {
  it.each([
    [{ title: 'Adidas x Black Panther collection launches', description: 'A themed footwear collection.' }, 'partnership signal'],
    [{ title: 'Puma partners with F1 team on apparel', description: '' }, 'partnership signal'],
    [{ title: 'Nike unveils self-lacing basketball shoe update', description: 'Longer battery life.' }, 'product innovation'],
    [{ title: 'Lululemon enters footwear with women-first running shoe', description: 'Lululemon launched its first running shoe.' }, 'product innovation'],
  ])('%j becomes %s', (article, angle) => {
    expect(angleForArticle('leadership move', article)).toBe(angle);
  });

  it('keeps leadership move for people changes and leaves other angles alone', () => {
    expect(angleForArticle('leadership move', { title: 'Puma appoints new chief executive', description: 'To lead the brand reset.' })).toBe('leadership move');
    expect(angleForArticle('leadership move', { title: 'Adidas names new CEO as it launches a partnership', description: '' })).toBe('leadership move');
    expect(angleForArticle('competitor benchmark', { title: 'Adidas x Black Panther collection launches', description: '' })).toBe('competitor benchmark');
    expect(angleForArticle(undefined, { title: 'Anything', description: '' })).toBeUndefined();
  });
});
