import { describe, expect, it } from 'vitest';
import { dcrItemId } from '../src';

const base = {
  kind: 'component.modified',
  target: { sid: 'components-button', vk: '0123456789abcdef', nk: 'root/label' },
  fields: ['paint.fills', 'text.fontSize'],
};

describe('dcrItemId (15 §4.9)', () => {
  it('is a 16-hex id that is stable for the same change', () => {
    expect(dcrItemId(base)).toMatch(/^[0-9a-f]{16}$/);
    expect(dcrItemId(base)).toBe(dcrItemId({ ...base, target: { ...base.target } }));
  });

  it('does not depend on field or target key order', () => {
    const reordered = {
      fields: [...base.fields].reverse(),
      target: { nk: 'root/label', vk: '0123456789abcdef', sid: 'components-button' },
      kind: base.kind,
    };
    expect(dcrItemId(reordered)).toBe(dcrItemId(base));
  });

  it('changes when kind, target or fields change', () => {
    const ids = new Set([
      dcrItemId(base),
      dcrItemId({ ...base, kind: 'variant.added' }),
      dcrItemId({ ...base, target: { ...base.target, nk: 'root/icon' } }),
      dcrItemId({ ...base, fields: ['paint.fills'] }),
      // Joining with a plain separator would make these two collide.
      dcrItemId({ ...base, fields: ['a,b'] }),
      dcrItemId({ ...base, fields: ['a', 'b'] }),
    ]);
    expect(ids.size).toBe(6);
  });
});
