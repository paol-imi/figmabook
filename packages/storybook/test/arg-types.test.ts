import type { JsonValue } from '@holotype/ir';
import { describe, expect, it } from 'vitest';
import { inferControl, type NormalizedArgType, normalizeArgType, normalizeArgTypes } from '../src';

const sources = { declared: new Set(['variant', 'off']), docgen: new Set(['variant', 'type', 'onClick']) };

describe('normalizeArgType (03 §4.4)', () => {
  it('keeps a declared enum with its options, control, table and description', () => {
    expect(
      normalizeArgType(
        'variant',
        {
          name: 'variant',
          control: { type: 'inline-radio', disable: false },
          options: ['primary', 'secondary'],
          description: 'Visual emphasis.',
          type: { name: 'enum', value: ['primary', 'secondary'], required: false, raw: "'primary' | 'secondary'" },
          table: { type: { summary: 'union' }, defaultValue: { summary: "'primary'" }, category: 'Look' },
        },
        sources,
      ),
    ).toEqual({
      name: 'variant',
      origin: 'story',
      type: { name: 'enum', value: ['primary', 'secondary'], required: false, raw: "'primary' | 'secondary'" },
      control: { type: 'inline-radio' },
      options: ['primary', 'secondary'],
      table: { category: 'Look', defaultValue: { summary: "'primary'" } },
      description: 'Visual emphasis.',
    });
  });

  it('tells docgen-inline and inferred argTypes apart', () => {
    expect(normalizeArgType('type', { type: { required: false } }, sources)).toEqual({
      name: 'type',
      origin: 'docgen-inline',
    });
    expect(normalizeArgType('extra', { type: { name: 'string' } }, sources)).toEqual({
      name: 'extra',
      origin: 'inferred-from-args',
      type: { name: 'string' },
      control: { type: 'text' },
    });
  });

  it('reads control: false, a disabled control, labels and range bounds', () => {
    expect(normalizeArgType('off', { control: false }, sources).control).toBe(false);
    expect(normalizeArgType('off', { control: { disable: true } }, sources).control).toBe(false);
    expect(
      normalizeArgType(
        'size',
        { control: { type: 'range', min: 0, max: 10, step: 2, labels: { a: 'A', b: 1 } } },
        sources,
      ).control,
    ).toEqual({ type: 'range', min: 0, max: 10, step: 2, labels: { a: 'A' } });
    expect(normalizeArgType('size', { control: 'select', options: [1, 2] }, sources).control).toEqual({
      type: 'select',
    });
  });

  it('keeps mapping and conditional argTypes, and drops an empty description', () => {
    const made = normalizeArgType(
      'icon',
      { mapping: { star: { $node: 'react', type: 'Star' } }, if: { arg: 'showIcon' }, description: '' },
      sources,
    );
    expect(made.mapping).toEqual({ star: { $node: 'react', type: 'Star' } });
    expect(made.if).toEqual({ arg: 'showIcon' });
    expect(made.description).toBeUndefined();
  });

  it('sorts keys', () => {
    expect(Object.keys(normalizeArgTypes({ b: {}, a: {}, c: null }, sources))).toEqual(['a', 'b', 'c']);
  });
});

describe('inferControl (store/inferControls.ts)', () => {
  it.each([
    [{ name: 'boolean' }, undefined, { type: 'boolean' }],
    [{ name: 'string' }, undefined, { type: 'text' }],
    [{ name: 'number' }, undefined, { type: 'number' }],
    [{ name: 'array' }, undefined, { type: 'object' }],
    [{ name: 'enum', value: ['a', 'b'] }, undefined, { type: 'radio' }],
    [{ name: 'enum', value: [1, 2, 3, 4, 5, 6] }, undefined, { type: 'select' }],
    [undefined, ['a', 'b', 'c', 'd', 'e'], { type: 'radio' }],
    [{ name: 'function' }, undefined, false],
    [{ name: 'symbol' }, undefined, false],
    [{ name: 'other' }, undefined, undefined],
    [undefined, undefined, undefined],
  ] as [NormalizedArgType['type'], JsonValue[] | undefined, unknown][])(
    '%j with options %j → %j',
    (type, options, expected) => {
      expect(inferControl(type, options)).toEqual(expected);
    },
  );
});
