import { describe, expect, it } from 'vitest';
import { createFakeFigma, type FakeFigma } from '../src';
import { fakeWithFonts, RED } from './helpers';

/**
 * A toy keyed applier: it finds its node by plugin data and writes only what differs. It
 * shows how B-59's "re-applying the same bundle gives an empty op log" is asserted.
 */
async function applyBadge(figma: FakeFigma, label: string): Promise<void> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const page = figma.currentPage;
  let frame = page.findAllWithCriteria({
    types: ['FRAME'],
    sharedPluginData: { namespace: 'holotype', keys: ['nk'] },
  })[0];
  if (!frame) {
    frame = figma.createFrame();
    frame.setSharedPluginData('holotype', 'nk', 'badge');
    frame.layoutMode = 'HORIZONTAL';
    frame.appendChild(figma.createText());
  }
  const text = frame.children[0];
  if (text?.type !== 'TEXT') throw new Error('badge text missing');
  if (frame.getSharedPluginData('holotype', 'irh') !== label) {
    text.characters = label;
    frame.paddingLeft = 8;
    frame.fills = [RED];
    frame.setSharedPluginData('holotype', 'irh', label);
  }
}

describe('ops()', () => {
  it('logs creation, assignments, calls and plugin data in order', async () => {
    const figma = await fakeWithFonts();
    const frame = figma.createFrame();
    frame.resize(10, 20);
    frame.opacity = 0.5;
    frame.setSharedPluginData('holotype', 'nk', 'root');
    expect(figma.ops()).toEqual([
      { method: 'createFrame', nodeId: frame.id, property: null, value: null },
      { method: 'resize', nodeId: frame.id, property: null, value: { width: 10, height: 20 } },
      { method: 'set', nodeId: frame.id, property: 'opacity', value: 0.5 },
      { method: 'setSharedPluginData', nodeId: frame.id, property: 'holotype/nk', value: 'root' },
    ]);
  });

  it('logs every assignment, even of an unchanged value', () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    figma.reset();
    frame.opacity = 1;
    expect(figma.ops()).toHaveLength(1);
  });

  it('does not log reads, rejected writes, font loads, page switches or notifications', async () => {
    const figma = createFakeFigma({ pages: ['A', 'B'] });
    const frame = figma.createFrame();
    figma.reset();
    void frame.fills;
    void frame.absoluteBoundingBox;
    expect(() => {
      frame.opacity = 2;
    }).toThrow();
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    const b = figma.root.children[1];
    if (b) await figma.setCurrentPageAsync(b);
    figma.notify('hi');
    figma.commitUndo();
    expect(figma.ops()).toEqual([]);
  });

  it('returns a frozen copy', () => {
    const figma = createFakeFigma();
    figma.createFrame();
    const ops = figma.ops();
    expect(Object.isFrozen(ops)).toBe(true);
    figma.createFrame();
    expect(ops).toHaveLength(1);
  });

  it('a no-op re-apply makes zero writes (I-2, 10 §1)', async () => {
    const figma = createFakeFigma();
    await applyBadge(figma, 'New');
    expect(figma.ops().length).toBeGreaterThan(0);
    figma.reset();
    await applyBadge(figma, 'New');
    expect(figma.ops()).toEqual([]);
    await applyBadge(figma, 'Beta');
    expect(figma.ops().map((op) => op.property ?? op.method)).toEqual([
      'characters',
      'paddingLeft',
      'fills',
      'holotype/irh',
    ]);
  });
});

describe('snapshot()', () => {
  async function build(): Promise<FakeFigma> {
    const figma = await fakeWithFonts();
    const frame = figma.createFrame();
    frame.name = 'Card';
    frame.layoutMode = 'VERTICAL';
    frame.itemSpacing = 8;
    frame.fills = [RED];
    const text = figma.createText();
    frame.appendChild(text);
    text.characters = 'Title';
    text.setRangeFontSize(0, 1, 20);
    text.layoutSizingHorizontal = 'FILL';
    frame.setSharedPluginData('holotype', 'nk', 'root');
    const set = figma.combineAsVariants([figma.createComponent()], figma.currentPage);
    set.description = 'Set';
    return figma;
  }

  it('is canonical: the same writes give the same bytes', async () => {
    const [a, b] = [await build(), await build()];
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  });

  it('lists identity, geometry, non-default properties, text runs and plugin data', async () => {
    const figma = await build();
    expect(figma.snapshot()).toMatchInlineSnapshot(`
      {
        "currentPage": "0:1",
        "document": {
          "children": [
            {
              "children": [
                {
                  "children": [
                    {
                      "characters": "Title",
                      "height": 14,
                      "id": "1:3",
                      "layoutAlign": "STRETCH",
                      "layoutSizingHorizontal": "FILL",
                      "layoutSizingVertical": "HUG",
                      "name": "Title",
                      "textAutoResize": "HEIGHT",
                      "textStyle": [
                        {
                          "end": 1,
                          "fontSize": 20,
                          "start": 0,
                        },
                        {
                          "end": 5,
                          "start": 1,
                        },
                      ],
                      "type": "TEXT",
                      "width": 0,
                      "x": 0,
                      "y": 0,
                    },
                  ],
                  "fills": [
                    {
                      "blendMode": "NORMAL",
                      "boundVariables": {},
                      "color": {
                        "b": 0,
                        "g": 0,
                        "r": 1,
                      },
                      "opacity": 1,
                      "type": "SOLID",
                      "visible": true,
                    },
                  ],
                  "height": 100,
                  "id": "1:2",
                  "itemSpacing": 8,
                  "layoutMode": "VERTICAL",
                  "layoutSizingVertical": "HUG",
                  "name": "Card",
                  "sharedPluginData": {
                    "holotype": {
                      "nk": "root",
                    },
                  },
                  "type": "FRAME",
                  "width": 100,
                  "x": 0,
                  "y": 0,
                },
                {
                  "children": [
                    {
                      "height": 100,
                      "id": "1:4",
                      "name": "Property 1=Component",
                      "type": "COMPONENT",
                      "variantProperties": {
                        "Property 1": "Component",
                      },
                      "width": 100,
                      "x": 0,
                      "y": 0,
                    },
                  ],
                  "description": "Set",
                  "height": 100,
                  "id": "1:5",
                  "name": "Component Set",
                  "type": "COMPONENT_SET",
                  "width": 100,
                  "x": 0,
                  "y": 0,
                },
              ],
              "id": "0:1",
              "name": "Page 1",
              "type": "PAGE",
            },
          ],
          "id": "0:0",
          "name": "Untitled",
          "type": "DOCUMENT",
        },
        "images": [],
      }
    `);
  });

  it('marks unloaded pages and keeps snapshots detached from the live document', () => {
    const figma = createFakeFigma({ pages: ['A', 'B'] });
    const before = figma.snapshot();
    figma.createFrame();
    expect(before.document.children).toEqual([
      { id: '0:1', type: 'PAGE', name: 'A', children: [] },
      { id: '1:2', type: 'PAGE', name: 'B', loaded: false, children: [] },
    ]);
  });
});
