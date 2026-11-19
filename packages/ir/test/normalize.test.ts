import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  APPLIED_GROUPS,
  APPLIED_HASH_LENGTH,
  appliedHash,
  changedGroups,
  fnv1a64,
  groupHashes,
  normalizeGroups,
  splitAppliedHash,
} from '../src';

const readback = {
  geom: { width: 96.00004, height: 40, rotation: -0 },
  layout: { layoutMode: 'HORIZONTAL', paddingLeft: 16.0001, itemSpacing: 8, layoutWrap: undefined },
  paint: {
    fills: [{ type: 'SOLID', color: { r: 0.23137254, g: 0.50980392, b: 0.96470588 }, opacity: 0.99999 }],
    effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.1000001 }, radius: 8 }],
  },
  vis: { visible: true, name: 'Variant=Primary' },
};

describe('normalizeGroups (06 §6 "ah")', () => {
  it('rounds floats to 1e-3, color channels to 1e-4, drops undefined and fills absent groups', () => {
    expect(normalizeGroups(readback)).toEqual({
      geom: { width: 96, height: 40, rotation: 0 },
      layout: { layoutMode: 'HORIZONTAL', paddingLeft: 16, itemSpacing: 8 },
      paint: {
        fills: [{ type: 'SOLID', color: { r: 0.2314, g: 0.5098, b: 0.9647 }, opacity: 1 }],
        effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.1 }, radius: 8 }],
      },
      text: {},
      vis: { visible: true, name: 'Variant=Primary' },
      bind: {},
      inst: {},
    });
  });

  it('treats only pure {r,g,b[,a]} objects as colors', () => {
    const groups = normalizeGroups({ layout: { padding: { r: 16.00042, b: 0.12345, t: 1, l: 1 } } });
    expect(groups.layout).toEqual({ padding: { r: 16, b: 0.123, t: 1, l: 1 } });
  });

  it('keeps a `__proto__` key as data', () => {
    const raw = JSON.parse('{"bind":{"__proto__":{"x":1.00001}}}');
    const groups = normalizeGroups(raw);
    expect(Object.keys(groups.bind as object)).toEqual(['__proto__']);
    expect(appliedHash(groups)).toHaveLength(112);
  });

  it('rejects values that are not readback data', () => {
    expect(() => normalizeGroups({ geom: { width: Number.NaN } })).toThrow(/non-finite number NaN at geom\/width/);
    expect(() => normalizeGroups({ paint: { fills: [() => 1] } })).toThrow(/function is not readback data/);
  });

  const json = fc.jsonValue({ noUnicodeString: false });
  const raw = fc.record(Object.fromEntries(APPLIED_GROUPS.map((group) => [group, json])), { requiredKeys: [] });

  it('is idempotent', () => {
    fc.assert(
      fc.property(raw, (input) => {
        const once = normalizeGroups(input);
        expect(normalizeGroups(once)).toEqual(once);
      }),
    );
  });

  it('gives the same ah for any key order', () => {
    const reverse = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverse);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, item]) => [key, reverse(item)]),
      );
    };
    fc.assert(
      fc.property(raw, (input) => {
        expect(appliedHash(normalizeGroups(reverse(input) as typeof input))).toBe(appliedHash(normalizeGroups(input)));
      }),
    );
  });
});

describe('applied hash', () => {
  const groups = normalizeGroups(readback);

  it('is the 7 FNV-1a-64 group hashes in order', () => {
    const ah = appliedHash(groups);
    expect(ah).toHaveLength(APPLIED_HASH_LENGTH);
    expect(ah.slice(16 * 3, 16 * 4)).toBe(fnv1a64('{}'));
    expect(splitAppliedHash(ah)).toEqual(groupHashes(groups));
  });

  it('an edited fill changes only the paint sub-hash', () => {
    const edited = normalizeGroups({
      ...readback,
      paint: { ...readback.paint, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }] },
    });
    expect(changedGroups(appliedHash(groups), appliedHash(edited))).toEqual(['paint']);
  });

  it('float noise from Figma does not register as an edit', () => {
    const noisy = normalizeGroups({ ...readback, geom: { width: 96.0002, height: 39.99996, rotation: 0 } });
    expect(changedGroups(appliedHash(groups), appliedHash(noisy))).toEqual([]);
  });

  it('rejects a malformed ah', () => {
    expect(() => splitAppliedHash('abc')).toThrow(/112 lowercase hex/);
  });
});
