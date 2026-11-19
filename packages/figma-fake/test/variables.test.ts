import { describe, expect, it } from 'vitest';
import { createFakeFigma, type FakeFigma } from '../src';
import { fakeWithFonts, INTER_BOLD, RED, stack, textNode } from './helpers';

function tokens(figma: FakeFigma) {
  const collection = figma.variables.createVariableCollection('Tokens');
  const mode = collection.defaultModeId;
  const variable = (name: string, type: VariableResolvedDataType, value: VariableValue) => {
    const v = figma.variables.createVariable(name, collection, type);
    v.setValueForMode(mode, value);
    return v;
  };
  return { collection, mode, variable };
}

describe('variables and collections (BUILD §8.1 "Variables (subset)", typings:2148-2280, 11769-12051)', () => {
  it('a collection has one mode, "Mode 1"; variables start with a value per mode', async () => {
    const figma = createFakeFigma();
    const collection = figma.variables.createVariableCollection('Tokens');
    expect(collection.id).toMatch(/^VariableCollectionId:/);
    expect(collection.modes).toEqual([{ modeId: collection.defaultModeId, name: 'Mode 1' }]);
    const space = figma.variables.createVariable('space/4', collection, 'FLOAT');
    expect(space.id).toMatch(/^VariableID:/);
    expect([space.name, space.resolvedType, space.variableCollectionId]).toEqual(['space/4', 'FLOAT', collection.id]);
    expect(space.valuesByMode).toEqual({ [collection.defaultModeId]: 0 });
    expect(space.scopes).toEqual(['ALL_SCOPES']);
    expect(collection.variableIds).toEqual([space.id]);
    expect([space.remote, collection.remote, collection.isExtension]).toEqual([false, false, false]);
    expect(space.key).toMatch(/^[0-9a-f]{40}$/);
    expect(await space.getPublishStatusAsync()).toBe('UNPUBLISHED');
    collection.renameMode(collection.defaultModeId, 'Light');
    expect(collection.modes[0]?.name).toBe('Light');
  });

  it('lists and finds local variables; getVariableByIdAsync returns null for unknown or removed ones', async () => {
    const figma = createFakeFigma();
    const { variable } = tokens(figma);
    const a = variable('a', 'FLOAT', 1);
    const b = variable('b', 'COLOR', { r: 1, g: 0, b: 0 });
    expect(await figma.variables.getLocalVariablesAsync()).toEqual([a, b]);
    expect(await figma.variables.getLocalVariablesAsync('COLOR')).toEqual([b]);
    expect(await figma.variables.getVariableByIdAsync(a.id)).toBe(a);
    expect(await figma.variables.getVariableByIdAsync('VariableID:9:9')).toBeNull();
    a.remove();
    expect(await figma.variables.getVariableByIdAsync(a.id)).toBeNull();
    expect(() => a.name).toThrow(/does not exist/);
    expect((await figma.variables.getLocalVariableCollectionsAsync()).length).toBe(1);
  });

  it('the deprecated collection-id overload throws under dynamic-page (typings:2190-2199)', () => {
    const figma = createFakeFigma();
    const collection = figma.variables.createVariableCollection('Tokens');
    expect(() => figma.variables.createVariable('x', collection.id, 'FLOAT')).toThrow(/dynamic-page/);
  });

  it('setValueForMode checks the type, the mode and aliases; COLOR values are stored as RGBA', () => {
    const figma = createFakeFigma();
    const { collection, mode, variable } = tokens(figma);
    const color = variable('color/bg', 'COLOR', { r: 1, g: 1, b: 1 });
    expect(color.valuesByMode[mode]).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(() => color.setValueForMode(mode, 3)).toThrow(/RGB/);
    expect(() => color.setValueForMode('1:999', { r: 0, g: 0, b: 0 })).toThrow(/not in this collection/);
    expect(() => color.setValueForMode(mode, { r: 2, g: 0, b: 0 })).toThrow(/between 0 and 1/);
    const size = variable('size', 'FLOAT', 4);
    expect(() => size.setValueForMode(mode, 'big')).toThrow(/number/);
    const alias = variable('size/alias', 'FLOAT', figma.variables.createVariableAlias(size));
    expect(alias.valuesByMode[mode]).toEqual({ type: 'VARIABLE_ALIAS', id: size.id });
    expect(alias.resolveForConsumer(figma.createFrame())).toEqual({ value: 4, resolvedType: 'FLOAT' });
    expect(() => size.setValueForMode(mode, figma.variables.createVariableAlias(alias))).toThrow(/cycle/);
    expect(() => alias.setValueForMode(mode, figma.variables.createVariableAlias(color))).toThrow(/Cannot alias/);
    expect(collection.variableIds).toHaveLength(3);
  });

  it('scopes, code syntax, description and plugin data', () => {
    const figma = createFakeFigma();
    const { variable } = tokens(figma);
    const gap = variable('gap', 'FLOAT', 8);
    gap.scopes = ['GAP'];
    expect(gap.scopes).toEqual(['GAP']);
    expect(() => {
      gap.scopes = ['NOPE' as VariableScope];
    }).toThrow(/scope/);
    gap.setVariableCodeSyntax('WEB', 'var(--gap)');
    expect(gap.codeSyntax).toEqual({ WEB: 'var(--gap)' });
    gap.removeVariableCodeSyntax('WEB');
    expect(gap.codeSyntax).toEqual({});
    gap.description = 'Default gap';
    gap.setSharedPluginData('holotype', 'tok', '--gap');
    expect(gap.getSharedPluginData('holotype', 'tok')).toBe('--gap');
    expect(gap.getSharedPluginDataKeys('holotype')).toEqual(['tok']);
    expect(() => gap.setSharedPluginData('x', 'k', 'v')).toThrow(/namespace/);
    expect(figma.ops().at(-1)).toEqual({
      method: 'setSharedPluginData',
      nodeId: gap.id,
      property: 'holotype/tok',
      value: '--gap',
    });
  });

  it('removing a collection removes its variables', async () => {
    const figma = createFakeFigma();
    const { collection, variable } = tokens(figma);
    const a = variable('a', 'BOOLEAN', true);
    collection.remove();
    expect(await figma.variables.getLocalVariablesAsync()).toEqual([]);
    expect(await figma.variables.getVariableByIdAsync(a.id)).toBeNull();
  });

  it('snapshots list collections and variables', () => {
    const figma = createFakeFigma();
    expect(figma.snapshot().variables).toBeUndefined();
    const { collection, mode, variable } = tokens(figma);
    const gap = variable('gap', 'FLOAT', 8);
    gap.setVariableCodeSyntax('WEB', 'var(--gap)');
    expect(figma.snapshot().variables).toEqual({
      collections: [
        { id: collection.id, name: 'Tokens', modes: collection.modes, defaultModeId: mode, variableIds: [gap.id] },
      ],
      variables: [
        {
          id: gap.id,
          name: 'gap',
          collection: collection.id,
          resolvedType: 'FLOAT',
          valuesByMode: { [mode]: 8 },
          codeSyntax: { WEB: 'var(--gap)' },
        },
      ],
    });
  });
});

