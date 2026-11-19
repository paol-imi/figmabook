import { describe, expect, it } from 'vitest';
import { computeItemId, type DcrTarget, dcrItemId, itemIdentity } from '../src';

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

  it('does not depend on field order, duplicates or target key order', () => {
    const reordered = {
      fields: [...base.fields].reverse().concat('paint.fills'),
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

describe('itemIdentity', () => {
  const code = { sid: 'components-button', storiesPath: 'src/Button.stories.tsx', storyIds: [] };

  it('never includes the CLI-added code ref', () => {
    const target: DcrTarget = {
      sid: 'components-button',
      vk: '0123456789abcdef',
      nk: 'root',
      figmaNodeId: '12:40',
      code,
    };
    expect(itemIdentity('component.modified', target)).toEqual({
      sid: 'components-button',
      vk: '0123456789abcdef',
      nk: 'root',
    });
  });

  it('keeps figmaNodeId only when no nk or key names the node', () => {
    expect(itemIdentity('variant.added', { sid: 's', figmaNodeId: '12:88' })).toEqual({
      sid: 's',
      figmaNodeId: '12:88',
    });
    expect(itemIdentity('node.added', { sid: 's', vk: '0123456789abcdef', figmaNodeId: '30:21' })).toEqual({
      sid: 's',
      vk: '0123456789abcdef',
      figmaNodeId: '30:21',
    });
    expect(itemIdentity('screen', { key: 'Checkout', figmaNodeId: '60:1' })).toEqual({ key: 'Checkout' });
  });

  it('names instance.outdated / instance.deprecated by the used (sid, vk), not by an occurrence', () => {
    const a = { sid: 's', vk: '0123456789abcdef', figmaNodeId: '60:9' };
    expect(itemIdentity('instance.deprecated', a)).toEqual({ sid: 's', vk: '0123456789abcdef' });
    expect(itemIdentity('instance.detached', a)).toEqual(a);
  });

  it('two variants added to the same set, or two layers added to one variant, get different ids', () => {
    const variant = (figmaNodeId: string) =>
      computeItemId({ kind: 'variant.added', target: { sid: 's', figmaNodeId } });
    expect(variant('12:88')).not.toBe(variant('12:89'));
    const layer = (figmaNodeId: string) =>
      computeItemId({ kind: 'node.added', target: { sid: 's', vk: '0123456789abcdef', figmaNodeId } });
    expect(layer('30:21')).not.toBe(layer('30:22'));
  });

  it('computeItemId uses the field paths of the changes', () => {
    const target = { sid: 's', vk: '0123456789abcdef', nk: 'root', figmaNodeId: '1:2' };
    const change = (field: string) => ({ group: 'layout' as const, field, before: 1, after: 2 });
    expect(computeItemId({ kind: 'component.modified', target, changes: [change('layout.paddingLeft')] })).toBe(
      dcrItemId({
        kind: 'component.modified',
        target: { sid: 's', vk: '0123456789abcdef', nk: 'root' },
        fields: ['layout.paddingLeft'],
      }),
    );
  });
});
