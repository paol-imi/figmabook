import { type CNode, checkSceneInvariants, type SceneNode } from '@holotype/ir';
import { HolotypeError, NotImplementedError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { mapComponent, mapTokens } from '../src';
import { asVariant, loadCapture, mapperInput, settings, singleInput } from './support';

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof HolotypeError) return error.code;
    throw error;
  }
  return undefined;
};

const find = (node: SceneNode, nk: string): SceneNode | undefined =>
  node.nk === nk ? node : node.children?.map((child) => find(child, nk)).find((found) => found !== undefined);

const button = loadCapture('button');

/** A second Button variant: same structure, another background. */
function secondaryButton() {
  const capture = asVariant(button, 'components-button--secondary', 'a1b2c3d4e5f60718', { variant: 'secondary' });
  const root = structuredClone(capture.root);
  if (root.computed) root.computed.background.color = { r: 0.9, g: 0.9, b: 0.9, a: 1, space: 'srgb' };
  return { ...capture, root };
}

const variantAxis = {
  id: 'arg:variant',
  name: 'Variant',
  source: { kind: 'arg', arg: 'variant' },
  values: [
    { label: 'Primary', bind: { args: { variant: 'primary' } } },
    { label: 'Secondary', bind: { args: { variant: 'secondary' } } },
  ],
} as const;

