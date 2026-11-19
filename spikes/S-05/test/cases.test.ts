import { describe, expect, it } from 'vitest';
import { CASES, caseHtml, expectedChildOffset, uniform } from '../cases.ts';
import { modelPadding, technique } from '../plugin.ts';
import refsJson from '../refs.json';
import { REFS_FORMAT, type RefsFile } from '../refs.ts';
import { base64ToBytes, type Decoder, scoreCases, summarize } from '../steps.ts';

const refs = refsJson as RefsFile;
const byId = (id: string) => {
  const found = CASES.find((testCase) => testCase.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('S-05 cases', () => {
  it('cover uniform, per-side widths, per-side colors, dashed and outline, in and out of auto layout', () => {
    expect(CASES).toHaveLength(12);
    expect(new Set(CASES.map((testCase) => testCase.id)).size).toBe(12);
    expect(CASES.filter((testCase) => testCase.autoLayout)).toHaveLength(6);
    expect(new Set(CASES.map(technique))).toEqual(new Set(['stroke', 'edges', 'outline']));
  });

  it('place the child at border + padding, as CSS does', () => {
    expect(expectedChildOffset(byId('per-side-widths-1-2-3-4-al'))).toEqual({ x: 12, y: 9 });
    expect(expectedChildOffset(byId('outline-2px-no-border-al'))).toEqual({ x: 8, y: 8 });
  });

  it('model A adds the border to the padding (D-16); model B leaves it to Figma', () => {
    const sides = byId('per-side-widths-1-2-3-4-al');
    expect(modelPadding(sides, 'A')).toEqual([9, 10, 11, 12]);
    expect(modelPadding(sides, 'B')).toEqual([8, 8, 8, 8]);
    // Edge rectangles are not strokes, so model B has to add them as well.
    expect(modelPadding(byId('per-side-colors-3px-al'), 'B')).toEqual([11, 11, 11, 11]);
  });

  it('renders CSS for the reference page', () => {
    const html = caseHtml(byId('dashed-2px-al'));
    expect(html).toContain('border-style:dashed;border-width:2px 2px 2px 2px;');
    expect(html).toContain('display:flex;');
    expect(caseHtml(byId('outline-2px-no-border-abs'))).toContain('outline:2px solid #0ea5e9;');
    expect(uniform([1, 1, 1, 1])).toBe(true);
    expect(uniform([1, 2, 1, 1])).toBe(false);
  });
});

describe('S-05 committed references', () => {
  it('exist for every case and agree with the CSS box model', () => {
    expect(refs.format).toBe(REFS_FORMAT);
    expect(Object.keys(refs.cases).sort()).toEqual(CASES.map((testCase) => testCase.id).sort());
    for (const testCase of CASES) {
      const ref = refs.cases[testCase.id];
      expect(ref?.child, testCase.id).toEqual({ ...expectedChildOffset(testCase), width: 40, height: 20 });
      expect(base64ToBytes(ref?.png ?? '').slice(1, 4)).toEqual(new TextEncoder().encode('PNG'));
    }
    expect(refs.cases['dashed-2px-al']?.dash).toMatchObject({ dash: expect.any(Number), gap: expect.any(Number) });
  });
});

describe('S-05 scoring', () => {
  const flat: Decoder = async () => ({ data: new Uint8Array(4 * 4).fill(255), width: 2, height: 2 });

  it('scores child offsets against the reference and pixel differences per model', async () => {
    const scored = await scoreCases(
      [
        {
          caseId: 'uniform-4px-al',
          model: 'A',
          technique: 'stroke',
          child: { x: 12, y: 12 },
          png: new Uint8Array([1]),
          error: null,
        },
        {
          caseId: 'uniform-4px-al',
          model: 'B',
          technique: 'stroke',
          child: { x: 8, y: 8 },
          png: new Uint8Array([1]),
          error: null,
        },
      ],
      flat,
    );
    expect(scored.map((row) => row.childError)).toEqual([0, 4]);
    expect(scored[0]?.pixels?.diffRatio).toBe(0);
    const summary = summarize(scored);
    expect(summary.measuredFavours).toBe('A');
    expect(summary.modelB.casesWithChildError).toEqual(['uniform-4px-al']);
  });

  it('records a decode failure on the case instead of failing the run', async () => {
    const broken: Decoder = async () => {
      throw new Error('no canvas');
    };
    const [row] = await scoreCases(
      [
        {
          caseId: 'uniform-1px-abs',
          model: 'A',
          technique: 'stroke',
          child: { x: 9, y: 9 },
          png: new Uint8Array([1]),
          error: null,
        },
      ],
      broken,
    );
    expect(row?.error).toBe('pixel compare: no canvas');
    expect(row?.childError).toBe(0);
  });
});
