import { describe, expect, it } from 'vitest';
import { BADGE_DEFS, BUTTON_DEFS, CASES } from '../cases.ts';
import { compareSnapshots, forwardMap, type InstanceSnapshot, isUnmapped, reverseMap } from '../model.ts';
import { summarize } from '../steps.ts';

const snapshot = (patch: Partial<InstanceSnapshot> = {}): InstanceSnapshot => ({
  variant: { Variant: 'Primary', Size: 'md' },
  props: { 'Show icon': true, Label: 'Button' },
  swaps: { Icon: 'icon-star' },
  overrides: [],
  referencedFields: { label: ['characters'], icon: ['mainComponent', 'visible'], hint: [], badge: [] },
  nested: {},
  ...patch,
});

describe('reverseMap (15 §4.5)', () => {
  it('maps VARIANT and BOOLEAN through valueMap, TEXT as is, INSTANCE_SWAP through preferredValues', () => {
    expect(reverseMap(BUTTON_DEFS, snapshot()).args).toEqual({
      variant: 'primary',
      size: 'medium',
      iconPosition: 'start',
      children: 'Button',
      icon: 'star',
    });
  });

  it('keeps the Figma value of a value with no map entry and reports it (DCR_PROPERTY_UNMAPPED)', () => {
    const result = reverseMap(
      BUTTON_DEFS,
      snapshot({ variant: { Variant: 'Danger', Size: 'sm' }, swaps: { Icon: 'icon-bolt' } }),
    );
    expect(result.args.variant).toEqual({ unmapped: 'Danger' });
    expect(result.args.icon).toEqual({ unmapped: 'icon-bolt' });
    expect(result.unmapped).toEqual([
      { key: 'arg:variant', figma: 'Danger' },
      { key: 'arg:icon', figma: 'icon-bolt' },
    ]);
  });

  it('reports a missing property as unmapped null', () => {
    const result = reverseMap(BUTTON_DEFS, snapshot({ props: {} }));
    expect(result.args.children).toEqual({ unmapped: null });
    expect(result.args.iconPosition).toEqual({ unmapped: null });
  });

  it('turns overrides that properties do not explain into deviations', () => {
    const result = reverseMap(
      BUTTON_DEFS,
      snapshot({
        overrides: [
          { role: 'label', fields: ['characters', 'styledTextSegments'] },
          { role: 'icon', fields: ['visible'] },
          { role: 'hint', fields: ['characters'] },
          { role: 'root', fields: ['fills', 'componentProperties'] },
        ],
      }),
    );
    expect(result.deviations).toEqual([
      { role: 'hint', fields: ['characters'] },
      { role: 'root', fields: ['fills'] },
    ]);
  });

  it('maps nested instances with their own definitions', () => {
    const nested = {
      badge: { defs: BADGE_DEFS, snapshot: snapshot({ variant: { Tone: 'Info' }, props: {}, swaps: {} }) },
    };
    expect(reverseMap(BUTTON_DEFS, snapshot({ nested })).nested.badge?.args).toEqual({ tone: 'info' });
  });
});

describe('forwardMap and the round trip', () => {
  it('rebuilds the same property values from the args, unmapped values included', () => {
    const original = snapshot({
      variant: { Variant: 'Danger', Size: 'sm' },
      props: { 'Show icon': false, Label: 'Delete' },
      swaps: { Icon: 'icon-heart' },
    });
    const forward = forwardMap(BUTTON_DEFS, reverseMap(BUTTON_DEFS, original).args);
    expect(forward).toEqual({
      variant: { Variant: 'Danger', Size: 'sm' },
      props: { 'Show icon': false, Label: 'Delete' },
      swaps: { Icon: 'icon-heart' },
    });
    expect(compareSnapshots(original, { ...original, ...forward })).toEqual([]);
  });

  it('lists every difference by field', () => {
    const diffs = compareSnapshots(snapshot(), snapshot({ props: { 'Show icon': true, Label: 'Other' } }));
    expect(diffs).toEqual([{ field: 'props.Label', before: 'Button', after: 'Other' }]);
  });

  it('isUnmapped distinguishes wrapped values from plain objects', () => {
    expect(isUnmapped({ unmapped: 1 })).toBe(true);
    expect(isUnmapped({ other: 1 })).toBe(false);
    expect(isUnmapped('primary')).toBe(false);
  });
});

describe('S-16 cases and summary', () => {
  it('has 20 cases with unique ids, covering every slice property kind', () => {
    expect(CASES).toHaveLength(20);
    expect(new Set(CASES.map((testCase) => testCase.id)).size).toBe(20);
    for (const kind of ['VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'nested'] as const) {
      expect(CASES.some((testCase) => testCase.kinds.includes(kind))).toBe(true);
    }
  });

  it('builds the reversibility table from case rows', () => {
    const row = (id: string, kinds: (typeof CASES)[number]['kinds'], roundTrip: boolean, deviation = false) => ({
      id,
      label: id,
      kinds,
      applied: true,
      applyError: null,
      args: {},
      nestedArgs: {},
      unmapped: id === 'C2' ? [{ key: 'arg:variant', figma: 'Danger' }] : [],
      deviations: deviation ? [{ role: 'root', fields: ['fills'] }] : [],
      roundTrip,
      diffs: [],
      surprise: [],
      error: null,
    });
    const summary = summarize([
      row('C1', ['VARIANT', 'TEXT'], true),
      row('C2', ['VARIANT'], false),
      row('C3', [], true, true),
    ]);
    expect(summary.reversibility.VARIANT).toEqual({ cases: 2, roundTrip: 1, failed: ['C2'] });
    expect(summary.reversibility.TEXT).toEqual({ cases: 1, roundTrip: 1, failed: [] });
    expect(summary.valueMapGaps).toEqual(['arg:variant="Danger"']);
    expect(summary.overridesOutsideProperties).toEqual(['root.fills']);
  });
});
