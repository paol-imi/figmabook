import { NotImplementedError } from '@holotype/shared';
import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';

/**
 * Members outside the slice (BUILD §8.1) fail with `NotImplementedError` naming the item that
 * adds them, so no test can pass on behaviour the fake does not emulate (README "Not modelled yet").
 */
describe('members the slice does not model', () => {
  const figma = createFakeFigma();
  const frame = figma.createFrame();
  const component = figma.createComponent();
  const instance = component.createInstance();
  const set = figma.combineAsVariants([figma.createComponent()], figma.currentPage);
  const text = figma.createText();
  const collection = figma.variables.createVariableCollection('Tokens');
  const variable = figma.variables.createVariable('size', collection, 'FLOAT');

  const cases: Array<[string, () => unknown, RegExp]> = [
    ['clone', () => frame.clone(), /B-125/],
    ['InstanceNode.overrides', () => instance.overrides, /B-125/],
    ['InstanceNode.removeOverrides', () => instance.removeOverrides(), /B-125/],
    ['InstanceNode.detachInstance', () => instance.detachInstance(), /hardening/],
    ['gridRowCount', () => frame.gridRowCount, /B-111/],
    ['setGridChildPosition', () => frame.setGridChildPosition(0, 0), /B-111/],
    ['setFillStyleIdAsync', () => frame.setFillStyleIdAsync('S:1'), /B-139/],
    ['setExplicitVariableModeForCollection', () => frame.setExplicitVariableModeForCollection('c', 'm'), /B-139/],
    ['VariableCollection.addMode', () => collection.addMode('Dark'), /B-139/],
    ['Variable.valuesByModeForCollectionAsync', () => variable.valuesByModeForCollectionAsync(collection), /hardening/],
    ['createVariable(EASING)', () => figma.variables.createVariable('ease', collection, 'EASING'), /hardening/],
    ['createSlot', () => component.createSlot(), /B-142/],
    ['addComponentProperty(SLOT)', () => set.addComponentProperty('Content', 'SLOT', ''), /B-142/],
    ['getRangeListOptions', () => text.getRangeListOptions(0, 0), /hardening/],
    ['getCSSAsync', () => frame.getCSSAsync(), /hardening/],
    ['on', () => figma.currentPage.on('nodechange', () => undefined), /hardening/],
  ];

  for (const [name, call, item] of cases) {
    it(`${name} throws NotImplementedError (${item.source})`, () => {
      expect(call).toThrow(NotImplementedError);
      expect(call).toThrow(item);
    });
  }

  it('async members not modelled reject with NotImplementedError', async () => {
    await expect(frame.exportAsync({ format: 'JPG' })).rejects.toThrow(NotImplementedError);
    await expect(frame.exportAsync({ format: 'PDF' })).rejects.toThrow(/hardening/);
  });

  it('values that are empty by construction in the slice are returned, not thrown', () => {
    expect(frame.boundVariables).toEqual({});
    expect(frame.reactions).toEqual([]);
    expect(frame.stuckNodes).toEqual([]);
    expect(frame.detachedInfo).toBeNull();
    expect(frame.complexStrokeProperties).toEqual({ type: 'BASIC' });
    expect(frame.componentPropertyReferences).toBeNull();
  });
});
