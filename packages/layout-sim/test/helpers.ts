import type { Rect } from '@holotype/ir';
import { expect } from 'vitest';
import type { SimIssueCode, SimNode, SimResult, Simulation, StackSpec } from '../src';

/** A HORIZONTAL, FIXED × FIXED, MIN/MIN stack with no padding and no gap. */
export const ROW: StackSpec = {
  mode: 'HORIZONTAL',
  padding: { t: 0, r: 0, b: 0, l: 0 },
  itemSpacing: 0,
  primaryAxisAlignItems: 'MIN',
  counterAxisAlignItems: 'MIN',
  primaryAxisSizingMode: 'FIXED',
  counterAxisSizingMode: 'FIXED',
  strokesIncludedInLayout: false,
};

export const COLUMN: StackSpec = { ...ROW, mode: 'VERTICAL' };

export function pad(t: number, r = t, b = t, l = r): StackSpec['padding'] {
  return { t, r, b, l };
}

/** A FIXED leaf. */
export function leaf(key: string, w: number, h: number, extra: Partial<SimNode> = {}): SimNode {
  return { key, size: { w, h }, ...extra };
}

/** A stack frame. */
export function frame(
  key: string,
  spec: Partial<StackSpec>,
  children: readonly SimNode[],
  extra: Partial<SimNode> = {},
): SimNode {
  return { key, size: { w: 0, h: 0 }, layout: { ...ROW, ...spec }, children, ...extra };
}

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

export function value<T>(result: SimResult<T>): T {
  if (!result.ok) throw new Error(`expected a simulation, got: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** The issue codes of a failed simulation. */
export function codes(result: SimResult<unknown>): SimIssueCode[] {
  if (result.ok) throw new Error('expected issues, got a simulation');
  return result.error.map((entry) => entry.code);
}

/** Rects as a plain object, for readable `toEqual` diffs. */
export function rectsOf(simulation: Simulation): Record<string, Rect> {
  return Object.fromEntries(simulation.rects);
}

export function expectRects(simulation: Simulation, expected: Record<string, Rect>): void {
  const actual = rectsOf(simulation);
  for (const [key, want] of Object.entries(expected)) {
    const got = actual[key];
    expect(got, `rect of ${key}`).toBeDefined();
    for (const field of ['x', 'y', 'w', 'h'] as const) {
      expect(got?.[field], `${key}.${field}`).toBeCloseTo(want[field], 9);
    }
  }
}
