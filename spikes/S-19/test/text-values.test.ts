import { describe, expect, it } from 'vitest';
import {
  declarationAt,
  enclosingSelector,
  offsetOf,
  selectorFrom,
  splitSelectorList,
  splitTopLevel,
  stripComments,
} from '../resolver/css-text.ts';
import { fieldGroup, relevantFields } from '../resolver/fields.ts';
import { comparableValue, sameValue, shorthandComponent } from '../resolver/values.ts';

const CSS = `/* Variants */
.primary,
.cta:hover { /* { */
  background: var(--bg);
}

@media (min-width: 1px) {
  .a[data-x="}"] { color: red; }
}
`;

describe('css-text', () => {
  it('converts 1-based positions to offsets', () => {
    expect(offsetOf('ab\ncd', 2, 1)).toBe(3);
    expect(offsetOf('ab\ncd', 1, 3)).toBe(2);
    expect(offsetOf('ab\ncd', 1, 4)).toBe(-1);
    expect(offsetOf('ab', 3, 1)).toBe(-1);
    expect(offsetOf('ab', 1, 0)).toBe(-1);
  });

  it('blanks comments without moving offsets', () => {
    const stripped = stripComments('a/* x\ny */b"/*"');
    expect(stripped).toBe('a    \n    b"/*"');
    expect(stripped.length).toBe('a/* x\ny */b"/*"'.length);
  });

  it('reads the selector list that starts at a position', () => {
    expect(selectorFrom(CSS, offsetOf(CSS, 2, 1))).toBe('.primary, .cta:hover');
    expect(selectorFrom(CSS, offsetOf(CSS, 8, 3))).toBe('.a[data-x="}"]');
    expect(selectorFrom('color: red;', 0)).toBeUndefined();
    expect(selectorFrom('.a', -1)).toBeUndefined();
  });

  it('finds the enclosing rule of a declaration', () => {
    expect(enclosingSelector(CSS, offsetOf(CSS, 4, 3))).toBe('.primary, .cta:hover');
    expect(enclosingSelector(CSS, CSS.indexOf('color'))).toBe('.a[data-x="}"]');
    expect(enclosingSelector('color: red', 3)).toBeUndefined();
  });

  it('checks declarations and splits lists', () => {
    expect(declarationAt(CSS, offsetOf(CSS, 4, 3), 'background')).toBe(true);
    expect(declarationAt(CSS, offsetOf(CSS, 4, 3), 'background-color')).toBe(false);
    expect(declarationAt(CSS, -1, 'x')).toBe(false);
    expect(splitSelectorList('.a ,\n .b:is(.c, .d)')).toEqual(['.a', '.b:is(.c, .d)']);
    expect(splitTopLevel('var(--a) solid  rgb(0 0 0)', ' ')).toEqual(['var(--a)', 'solid', 'rgb(0 0 0)']);
  });
});

describe('shorthandComponent', () => {
  it('reads box shorthands positionally', () => {
    expect(shorthandComponent('padding', '1px 2px 3px 4px', 'padding-left')).toBe('4px');
    expect(shorthandComponent('padding', '1px 2px 3px', 'padding-left')).toBe('2px');
    expect(shorthandComponent('padding', '1px 2px', 'padding-bottom')).toBe('1px');
    expect(shorthandComponent('padding', 'var(--a)', 'padding-right')).toBe('var(--a)');
    expect(shorthandComponent('padding-inline', '1px 2px', 'padding-right')).toBe('2px');
    expect(shorthandComponent('padding-inline', '1px 2px', 'padding-right', 'rtl')).toBe('1px');
    expect(shorthandComponent('padding-block', '1px 2px', 'padding-bottom')).toBe('2px');
    expect(shorthandComponent('gap', '4px 8px', 'column-gap')).toBe('8px');
    expect(shorthandComponent('border-color', 'red green', 'border-left-color')).toBe('green');
    expect(shorthandComponent('border-radius', '1px 2px / 9px', 'border-bottom-right-radius')).toBe('1px');
    expect(shorthandComponent('border-radius', '1px 2px 3px', 'border-bottom-left-radius')).toBe('2px');
    expect(shorthandComponent('padding-left', ' 4px ', 'padding-left')).toBe('4px');
  });

  it('leaves non-positional shorthands to value matching', () => {
    expect(shorthandComponent('border', '1px solid red', 'border-top-width')).toBeUndefined();
    expect(shorthandComponent('padding', '1px 2px 3px 4px 5px', 'padding-left')).toBeUndefined();
    expect(shorthandComponent('padding-inline', '1px', 'padding-top')).toBeUndefined();
  });
});

