import { describe, expect, it } from 'vitest';
import { analyze, CHUNK_LENGTH, MARKERS, makeChunk, type Readout, type StepId, survival } from '../markers.ts';
import { branchApis } from '../plugin.ts';

function readout(
  step: StepId,
  present: (key: string, on: string) => string | null,
  fileKeyFingerprint = 'aaaa0000',
): Readout {
  return {
    step,
    componentFound: true,
    markers: MARKERS.map((marker) => {
      const value = present(marker.key, marker.on);
      return { key: marker.key, on: marker.on, present: value !== null, value };
    }),
    edit: null,
    fileKeyFingerprint,
    wrote: [],
    errors: [],
  };
}

const all = (key: string) =>
  key === 's17.base.0' ? 'intact' : (MARKERS.find((marker) => marker.key === key)?.value ?? null);

describe('S-17 markers', () => {
  it('makes the same 90 kB chunk every time', () => {
    expect(makeChunk()).toHaveLength(CHUNK_LENGTH);
    expect(makeChunk()).toBe(makeChunk());
    expect(new Set(makeChunk(1000)).size).toBeGreaterThan(20);
  });

  it('grades survival per step and per host', () => {
    const r = readout('step2', (key, on) => (on === 'root' ? all(key) : null));
    expect(survival(r, 'step1')).toBe('partial');
    expect(survival(r, 'step1', 'root')).toBe('yes');
    expect(survival(r, 'step1', 'component')).toBe('no');
    expect(survival(undefined, 'step1')).toBe('not-run');
  });

  it('treats a damaged chunk as not surviving', () => {
    const r = readout('step2', (key) => (key === 's17.base.0' ? 'damaged:500' : all(key)));
    expect(survival(r, 'step1', 'root')).toBe('partial');
  });

  it('answers each question from the steps that ran', () => {
    const answers = analyze({
      step1: readout('step1', all, 'main0000'),
      step2: readout('step2', all, 'branch00'),
      step3: readout(
        'step3',
        (key) => (key === 's17.branch' || key === 's17.branch-only' ? null : all(key)),
        'main0000',
      ),
    });
    expect(answers.onCreate).toEqual({
      root: 'yes',
      component: 'yes',
      chunk90kB: { root: 'intact', component: 'intact' },
    });
    expect(answers.branchWritesVisibleInMainBeforeMerge).toBe(false);
    expect(answers.onMerge.branchWritesArrived).toBe('not-run');
    expect(answers.fileKey).toEqual({ branchHasOwnKey: true, mainKeyStable: null });
    expect(answers.stepsRun).toEqual(['step1', 'step2', 'step3']);
  });

  it('lists Plugin API members that mention branches', () => {
    expect(branchApis({ createFrame: 1, getBranchesAsync: 2, mainBranchInfo: 3 })).toEqual([
      'getBranchesAsync',
      'mainBranchInfo',
    ]);
    expect(branchApis({})).toEqual([]);
  });
});