describe('node bindings (setBoundVariable, boundVariables, typings:6692-6740; 08 §8)', () => {
  it('binding writes the value; the binding shows in boundVariables', () => {
    const figma = createFakeFigma();
    const { variable } = tokens(figma);
    const space = variable('space/4', 'FLOAT', 16);
    const { parent } = stack(figma);
    parent.paddingLeft = 12;
    parent.setBoundVariable('paddingLeft', space);
    expect(parent.paddingLeft).toBe(16);
    expect(parent.boundVariables).toEqual({ paddingLeft: { type: 'VARIABLE_ALIAS', id: space.id } });
    expect(figma.ops().at(-1)).toEqual({
      method: 'setBoundVariable',
      nodeId: parent.id,
      property: 'paddingLeft',
      value: space.id,
    });
    parent.setBoundVariable('paddingLeft', null);
    expect(parent.boundVariables).toEqual({});
    expect(parent.paddingLeft).toBe(16);
  });

  it('follows the field rules: types, fields the node has, auto layout, and no variable ids', () => {
    const figma = createFakeFigma();
    const { variable } = tokens(figma);
    const space = variable('space', 'FLOAT', 4);
    const label = variable('label', 'STRING', 'x');
    const frame = figma.createFrame();
    expect(() => frame.setBoundVariable('paddingLeft', space)).toThrow(/layoutMode/);
    expect(() => frame.setBoundVariable('opacity', label)).toThrow(/FLOAT/);
    expect(() => figma.createRectangle().setBoundVariable('itemSpacing', space)).toThrow(/Cannot bind "itemSpacing"/);
    expect(() => frame.setBoundVariable('width', space.id)).toThrow(/dynamic-page/);
    expect(() => frame.setBoundVariable('fontSize', space)).toThrow(/text nodes/);
    expect(() => frame.setBoundVariable('nope' as VariableBindableNodeField, space)).toThrow(/Invalid field/);
    expect(frame.boundVariables).toEqual({});
  });

  it('cornerRadius binds the four corners on frames and rectangles (typings:6702-6705)', () => {
    const figma = createFakeFigma();
    const { variable } = tokens(figma);
    const radius = variable('radius', 'FLOAT', 6);
    const rect = figma.createRectangle();
    rect.setBoundVariable('cornerRadius', radius);
    const alias = { type: 'VARIABLE_ALIAS', id: radius.id };
    expect(rect.cornerRadius).toBe(6);
    expect(rect.boundVariables).toEqual({
      topLeftRadius: alias,
      topRightRadius: alias,
      bottomLeftRadius: alias,
      bottomRightRadius: alias,
    });
  });

  it('width binds through resize; a literal write unbinds the field', () => {
    const figma = createFakeFigma();
    const { variable } = tokens(figma);
    const size = variable('size', 'FLOAT', 48);
    const frame = figma.createFrame();
    frame.setBoundVariable('width', size);
    expect(frame.width).toBe(48);
    frame.setBoundVariable('opacity', variable('half', 'FLOAT', 0.5));
    frame.opacity = 1;
    expect(Object.keys(frame.boundVariables ?? {})).toEqual(['width']);
    frame.resize(10, 10);
    expect(frame.boundVariables).toEqual({});
  });

  it('bound fields and paints follow their variable when its value changes', () => {
    const figma = createFakeFigma();
    const { mode, variable } = tokens(figma);
    const gap = variable('gap', 'FLOAT', 4);
    const brand = variable('brand', 'COLOR', { r: 0, g: 0, b: 1 });
    const alias = variable('gap/alias', 'FLOAT', figma.variables.createVariableAlias(gap));
    const { parent } = stack(figma);
    parent.setBoundVariable('itemSpacing', alias);
    parent.fills = [figma.variables.setBoundVariableForPaint(RED, 'color', brand)];
    expect(parent.itemSpacing).toBe(4);
    gap.setValueForMode(mode, 10);
    brand.setValueForMode(mode, { r: 0, g: 1, b: 0, a: 0.5 });
    expect(parent.itemSpacing).toBe(10);
    expect(parent.fills).toEqual([expect.objectContaining({ color: { r: 0, g: 1, b: 0 }, opacity: 0.5 })]);
    expect(
      figma
        .ops()
        .filter((op) => op.nodeId === parent.id)
        .map((op) => op.method),
    ).toEqual(['createFrame', 'set', 'appendChild', 'setBoundVariable', 'set']);
  });

  it('setBoundVariableForPaint needs a solid paint, the color field and a COLOR variable', () => {
    const figma = createFakeFigma();
    const { variable } = tokens(figma);
    const brand = variable('brand', 'COLOR', { r: 0, g: 0, b: 1 });
    const size = variable('size', 'FLOAT', 1);
    const gradient = {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      gradientStops: [],
    };
    expect(() => figma.variables.setBoundVariableForPaint(gradient as unknown as SolidPaint, 'color', brand)).toThrow(
      /solid/,
    );
    expect(() => figma.variables.setBoundVariableForPaint(RED, 'opacity' as 'color', brand)).toThrow(/field/);
    expect(() => figma.variables.setBoundVariableForPaint(RED, 'color', size)).toThrow(/COLOR/);
    const bound = figma.variables.setBoundVariableForPaint(RED, 'color', brand);
    const unbound = figma.variables.setBoundVariableForPaint(bound, 'color', null);
    expect([unbound.boundVariables, unbound.color]).toEqual([{}, { r: 0, g: 0, b: 1 }]);
  });
});

