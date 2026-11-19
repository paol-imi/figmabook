import { canonicalDcr } from '@holotype/dcr';
import { canonicalJSON } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import {
  canonicalBaselines,
  canonicalProvenance,
  canonicalSnapshot,
  listCases,
  loadCase,
  permute,
  SHUFFLE_SEEDS,
  seededRandom,
  shuffleInput,
  shuffleKeys,
  snapshotHash,
} from '../src/index.ts';

describe('seededRandom', () => {
  it('gives the same sequence for the same seed and another for another seed', () => {
    const take = (seed: number) => Array.from({ length: 5 }, seededRandom(seed));
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
    for (const x of take(7)) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe('permute', () => {
  it('returns a permutation and leaves the input alone', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = permute(input, seededRandom(1));
    expect([...out].sort()).toEqual([...input]);
    expect(out).not.toEqual(input);
  });
});

describe('shuffleKeys', () => {
  it('reorders keys deeply, keeps array order and the canonical form', () => {
    const value = { a: 1, b: { c: [3, { d: 4, e: 5, f: 6 }], g: 7, h: 8, i: 9 }, j: 10, k: 11, l: 12 };
    const out = shuffleKeys(value, seededRandom(3));
    expect(canonicalJSON(out)).toBe(canonicalJSON(value));
    expect(JSON.stringify(out)).not.toBe(JSON.stringify(value));
    expect(out.b.c[0]).toBe(3);
  });

  it('keeps a __proto__ key as data', () => {
    const value = JSON.parse('{"__proto__":{"x":1},"y":2}') as Record<string, unknown>;
    const out = shuffleKeys(value, seededRandom(1));
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'y']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe.each(listCases())('%s shuffles', (name) => {
  const { input } = loadCase(name);
  const shuffled = SHUFFLE_SEEDS.map((seed) => shuffleInput(input, seed));

  it('change the input bytes', () => {
    for (const s of shuffled) expect(JSON.stringify(s)).not.toBe(JSON.stringify(input));
  });

  it('keep the meaning: canonical snapshot, baselines and provenance are unchanged', () => {
    for (const s of shuffled) {
      expect(canonicalDcr(canonicalSnapshot(s.branch))).toBe(canonicalDcr(canonicalSnapshot(input.branch)));
      expect(canonicalDcr(canonicalBaselines(s.baseline))).toBe(canonicalDcr(canonicalBaselines(input.baseline)));
      if (input.provenance && s.provenance) {
        expect(canonicalDcr(canonicalProvenance(s.provenance))).toBe(
          canonicalDcr(canonicalProvenance(input.provenance)),
        );
      }
      expect(snapshotHash(s.branch)).toBe(snapshotHash(input.branch));
    }
  });

  it('keep every meaningful order: children, baseline order, axes, paints', () => {
    for (const s of shuffled) {
      for (const [id, node] of Object.entries(input.branch.nodes)) {
        expect(s.branch.nodes[id]?.children).toEqual(node.children);
        expect(canonicalJSON(s.branch.nodes[id]?.groups)).toBe(canonicalJSON(node.groups));
      }
      for (const b of input.baseline) {
        const same = s.baseline.find((x) => x.vk === b.vk && (x.props === undefined) === (b.props === undefined));
        expect(same?.order).toEqual(b.order);
        expect(same?.props?.axes).toEqual(b.props?.axes);
      }
    }
  });

  it('are reproducible from the seed', () => {
    expect(JSON.stringify(shuffleInput(input, SHUFFLE_SEEDS[0]))).toBe(JSON.stringify(shuffled[0]));
  });
});
