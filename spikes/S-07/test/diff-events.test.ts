import { describe, expect, it } from 'vitest';
import { firstDifference } from '../diff.ts';
import { summarizeEvents } from '../events.ts';

describe('firstDifference', () => {
  it('returns null for equal values', () => {
    expect(firstDifference({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBeNull();
  });

  it('names the first differing path in key order', () => {
    const a = { root: { children: [{ id: '_r_0_' }, { id: 'x' }] }, z: 1 };
    const b = { root: { children: [{ id: '_r_3_' }, { id: 'y' }] }, z: 2 };
    expect(firstDifference(a, b)).toBe('$.root.children[0].id ("_r_0_" vs "_r_3_")');
  });

  it('reports kind, length and key mismatches', () => {
    expect(firstDifference({ a: [1] }, { a: { 0: 1 } })).toBe('$.a (array vs object)');
    expect(firstDifference([1, 2], [1])).toBe('$[1] (length 2 vs 1)');
    expect(firstDifference({ a: 1 }, { b: 1 })).toBe('$.a (missing on one side)');
    expect(firstDifference(null, 0)).toBe('$ (null vs number)');
  });

  it('skips ignored top-level keys only', () => {
    expect(firstDifference({ timing: 1, x: 1 }, { timing: 2, x: 1 }, ['timing'])).toBeNull();
    expect(firstDifference({ x: { timing: 1 } }, { x: { timing: 2 } }, ['timing'])).toBe('$.x.timing (1 vs 2)');
  });
});

describe('summarizeEvents', () => {
  it('counts events, drops phase changes and the postMessage echo of emitted events', () => {
    expect(
      summarizeEvents([
        { dir: 'in', event: 'services:patches' },
        { dir: 'in', event: 'storyIndexInvalidated' },
        { dir: 'out', event: 'storyRenderPhaseChanged' },
        { dir: 'out', event: 'storyRendered' },
        { dir: 'in', event: 'storyRendered' },
        { dir: 'out', event: 'storyRendered' },
        { dir: 'in', event: 'storyRendered' },
        { dir: 'in', event: 'services:patches' },
      ]),
    ).toEqual(['←services:patches×2', '←storyIndexInvalidated', '→storyRendered×2']);
  });
});
