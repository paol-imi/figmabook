import { NotImplementedError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import {
  cloneJson,
  compareItems,
  DCR_ITEM_KINDS,
  type DcrItemOf,
  type DesignChangeRequest,
  extractDcr,
  type FigmaSnapshot,
  itemOrderKey,
  SLICE_ITEM_KINDS,
  sortDcr,
} from '../src';
import { validDoc } from './corpus';

const worked = validDoc('dcr', 'worked-example.json') as DesignChangeRequest;

describe('canonical order (15 §4.9)', () => {
  it('orders items by (kindOrder, sid, vk, nk/key, id)', () => {
    const [modified, variant] = worked.items;
    if (!modified || !variant) throw new Error('fixture');
    expect(itemOrderKey(modified)).toEqual([0, 'components-button', '3b9a0c1d2e3f4a5b', 'root', modified.id]);
    expect(compareItems(modified, variant)).toBeLessThan(0);
    expect(compareItems(variant, modified)).toBeGreaterThan(0);
    expect(compareItems(modified, modified)).toBe(0);
    expect([...worked.items].reverse().sort(compareItems)).toEqual(worked.items);
  });

  it('every kind has an order; the slice kinds are a subset', () => {
    expect(new Set(DCR_ITEM_KINDS).size).toBe(16);
    expect(SLICE_ITEM_KINDS.every((kind) => DCR_ITEM_KINDS.includes(kind))).toBe(true);
  });

  it('sorts nearest by score descending then sid, a11y by focus order with unset last', () => {
    const dcr = cloneJson(worked);
    const priceTag = dcr.items.find((item): item is DcrItemOf<'component.new'> => item.kind === 'component.new');
    if (!priceTag) throw new Error('fixture');
    priceTag.nearest = [
      { sid: 'b', score: 0.5 },
      { sid: 'a', score: 0.5 },
      { sid: 'z', score: 0.9 },
    ];
    const sorted = sortDcr(dcr);
    const sortedTag = sorted.items.find((item) => item.kind === 'component.new') as DcrItemOf<'component.new'>;
    expect(sortedTag.nearest?.map((n) => n.sid)).toEqual(['z', 'a', 'b']);
    const screen = sorted.items.find((item) => item.kind === 'screen') as DcrItemOf<'screen'>;
    expect(screen.screen.variants[0]?.a11y.map((a) => a.focusOrder ?? null)).toEqual([1, 2, null]);
  });

  it('keeps arrays whose order is meaning: children, variants, headline', () => {
    const dcr = cloneJson(worked);
    dcr.summary.headline.reverse();
    const sorted = sortDcr(dcr);
    expect(sorted.summary.headline).toEqual(dcr.summary.headline);
    const screen = sorted.items.find((item) => item.kind === 'screen') as DcrItemOf<'screen'>;
    expect(screen.screen.variants.map((v) => v.figmaNodeId)).toEqual(['60:2', '60:3', '60:4']);
  });

  it('does not change its input', () => {
    const dcr = cloneJson(worked);
    dcr.items.reverse();
    const before = JSON.stringify(dcr);
    sortDcr(dcr);
    expect(JSON.stringify(dcr)).toBe(before);
  });
});

describe('extractDcr', () => {
  it('is not built yet (B-65)', () => {
    const snapshot = validDoc('figma-snapshot', 'price-tag-branch.json') as FigmaSnapshot;
    expect(() => extractDcr(snapshot, [])).toThrow(NotImplementedError);
  });
});
