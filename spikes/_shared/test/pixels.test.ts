import { describe, expect, it } from 'vitest';
import { comparePixels, dashPattern, rowRuns } from '../pixels.ts';

function image(width: number, height: number, paint: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

describe('comparePixels', () => {
  it('scores identical images as 0', () => {
    const a = image(4, 4, () => [10, 20, 30]);
    expect(
      comparePixels(
        a,
        image(4, 4, () => [10, 20, 30]),
      ),
    ).toEqual({ diffRatio: 0, meanDelta: 0, width: 4, height: 4 });
  });

  it('ignores anti-aliasing noise below the tolerance', () => {
    const a = image(2, 2, () => [100, 100, 100]);
    expect(
      comparePixels(
        a,
        image(2, 2, () => [130, 100, 100]),
      ).diffRatio,
    ).toBe(0);
  });

  it('counts pixels over the tolerance and the mean channel delta', () => {
    const a = image(2, 1, () => [0, 0, 0]);
    const b = image(2, 1, (x) => (x === 0 ? [255, 255, 255] : [0, 0, 0]));
    expect(comparePixels(a, b)).toEqual({ diffRatio: 0.5, meanDelta: 127.5, width: 2, height: 1 });
  });

  it('counts the non-overlapping area of different sizes as different', () => {
    const score = comparePixels(
      image(2, 2, () => [0, 0, 0]),
      image(4, 2, () => [0, 0, 0]),
    );
    expect(score.diffRatio).toBe(0.5);
    expect(score.width).toBe(4);
  });

  it('handles empty images', () => {
    expect(
      comparePixels(
        image(0, 0, () => [0, 0, 0]),
        image(0, 0, () => [0, 0, 0]),
      ).diffRatio,
    ).toBe(0);
  });
});

describe('rowRuns and dashPattern', () => {
  const ink = (r: number) => r < 128;
  it('measures a dash pattern, ignoring the cut runs at both ends', () => {
    // 3 ink (cut), then 6 gap / 6 ink repeated, ending with a cut gap
    const row = image(40, 1, (x) => ((x + 3) % 12 < 6 ? [0, 0, 0] : [255, 255, 255]));
    const runs = rowRuns(row, 0, 0, 40, ink);
    expect(runs.startsWithInk).toBe(true);
    expect(runs.runs[0]).toBe(3);
    expect(dashPattern(runs)).toEqual({ dash: 6, gap: 6 });
  });

  it('returns null for a solid row', () => {
    const row = image(10, 1, () => [0, 0, 0]);
    expect(dashPattern(rowRuns(row, 0, 0, 10, ink))).toBeNull();
  });
});
