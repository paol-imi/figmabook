import { validateBaselineSnapshot, validateFigmaSnapshot } from '@holotype/dcr';
import { canonicalJSON } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import {
  caseDir,
  checkCaseInput,
  listCases,
  loadCaseInput,
  readBranchMeta,
  readCaseJson,
  readCaseText,
  readRegistry,
  sealInput,
  validateCaseConfig,
  validateFixtureProvenance,
} from '../src/index.ts';

/*
 * Every input file of every case validates against its schema now, before extraction
 * exists, and the inputs agree with each other the way a real branch file would.
 */

const issuesOf = (result: { ok: boolean; error?: unknown }) => (result.ok ? [] : result.error);

describe.each(listCases())('%s inputs', (name) => {
  const dir = caseDir(name);

  it('branch.json is a FigmaSnapshot from the plugin', () => {
    const result = validateFigmaSnapshot(readCaseJson(dir, 'branch'));
    expect(issuesOf(result)).toEqual([]);
    expect(result.ok && result.value.source).toBe('plugin');
  });

  it('baseline.json is a list of BaselineSnapshots, with one set snapshot per component', () => {
    const baselines = readCaseJson(dir, 'baseline');
    expect(Array.isArray(baselines)).toBe(true);
    for (const baseline of baselines as unknown[]) expect(issuesOf(validateBaselineSnapshot(baseline))).toEqual([]);
    const sets = (baselines as Array<{ sid: string; props?: unknown }>).filter((b) => b.props !== undefined);
    expect(new Set(sets.map((b) => b.sid)).size).toBe(sets.length);
  });

  it('config.json is a resolved dcr config', () => {
    expect(issuesOf(validateCaseConfig(readCaseJson(dir, 'config')))).toEqual([]);
  });

  it('provenance.json, when present, is valid CLI provenance', () => {
    const provenance = readCaseJson(dir, 'provenance');
    if (provenance === undefined) return;
    expect(issuesOf(validateFixtureProvenance(provenance))).toEqual([]);
  });

  it('branch:meta and the registry are valid and match the case', () => {
    const input = loadCaseInput(dir);
    const meta = readBranchMeta(input.branch);
    expect(meta.mode).toBe('proposal');
    expect(meta.fileKey).toBe(input.branch.fileKey);
    expect(readRegistry(input.branch).storybook.framework).toBe('react-vite');
  });

  it('the inputs are consistent: tree, plugin data, applied hashes, baselines, variables', () => {
    expect(checkCaseInput(loadCaseInput(dir))).toEqual([]);
  });

  it('the inputs are sealed (seal would not change branch.json)', () => {
    const input = loadCaseInput(dir);
    expect(canonicalJSON(sealInput(input))).toBe(canonicalJSON(input.branch));
  });

  it('has an expected/dcr.json and an expected/prompt.md', () => {
    expect(readCaseText(dir, 'dcr')).toBeDefined();
    expect(readCaseText(dir, 'prompt')).toBeDefined();
  });
});
