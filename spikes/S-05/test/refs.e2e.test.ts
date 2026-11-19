import { describe, expect, it } from 'vitest';
import { CASES } from '../cases.ts';
import committed from '../refs.json';
import { type RefsFile, renderRefs } from '../refs.ts';

describe('S-05 Chromium references', () => {
  it('match the committed refs.json (rects and dash pattern; pixels may differ across Chromium builds)', async () => {
    const fresh = await renderRefs();
    const refs = committed as RefsFile;
    for (const testCase of CASES) {
      expect(fresh.cases[testCase.id]?.child, testCase.id).toEqual(refs.cases[testCase.id]?.child);
      expect(fresh.cases[testCase.id]?.dash, testCase.id).toEqual(refs.cases[testCase.id]?.dash);
    }
  });
});
