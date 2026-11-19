/**
 * Pixel scoring for reference comparisons (BUILD §9.1: the plugin compares in the UI and only
 * small numbers come back). Pure functions over RGBA byte arrays.
 */

export type Rgba = Uint8Array | Uint8ClampedArray;

export type PixelScore = {
  /** Share of pixels whose largest channel difference is above the tolerance (0…1). */
  readonly diffRatio: number;
  /** Mean absolute channel difference over all pixels and RGB channels (0…255). */
  readonly meanDelta: number;
  readonly width: number;
  readonly height: number;
};

/** Default tolerance absorbs anti-aliasing differences between Skia builds. */
export const DEFAULT_TOLERANCE = 48;

/**
 * Compares two images of the same size. Different sizes are compared over the overlapping
 * area and every non-overlapping pixel counts as different.
 */
export function comparePixels(
  a: { readonly data: Rgba; readonly width: number; readonly height: number },
  b: { readonly data: Rgba; readonly width: number; readonly height: number },
  tolerance = DEFAULT_TOLERANCE,
): PixelScore {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const total = width * height;
  if (total === 0) return { diffRatio: 0, meanDelta: 0, width, height };
  let different = 0;
  let deltaSum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= a.width || y >= a.height || x >= b.width || y >= b.height) {
        different++;
        deltaSum += 255 * 3;
        continue;
      }
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      let max = 0;
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs((a.data[i + c] ?? 0) - (b.data[j + c] ?? 0));
        deltaSum += delta;
        if (delta > max) max = delta;
      }
      if (max > tolerance) different++;
    }
  }
  return {
    diffRatio: Math.round((different / total) * 10_000) / 10_000,
    meanDelta: Math.round((deltaSum / (total * 3)) * 100) / 100,
    width,
    height,
  };
}

/**
 * Run lengths along one pixel row, alternating "ink" and "gap" and starting with whichever
 * comes first (`startsWithInk` says which). Used to measure CSS dash patterns.
 */
export function rowRuns(
  image: { readonly data: Rgba; readonly width: number },
  y: number,
  x0: number,
  x1: number,
  isInk: (r: number, g: number, b: number) => boolean,
): { startsWithInk: boolean; runs: number[] } {
  const runs: number[] = [];
  let current: boolean | null = null;
  let startsWithInk = false;
  for (let x = x0; x < x1; x++) {
    const i = (y * image.width + x) * 4;
    const ink = isInk(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0);
    if (current === null) {
      startsWithInk = ink;
      current = ink;
      runs.push(1);
    } else if (ink === current) {
      runs[runs.length - 1] = (runs[runs.length - 1] ?? 0) + 1;
    } else {
      current = ink;
      runs.push(1);
    }
  }
  return { startsWithInk, runs };
}

/** Median of the inner runs of each kind (the first and last runs are cut by the corners). */
export function dashPattern(row: {
  startsWithInk: boolean;
  runs: readonly number[];
}): { dash: number; gap: number } | null {
  const inner = row.runs.slice(1, -1);
  const firstInnerIsInk = row.runs.length > 1 ? !row.startsWithInk : row.startsWithInk;
  const ink: number[] = [];
  const gap: number[] = [];
  for (const [index, run] of inner.entries()) ((index % 2 === 0) === firstInnerIsInk ? ink : gap).push(run);
  const median = (values: number[]) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  };
  const dash = median(ink);
  const space = median(gap);
  return dash === null || space === null ? null : { dash, gap: space };
}