describe('mapComponent: input checks', () => {
  it('rejects a plan for another component', () => {
    const input = singleInput(button);
    expect(codeOf(() => mapComponent({ ...input, plan: { ...input.plan, sid: 'other' } }))).toBe('PLAN_MAPPER_FAILED');
  });

  it('rejects a plan without variants', () => {
    const input = singleInput(button);
    expect(codeOf(() => mapComponent({ ...input, plan: { ...input.plan, variants: [] } }))).toBe('PLAN_MAPPER_FAILED');
  });

  it('rejects a planned variant without a capture, and a capture keyed under the wrong variant', () => {
    const input = singleInput(button);
    expect(codeOf(() => mapComponent({ ...input, captures: new Map() }))).toBe('PLAN_MAPPER_FAILED');
    const wrong = new Map([[button.target.vk, { ...button, target: { ...button.target, vk: 'ffffffffffffffff' } }]]);
    expect(codeOf(() => mapComponent({ ...input, captures: wrong }))).toBe('PLAN_MAPPER_FAILED');
  });

  it('rejects settings that cannot be meant', () => {
    const bad = settings((s) => ({ ...s, layout: { ...s.layout, tolerancePx: -1 } }));
    const error = (() => {
      try {
        mapComponent(singleInput(button, { config: bad }));
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(HolotypeError);
    expect((error as HolotypeError).message).toContain('layout.tolerancePx');
  });

  it('rejects text whose runs use an unknown style or do not tile the characters', () => {
    const unknownStyle = { ...button, textStyles: {} };
    expect(codeOf(() => mapComponent(singleInput(unknownStyle)))).toBe('PLAN_MAPPER_FAILED');
    const root = structuredClone(button.root);
    const label = root.children.find((child) => child.type === 'text');
    if (label?.text) label.text.runs = [{ start: 0, end: 3, styleId: 'ts1' }];
    expect(codeOf(() => mapComponent(singleInput({ ...button, root })))).toBe('PLAN_MAPPER_FAILED');
  });

  it('wraps an unexpected exception in PLAN_MAPPER_FAILED and keeps it as the cause', () => {
    const input = singleInput(button);
    const failing = new Map(input.captures);
    failing.get = () => {
      throw new TypeError('boom');
    };
    try {
      mapComponent({ ...input, captures: failing });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HolotypeError);
      expect((error as HolotypeError).code).toBe('PLAN_MAPPER_FAILED');
      expect((error as HolotypeError).message).toContain('boom');
      expect((error as Error).cause).toBeInstanceOf(TypeError);
    }
  });

  it('does not modify its input', () => {
    const input = singleInput(loadCapture('paints'));
    const before = structuredClone([...input.captures.values()]);
    mapComponent(input);
    expect([...input.captures.values()]).toEqual(before);
  });
});

describe('mapComponent: component sets', () => {
  it('builds a component set with VARIANT properties, variant names and a grid', () => {
    const input = mapperInput(
      [
        { capture: button, values: { 'arg:variant': 'Primary' } },
        { capture: secondaryButton(), values: { 'arg:variant': 'Secondary' } },
      ],
      { displayName: 'Button', axes: [variantAxis], layoutGrid: { columns: ['arg:variant'], rows: [] } },
    );
    const { scene } = mapComponent(input);
    expect(scene.meta.kind).toBe('component-set');
    expect(scene.properties).toEqual([
      {
        type: 'VARIANT',
        key: 'arg:variant',
        name: 'Variant',
        values: ['Primary', 'Secondary'],
        defaultValue: 'Primary',
        source: {
          kind: 'arg',
          argName: 'variant',
          classification: 'VARIANT',
          evidence: 'declared',
          valueMap: [
            { figma: 'Primary', arg: 'primary' },
            { figma: 'Secondary', arg: 'secondary' },
          ],
        },
      },
    ]);
    expect(scene.variants.map((variant) => [variant.root.name, variant.grid, variant.values])).toEqual([
      ['Variant=Primary', { row: 0, col: 0 }, { 'arg:variant': 'Primary' }],
      ['Variant=Secondary', { row: 0, col: 1 }, { 'arg:variant': 'Secondary' }],
    ]);
    expect(scene.setLayout).toMatchObject({ columnsBy: ['arg:variant'], rowsBy: [], labels: true });
    expect(checkSceneInvariants(scene)).toEqual([]);
  });

  it('throws PLAN_INVARIANT_VIOLATION when unaligned variants break the nk-aligned invariant', () => {
    const other = secondaryButton();
    const root: CNode = { ...other.root, children: other.root.children.filter((child) => child.type !== 'text') };
    const input = mapperInput(
      [
        { capture: button, values: { 'arg:variant': 'Primary' } },
        { capture: { ...other, root }, values: { 'arg:variant': 'Secondary' } },
      ],
      { axes: [variantAxis] },
    );
    try {
      mapComponent(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HolotypeError);
      const { diagnostics } = error as HolotypeError;
      expect(diagnostics.every((d) => d.code === 'PLAN_INVARIANT_VIOLATION' && d.severity === 'error')).toBe(true);
      expect(diagnostics.map((d) => d.data?.invariant)).toContain('nk-aligned');
    }
  });

  it('drops planned BOOLEAN and TEXT properties it cannot bind yet, with PLAN_PROPERTY_UNBOUND', () => {
    const verification = { status: 'verified', rule: 'R1', probes: [], diagnostics: [] } as const;
    const input = singleInput(button, {
      properties: [
        { kind: 'BOOLEAN', name: 'Show icon', arg: 'showIcon', defaultValue: false, verification },
        { kind: 'TEXT', name: 'Label', arg: 'label', defaultValue: 'Button', verification },
      ],
    });
    const { scene, diagnostics } = mapComponent(input);
    expect(scene.properties).toEqual([]);
    expect(scene.diagnostics.map((d) => [d.code, d.property, d.severity])).toEqual([
      ['PLAN_PROPERTY_UNBOUND', 'Show icon', 'warn'],
      ['PLAN_PROPERTY_UNBOUND', 'Label', 'warn'],
    ]);
    expect(diagnostics.slice(0, 2)).toEqual(scene.diagnostics);
  });
});

describe('mapComponent: settings', () => {
  const paints = loadCapture('paints');

  it('drops opacity:0 layers when mapper.keepInvisible is off', () => {
    const keep = mapComponent(singleInput(paints)).scene.variants[0]?.root;
    const drop = mapComponent(
      singleInput(paints, { config: settings((s) => ({ ...s, mapper: { ...s.mapper, keepInvisible: false } })) }),
    ).scene.variants[0]?.root;
    expect(keep && find(keep, 'root/invisible')?.visible).toBe(false);
    expect(drop && find(drop, 'root/invisible')).toBeUndefined();
  });

  it('keeps Display P3 channels for a P3 file, without gamut mapping', () => {
    const config = settings((s) => ({ ...s, mapper: { ...s.mapper, colorProfile: 'display-p3' } }));
    const { scene, diagnostics } = mapComponent(singleInput(paints, { config }));
    const p3 = scene.variants[0] && find(scene.variants[0].root, 'root/p3');
    expect(p3?.fills).toEqual([{ type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 1 }]);
    expect(diagnostics.some((d) => d.code === 'PAINT_COLOR_GAMUT_MAPPED')).toBe(false);
  });

  it('locks browser line breaks in locked-lines mode', () => {
    const config = settings((s) => ({ ...s, textMode: 'locked-lines' }));
    const { scene } = mapComponent(singleInput(loadCapture('card'), { config }));
    const text = scene.variants[0] && find(scene.variants[0].root, 'root/p')?.text;
    expect(text?.wrapMode).toBe('locked-lines');
    expect(text?.characters).toBe('A short description that wraps onto two lines.');
    expect(text?.lines).toEqual([
      { startChar: 0, endChar: 25 },
      { startChar: 25, endChar: 46 },
    ]);
  });
});

describe('mapTokens', () => {
  it('is not built yet (Phase 5)', () => {
    expect(() => mapTokens([])).toThrow(NotImplementedError);
  });
});
