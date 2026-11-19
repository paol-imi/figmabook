import { sha256Hex } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { computeDcrHash, type DesignChangeRequest, sealDcr, serializeDcr, sortDcr } from '../src';
import { validDocs } from './corpus';

/*
 * D-35 / 12 §2.4: the same request, with its input order shuffled by a seeded permutation
 * (object keys and every array whose order is not meaning), gives byte-identical output.
 */

/** Arrays whose order carries no meaning, by the key that holds them. */
const ORDER_FREE = new Set([
  'items',
  'questions',
  'diagnostics',
  'changes',
  'candidates',
  'nearest',
  'components',
  'newComponents',
  'screens',
  'fields',
  'token',
  'mustImport',
  'mustNotImport',
  'interactions',
  'a11y',
  'occurrences',
  'notes',
  'defaults',
  'ids',
  'sameOriginVariants',
  'designerChangedIn',
  'visualChanges',
  'deviations',
]);

/** mulberry32: a small seeded PRNG, so the shuffles are the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permute<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function shuffle(value: unknown, next: () => number, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => shuffle(item, next));
    return key !== undefined && ORDER_FREE.has(key) ? permute(items, next) : items;
  }
  if (value === null || typeof value !== 'object') return value;
  const entries = permute(Object.entries(value), next);
  return Object.fromEntries(entries.map(([k, v]) => [k, shuffle(v, next, k)]));
}

describe.each(validDocs('dcr'))('valid/%s is deterministic (D-35)', (_name, value) => {
  const dcr = value as DesignChangeRequest;
  const expected = serializeDcr(dcr);

  it.each([0, 1, 2])('run %i: shuffled input → the same bytes and the same dcrHash', (seed) => {
    const input = (seed === 0 ? structuredClone(dcr) : shuffle(dcr, random(seed))) as DesignChangeRequest;
    if (seed !== 0 && dcr.items.length > 1) expect(JSON.stringify(input)).not.toBe(JSON.stringify(dcr));
    const { id: _id, dcrHash: _hash, ...draft } = input;
    const sealed = sealDcr(draft);
    expect(sha256Hex(serializeDcr(sealed))).toBe(sha256Hex(expected));
    expect(computeDcrHash(input)).toBe(dcr.dcrHash);
    expect(sealed.id).toBe(dcr.id);
  });

  it('sortDcr is idempotent', () => {
    const once = sortDcr(dcr);
    expect(sortDcr(once)).toEqual(once);
  });
});