describe('text bindings (setRangeBoundVariable, typings:9977-9990)', () => {
  it('binds ranges, needs loaded fonts, and reads back per range', async () => {
    const { figma, text } = await textNode('Hello');
    const { variable } = tokens(figma);
    const size = variable('font/size', 'FLOAT', 20);
    text.setRangeBoundVariable(0, 2, 'fontSize', size);
    expect(text.getRangeFontSize(0, 2)).toBe(20);
    expect(text.getRangeBoundVariable(0, 2, 'fontSize')).toEqual({ type: 'VARIABLE_ALIAS', id: size.id });
    expect(text.getRangeBoundVariable(0, 5, 'fontSize')).toBe(figma.mixed);
    expect(text.getRangeBoundVariable(2, 5, 'fontSize')).toBeNull();
    expect(text.boundVariables).toEqual({ fontSize: [{ type: 'VARIABLE_ALIAS', id: size.id }] });
    expect(text.getStyledTextSegments(['boundVariables']).map((s) => [s.start, s.end, s.boundVariables])).toEqual([
      [0, 2, { fontSize: { type: 'VARIABLE_ALIAS', id: size.id } }],
      [2, 5, {}],
    ]);
    figma.reset();
    expect(() => text.setRangeBoundVariable(0, 2, 'fontSize', size)).toThrow(/unloaded font/);
  });

  it('a literal range write unbinds; a variable change rewrites the bound range without fonts', async () => {
    const { figma, text } = await textNode('Hello');
    const { mode, variable } = tokens(figma);
    const line = variable('line', 'FLOAT', 18);
    const size = variable('size', 'FLOAT', 14);
    text.setBoundVariable('lineHeight', line);
    text.setBoundVariable('fontSize', size);
    expect(text.lineHeight).toEqual({ value: 18, unit: 'PIXELS' });
    text.setRangeFontSize(0, 5, 16);
    expect(text.boundVariables).toEqual({ lineHeight: [{ type: 'VARIABLE_ALIAS', id: line.id }] });
    figma.reset();
    line.setValueForMode(mode, 24);
    expect(text.lineHeight).toEqual({ value: 24, unit: 'PIXELS' });
  });

  it('font family, style and weight bindings switch fonts that must be loaded', async () => {
    const figma = await fakeWithFonts();
    const text = figma.createText();
    text.characters = 'Hi';
    const { variable } = tokens(figma);
    const weight = variable('weight', 'FLOAT', 700);
    text.setRangeBoundVariable(0, 2, 'fontWeight', weight);
    expect(text.fontName).toEqual(INTER_BOLD);
    const family = variable('family', 'STRING', 'Roboto');
    expect(() => text.setRangeBoundVariable(0, 2, 'fontFamily', family)).toThrow(/unloaded font "Roboto Bold"/);
    await figma.loadFontAsync({ family: 'Roboto', style: 'Bold' });
    text.setRangeBoundVariable(0, 2, 'fontFamily', family);
    expect(text.fontName).toEqual({ family: 'Roboto', style: 'Bold' });
    const heavy = variable('heavy', 'FLOAT', 900);
    expect(() => text.setRangeBoundVariable(0, 2, 'fontWeight', heavy)).toThrow(/No available style/);
    expect(() => text.setRangeBoundVariable(0, 2, 'fontFamily', weight)).toThrow(/STRING/);
  });
});