describe('comparableValue / sameValue', () => {
  it('normalizes the forms Chromium serializes differently', () => {
    expect(comparableValue('#2563eb')).toBe('rgb(37, 99, 235)');
    expect(comparableValue('#2563eb80')).toBe('rgba(37, 99, 235, 0.5)');
    expect(comparableValue('#fff')).toBe('rgb(255, 255, 255)');
    expect(comparableValue('transparent')).toBe('rgba(0, 0, 0, 0)');
    expect(comparableValue('0')).toBe('0px');
    expect(comparableValue('16.50px')).toBe('16.5px');
    expect(comparableValue('bold')).toBe('700');
    expect(comparableValue('"Inter", sans-serif')).toBe('inter, sans-serif');
    expect(comparableValue('rgba(1, 2, 3, 1)')).toBe('rgb(1, 2, 3)');
  });

  it('refuses forms it cannot evaluate', () => {
    for (const value of ['var(--a)', 'calc(1px + 2px)', '1rem', 'currentColor', 'red', 'oklch(65% .2 145)', '']) {
      expect(comparableValue(value)).toBeUndefined();
    }
    expect(comparableValue('#12345')).toBeUndefined();
  });

  it('compares equal text first, then normalized forms', () => {
    expect(sameValue('Red', 'red')).toBe(true);
    expect(sameValue('#2563eb', 'rgb(37, 99, 235)')).toBe(true);
    expect(sameValue('4px', '5px')).toBe(false);
    expect(sameValue('red', 'rgb(255, 0, 0)')).toBeUndefined();
  });
});

describe('relevantFields', () => {
  const base = {
    display: 'flex',
    'padding-top': '0px',
    'padding-right': '8px',
    'padding-bottom': '0px',
    'padding-left': '8px',
    'row-gap': 'normal',
    'column-gap': '4px',
    'background-color': 'rgba(0, 0, 0, 0)',
    'border-top-style': 'solid',
    'border-top-width': '1px',
    'border-top-color': 'rgba(0, 0, 0, 0)',
    'border-right-style': 'none',
    'border-right-width': '3px',
    'border-top-left-radius': '6px',
    'border-top-right-radius': '0px',
  };

  it('keeps non-default element fields', () => {
    expect(relevantFields('element', base)).toEqual([
      'padding-right',
      'padding-left',
      'column-gap',
      'border-top-width',
      'border-top-left-radius',
    ]);
    expect(relevantFields('element', { ...base, display: 'block', 'background-color': 'rgb(1, 2, 3)' })).toEqual([
      'padding-right',
      'padding-left',
      'background-color',
      'border-top-width',
      'border-top-left-radius',
    ]);
  });

  it('keeps typography for text, letter-spacing only when set', () => {
    expect(relevantFields('text', { 'letter-spacing': 'normal' })).toEqual([
      'color',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
    ]);
    expect(relevantFields('text', { 'letter-spacing': '0.5px' })).toContain('letter-spacing');
  });

  it('groups fields', () => {
    expect(
      ['padding-left', 'row-gap', 'background-color', 'border-top-color', 'border-top-left-radius', 'color'].map(
        fieldGroup,
      ),
    ).toEqual(['padding', 'gap', 'fill', 'border', 'radius', 'text']);
  });
});
