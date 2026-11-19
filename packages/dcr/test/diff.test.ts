import { appliedHash, normalizeGroups } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import type { SnapVariable } from '../src';
import { argsText, camelCase, hexColor, kebab, pascalCase } from '../src/classify/text';
import { variableHash } from '../src/classify/variables';
import { changedGroupsOf, diffGroups, diffNode, isDerivedGeometry, TokenIndex, valueAt } from '../src/diff/index';
import { cssNameFromVariableName } from '../src/diff/tokens';
import { parseVariantName } from '../src/identify/components';
import { loadInput } from './cases';

/*
 * The diff, noise filter and token rules (15 §4.3, §4.7) and the words of titles (15 §6).
 */

const variable = (id: string, name: string, value: unknown, extra: Partial<SnapVariable> = {}): SnapVariable =>
  ({
    id,
    name,
    collection: 'Tokens',
    resolvedType: typeof value === 'number' ? 'FLOAT' : 'COLOR',
    valuesByMode: { '1:0': value },
    data: {},
    ...extra,
  }) as SnapVariable;

describe('diffGroups', () => {
  it('names atomic values by their read-back path', () => {
    const before = { paint: { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }], topLeftRadius: 4 } };
    const after = { paint: { fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 }], topLeftRadius: 6 } };
    expect(diffGroups(before, after).map((c) => [c.field, c.before, c.after])).toEqual([
      ['paint.fills[0].color', { r: 1, g: 0, b: 0 }, { r: 0, g: 0, b: 1 }],
      ['paint.topLeftRadius', 4, 6],
    ]);
  });

  it('compares a list of another length as a whole and a missing object as empty', () => {
    const changes = diffGroups(
      { paint: { fills: [] }, bind: {} },
      { paint: { fills: [{ type: 'SOLID' }] }, bind: { componentPropertyReferences: { characters: 'Title#1:2' } } },
    );
    expect(changes).toEqual([
      { group: 'bind', field: 'bind.componentPropertyReferences.characters', before: null, after: 'Title#1:2' },
      { group: 'paint', field: 'paint.fills', before: [], after: [{ type: 'SOLID' }] },
    ]);
  });

  it('keeps line heights, font names and points whole', () => {
    const changes = diffGroups(
      { text: { lineHeight: { unit: 'PIXELS', value: 24 }, fontName: { family: 'Inter', style: 'Regular' } } },
      { text: { lineHeight: { unit: 'PERCENT', value: 150 }, fontName: { family: 'Inter', style: 'Bold' } } },
    );
    expect(changes.map((c) => c.field)).toEqual(['text.fontName', 'text.lineHeight']);
  });

  it('reads the edited groups from the per-group sub-hashes of ah', () => {
    const applied = { layout: { paddingLeft: 16 }, vis: { name: 'A', visible: true } };
    const ah = appliedHash(normalizeGroups(applied));
    expect(changedGroupsOf(ah, applied)).toEqual([]);
    expect(changedGroupsOf(ah, { ...applied, layout: { paddingLeft: 20 } })).toEqual(['layout']);
    expect(changedGroupsOf(undefined, applied)).toEqual(['layout', 'vis']);
    expect(changedGroupsOf('not-a-hash', applied)).toEqual(['layout', 'vis']);
  });
});

