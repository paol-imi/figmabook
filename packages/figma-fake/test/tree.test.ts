import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';

describe('document and ids', () => {
  it('starts with the document 0:0 and one loaded page 0:1 (typings:6366-6372)', () => {
    const figma = createFakeFigma();
    expect(figma.root.id).toBe('0:0');
    expect(figma.root.type).toBe('DOCUMENT');
    expect(figma.root.parent).toBeNull();
    expect(figma.root.children.map((p) => [p.id, p.name])).toEqual([['0:1', 'Page 1']]);
    expect(figma.currentPage).toBe(figma.root.children[0]);
    expect(figma.currentPage.parent).toBe(figma.root);
  });

  it('gives new nodes real-looking, unique ids `<session>:<n>`', () => {
    const figma = createFakeFigma({ sessionId: 7 });
    const ids = [figma.createFrame(), figma.createText(), figma.createRectangle()].map((n) => n.id);
    expect(ids).toEqual(['7:2', '7:3', '7:4']);
    expect(String(figma.createEllipse())).toBe('[Node 7:5]');
  });

  it('parents created nodes under the current page with type defaults (typings:911-1102)', () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    const rect = figma.createRectangle();
    const component = figma.createComponent();
    const text = figma.createText();
    expect(figma.currentPage.children).toEqual([frame, rect, component, text]);
    expect([frame.width, frame.height, frame.name, frame.clipsContent]).toEqual([100, 100, 'Frame', true]);
    expect(frame.fills).toEqual([
      {
        type: 'SOLID',
        visible: true,
        opacity: 1,
        blendMode: 'NORMAL',
        color: { r: 1, g: 1, b: 1 },
        boundVariables: {},
      },
    ]);
    expect(rect.fills).toHaveLength(1);
    expect(component.fills).toEqual([]);
    expect(text.characters).toBe('');
    expect(text.fontName).toEqual({ family: 'Inter', style: 'Regular' });
    expect(frame.parent).toBe(figma.currentPage);
  });

  it('createPage appends a page to the document (typings:1121-1135)', () => {
    const figma = createFakeFigma();
    const page = figma.createPage();
    expect(page.type).toBe('PAGE');
    expect(figma.root.children.at(-1)).toBe(page);
    expect(page.name).toMatch(/^Page \d+$/);
  });

  it('the document name is read-only (typings:6383)', () => {
    const figma = createFakeFigma({ fileName: 'Library' });
    expect(figma.root.name).toBe('Library');
    expect(() => {
      figma.root.name = 'Other';
    }).toThrow(Error);
  });
});

