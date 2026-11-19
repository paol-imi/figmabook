import { NotImplementedError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';

describe('createFakeFigma', () => {
  it('starts as an empty document with one page', () => {
    expect(createFakeFigma().snapshot()).toEqual({
      type: 'DOCUMENT',
      children: [{ type: 'PAGE', name: 'Page 1', children: [] }],
      notifications: [],
    });
  });

  it('records notifications and returns detached snapshots', () => {
    const figma = createFakeFigma();
    const before = figma.snapshot();
    figma.notify('Imported 3 components');
    expect(figma.snapshot().notifications).toEqual(['Imported 3 components']);
    expect(before.notifications).toEqual([]);
  });

  it('fails loudly for Plugin API members it does not model yet', () => {
    const figma = createFakeFigma();
    expect(() => figma.createFrame()).toThrow(NotImplementedError);
    expect(() => figma.createFrame()).toThrow(/FigmaPort\.createFrame/);
  });
});
