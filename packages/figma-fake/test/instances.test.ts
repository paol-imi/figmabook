import { describe, expect, it } from 'vitest';
import type { FakeFigma } from '../src';
import { fakeWithFonts, RED } from './helpers';

/** A HUG auto-layout "Button" component with one text label, both with Holotype identity. */
function button(figma: FakeFigma) {
  const main = figma.createComponent();
  main.name = 'Button';
  main.layoutMode = 'HORIZONTAL';
  main.paddingLeft = 8;
  main.paddingRight = 8;
  main.layoutSizingHorizontal = 'HUG';
  main.layoutSizingVertical = 'HUG';
  const label = figma.createText();
  main.appendChild(label);
  label.characters = 'OK';
  main.setSharedPluginData('holotype', 'nk', 'root');
  label.setSharedPluginData('holotype', 'nk', 'label');
  return { main, label };
}

function only<T>(list: readonly T[]): T {
  const [first] = list;
  if (first === undefined || list.length !== 1) throw new Error(`expected one item, got ${list.length}`);
  return first;
}

describe('instances (BUILD §8.1 "Instances (basic)", InstanceNode typings:11244-11330)', () => {
  it('createInstance copies the main component onto the current page', async () => {
    const figma = await fakeWithFonts();
    const { main, label } = button(figma);
    const instance = main.createInstance();
    expect(instance.type).toBe('INSTANCE');
    expect(instance.parent).toBe(figma.currentPage);
    expect([instance.name, instance.width, instance.height]).toEqual(['Button', main.width, main.height]);
    expect(figma.ops().at(-1)).toEqual({
      method: 'createInstance',
      nodeId: instance.id,
      property: null,
      value: main.id,
    });
    const copy = only(instance.children) as TextNode;
    expect(copy.type).toBe('TEXT');
    expect(copy.characters).toBe('OK');
    expect([copy.x, copy.y]).toEqual([label.x, label.y]);
  });

  it('sublayers have ids I<instance>;<child> and read the main component plugin data (10 §2.1)', async () => {
    const figma = await fakeWithFonts();
    const { main, label } = button(figma);
    const instance = main.createInstance();
    const copy = only(instance.children);
    expect(copy.id).toBe(`I${instance.id};${label.id}`);
    expect(copy.getSharedPluginData('holotype', 'nk')).toBe('label');
    expect(copy.getSharedPluginDataKeys('holotype')).toEqual(['nk']);
    // The instance itself has its own plugin data.
    expect(instance.getSharedPluginData('holotype', 'nk')).toBe('');
    expect(await figma.getNodeByIdAsync(copy.id)).toBe(copy);
    const found = figma.currentPage.findAllWithCriteria({ sharedPluginData: { namespace: 'holotype', keys: ['nk'] } });
    expect(found).toEqual([main, label, copy]);
  });

  it('getMainComponentAsync and getInstancesAsync; reading mainComponent throws under dynamic-page', async () => {
    const figma = await fakeWithFonts();
    const { main } = button(figma);
    const a = main.createInstance();
    const frame = figma.createFrame();
    const b = main.createInstance();
    frame.appendChild(b);
    expect(await a.getMainComponentAsync()).toBe(main);
    expect(await main.getInstancesAsync()).toEqual([a, b]);
    expect(() => a.mainComponent).toThrow(/getMainComponentAsync/);
    main.remove();
    expect(await a.getMainComponentAsync()).toBeNull();
    expect(only(a.children).type).toBe('TEXT');
  });

  it('instances follow their main component; HUG instances and their stacks resize', async () => {
    const figma = await fakeWithFonts();
    const { main, label } = button(figma);
    const stack = figma.createFrame();
    stack.layoutMode = 'HORIZONTAL';
    stack.layoutSizingHorizontal = 'HUG';
    const instance = main.createInstance();
    stack.appendChild(instance);
    const before = instance.width;
    label.characters = 'Continue';
    const copy = only(instance.children) as TextNode;
    expect(copy.characters).toBe('Continue');
    expect(instance.width).toBe(main.width);
    expect(instance.width).toBeGreaterThan(before);
    expect(stack.width).toBe(instance.width);
    main.fills = [RED];
    expect(instance.fills).toEqual(main.fills);
  });

  it('overrides are kept when the main component changes; other fields still follow it', async () => {
    const figma = await fakeWithFonts();
    const { main, label } = button(figma);
    const instance = main.createInstance();
    const copy = only(instance.children) as TextNode;
    copy.fills = [RED];
    label.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }];
    label.characters = 'Changed';
    expect((copy.fills as SolidPaint[])[0]?.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(copy.characters).toBe('Changed');
    instance.resize(200, 40);
    main.paddingLeft = 20;
    expect([instance.width, instance.height, instance.paddingLeft]).toEqual([200, 40, 20]);
    expect(copy.x).toBe(20);
  });

  it('an instance resized away from its main applies its sublayers constraints', async () => {
    const figma = await fakeWithFonts();
    const main = figma.createComponent();
    main.resize(100, 50);
    const badge = figma.createRectangle();
    main.appendChild(badge);
    badge.resize(10, 10);
    badge.x = 80;
    badge.constraints = { horizontal: 'MAX', vertical: 'MIN' };
    const instance = main.createInstance();
    instance.resize(150, 50);
    expect(only(instance.children).x).toBe(130);
    main.resize(120, 50);
    expect([instance.width, only(instance.children).x]).toEqual([150, 130]);
  });

  it('nothing can be added to, moved out of or removed from an instance', async () => {
    const figma = await fakeWithFonts();
    const { main } = button(figma);
    const instance = main.createInstance();
    const copy = only(instance.children);
    expect(() => instance.appendChild(figma.createFrame())).toThrow(/instance/);
    expect(() => figma.currentPage.appendChild(copy)).toThrow(/inside of an instance/);
    expect(() => copy.remove()).toThrow(/inside an instance/);
    expect(() => main.appendChild(instance)).toThrow(/inside itself/);
    instance.remove();
    expect(instance.removed).toBe(true);
  });

  it('an instance cannot reach its own main component through other components', async () => {
    const figma = await fakeWithFonts();
    const { main: inner } = button(figma);
    const outer = figma.createComponent();
    outer.appendChild(inner.createInstance());
    const outerInstance = outer.createInstance();
    expect(() => inner.appendChild(outerInstance)).toThrow(/inside itself/);
    const loose = inner.createInstance();
    expect(() => loose.swapComponent(outer)).not.toThrow();
    const nested = outer.children[0] as InstanceNode;
    expect(() => nested.swapComponent(outer)).toThrow(/contains this instance/);
  });

  it('nested instances: ids chain, plugin data reads through, changes propagate two levels', async () => {
    const figma = await fakeWithFonts();
    const { main, label } = button(figma);
    const card = figma.createComponent();
    card.name = 'Card';
    card.layoutMode = 'VERTICAL';
    card.layoutSizingHorizontal = 'HUG';
    card.layoutSizingVertical = 'HUG';
    const inner = main.createInstance();
    card.appendChild(inner);
    const cardInstance = card.createInstance();
    const nested = only(cardInstance.children) as InstanceNode;
    const deep = only(nested.children) as TextNode;
    expect(nested.id).toBe(`I${cardInstance.id};${inner.id}`);
    expect(deep.id).toBe(`I${cardInstance.id};${inner.id};${label.id}`);
    expect(deep.getSharedPluginData('holotype', 'nk')).toBe('label');
    expect(await nested.getMainComponentAsync()).toBe(main);
    expect(await main.getInstancesAsync()).toEqual([inner, nested]);
    label.characters = 'Much longer label';
    expect(deep.characters).toBe('Much longer label');
    expect(cardInstance.width).toBe(card.width);
    expect(card.width).toBe(main.width);
  });

  it('swapComponent keeps overrides on layers that match by name; mainComponent = clears them', async () => {
    const figma = await fakeWithFonts();
    const { main, label } = button(figma);
    const { main: other, label: otherLabel } = button(figma);
    other.name = 'Link';
    otherLabel.characters = 'Go';
    // Overrides follow layers with the same name path.
    label.name = 'Label';
    otherLabel.name = 'Label';
    const instance = main.createInstance();
    const copy = only(instance.children) as TextNode;
    copy.fills = [RED];
    instance.swapComponent(other);
    expect(await instance.getMainComponentAsync()).toBe(other);
    const swapped = only(instance.children) as TextNode;
    expect(swapped.id).toBe(`I${instance.id};${otherLabel.id}`);
    expect(copy.removed).toBe(true);
    expect([swapped.characters, (swapped.fills as SolidPaint[])[0]?.color]).toEqual(['Go', { r: 1, g: 0, b: 0 }]);
    instance.mainComponent = main;
    const reset = only(instance.children) as TextNode;
    expect([reset.characters, (reset.fills as SolidPaint[])[0]?.color]).toEqual(['OK', { r: 0, g: 0, b: 0 }]);
    expect(() => instance.swapComponent(figma.createFrame() as unknown as ComponentNode)).toThrow(/component/);
  });

  it('an instance of a variant is named after its set and reports its variant properties', async () => {
    const figma = await fakeWithFonts();
    const { main } = button(figma);
    main.name = 'Size=sm';
    const set = figma.combineAsVariants([main], figma.currentPage);
    set.name = 'Button';
    const instance = main.createInstance();
    expect(instance.name).toBe('Button');
    expect(instance.variantProperties).toEqual({ Size: 'sm' });
    set.name = 'Action';
    expect(instance.name).toBe('Action');
    instance.name = 'Primary action';
    set.name = 'Again';
    expect(instance.name).toBe('Primary action');
  });

  it('skipInvisibleInstanceChildren hides invisible sublayers from traversal and access (typings:80-109)', async () => {
    const figma = await fakeWithFonts();
    const { main, label } = button(figma);
    label.visible = false;
    const instance = main.createInstance();
    const copy = only(instance.children);
    figma.skipInvisibleInstanceChildren = true;
    expect(instance.children).toEqual([]);
    expect(figma.currentPage.findAll((node) => node.id === copy.id)).toEqual([]);
    expect(await figma.getNodeByIdAsync(copy.id)).toBeNull();
    expect(() => copy.name).toThrow(/skipInvisibleInstanceChildren/);
    expect(main.children).toEqual([label]);
    figma.reset();
    expect(figma.skipInvisibleInstanceChildren).toBe(false);
    expect(instance.children).toEqual([copy]);
  });

  it('snapshots list instances with their main component and sublayers', async () => {
    const figma = await fakeWithFonts();
    const { main } = button(figma);
    const instance = main.createInstance();
    const text = JSON.stringify(figma.snapshot());
    const [page] = JSON.parse(text).document.children as Array<{ children: Array<Record<string, unknown>> }>;
    const json = page?.children.find((entry) => entry.id === instance.id);
    expect(json).toMatchObject({
      type: 'INSTANCE',
      mainComponent: main.id,
      children: [expect.objectContaining({ id: `I${instance.id};${main.children[0]?.id}`, type: 'TEXT' })],
    });
    // Same writes, same bytes (BUILD §3.1 rule 4).
    const again = await fakeWithFonts();
    button(again).main.createInstance();
    expect(JSON.stringify(again.snapshot())).toBe(text);
  });
});