describe('parent/child invariants (typings:7030-7080)', () => {
  it('appendChild reparents: a node has exactly one parent', () => {
    const figma = createFakeFigma();
    const a = figma.createFrame();
    const b = figma.createFrame();
    const child = figma.createRectangle();
    a.appendChild(child);
    b.appendChild(child);
    expect(a.children).toEqual([]);
    expect(b.children).toEqual([child]);
    expect(child.parent).toBe(b);
  });

  it('insertChild accepts 0..length and throws beyond (typings:7065-7070)', () => {
    const figma = createFakeFigma();
    const group = figma.createFrame();
    const [a, b, c, d] = [figma.createFrame(), figma.createFrame(), figma.createFrame(), figma.createFrame()];
    group.appendChild(a);
    group.appendChild(b);
    group.appendChild(c);
    group.insertChild(1, d);
    expect(group.children).toEqual([a, d, b, c]);
    expect(() => group.insertChild(5, figma.createFrame())).toThrow(/out of range/);
    expect(() => group.insertChild(-1, figma.createFrame())).toThrow(/out of range/);
  });

  it('insertChild moves an existing child before the node at the index (fractional indexing)', () => {
    const figma = createFakeFigma();
    const group = figma.createFrame();
    const [a, b, c] = [figma.createFrame(), figma.createFrame(), figma.createFrame()];
    for (const n of [a, b, c]) group.appendChild(n);
    group.insertChild(2, a);
    expect(group.children).toEqual([b, a, c]);
    group.insertChild(3, b);
    expect(group.children).toEqual([a, c, b]);
    group.insertChild(0, a);
    expect(group.children).toEqual([a, c, b]);
    group.appendChild(a);
    expect(group.children).toEqual([c, b, a]);
  });

  it('children is a new read-only array on every read (typings:7036-7040)', () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    const first = frame.children;
    expect(Object.isFrozen(first)).toBe(true);
    expect(frame.children).not.toBe(first);
  });

  it('refuses cycles, pages inside frames, and sections inside frames', () => {
    const figma = createFakeFigma();
    const outer = figma.createFrame();
    const inner = figma.createFrame();
    outer.appendChild(inner);
    expect(() => inner.appendChild(outer)).toThrow(/itself or one of its descendants/);
    expect(() => outer.appendChild(outer)).toThrow(Error);
    const page = figma.createPage();
    expect(() => outer.appendChild(page as unknown as SceneNode)).toThrow(/page/);
    expect(() => outer.appendChild(figma.createSection())).toThrow(/Sections/);
    const section = figma.createSection();
    section.appendChild(figma.createSection());
    section.appendChild(outer);
    expect(outer.parent).toBe(section);
  });

  it('refuses components nested in components', () => {
    const figma = createFakeFigma();
    const main = figma.createComponent();
    const frame = figma.createFrame();
    main.appendChild(frame);
    expect(() => frame.appendChild(figma.createComponent())).toThrow(/component/);
    const wrapper = figma.createFrame();
    wrapper.appendChild(figma.createComponent());
    expect(() => main.appendChild(wrapper)).toThrow(/component/);
  });

  it('document children are pages only', () => {
    const figma = createFakeFigma();
    const page = figma.createPage();
    figma.root.insertChild(0, page);
    expect(figma.root.children[0]).toBe(page);
    expect(() => figma.root.appendChild(figma.createFrame() as unknown as PageNode)).toThrow(/pages/);
  });

  it('rejects objects that are not nodes of this fake', () => {
    const figma = createFakeFigma();
    const other = createFakeFigma().createFrame();
    expect(() => figma.createFrame().appendChild({} as SceneNode)).toThrow(/node object/);
    expect(() => figma.createFrame().appendChild(other)).toThrow(/another document/);
  });
});

describe('remove() (typings:6385-6427)', () => {
  it('removes the node and its subtree; reads then throw and getNodeByIdAsync gives null', async () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    const child = figma.createRectangle();
    frame.appendChild(child);
    frame.remove();
    expect(frame.removed).toBe(true);
    expect(child.removed).toBe(true);
    expect(frame.parent).toBeNull();
    expect(figma.currentPage.children).toEqual([]);
    expect(() => frame.name).toThrow(/does not exist/);
    expect(() => {
      child.opacity = 0.5;
    }).toThrow(/does not exist/);
    expect(await figma.getNodeByIdAsync(child.id)).toBeNull();
  });

  it('cannot remove the document or the last page', () => {
    const figma = createFakeFigma();
    expect(() => figma.currentPage.remove()).toThrow(/last page/);
    const second = figma.createPage();
    figma.currentPage.remove();
    expect(figma.currentPage).toBe(second);
  });
});

