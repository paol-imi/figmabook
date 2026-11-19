import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';

function variants(figma: ReturnType<typeof createFakeFigma>, names: string[]): ComponentNode[] {
  return names.map((name, i) => {
    const component = figma.createComponent();
    component.name = name;
    component.resize(80, 32);
    component.x = i * 100;
    component.y = 200;
    return component;
  });
}

describe('combineAsVariants (typings:1835-1857, 09 §7.2)', () => {
  it('moves the components into a new set under the parent, keeping their layout', () => {
    const figma = createFakeFigma();
    const section = figma.createSection();
    section.x = 1000;
    const [sm, lg] = variants(figma, ['Size=sm', 'Size=lg']);
    if (!sm || !lg) throw new Error('variants missing');
    const set = figma.combineAsVariants([sm, lg], section);
    expect(set.type).toBe('COMPONENT_SET');
    expect(set.parent).toBe(section);
    expect(set.children).toEqual([sm, lg]);
    expect([set.x, set.y, set.width, set.height]).toEqual([-1000, 200, 180, 32]);
    expect([sm.x, sm.y, lg.x, lg.y]).toEqual([0, 0, 100, 0]);
    expect(sm.absoluteBoundingBox).toEqual({ x: 0, y: 200, width: 80, height: 32 });
  });

  it('inserts the set at index and derives variant properties from names', () => {
    const figma = createFakeFigma();
    const parent = figma.createFrame();
    parent.appendChild(figma.createRectangle());
    parent.appendChild(figma.createRectangle());
    const nodes = variants(figma, ['Size=sm, State=Default', 'Size=lg, State=Hover', 'Size=sm, State=Hover']);
    const set = figma.combineAsVariants(nodes, parent, 1);
    expect(parent.children[1]).toBe(set);
    expect(nodes[1]?.variantProperties).toEqual({ Size: 'lg', State: 'Hover' });
    expect(set.variantGroupProperties).toEqual({
      Size: { values: ['sm', 'lg'] },
      State: { values: ['Default', 'Hover'] },
    });
    expect(set.defaultVariant).toBe(nodes[0]);
  });

  it('names plain components `Property 1=<name>`, as the editor does', () => {
    const figma = createFakeFigma();
    const [a] = variants(figma, ['Primary']);
    if (!a) throw new Error('variant missing');
    figma.combineAsVariants([a], figma.currentPage);
    expect(a.name).toBe('Property 1=Primary');
    expect(a.variantProperties).toEqual({ 'Property 1': 'Primary' });
  });

  it('components outside a set have no variant properties (typings:9670-9715)', () => {
    expect(createFakeFigma().createComponent().variantProperties).toBeNull();
  });

  it('defaultVariant is the top-left-most variant (typings:11184-11187)', () => {
    const figma = createFakeFigma();
    const nodes = variants(figma, ['A=1', 'A=2']);
    const set = figma.combineAsVariants(nodes, figma.currentPage);
    nodes[0]?.resize(80, 32);
    if (nodes[0]) nodes[0].y = 50;
    expect(set.defaultVariant).toBe(nodes[1]);
  });

  it('a set accepts only components, and deletes itself when emptied', () => {
    const figma = createFakeFigma();
    const nodes = variants(figma, ['A=1', 'A=2']);
    const set = figma.combineAsVariants(nodes, figma.currentPage);
    expect(() => set.appendChild(figma.createFrame())).toThrow(/only contain components/);
    const extra = figma.createComponent();
    extra.name = 'A=3';
    set.appendChild(extra);
    expect(set.children).toHaveLength(3);
    for (const node of [...set.children]) figma.currentPage.appendChild(node);
    expect(set.removed).toBe(true);
    expect(nodes[0]?.variantProperties).toBeNull();
  });

  it('reorders variants inside the set without deleting it', () => {
    const figma = createFakeFigma();
    const nodes = variants(figma, ['A=1']);
    const set = figma.combineAsVariants(nodes, figma.currentPage);
    const only = nodes[0];
    if (!only) throw new Error('variant missing');
    set.appendChild(only);
    set.insertChild(1, only);
    expect(set.removed).toBe(false);
    expect(set.children).toEqual([only]);
  });

  it('sets get the editor defaults: no fill, dashed purple stroke, radius 5', () => {
    const figma = createFakeFigma();
    const set = figma.combineAsVariants(variants(figma, ['A=1']), figma.currentPage);
    expect(set.fills).toEqual([]);
    expect(set.dashPattern).toEqual([10, 5]);
    expect(set.cornerRadius).toBe(5);
    expect(set.strokes).toHaveLength(1);
  });
});

describe('PublishableMixin (typings:9364-9414)', () => {
  it('stores description and one documentation link; key is stable per node', async () => {
    const figma = createFakeFigma();
    const component = figma.createComponent();
    component.description = 'A button';
    component.descriptionMarkdown = '**A** button';
    component.documentationLinks = [{ uri: 'https://storybook.example/?path=/story/button' }];
    expect([component.description, component.descriptionMarkdown]).toEqual(['A button', '**A** button']);
    expect(component.documentationLinks).toEqual([{ uri: 'https://storybook.example/?path=/story/button' }]);
    expect(() => {
      component.documentationLinks = [{ uri: 'a' }, { uri: 'b' }];
    }).toThrow(/single documentation link/);
    expect(component.key).toMatch(/^[0-9a-f]{40}$/);
    expect(component.key).toBe(component.key);
    expect(component.key).not.toBe(figma.createComponent().key);
    expect(component.remote).toBe(false);
    expect(await component.getPublishStatusAsync()).toBe('UNPUBLISHED');
  });
});
