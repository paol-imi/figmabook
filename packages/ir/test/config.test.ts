import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type ComponentConfig,
  DEFAULT_DCR_CONFIG,
  type HolotypeParams,
  normalizeConfigInput,
  parsePattern,
  patternToString,
  type ResolvedDcrConfig,
  resolveDcrConfig,
  validateHolotypeParams,
} from '../src';

describe('HolotypeParams (04 §9)', () => {
  it('has the keys D-37 and 04 add: implements, replacedBy, channelCapture, split, excludeCombos, grid, budget.hardLimit', () => {
    const params = {
      implements: ['1f2e3d4c5b6a7980'],
      replacedBy: { sid: 'components-banner', args: { tone: 'variant' } },
      channelCapture: true,
      split: true,
      excludeCombos: [{ Variant: 'Link', Size: 'Large' }],
      grid: { columns: ['State'], rows: ['Variant'] },
      budget: { hardLimit: 1024 },
    } satisfies HolotypeParams;
    expect(validateHolotypeParams(params).ok).toBe(true);
  });

  it('types match the authoring shapes, and `conflicts` exists only in components[sid]', () => {
    expectTypeOf<HolotypeParams['states']>().toEqualTypeOf<
      | false
      | {
          include?: (
            | 'default'
            | 'hover'
            | 'focus'
            | 'focus-visible'
            | 'focus-within'
            | 'active'
            | 'visited'
            | 'target'
          )[];
          foldBooleans?: string[];
          labels?: Record<string, string>;
          mode?: 'force' | 'addon' | 'interact';
          target?: string;
          includePortals?: boolean;
        }
      | undefined
    >();
    expectTypeOf<ComponentConfig['conflicts']>().toEqualTypeOf<'keep' | 'overwrite' | 'fork' | undefined>();
    expectTypeOf<HolotypeParams>().not.toHaveProperty('conflicts');
  });
});

describe('patterns (16 §1)', () => {
  it('round-trip between RegExp and "/pattern/flags"', () => {
    expect(patternToString(/^--tw-/i)).toBe('/^--tw-/i');
    expect(parsePattern('/^--tw-/i')).toEqual(/^--tw-/i);
    expect(parsePattern('/a\\/b/')).toEqual(/a\/b/);
    expect(parsePattern('--color-*')).toBe('--color-*');
  });

  it('normalizeConfigInput converts RegExps at any depth and keeps everything else', () => {
    const rename = (name: string) => name;
    expect(normalizeConfigInput({ a: [/x/g, 'y', { b: /z/ }], rename, n: 1, nil: null })).toEqual({
      a: ['/x/g', 'y', { b: '/z/' }],
      rename,
      n: 1,
      nil: null,
    });
  });
});

describe('resolveDcrConfig (16 §15, D-50)', () => {
  it('fills the built-in defaults', () => {
    expect(resolveDcrConfig()).toEqual(DEFAULT_DCR_CONFIG);
    expect(resolveDcrConfig()).not.toBe(DEFAULT_DCR_CONFIG);
  });

  it('merges objects and replaces arrays and records', () => {
    const resolved: ResolvedDcrConfig = resolveDcrConfig({
      scope: 'page:Checkout',
      targets: { components: { package: '@acme/ui' }, screens: { repo: 'github.com/acme/shop', path: 'apps/web' } },
      screens: { separator: ' – ', breakpoints: { Phone: 0 } },
      content: { placeholders: ['/^XX+$/'] },
      a11y: { categories: ['A11y'] },
    });
    expect(resolved).toEqual({
      ...DEFAULT_DCR_CONFIG,
      scope: 'page:Checkout',
      targets: { components: { package: '@acme/ui' }, screens: { repo: 'github.com/acme/shop', path: 'apps/web' } },
      screens: { ...DEFAULT_DCR_CONFIG.screens, separator: ' – ', breakpoints: { Phone: 0 } },
      content: { placeholders: ['/^XX+$/'], i18n: 'auto' },
      a11y: { categories: ['A11y'] },
    });
  });

  it('never aliases the defaults', () => {
    const resolved = resolveDcrConfig();
    resolved.screens.states.default?.push('Mutated');
    resolved.a11y.categories.push('Mutated');
    expect(DEFAULT_DCR_CONFIG.screens.states.default).toEqual(['Default', 'Filled']);
    expect(DEFAULT_DCR_CONFIG.a11y.categories).toEqual(['Accessibility', 'A11y']);
  });
});
