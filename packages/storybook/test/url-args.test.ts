import { describe, expect, it } from 'vitest';
import { buildIframeUrl, encodeUrlParam } from '../src';

describe('encodeUrlParam (03 §5.4)', () => {
  it('encodes the Storybook special values and sorts keys', () => {
    const encoded = encodeUrlParam({
      variant: 'primary',
      disabled: true,
      loading: false,
      count: -2.5,
      icon: null,
      label: undefined,
      color: '#FF0000',
      tint: 'rgba(255, 0, 0, 0.5)',
      shade: 'hsl(120, 50%, 50%)',
      when: new Date('2026-01-01T00:00:00Z'),
      text: 'Hello world_-',
    });
    expect(encoded).toEqual({
      ok: true,
      value: [
        'color:!hex(FF0000)',
        'count:-2.5',
        'disabled:!true',
        'icon:!null',
        'label:!undefined',
        'loading:!false',
        'shade:!hsl(120,50,50)',
        'text:Hello world_-',
        'tint:!rgba(255,0,0,0.5)',
        'variant:primary',
        'when:!date(2026-01-01T00:00:00.000Z)',
      ].join(';'),
    });
  });

  it('encodes nested objects with dots and arrays with brackets', () => {
    expect(encodeUrlParam({ style: { b: 2, a: 'x' }, items: ['one', 'two'] })).toEqual({
      ok: true,
      value: 'items[0]:one;items[1]:two;style.a:x;style.b:2',
    });
  });

  it('gives an empty string for no values', () => {
    expect(encodeUrlParam({})).toEqual({ ok: true, value: '' });
  });

  it('reports every value the safe-list would drop or change', () => {
    class Point {
      x = 1;
    }
    const encoded = encodeUrlParam({
      'bad key!': 1,
      html: '<b>x</b>',
      numeric: '42',
      big: 1e21,
      tiny: 1e-7,
      nan: Number.NaN,
      empty: [],
      bare: {},
      nested: { 'a.b': 1 },
      fn: () => 1,
      point: new Point(),
      invalid: new Date(Number.NaN),
    });
    expect(encoded.ok).toBe(false);
    if (encoded.ok) return;
    expect(encoded.error.map((problem) => problem.path)).toEqual([
      'bad key!',
      'bare',
      'big',
      'empty',
      'fn',
      'html',
      'invalid',
      'nan',
      'nested.a.b',
      'numeric',
      'point',
      'tiny',
    ]);
    expect(encoded.error.find((problem) => problem.path === 'numeric')?.reason).toBe(
      'a numeric string would be read back as a number',
    );
    expect(encoded.error.find((problem) => problem.path === 'point')?.reason).toBe(
      'a class instance cannot be encoded',
    );
    expect(encoded.error.find((problem) => problem.path === 'fn')?.reason).toBe('a function cannot be encoded');
  });
});

describe('buildIframeUrl', () => {
  it('puts id and viewMode first and leaves out empty params', () => {
    expect(buildIframeUrl('http://127.0.0.1:6006/', 'micro-flex--row', '', '')).toBe(
      'http://127.0.0.1:6006/iframe.html?id=micro-flex--row&viewMode=story',
    );
  });

  it('percent-encodes args and globals under a base path', () => {
    expect(
      buildIframeUrl(
        'https://example.test/sb/',
        'components-button--primary',
        'label:Hi there;disabled:!true',
        'theme:dark',
      ),
    ).toBe(
      'https://example.test/sb/iframe.html?id=components-button--primary&viewMode=story&args=label%3AHi+there%3Bdisabled%3A%21true&globals=theme%3Adark',
    );
  });
});