describe('async getters and dynamic-page (09 §6.2, typings:417-470)', () => {
  it('getNodeByIdAsync finds any node by id, or null', async () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    expect(await figma.getNodeByIdAsync(frame.id)).toBe(frame);
    expect(await figma.getNodeByIdAsync('0:0')).toBe(figma.root);
    expect(await figma.getNodeByIdAsync('99:99')).toBeNull();
  });

  it('getNodeById throws under dynamic-page', () => {
    const figma = createFakeFigma();
    expect(() => figma.getNodeById('0:0')).toThrow(/getNodeByIdAsync/);
  });

  it('currentPage is read-only; setCurrentPageAsync switches and loads', async () => {
    const figma = createFakeFigma({ pages: ['Cover', 'Components'] });
    const [cover, components] = figma.root.children;
    if (!cover || !components) throw new Error('pages missing');
    expect(() => {
      figma.currentPage = components;
    }).toThrow(/setCurrentPageAsync/);
    expect(() => components.children).toThrow(/loadAsync/);
    await figma.setCurrentPageAsync(components);
    expect(figma.currentPage).toBe(components);
    expect(components.children).toEqual([]);
    expect(figma.createFrame().parent).toBe(components);
    expect(cover.children).toEqual([]);
  });

  it('pages other than the current one must be loaded before children are used (typings:7034-7063)', async () => {
    const figma = createFakeFigma({ pages: ['A', 'B'] });
    const b = figma.root.children[1];
    if (!b) throw new Error('page missing');
    const frame = figma.createFrame();
    expect(() => b.appendChild(frame)).toThrow(/loadAsync/);
    expect(() => b.findAllWithCriteria({ types: ['FRAME'] })).toThrow(/loadAsync/);
    await b.loadAsync();
    b.appendChild(frame);
    expect(b.findAllWithCriteria({ types: ['FRAME'] })).toEqual([frame]);
    figma.reset();
    expect(() => b.children).toThrow(/loadAsync/);
  });

  it('document-wide traversal needs loadAllPagesAsync, which the port does not offer', () => {
    const figma = createFakeFigma();
    expect(() => figma.root.findAll()).toThrow(/loadAllPagesAsync/);
    expect(() => figma.root.findAllWithCriteria({ types: ['FRAME'] })).toThrow(/loadAllPagesAsync/);
    expect(figma.root.findChildren()).toEqual([figma.currentPage]);
  });

  it('ComponentNode.instances throws under dynamic-page; getInstancesAsync works (typings:11220-11229)', async () => {
    const figma = createFakeFigma();
    const component = figma.createComponent();
    expect(() => component.instances).toThrow(/getInstancesAsync/);
    expect(await component.getInstancesAsync()).toEqual([]);
  });
});

describe('find* (typings:7081-7266, 12821-12876)', () => {
  function tree() {
    const figma = createFakeFigma();
    const root = figma.createFrame();
    const a = figma.createFrame();
    const a1 = figma.createText();
    const b = figma.createRectangle();
    root.appendChild(a);
    a.appendChild(a1);
    root.appendChild(b);
    return { figma, root, a, a1, b };
  }

  it('findAll walks pre-order, back to front, excluding the node itself', () => {
    const { root, a, a1, b } = tree();
    expect(root.findAll()).toEqual([a, a1, b]);
    expect(root.findAll((n) => n.type === 'TEXT')).toEqual([a1]);
    expect(root.findOne((n) => n.type === 'RECTANGLE')).toBe(b);
    expect(root.findChildren()).toEqual([a, b]);
    expect(root.findChild((n) => n.type === 'TEXT')).toBeNull();
  });

  it('findAllWithCriteria filters by types, plugin data and shared plugin data keys', () => {
    const { root, a, a1, b } = tree();
    a.setSharedPluginData('holotype', 'nk', 'a');
    a1.setSharedPluginData('holotype', 'vk', 'x');
    b.setSharedPluginData('other', 'nk', 'b');
    b.setPluginData('mine', '1');
    expect(root.findAllWithCriteria({ types: ['TEXT', 'RECTANGLE'] })).toEqual([a1, b]);
    expect(root.findAllWithCriteria({ sharedPluginData: { namespace: 'holotype' } })).toEqual([a, a1]);
    expect(root.findAllWithCriteria({ sharedPluginData: { namespace: 'holotype', keys: ['nk'] } })).toEqual([a]);
    expect(root.findAllWithCriteria({ types: ['FRAME'], sharedPluginData: { namespace: 'holotype' } })).toEqual([a]);
    expect(root.findAllWithCriteria({ pluginData: {} })).toEqual([b]);
    expect(root.findAllWithCriteria({ pluginData: { keys: ['other'] } })).toEqual([]);
    const texts = root.findAllWithCriteria({ types: ['TEXT'] });
    expect(texts[0]?.characters).toBe('');
  });
});
