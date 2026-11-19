import type { AssumptionLog } from './assumptions';
import { isAutoGap } from './axis';
import type { StackSpec } from './types';

/**
 * Primary-axis offsets of the in-flow children, given their final primary sizes.
 * `start` and `inner` describe the inner box (frame minus insets) on the primary axis.
 */
export function primaryOffsets(
  spec: StackSpec,
  start: number,
  inner: number,
  sizes: readonly number[],
  log: AssumptionLog,
): number[] {
  const count = sizes.length;
  if (count === 0) return [];
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const { first, gap } = isAutoGap(spec)
    ? autoGap(spec, inner - total, count, log)
    : fixedGap(spec, inner, total, count, log);

  const offsets: number[] = [];
  let cursor = start + first;
  for (const size of sizes) {
    offsets.push(cursor);
    cursor += size + gap;
  }
  return offsets;
}

interface Run {
  /** Offset of the first child from the inner start. */
  readonly first: number;
  readonly gap: number;
}

function fixedGap(spec: StackSpec, inner: number, total: number, count: number, log: AssumptionLog): Run {
  const gap = spec.itemSpacing;
  const free = inner - total - gap * (count - 1);
  if (free < 0 && spec.primaryAxisAlignItems !== 'MIN') log.use('overflow-alignment');
  switch (spec.primaryAxisAlignItems) {
    case 'CENTER':
      return { first: free / 2, gap };
    case 'MAX':
      return { first: free, gap };
    default:
      return { first: 0, gap };
  }
}

/** SPACE_BETWEEN / SPACE_EVENLY / SPACE_AROUND: itemSpacing is ignored and the gap never goes below 0. */
function autoGap(spec: StackSpec, rawFree: number, count: number, log: AssumptionLog): Run {
  const align = spec.primaryAxisAlignItems;
  if (align !== 'SPACE_BETWEEN') log.use('auto-gap-evenly-around');
  log.use('auto-gap-between');
  const free = Math.max(0, rawFree);
  if (rawFree < 0) log.use('auto-gap-floor');
  if (count === 1) {
    log.use('auto-gap-single-child');
    return { first: 0, gap: 0 };
  }
  switch (align) {
    case 'SPACE_EVENLY': {
      const gap = free / (count + 1);
      return { first: gap, gap };
    }
    case 'SPACE_AROUND': {
      const gap = free / count;
      return { first: gap / 2, gap };
    }
    default:
      return { first: 0, gap: free / (count - 1) };
  }
}

/** Counter-axis offset of one child for MIN / CENTER / MAX alignment. */
export function crossOffset(
  align: 'MIN' | 'CENTER' | 'MAX',
  start: number,
  inner: number,
  size: number,
  log: AssumptionLog,
): number {
  const free = inner - size;
  if (free < 0 && align !== 'MIN') log.use('overflow-alignment');
  if (align === 'CENTER') return start + free / 2;
  if (align === 'MAX') return start + free;
  return start;
}
