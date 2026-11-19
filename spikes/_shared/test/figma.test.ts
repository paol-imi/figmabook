import { describe, expect, it } from 'vitest';
import { createDryRunFigma } from '../../runner/test/support/dry-run-figma.ts';
import {
  dropShadow,
  effectsSignature,
  findByRole,
  fingerprint,
  hexOf,
  layoutGrid,
  paintsSignature,
  probe,
  rgb,
  setRole,
  solid,
  usePage,
} from '../figma.ts';

describe('color helpers', () => {
  it('round-trips #rrggbb', () => {
    expect(hexOf(rgb('#3b82f6'))).toBe('#3b82f6');
    expect(() => rgb('blue')).toThrow(/Not a #rrggbb color/);
  });

  it('describes paints and effects compactly', () => {
    expect(paintsSignature([solid('#ff0000', 0.5)])).toBe('#ff0000@0.5');
    expect(paintsSignature([])).toBe('none');
    expect(paintsSignature(Symbol('mixed') as unknown as PluginAPI['mixed'])).toBe('mixed');
    expect(effectsSignature([dropShadow('#000000', 1, 2, 3)])).toBe('drop_shadow:#000000:1,2:3');
    expect(effectsSignature([])).toBe('none');
  });
});

describe('probe', () => {
  it('turns throws into evidence', async () => {
    expect(await probe(() => 1)).toEqual({ ok: true, value: 1 });
    expect(
      await probe(() => {
        throw new Error('not allowed');
      }),
    ).toEqual({ ok: false, error: 'not allowed' });
  });
});

describe('fingerprint', () => {
  it('is stable, short and does not contain the input', () => {
    expect(fingerprint('AbCdEf123456')).toBe(fingerprint('AbCdEf123456'));
    expect(fingerprint('AbCdEf123456')).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint('AbCdEf123456')).not.toBe(fingerprint('AbCdEf123457'));
  });
});

describe('page and role helpers (dry run)', () => {
  it('reuses a kit page by name and finds nodes by role, then by name', async () => {
    const { figma } = createDryRunFigma();
    const page = await usePage(figma, 'Kit page');
    expect(await usePage(figma, 'Kit page')).toBe(page);
    expect(figma.currentPage).toBe(page);
    const frame = figma.createFrame();
    const child = figma.createRectangle();
    child.name = 'Named';
    frame.appendChild(child);
    setRole(child, 'box');
    expect(findByRole(frame, 'box')).toBe(child);
    expect(findByRole(frame, 'missing', 'Named')).toBe(child);
    expect(findByRole(frame, 'missing')).toBeUndefined();
  });

  it('lays nodes out in rows', () => {
    const { figma } = createDryRunFigma();
    const nodes = [0, 1, 2].map(() => {
      const frame = figma.createFrame();
      frame.resize(10, 10);
      return frame;
    });
    layoutGrid(nodes, { x: 0, y: 0, columns: 2, gap: 5 });
    expect(nodes.map((node) => [node.x, node.y])).toEqual([
      [0, 0],
      [15, 0],
      [0, 15],
    ]);
  });
});
