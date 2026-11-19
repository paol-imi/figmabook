import { NotImplementedError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';

/**
 * Members outside the B-06 slice fail with `NotImplementedError` naming the item that adds
 * them, so no test can pass on behaviour the fake does not emulate (README "Not modelled yet").
 */
describe('members the slice does not model', () => {
  const figma = createFakeFigma();
  const frame = figma.createFrame();
  const component = figma.createComponent();
  const text = figma.createText();
  const vector = figma.createVector();

  const cases: Array<[string, () => unknown, RegExp]> = [
    ['exportAsync', () => frame.exportAsync(), /B-54/],
    ['setBoundVariable', () => frame.setBoundVariable('width', null), /B-54/],
    ['createInstance', () => component.createInstance(), /B-54/],
    ['componentPropertyDefinitions', () => component.componentPropertyDefinitions, /B-54/],
    ['addComponentProperty', () => component.addComponentProperty('Label', 'TEXT', 'x'), /B-54/],
    ['clone', () => frame.clone(), /B-125/],
    ['gridRowCount', () => frame.gridRowCount, /B-111/],
    ['setGridChildPosition', () => frame.setGridChildPosition(0, 0), /B-111/],
    ['setFillStyleIdAsync', () => frame.setFillStyleIdAsync('S:1'), /B-139/],
    ['setExplicitVariableModeForCollection', () => frame.setExplicitVariableModeForCollection('c', 'm'), /B-139/],
    ['vectorNetwork', () => vector.vectorNetwork, /B-54/],
    ['setRangeBoundVariable', () => text.setRangeBoundVariable(0, 0, 'fontSize', null), /B-54/],
    ['openTypeFeatures', () => text.openTypeFeatures, /B-54/],
    ['getRangeListOptions', () => text.getRangeListOptions(0, 0), /hardening/],
    ['getCSSAsync', () => frame.getCSSAsync(), /hardening/],
    ['on', () => figma.currentPage.on('nodechange', () => undefined), /hardening/],
    ['absoluteRenderBounds', () => frame.absoluteRenderBounds, /B-54/],
  ];

  for (const [name, call, item] of cases) {
    it(`${name} throws NotImplementedError (${item.source})`, () => {
      expect(call).toThrow(NotImplementedError);
      expect(call).toThrow(item);
    });
  }

  it('values that are empty by construction in the slice are returned, not thrown', () => {
    expect(frame.boundVariables).toEqual({});
    expect(frame.reactions).toEqual([]);
    expect(frame.stuckNodes).toEqual([]);
    expect(frame.detachedInfo).toBeNull();
    expect(frame.complexStrokeProperties).toEqual({ type: 'BASIC' });
    expect(frame.componentPropertyReferences).toBeNull();
  });
});
