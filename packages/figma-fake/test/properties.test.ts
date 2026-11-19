import { describe, expect, it } from 'vitest';
import { createFakeFigma, type FakeFigma } from '../src';
import { at, fakeWithFonts } from './helpers';

/** A "Button" set with Size=sm and Size=lg variants, each with a label and an icon. */
function buttonSet(figma: FakeFigma) {
  const variants = ['Size=sm', 'Size=lg'].map((name, i) => {
    const component = figma.createComponent();
    component.name = name;
    component.x = i * 200;
    const label = figma.createText();
    label.name = 'Label';
    component.appendChild(label);
    label.characters = 'Button';
    const icon = figma.createRectangle();
    icon.name = 'Icon';
    component.appendChild(icon);
    return { component, label, icon };
  });
  const set = figma.combineAsVariants(
    variants.map((v) => v.component),
    figma.currentPage,
  );
  set.name = 'Button';
  return { set, variants };
}

describe('component property definitions (ComponentPropertiesMixin, typings:9717-9766; 09 §8)', () => {
  it('stored properties get a #id suffix; VARIANT axes come from the variant names', async () => {
    const figma = await fakeWithFonts();
    const { set } = buttonSet(figma);
    const label = set.addComponentProperty('Label', 'TEXT', 'Button');
    const icon = set.addComponentProperty('Show icon', 'BOOLEAN', true);
    expect(label).toMatch(/^Label#\d+:\d+$/);
    expect(icon).toMatch(/^Show icon#\d+:\d+$/);
    expect(set.componentPropertyDefinitions).toEqual({
      Size: { type: 'VARIANT', defaultValue: 'sm', variantOptions: ['sm', 'lg'] },
      [label]: { type: 'TEXT', defaultValue: 'Button' },
      [icon]: { type: 'BOOLEAN', defaultValue: true },
    });
    expect(figma.ops().at(-1)).toMatchObject({ method: 'addComponentProperty', nodeId: set.id });
  });

  it('a variant has no definitions of its own: the set holds them', async () => {
    const figma = await fakeWithFonts();
    const { variants } = buttonSet(figma);
    const variant = at(variants, 0).component;
    expect(() => variant.componentPropertyDefinitions).toThrow(/component set/);
    expect(() => variant.addComponentProperty('X', 'BOOLEAN', true)).toThrow(/component set/);
    const loose = figma.createComponent();
    const name = loose.addComponentProperty('Disabled', 'BOOLEAN', false);
    expect(loose.componentPropertyDefinitions).toEqual({ [name]: { type: 'BOOLEAN', defaultValue: false } });
  });

  it('validates types, defaults and options', async () => {
    const figma = await fakeWithFonts();
    const { set } = buttonSet(figma);
    expect(() => set.addComponentProperty('A', 'BOOLEAN', 'yes')).toThrow(/boolean/);
    expect(() => set.addComponentProperty('A', 'TEXT', true)).toThrow(/string/);
    expect(() => set.addComponentProperty('A', 'INSTANCE_SWAP', '99:99')).toThrow(/not the id of a component/);
    expect(() => set.addComponentProperty('A', 'TEXT', 'x', { preferredValues: [] })).toThrow(/INSTANCE_SWAP/);
    expect(() => set.addComponentProperty('A', 'TEXT', 'x', { description: 'd' })).toThrow(/SLOT/);
    expect(() => set.addComponentProperty('', 'TEXT', 'x')).toThrow(/non-empty/);
    expect(() => figma.createComponent().addComponentProperty('Theme', 'VARIANT', 'Light')).toThrow(/component sets/);
    const icon = figma.createComponent();
    const swap = set.addComponentProperty('Icon', 'INSTANCE_SWAP', icon.id, {
      preferredValues: [{ type: 'COMPONENT', key: icon.key }],
    });
    expect(set.componentPropertyDefinitions[swap]).toEqual({
      type: 'INSTANCE_SWAP',
      defaultValue: icon.id,
      preferredValues: [{ type: 'COMPONENT', key: icon.key }],
    });
  });

  it('adding a VARIANT property gives every variant Name=Default (09 §7.2)', async () => {
    const figma = await fakeWithFonts();
    const { set, variants } = buttonSet(figma);
    expect(set.addComponentProperty('Theme', 'VARIANT', 'Light')).toBe('Theme');
    expect(variants.map((v) => v.component.name)).toEqual(['Size=sm, Theme=Light', 'Size=lg, Theme=Light']);
    expect(() => set.addComponentProperty('Theme', 'VARIANT', 'Dark')).toThrow(/already exists/);
    expect(() => set.addComponentProperty('Bad=Name', 'VARIANT', 'x')).toThrow(/cannot be empty or contain/);
  });

  it('editComponentProperty renames (keeping the id), changes defaults, and refuses per-type fields', async () => {
    const figma = await fakeWithFonts();
    const { set, variants } = buttonSet(figma);
    const label = set.addComponentProperty('Label', 'TEXT', 'Button');
    const id = label.split('#')[1];
    const renamed = set.editComponentProperty(label, { name: 'Text', defaultValue: 'Go' });
    expect(renamed).toBe(`Text#${id}`);
    expect(set.componentPropertyDefinitions[renamed]).toEqual({ type: 'TEXT', defaultValue: 'Go' });
    expect(() => set.editComponentProperty(label, { name: 'X' })).toThrow(/does not exist/);
    expect(() => set.editComponentProperty(renamed, { preferredValues: [] })).toThrow(/INSTANCE_SWAP/);
    expect(set.editComponentProperty('Size', { name: 'Scale' })).toBe('Scale');
    expect(variants.map((v) => v.component.name)).toEqual(['Scale=sm', 'Scale=lg']);
    expect(() => set.editComponentProperty('Scale', { defaultValue: 'lg' })).toThrow(/Only "name"/);
  });

  it('deleteComponentProperty removes stored properties and their references, not VARIANT ones', async () => {
    const figma = await fakeWithFonts();
    const { set, variants } = buttonSet(figma);
    const show = set.addComponentProperty('Show icon', 'BOOLEAN', true);
    const icon = at(variants, 0).icon;
    icon.componentPropertyReferences = { visible: show };
    expect(icon.componentPropertyReferences).toEqual({ visible: show });
    set.deleteComponentProperty(show);
    expect(set.componentPropertyDefinitions[show]).toBeUndefined();
    expect(icon.componentPropertyReferences).toEqual({});
    expect(() => set.deleteComponentProperty('Size')).toThrow(/VARIANT/);
    expect(() => set.deleteComponentProperty(show)).toThrow(/does not exist/);
  });
});

describe('componentPropertyReferences (typings:6682-6690)', () => {
  it('is null outside components, {} on unbound component sublayers', async () => {
    const figma = await fakeWithFonts();
    const { set, variants } = buttonSet(figma);
    expect(figma.createFrame().componentPropertyReferences).toBeNull();
    expect(set.componentPropertyReferences).toBeNull();
    expect(at(variants, 0).label.componentPropertyReferences).toEqual({});
  });

  it('binds to properties of the containing component with the matching type and node type', async () => {
    const figma = await fakeWithFonts();
    const { set, variants } = buttonSet(figma);
    const { label, icon } = at(variants, 0);
    const text = set.addComponentProperty('Label', 'TEXT', 'Button');
    const show = set.addComponentProperty('Show icon', 'BOOLEAN', true);
    label.componentPropertyReferences = { characters: text, visible: show };
    expect(label.componentPropertyReferences).toEqual({ characters: text, visible: show });
    expect(() => {
      icon.componentPropertyReferences = { characters: text };
    }).toThrow(/text layers/);
    expect(() => {
      icon.componentPropertyReferences = { visible: text };
    }).toThrow(/BOOLEAN/);
    expect(() => {
      icon.componentPropertyReferences = { visible: 'Nope#1:1' };
    }).toThrow(/does not exist/);
    expect(() => {
      icon.componentPropertyReferences = { mainComponent: show };
    }).toThrow(/INSTANCE_SWAP/);
    expect(() => {
      figma.createFrame().componentPropertyReferences = { visible: show };
    }).toThrow(/inside a component/);
    // A rename keeps the reference: it points at the property id.
    const renamed = set.editComponentProperty(text, { name: 'Caption' });
    expect(label.componentPropertyReferences).toEqual({ characters: renamed, visible: show });
  });
});

describe('instance properties (setProperties, componentProperties, typings:11283-11295)', () => {
  async function bound() {
    const figma = await fakeWithFonts();
    const { set, variants } = buttonSet(figma);
    const text = set.addComponentProperty('Label', 'TEXT', 'Button');
    const show = set.addComponentProperty('Show icon', 'BOOLEAN', true);
    for (const { label, icon } of variants) {
      label.componentPropertyReferences = { characters: text };
      icon.componentPropertyReferences = { visible: show };
    }
    const instance = at(variants, 0).component.createInstance();
    return { figma, set, variants, text, show, instance };
  }

  it('componentProperties lists VARIANT values and defaults', async () => {
    const { instance, text, show } = await bound();
    expect(instance.componentProperties).toEqual({
      Size: { type: 'VARIANT', value: 'sm' },
      [text]: { type: 'TEXT', value: 'Button' },
      [show]: { type: 'BOOLEAN', value: true },
    });
  });

  it('TEXT and BOOLEAN values drive the bound sublayers', async () => {
    const { figma, instance, text, show } = await bound();
    instance.setProperties({ [text]: 'Buy now', [show]: false });
    const [label, icon] = instance.children as [TextNode, RectangleNode];
    expect([label.characters, icon.visible]).toEqual(['Buy now', false]);
    expect(instance.componentProperties[text]?.value).toBe('Buy now');
    expect(figma.ops().at(-1)).toEqual({
      method: 'setProperties',
      nodeId: instance.id,
      property: null,
      value: { [text]: 'Buy now', [show]: false },
    });
  });

  it('a VARIANT value swaps to the matching variant and keeps the other values', async () => {
    const { instance, text, variants } = await bound();
    instance.setProperties({ [text]: 'Keep me' });
    instance.setProperties({ Size: 'lg' });
    expect(await instance.getMainComponentAsync()).toBe(at(variants, 1).component);
    expect((instance.children[0] as TextNode).characters).toBe('Keep me');
    expect(() => instance.setProperties({ Size: 'xl' })).toThrow(/Unable to find a variant/);
  });

  it('validates names, types and fonts', async () => {
    const { figma, instance, text, show } = await bound();
    expect(() => instance.setProperties({ 'Nope#9:9': true })).toThrow(/Could not find a component property/);
    expect(() => instance.setProperties({ [show]: 'yes' })).toThrow(/boolean/);
    expect(() => instance.setProperties({ [text]: 3 as unknown as string })).toThrow(/string/);
    expect(() => instance.setProperties({ Size: true as unknown as string })).toThrow(/string/);
    figma.reset();
    expect(() => instance.setProperties({ [text]: 'x' })).toThrow(/unloaded font/);
  });

  it('values survive main component changes; INSTANCE_SWAP swaps a nested instance', async () => {
    const figma = await fakeWithFonts();
    const iconA = figma.createComponent();
    iconA.name = 'Icon A';
    const iconB = figma.createComponent();
    iconB.name = 'Icon B';
    const card = figma.createComponent();
    const slot = iconA.createInstance();
    card.appendChild(slot);
    const swap = card.addComponentProperty('Icon', 'INSTANCE_SWAP', iconA.id);
    slot.componentPropertyReferences = { mainComponent: swap };
    const instance = card.createInstance();
    instance.setProperties({ [swap]: iconB.id });
    const nested = instance.children[0] as InstanceNode;
    expect(await nested.getMainComponentAsync()).toBe(iconB);
    card.resize(300, 300);
    expect(await (instance.children[0] as InstanceNode).getMainComponentAsync()).toBe(iconB);
    expect(() => instance.setProperties({ [swap]: at(card.children, 0).id })).toThrow(/not the id of a component/);
  });

  it('a value can be bound to a variable of the matching type', async () => {
    const { figma, instance, text } = await bound();
    const collection = figma.variables.createVariableCollection('Copy');
    const cta = figma.variables.createVariable('cta', collection, 'STRING');
    cta.setValueForMode(collection.defaultModeId, 'Order');
    instance.setProperties({ [text]: figma.variables.createVariableAlias(cta) });
    expect(instance.componentProperties[text]).toEqual({
      type: 'TEXT',
      value: 'Order',
      boundVariables: { value: { type: 'VARIABLE_ALIAS', id: cta.id } },
    });
    expect((instance.children[0] as TextNode).characters).toBe('Order');
    expect(instance.boundVariables?.componentProperties).toEqual({ [text]: { type: 'VARIABLE_ALIAS', id: cta.id } });
    const flag = figma.variables.createVariable('flag', collection, 'BOOLEAN');
    expect(() => instance.setProperties({ [text]: figma.variables.createVariableAlias(flag) })).toThrow(/string/);
  });

  it('a TEXT default can be bound to a STRING variable', () => {
    const figma = createFakeFigma();
    const collection = figma.variables.createVariableCollection('Copy');
    const label = figma.variables.createVariable('label', collection, 'STRING');
    label.setValueForMode(collection.defaultModeId, 'Hello');
    const component = figma.createComponent();
    const name = component.addComponentProperty('Label', 'TEXT', figma.variables.createVariableAlias(label));
    expect(component.componentPropertyDefinitions[name]).toEqual({
      type: 'TEXT',
      defaultValue: 'Hello',
      boundVariables: { defaultValue: { type: 'VARIABLE_ALIAS', id: label.id } },
    });
  });
});
