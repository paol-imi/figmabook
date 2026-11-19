/** Bounds of one FILL child on the primary axis: min (with the padding floor) and max. */
export interface FillBounds {
  readonly lo: number;
  readonly hi: number;
}

export interface FillShare {
  /** One size per item, in input order. */
  readonly sizes: readonly number[];
  /** A bound froze at least one item (assumption `fill-min-max`). */
  readonly clamped: boolean;
  /** The free space ran out: an equal share would have been negative (assumption `fill-no-space`). */
  readonly starved: boolean;
}

/**
 * Shares `free` primary-axis space among FILL children: equal shares from a zero basis,
 * never below 0, then the CSS flexbox freeze loop for min/max violations (§9.7 "resolve the
 * flexible lengths"). Each round freezes at least one item, so it ends after `n` rounds.
 */
export function shareFill(free: number, items: readonly FillBounds[]): FillShare {
  const sizes = items.map(() => 0);
  const frozen = items.map(() => false);
  let remaining = free;
  let clamped = false;
  let starved = false;

  for (let round = 0; round <= items.length; round++) {
    const open = indicesWhere(frozen, false);
    if (open.length === 0) break;
    const raw = remaining / open.length;
    if (raw < 0) starved = true;
    const share = Math.max(0, raw);

    let violation = 0;
    const targets = new Map<number, number>();
    for (const index of open) {
      const target = clamp(share, items[index] as FillBounds);
      targets.set(index, target);
      violation += target - share;
    }
    const violators = open.filter((index) => targets.get(index) !== share);
    if (violators.length === 0) {
      for (const index of open) sizes[index] = share;
      break;
    }

    clamped = true;
    const freezing = violators.filter((index) => {
      const target = targets.get(index) as number;
      if (violation > 0) return target > share;
      if (violation < 0) return target < share;
      return true;
    });
    for (const index of freezing) {
      const target = targets.get(index) as number;
      sizes[index] = target;
      frozen[index] = true;
      remaining -= target;
    }
  }
  return { sizes, clamped, starved };
}

function clamp(value: number, { lo, hi }: FillBounds): number {
  return Math.min(hi, Math.max(lo, value));
}

function indicesWhere(flags: readonly boolean[], wanted: boolean): number[] {
  const indices: number[] = [];
  flags.forEach((flag, index) => {
    if (flag === wanted) indices.push(index);
  });
  return indices;
}
