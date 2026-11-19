import { describe, expect, it } from 'vitest';
import { BINDINGS, normalizeWeb, TOKENS, webSyntax } from '../fields.ts';
import { step1Answers } from '../steps.ts';

/** Every row of 08 §8 that binds from CSS (visible and characters are bound by properties, but probed too). */
const PLAN_FIELDS = [
  'fills.color',
  'strokes.color',
  'gradientStops.color',
  'textRangeFills.color',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'itemSpacing',
  'counterAxisSpacing',
  'gridRowGap',
  'gridColumnGap',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'opacity',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'fontFamily',
  'fontWeight',
  'paragraphSpacing',
  'paragraphIndent',
  'effects.color',
  'effects.radius',
  'effects.spread',
  'effects.offsetX',
  'effects.offsetY',
];

describe('S-12 binding table', () => {
  it('covers every field of 08 §8', () => {
    const fields = BINDINGS.map((binding) => binding.field);
    expect(PLAN_FIELDS.filter((field) => !fields.includes(field))).toEqual([]);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('binds only tokens that exist, with a matching type', () => {
    for (const binding of BINDINGS) {
      const token = TOKENS.find((candidate) => candidate.name === binding.token);
      expect(token, binding.token).toBeDefined();
      const isColor = binding.field.endsWith('.color');
      if (isColor) expect(token?.type).toBe('COLOR');
    }
  });

  it('defines alias targets before the tokens that point at them', () => {
    TOKENS.forEach((token, index) => {
      for (const value of [token.value, token.dark]) {
        if (typeof value === 'string' && value.startsWith('alias:')) {
          const target = TOKENS.findIndex((candidate) => candidate.name === value.slice(6));
          expect(target, value).toBeGreaterThanOrEqual(0);
          expect(target).toBeLessThan(index);
        }
      }
    });
  });
});

describe('codeSyntax.WEB', () => {
  it('formats token names as var(--…)', () => {
    expect(webSyntax('color/brand')).toBe('var(--color-brand)');
    expect(webSyntax('space/4')).toBe('var(--space-4)');
  });

  it.each([
    ['var(--color-brand)', '--color-brand'],
    [' var( --color-brand ) ', '--color-brand'],
    ['var(--a, #fff)', '--a'],
    ['--plain', '--plain'],
    ['color-brand', 'color-brand'],
  ])('normalizes %j', (input, expected) => {
    expect(normalizeWeb(input)).toBe(expected);
  });
});

describe('step1Answers', () => {
  it('reports failed bindings with their error', () => {
    const answers = step1Answers(
      {
        modeLimit: { modeLimit: 4, reachedProbeMax: false, modesCreated: 4, refusal: 'Limited to 4 modes only' },
        darkModeError: null,
        codeSyntax: [{ name: 'a', set: 'var(--a)', readBack: 'var(--a)', error: null }],
        alias: { ok: true, crossCollection: true },
        explicitMode: {
          ok: true,
          error: null,
          explicitModeStored: true,
          resolvedBefore: '#000000',
          resolvedAfter: '#ffffff',
          resolvedChanged: true,
        },
        bindings: [
          { field: 'opacity', kind: 'node', token: 'opacity/muted', ok: true, bound: true, value: 0.5, error: null },
          {
            field: 'gridRowGap',
            kind: 'node',
            token: 'space/2',
            ok: false,
            bound: false,
            value: null,
            error: 'GRID unsupported',
          },
        ],
        documentationLinks: { set: { ok: true, error: null }, component: { ok: true, error: null } },
        keys: { collections: [], variables: [] },
      },
      'professional',
    );
    expect(answers.bindableFields).toEqual({ bound: ['opacity'], failed: ['gridRowGap: GRID unsupported'], total: 2 });
    expect(answers).toMatchObject({
      plan: 'professional',
      modeLimit: 4,
      explicitModes: true,
      aliasAcrossCollections: true,
    });
  });
});
