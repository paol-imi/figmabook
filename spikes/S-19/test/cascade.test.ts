import { describe, expect, it } from 'vitest';
import {
  cascadeWinner,
  type Declaration,
  levelCount,
  levelDeclarations,
  winningDeclaration,
} from '../resolver/cascade.ts';
import { declaringProperties, isInheritedProperty } from '../resolver/longhands.ts';
import { decl, matched, rule } from './support.ts';

const winnerValue = (result: ReturnType<typeof winningDeclaration>) =>
  result.kind === 'none' ? undefined : result.declaration.property.value;

describe('declaringProperties', () => {
  it('lists shorthands and logical forms of a physical side (ltr)', () => {
    expect(declaringProperties('padding-left')).toEqual([
      'padding',
      'padding-inline',
      'padding-inline-start',
      'padding-left',
    ]);
    expect(declaringProperties('border-top-color')).toEqual([
      'border',
      'border-color',
      'border-top',
      'border-block',
      'border-block-color',
      'border-block-start',
      'border-block-start-color',
      'border-top-color',
    ]);
  });

  it('swaps inline start and end for rtl', () => {
    expect(declaringProperties('padding-left', 'rtl')).toContain('padding-inline-end');
    expect(declaringProperties('border-top-left-radius', 'rtl')).toEqual([
      'border-radius',
      'border-start-end-radius',
      'border-top-left-radius',
    ]);
  });

  it('covers gaps, fills and font, and leaves other properties to themselves', () => {
    expect(declaringProperties('column-gap')).toEqual(['gap', 'grid-gap', 'grid-column-gap', 'column-gap']);
    expect(declaringProperties('background-color')).toEqual(['background', 'background-color']);
    expect(declaringProperties('line-height')).toEqual(['font', 'line-height']);
    expect(declaringProperties('letter-spacing')).toEqual(['letter-spacing']);
    expect(declaringProperties('--space-3')).toEqual(['--space-3']);
  });

  it('knows which mapped properties inherit', () => {
    expect(isInheritedProperty('color')).toBe(true);
    expect(isInheritedProperty('--x')).toBe(true);
    expect(isInheritedProperty('padding-left')).toBe(false);
  });
});

describe('levelDeclarations', () => {
  it('orders attributes, rules, then style="" and reads ranged declarations of authored styles', () => {
    const styles = {
      attributesStyle: { cssProperties: [{ name: 'width', value: '10px' }] },
      matchedCSSRules: [
        rule('.a', [
          decl('border', 'var(--w) solid red'),
          { name: 'border-top-width', value: '' },
          { name: 'border-top-color', value: '' },
        ]),
        rule('button', [{ name: 'padding-block-start', value: '1px' }], { origin: 'user-agent' }),
      ],
      inlineStyle: { cssProperties: [decl('color', 'blue')] },
    };
    expect(levelDeclarations(styles, 0).map((d) => `${d.source}:${d.property.name}`)).toEqual([
      'attributes:width',
      'rule:border',
      'user-agent:padding-block-start',
      'inline:color',
    ]);
    expect(levelDeclarations(styles, 1)).toEqual([]);
  });

  it('skips disabled and unparsed declarations', () => {
    const styles = matched([
      rule('.a', [decl('color', 'red', 0, { disabled: true }), decl('color', 'bogus', 1, { parsedOk: false })]),
    ]);
    expect(levelDeclarations(styles, 0)).toEqual([]);
  });

  it('counts the node plus its ancestors', () => {
    expect(levelCount(matched([], [], []))).toBe(3);
    expect(levelCount({})).toBe(1);
  });
});

describe('cascadeWinner', () => {
  const d = (value: string, important = false): Declaration => ({
    property: { name: 'color', value, important },
    source: 'rule',
    level: 0,
  });

  it('takes the last declaration, an !important one over later normal ones', () => {
    expect(cascadeWinner([d('a'), d('b')])?.property.value).toBe('b');
    expect(cascadeWinner([d('a', true), d('b')])?.property.value).toBe('a');
    expect(cascadeWinner([d('a', true), d('b', true)])?.property.value).toBe('b');
    expect(cascadeWinner([])).toBeUndefined();
  });
});

describe('winningDeclaration', () => {
  it('finds a longhand set by a later shorthand', () => {
    const styles = matched([rule('.a', [decl('padding-left', '4px'), decl('padding', '8px', 1)])]);
    expect(winnerValue(winningDeclaration(styles, 'padding-left'))).toBe('8px');
  });

  it('lets style="" win over rules', () => {
    const styles = {
      ...matched([rule('.a', [decl('color', 'red')])]),
      inlineStyle: { cssProperties: [decl('color', 'blue')] },
    };
    const result = winningDeclaration(styles, 'color');
    expect(result.kind === 'declared' && result.declaration.source).toBe('inline');
  });

  it('inherits inherited properties from the nearest ancestor that declares them', () => {
    const styles = matched(
      [],
      [rule('.parent', [decl('padding-left', '3px')])],
      [rule('body', [decl('color', 'red')])],
    );
    const color = winningDeclaration(styles, 'color');
    expect(color.kind === 'declared' && color.declaration.level).toBe(2);
    expect(winningDeclaration(styles, 'padding-left').kind).toBe('none');
  });

  it('follows `inherit` and inherited `unset` to the parent', () => {
    const styles = matched(
      [rule('.a', [decl('padding-left', 'inherit')])],
      [rule('.p', [decl('padding-left', '9px')])],
    );
    expect(winnerValue(winningDeclaration(styles, 'padding-left'))).toBe('9px');
    const unset = matched([rule('.a', [decl('color', 'unset')])], [rule('.p', [decl('color', 'green')])]);
    expect(winnerValue(winningDeclaration(unset, 'color'))).toBe('green');
  });

  it('reports CSS-wide keywords', () => {
    const styles = matched([rule('.a', [decl('padding-left', 'initial')])]);
    expect(winningDeclaration(styles, 'padding-left').kind).toBe('keyword');
  });

  it('starts at fromLevel', () => {
    const styles = matched([rule('.a', [decl('--x', '1px')])], [rule(':root', [decl('--x', '2px')])]);
    expect(winnerValue(winningDeclaration(styles, '--x'))).toBe('1px');
    expect(winnerValue(winningDeclaration(styles, '--x', { fromLevel: 1 }))).toBe('2px');
  });

  it('maps logical declarations with the direction', () => {
    const styles = matched([rule('.a', [decl('padding-inline-start', '5px')])]);
    expect(winnerValue(winningDeclaration(styles, 'padding-left'))).toBe('5px');
    expect(winningDeclaration(styles, 'padding-left', { direction: 'rtl' }).kind).toBe('none');
    expect(winnerValue(winningDeclaration(styles, 'padding-right', { direction: 'rtl' }))).toBe('5px');
  });
});
