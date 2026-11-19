import { describe, expect, it } from 'vitest';
import { allowedKeys, checkParams, mergeParams, resolveParams, suggestKey } from '../src';

const scope = { storyId: 'components-button--primary', sid: 'components-button', title: 'Components/Button' };

describe('mergeParams (combineParameters semantics)', () => {
  it('merges plain objects, replaces arrays and scalars, ignores undefined layers', () => {
    expect(
      mergeParams<Record<string, unknown>>(
        { a: 1, nested: { x: 1, y: 1 }, list: [1, 2] },
        undefined,
        { nested: { y: 2 }, list: [3] },
        { a: 'top' },
      ),
    ).toEqual({ a: 'top', nested: { x: 1, y: 2 }, list: [3] });
  });
});

describe('checkParams (04 §9)', () => {
  it('passes valid parameters through', () => {
    expect(checkParams({ keepLayout: true, args: { size: { as: 'variant' } } }, scope)).toEqual({
      params: { keepLayout: true, args: { size: { as: 'variant' } } },
      diagnostics: [],
    });
  });

  it('drops an unknown key with PLAN_PARAM_UNKNOWN_KEY and suggests the closest key', () => {
    const { params, diagnostics } = checkParams({ keepLayot: true, matrix: 'full' }, scope);
    expect(params).toEqual({ matrix: 'full' });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PLAN_PARAM_UNKNOWN_KEY',
        severity: 'warn',
        message: 'Unknown key /keepLayot in parameters.holotype was ignored.',
        sid: 'components-button',
        value: 'keepLayot',
        fallback: 'the key was ignored',
        data: { storyId: 'components-button--primary', pointer: '/keepLayot', suggestion: 'keepLayout' },
      }),
    ]);
  });

  it('suggests keys of nested objects', () => {
    const { diagnostics } = checkParams({ args: { size: { as: 'variant', nmae: 'Size' } } }, scope);
    expect(diagnostics[0]?.data).toMatchObject({ pointer: '/args/size/nmae', suggestion: 'name' });
  });

  it('gives no suggestion when nothing is close', () => {
    const { diagnostics } = checkParams({ zzzzzzzz: 1 }, scope);
    expect(diagnostics[0]?.data).not.toHaveProperty('suggestion');
  });

  it('drops an invalid value with PLAN_CONFIG_INVALID and keeps the rest', () => {
    const { params, diagnostics } = checkParams({ strategy: 'sometimes', keepLayout: true }, scope);
    expect(params).toEqual({ keepLayout: true });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PLAN_CONFIG_INVALID',
        severity: 'error',
        fallback: 'the value was ignored',
        data: { storyId: 'components-button--primary', pointer: '/strategy', source: 'parameters.holotype' },
      }),
    ]);
  });

  it('reports a value that is not an object', () => {
    const { params, diagnostics } = checkParams('nope', scope);
    expect(params).toEqual({});
    expect(diagnostics.map((d) => d.code)).toEqual(['PLAN_CONFIG_INVALID']);
  });

  it('reads {$regexp} markers from the page as config patterns', () => {
    // `states.target` is a selector string: a RegExp written there becomes its "/source/flags" form.
    const { params } = checkParams({ stateTarget: { $regexp: '/btn/i' } }, scope);
    expect(params).toEqual({ stateTarget: '/btn/i' });
  });

  it('treats missing parameters as empty', () => {
    expect(checkParams(undefined, scope)).toEqual({ params: {}, diagnostics: [] });
    expect(checkParams(null, scope)).toEqual({ params: {}, diagnostics: [] });
  });
});

describe('resolveParams (README §7 precedence)', () => {
  it('applies defaults < Storybook layers < components entries, in order', () => {
    const { params } = resolveParams(
      { matrix: 'full', name: 'Story name', keepLayout: true },
      {
        defaults: { matrix: 'pairwise', textMode: 'reflow', name: 'Default name' },
        components: {
          'components-*': { name: 'Glob name', delay: 10 },
          'components-button': { name: 'Exact name' },
          'Components/**': { delay: 20 },
          'other-*': { delay: 99 },
        },
      },
      scope,
    );
    expect(params).toEqual({ matrix: 'full', textMode: 'reflow', name: 'Exact name', keepLayout: true, delay: 20 });
  });
});

describe('helpers', () => {
  it('lists the keys allowed at a pointer', () => {
    expect(allowedKeys([])).toContain('keepLayout');
    expect(allowedKeys(['args', 'anything'])).toEqual(['as', 'labels', 'name', 'order', 'target', 'values']);
    expect(allowedKeys(['nope'])).toEqual([]);
  });

  it('suggests within a third of the key length', () => {
    expect(suggestKey('unwarp', ['unwrap', 'portal'])).toBe('unwrap');
    expect(suggestKey('ab', ['xy'])).toBeUndefined();
  });
});
