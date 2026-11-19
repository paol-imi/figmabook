import { describe, expect, it } from 'vitest';
import { MAX_VAR_DEPTH, resolveVarChain } from '../resolver/var-chain.ts';
import { soleVarRef, varRefs } from '../resolver/var-refs.ts';
import { decl, matched, rule } from './support.ts';

describe('varRefs', () => {
  it('lists the outermost references with their fallbacks', () => {
    expect(varRefs('var(--a) solid var(--b, var(--c))').map(({ name, fallback }) => ({ name, fallback }))).toEqual([
      { name: '--a', fallback: undefined },
      { name: '--b', fallback: 'var(--c)' },
    ]);
    expect(varRefs('calc(var(--space-2) * 2)')[0]).toMatchObject({ name: '--space-2', start: 5, end: 19 });
  });

  it('ignores var( in strings, longer identifiers and malformed references', () => {
    expect(varRefs('"var(--a)" somevar(--b) var(x) var(--c')).toEqual([]);
    expect(varRefs('VAR(--Upper)')).toMatchObject([{ name: '--Upper' }]);
  });

  it('recognizes a value that is exactly one reference', () => {
    expect(soleVarRef('  var(--a)  ')?.name).toBe('--a');
    expect(soleVarRef('var(--a, 4px)')?.fallback).toBe('4px');
    expect(soleVarRef('var(--a) var(--b)')).toBeUndefined();
    expect(soleVarRef('calc(var(--a))')).toBeUndefined();
    expect(soleVarRef('4px')).toBeUndefined();
  });
});

describe('resolveVarChain', () => {
  const ref = (value: string) => {
    const [first] = varRefs(value);
    if (first === undefined) throw new Error('no ref');
    return first;
  };

  it('follows definitions up the ancestors, resolving each where it is declared', () => {
    const styles = matched(
      [rule('.btn', [decl('background', 'var(--btn-bg)')])],
      [rule('.theme', [decl('--brand', 'red', 0)])],
      [rule(':root', [decl('--btn-bg', 'var(--brand)', 0), decl('--brand', '#2563eb', 1)])],
    );
    const chain = resolveVarChain(styles, ref('var(--btn-bg)'), 0);
    // `--btn-bg` is declared on :root, so its `var(--brand)` resolves on :root, not on `.theme`.
    expect(chain).toMatchObject({
      names: ['--btn-bg', '--brand'],
      terminal: '#2563eb',
      pure: true,
      status: 'complete',
    });
    expect(chain.steps.map((s) => s.declaration?.level)).toEqual([2, 2]);
  });

  it('prefers the later of two scopes on the same element ([data-theme] over :root)', () => {
    const styles = matched(
      [],
      [rule(':root', [decl('--fg', 'black')]), rule('[data-theme=dark]', [decl('--fg', 'white')])],
    );
    expect(resolveVarChain(styles, ref('var(--fg)'), 0).terminal).toBe('white');
  });

  it('uses the fallback of an undefined property', () => {
    const styles = matched([rule('.a', [decl('--b', '2px')])]);
    expect(resolveVarChain(styles, ref('var(--a, var(--b))'), 0)).toMatchObject({
      names: ['--a', '--b'],
      terminal: '2px',
      fallbackUsed: true,
      pure: false,
      status: 'complete',
    });
    expect(resolveVarChain(styles, ref('var(--missing)'), 0)).toMatchObject({ status: 'undefined-var', pure: false });
  });

  it('stops at expressions, which are not pure', () => {
    const styles = matched([rule('.a', [decl('--h', 'calc(var(--space-1) * 9)')])]);
    expect(resolveVarChain(styles, ref('var(--h)'), 0)).toMatchObject({
      names: ['--h'],
      terminal: 'calc(var(--space-1) * 9)',
      pure: false,
      status: 'complete',
    });
  });

  it('detects cycles and depth', () => {
    const cyclic = matched([rule('.a', [decl('--a', 'var(--b)'), decl('--b', 'var(--a)', 1)])]);
    expect(resolveVarChain(cyclic, ref('var(--a)'), 0).status).toBe('cycle');
    const deep = Array.from({ length: MAX_VAR_DEPTH + 1 }, (_, i) => decl(`--v${i}`, `var(--v${i + 1})`, i));
    expect(resolveVarChain(matched([rule('.a', deep)]), ref('var(--v0)'), 0).status).toBe('too-deep');
  });
});
