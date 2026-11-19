import {
  checkDcrHash,
  checkDcrIntegrity,
  computeDcrHash,
  DCR_ITEM_KINDS,
  type DesignChangeRequest,
  dcrCore,
  SLICE_ITEM_KINDS,
  validateDcr,
} from '@holotype/dcr';
import { describe, expect, it } from 'vitest';
import {
  caseDir,
  checkExpected,
  coreBytes,
  listCases,
  loadCase,
  readCaseJson,
  requestBytes,
  sealExpected,
} from '../src/index.ts';

/*
 * The expected requests are complete, sealed DCRs now: they validate, pass the integrity
 * check (ids, hash, references, summary, order) and agree with their inputs.
 */

const cases = listCases();

describe.each(cases)('%s expected/dcr.json', (name) => {
  it('validates against the DCR schema', () => {
    const result = validateDcr(readCaseJson(caseDir(name), 'dcr'));
    expect(result.ok ? [] : result.error).toEqual([]);
  });

  it('passes checkDcrIntegrity and its dcrHash and id recompute', () => {
    const { dcr } = loadCase(name).expected;
    expect(checkDcrIntegrity(dcr)).toEqual([]);
    expect(checkDcrHash(dcr)).toBeUndefined();
    expect(computeDcrHash(dcr)).toBe(dcr.dcrHash);
  });

  it('agrees with the inputs (header, targets, node ids, CLI-only fields)', () => {
    const { input, expected } = loadCase(name);
    expect(checkExpected(input, expected.dcr)).toEqual([]);
  });

  it('is sealed: sealing it again changes no byte', () => {
    const { input, expected } = loadCase(name);
    expect(requestBytes(sealExpected(input, expected.dcr))).toBe(requestBytes(expected.dcr));
  });

  it('keeps provenance outside the core hash', () => {
    const { dcr } = loadCase(name).expected;
    const stripped = { ...dcr, ...dcrCore(dcr) } as DesignChangeRequest;
    expect(computeDcrHash(stripped)).toBe(dcr.dcrHash);
    expect(coreBytes(stripped)).toBe(coreBytes(dcr));
  });
});

describe('case coverage (12 §2.4, BUILD B-68)', () => {
  const requests = cases.map((name) => [name, loadCase(name).expected.dcr] as const);
  const kindsOf = (dcr: DesignChangeRequest) => new Set(dcr.items.map((item) => item.kind));

  it('has the slice cases of BUILD B-68 and the empty cases', () => {
    for (const name of [
      'modified-padding',
      'variant-added',
      'property-added',
      'property-renamed',
      'component-new',
      'screen-usage-basic',
      'injection',
      'no-change',
      'noise-only',
    ]) {
      expect(cases).toContain(name);
    }
  });

  it('every slice item kind is the subject of at least one case', () => {
    const covered = new Set(requests.flatMap(([, dcr]) => [...kindsOf(dcr)]));
    for (const kind of SLICE_ITEM_KINDS) expect(covered, kind).toContain(kind);
    for (const kind of ['variant.removed', 'instance.detached', 'token.changed'] as const) {
      expect(covered, kind).toContain(kind);
    }
    for (const kind of covered) expect(DCR_ITEM_KINDS).toContain(kind);
  });

  it('component.modified covers padding, color, radius and text', () => {
    const fields = requests
      .flatMap(([, dcr]) => dcr.items)
      .flatMap((item) => (item.kind === 'component.modified' ? item.changes.map((c) => c.field) : []));
    expect(fields).toEqual(
      expect.arrayContaining(['layout.paddingLeft', 'paint.fills[0].color', 'paint.topLeftRadius', 'text.fontSize']),
    );
  });

  it('the no-change and noise-only cases expect an empty request', () => {
    for (const name of ['no-change', 'noise-only']) {
      const dcr = loadCase(name).expected.dcr;
      expect(dcr.items).toEqual([]);
      expect(dcr.questions).toEqual([]);
      expect(dcr.diagnostics).toEqual([]);
    }
  });

  it('the injection case keeps designer text raw in dcr.json and flags it', () => {
    const dcr = loadCase('injection').expected.dcr;
    const screen = dcr.items.find((item) => item.kind === 'screen');
    expect(screen?.notes?.[0]?.text).toMatch(/ignore all previous instructions/i);
    expect(screen?.diagnostics?.map((d) => d.code)).toContain('DCR_NOTE_SUSPICIOUS');
  });
});