describe('createComponentFromNode (typings:1104-1120)', () => {
  it('turns a frame into a component with its properties, children and place', async () => {
    const figma = await fakeWithFonts();
    const parent = figma.createFrame();
    parent.layoutMode = 'VERTICAL';
    const before = figma.createRectangle();
    const frame = figma.createFrame();
    parent.appendChild(before);
    parent.appendChild(frame);
    frame.name = 'Icon';
    frame.layoutMode = 'HORIZONTAL';
    frame.paddingLeft = 3;
    frame.setSharedPluginData('holotype', 'nk', 'icon');
    const child = figma.createRectangle();
    frame.appendChild(child);
    const component = figma.createComponentFromNode(frame);
    expect(component.type).toBe('COMPONENT');
    expect([component.name, component.layoutMode, component.paddingLeft]).toEqual(['Icon', 'HORIZONTAL', 3]);
    expect(component.getSharedPluginData('holotype', 'nk')).toBe('icon');
    expect(component.children).toEqual([child]);
    expect(parent.children).toEqual([before, component]);
    expect(frame.removed).toBe(true);
    expect(figma.ops().at(-1)).toEqual({
      method: 'createComponentFromNode',
      nodeId: component.id,
      property: null,
      value: frame.id,
    });
  });

  it('wraps any other layer in a component of its size at its place', async () => {
    const figma = await fakeWithFonts();
    const vector = figma.createVector();
    vector.x = 30;
    vector.y = 40;
    vector.resize(24, 24);
    const component = figma.createComponentFromNode(vector);
    expect([component.x, component.y, component.width, component.height]).toEqual([30, 40, 24, 24]);
    expect(component.children).toEqual([vector]);
    expect([vector.x, vector.y]).toEqual([0, 0]);
  });

  it('refuses components, sets, sections and layers inside components or instances', async () => {
    const figma = await fakeWithFonts();
    const holder = figma.createFrame();
    holder.appendChild(figma.createComponent());
    expect(() => figma.createComponentFromNode(holder)).toThrow(/Cannot create component from node/);
    expect(() => figma.createComponentFromNode(figma.createSection())).toThrow(/Cannot create component from node/);
  });
});