describe('noise filter and tokens', () => {
  it('treats sizes on hugging or filling axes, and auto-resized text, as derived', () => {
    const hug = { layout: { layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FIXED' } };
    expect(isDerivedGeometry('geom.width', hug)).toBe(true);
    expect(isDerivedGeometry('geom.height', hug)).toBe(false);
    expect(isDerivedGeometry('geom.height', { layout: { layoutSizingVertical: 'FILL' } })).toBe(true);
    expect(isDerivedGeometry('geom.height', { text: { textAutoResize: 'HEIGHT' } })).toBe(true);
    expect(isDerivedGeometry('geom.width', { text: { textAutoResize: 'HEIGHT' } })).toBe(false);
    expect(isDerivedGeometry('geom.x', hug)).toBe(false);
  });

  const tokens = new TokenIndex({
    'v:1': variable('v:1', 'space/4', 16, { codeSyntax: { WEB: 'var(--space-4)' }, scopes: ['GAP'] } as never),
    'v:2': variable('v:2', 'size/16', 16, { data: { tok: '--size-16' }, scopes: ['WIDTH_HEIGHT'] } as never),
    'v:3': variable('v:3', 'gap/base', { alias: 'v:1' }, { resolvedType: 'FLOAT', scopes: ['ALL_SCOPES'] } as never),
    'v:4': variable('v:4', 'Brand/Primary', { r: 0, g: 0, b: 1, a: 1 }, { scopes: ['ALL_FILLS'] } as never),
    'v:5': variable('v:5', 'hidden', 16, { scopes: [] } as never),
  });

  it('names a variable by codeSyntax.WEB, else tok, else its name in reverse', () => {
    expect(tokens.cssName('v:1')).toBe('--space-4');
    expect(tokens.cssName('v:2')).toBe('--size-16');
    expect(tokens.cssName('v:4')).toBe('--brand-primary');
    expect(tokens.figmaName('--space-4')).toBe('space/4');
    expect(cssNameFromVariableName('  ')).toBeUndefined();
  });

  it('finds candidates by type, scope and resolved value (aliases followed, hidden variables left out)', () => {
    expect(tokens.candidates({ kind: 'FLOAT', value: 16 }, 'GAP')).toEqual(['--gap-base', '--space-4']);
    expect(tokens.candidates({ kind: 'FLOAT', value: 16 }, 'WIDTH_HEIGHT')).toEqual(['--gap-base', '--size-16']);
    expect(tokens.candidates({ kind: 'COLOR', rgba: { r: 0, g: 0, b: 1, a: 1 } }, 'FRAME_FILL')).toEqual([
      '--brand-primary',
    ]);
    expect(tokens.candidates({ kind: 'COLOR', rgba: { r: 0, g: 0, b: 1, a: 0.5 } }, 'FRAME_FILL')).toEqual([]);
    expect(tokens.candidates({ kind: 'COLOR', rgba: { r: 0, g: 0, b: 1, a: 1 } }, 'STROKE_COLOR')).toEqual([]);
  });

  it('folds a rebinding into the value field and drops a value that moved with its variable', () => {
    const before = { layout: { paddingLeft: 16, paddingTop: 16 }, bind: { paddingLeft: 'v:1', paddingTop: 'v:1' } };
    const rebound = diffNode(
      { nodeType: 'FRAME', before, after: { layout: before.layout, bind: { paddingLeft: 'v:3', paddingTop: 'v:1' } } },
      tokens,
    );
    expect(rebound).toEqual([
      {
        group: 'layout',
        field: 'layout.paddingLeft',
        before: 16,
        after: 16,
        token: { before: '--space-4', after: '--gap-base' },
      },
    ]);
    const moved = diffNode(
      { nodeType: 'FRAME', before, after: { ...before, layout: { paddingLeft: 18, paddingTop: 18 } } },
      tokens,
    );
    expect(moved).toEqual([]);
  });

  it('reads a value by its field path', () => {
    const groups = { paint: { fills: [{ color: { r: 1, g: 1, b: 1 } }] } };
    expect(valueAt(groups, 'paint.fills[0].color')).toEqual({ r: 1, g: 1, b: 1 });
    expect(valueAt(groups, 'paint.fills[2].color')).toBeUndefined();
  });

  it('hashes a variable as the plugin wrote it (matches every fixture ah)', () => {
    const { branch } = loadInput('no-change');
    for (const written of Object.values(branch.variables)) expect(variableHash(written as never)).toBe(written.data.ah);
  });
});

describe('words', () => {
  it('inverts Title Case and builds arg and export names', () => {
    expect(kebab('With media')).toBe('with-media');
    expect(camelCase('Show icon')).toBe('showIcon');
    expect(pascalCase('Product card')).toBe('ProductCard');
    expect(pascalCase('2 up')).toBe('Component2Up');
    expect(hexColor({ r: 0.1451, g: 0.3882, b: 0.9216 })).toBe('#2563eb');
    expect(hexColor({ r: 1, g: 1, b: 1, a: 0.5 })).toBe('#ffffff80');
  });

  it('parses variant names and writes them as args in axis order', () => {
    const values = parseVariantName('Size=Md, Variant=With media');
    const axes = [
      { name: 'Variant', key: 'arg:variant', values: [] },
      { name: 'Size', key: 'arg:size', values: [] },
    ];
    expect(argsText(values, axes, { size: 'md' })).toBe('variant=with-media, size=md');
  });
});
