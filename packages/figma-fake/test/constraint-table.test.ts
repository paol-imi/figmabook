import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';
import { fakeWithFonts, RED, stack, textNode } from './helpers';

/**
 * One contract test per row of the constraint table in 09 §6.2 ("The fake enforces these
 * rules, so tests catch ordering regressions"), named after the row. Rows whose API arrives
 * later are `todo` with the work item that adds them.
 */
describe('09 §6.2 constraint table', () => {
  it('Padding, spacing and alignment need `layoutMode ≠ NONE`', () => {
    const frame = createFakeFigma().createFrame();
    expect(() => {
      frame.paddingLeft = 8;
    }).toThrow(/layoutMode/);
    expect(() => {
      frame.itemSpacing = 8;
    }).toThrow(/layoutMode/);
    expect(() => {
      frame.primaryAxisAlignItems = 'CENTER';
    }).toThrow(/layoutMode/);
    expect(() => {
      frame.counterAxisAlignItems = 'CENTER';
    }).toThrow(/layoutMode/);
    expect(() => {
      frame.primaryAxisSizingMode = 'FIXED';
    }).toThrow(/layoutMode/);
    expect(() => {
      frame.itemReverseZIndex = true;
    }).toThrow(/layoutMode/);
    expect(() => {
      frame.strokesIncludedInLayout = true;
    }).toThrow(/layoutMode/);
    frame.layoutMode = 'VERTICAL';
    frame.paddingLeft = 8;
    frame.itemSpacing = -4;
    frame.primaryAxisAlignItems = 'SPACE_BETWEEN';
    expect([frame.paddingLeft, frame.itemSpacing, frame.primaryAxisAlignItems]).toEqual([8, -4, 'SPACE_BETWEEN']);
  });

  it('`layoutWrap = WRAP` on GRID', () => {
    const frame = createFakeFigma().createFrame();
    frame.layoutMode = 'GRID';
    expect(() => {
      frame.layoutWrap = 'WRAP';
    }).toThrow(/HORIZONTAL" or "VERTICAL/);
    frame.paddingTop = 4;
    expect(frame.paddingTop).toBe(4);
  });

  it("`layoutSizing* = 'FILL'` needs an auto-layout parent", () => {
    const figma = createFakeFigma();
    const loose = figma.createFrame();
    expect(() => {
      loose.layoutSizingHorizontal = 'FILL';
    }).toThrow(/FILL/);
    const { child } = stack(figma);
    child.layoutSizingHorizontal = 'FILL';
    child.layoutSizingVertical = 'FILL';
    expect([child.layoutGrow, child.layoutAlign]).toEqual([1, 'STRETCH']);
    expect([child.layoutSizingHorizontal, child.layoutSizingVertical]).toEqual(['FILL', 'FILL']);
  });

  it("`layoutSizing* = 'HUG'` only on auto-layout frames and text", async () => {
    const figma = await fakeWithFonts();
    const rect = figma.createRectangle();
    const { parent, child } = stack(figma);
    child.appendChild(rect);
    expect(() => {
      rect.layoutSizingHorizontal = 'HUG';
    }).toThrow(/HUG/);
    expect(() => {
      child.layoutSizingVertical = 'HUG';
    }).toThrow(/HUG/);
    parent.layoutSizingHorizontal = 'HUG';
    expect(parent.primaryAxisSizingMode).toBe('AUTO');
    const text = figma.createText();
    text.textAutoResize = 'NONE';
    text.layoutSizingHorizontal = 'HUG';
    expect(text.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  });

  it('`resize()` on an auto-layout axis forces FIXED', () => {
    const figma = createFakeFigma();
    const { parent, child } = stack(figma);
    parent.layoutSizingHorizontal = 'HUG';
    parent.layoutSizingVertical = 'HUG';
    child.layoutSizingHorizontal = 'FILL';
    parent.resize(300, 40);
    child.resize(50, 50);
    expect([parent.primaryAxisSizingMode, parent.counterAxisSizingMode]).toEqual(['FIXED', 'FIXED']);
    expect([parent.layoutSizingHorizontal, parent.layoutSizingVertical]).toEqual(['FIXED', 'FIXED']);
    expect(child.layoutSizingHorizontal).toBe('FIXED');
  });

  it('`x`/`y` ignored for auto-layout children unless ABSOLUTE', () => {
    const figma = createFakeFigma();
    const { child } = stack(figma);
    child.x = 12;
    child.y = 34;
    expect([child.x, child.y]).toEqual([0, 0]);
    child.layoutPositioning = 'ABSOLUTE';
    child.x = 12;
    expect(child.x).toBe(12);
  });

  it("`layoutPositioning = 'ABSOLUTE'` needs the node already in an auto-layout parent", () => {
    const figma = createFakeFigma();
    const loose = figma.createFrame();
    expect(() => {
      loose.layoutPositioning = 'ABSOLUTE';
    }).toThrow(/ABSOLUTE/);
    const { parent } = stack(figma);
    parent.appendChild(loose);
    loose.layoutPositioning = 'ABSOLUTE';
    expect(loose.layoutPositioning).toBe('ABSOLUTE');
  });

  it('`characters` / font fields need a loaded font', async () => {
    const figma = createFakeFigma();
    const text = figma.createText();
    expect(() => {
      text.characters = 'Hi';
    }).toThrow(/unloaded font "Inter Regular"/);
    expect(() => {
      text.fontSize = 20;
    }).toThrow(Error);
    expect(() => {
      text.fontName = { family: 'Inter', style: 'Bold' };
    }).toThrow(/unloaded font "Inter Bold"/);
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    text.characters = 'Hi';
    expect(text.characters).toBe('Hi');
  });

  it('Replacing `characters` drops range styles', async () => {
    const { text } = await textNode('Hello');
    text.setRangeFontSize(0, 2, 24);
    expect(text.fontSize).toBe(createFakeFigma().mixed);
    text.characters = 'World!';
    expect(text.getStyledTextSegments(['fontSize']).map((s) => [s.start, s.end, s.fontSize])).toEqual([[0, 6, 24]]);
  });

  it('Text `resize()` sets fixed width', async () => {
    const { text } = await textNode('Label');
    expect(text.textAutoResize).toBe('WIDTH_AND_HEIGHT');
    text.resize(120, 20);
    expect(text.textAutoResize).toBe('HEIGHT');
    expect(text.layoutSizingHorizontal).toBe('FIXED');
    text.textAutoResize = 'WIDTH_AND_HEIGHT';
    expect(text.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  });

  it('Paints, effects and `constraints` are immutable objects', () => {
    const node = createFakeFigma().createRectangle();
    node.fills = [RED];
    node.effects = [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        offset: { x: 0, y: 2 },
        radius: 4,
        visible: true,
        blendMode: 'NORMAL',
      },
    ];
    const fills = node.fills as Paint[];
    expect(() => fills.push(RED)).toThrow(TypeError);
    expect(() => {
      (fills[0] as { opacity: number }).opacity = 0.5;
    }).toThrow(TypeError);
    expect(() => {
      ((fills[0] as SolidPaint).color as { r: number }).r = 0;
    }).toThrow(TypeError);
    expect(() => {
      (node.effects[0] as { radius: number }).radius = 1;
    }).toThrow(TypeError);
    expect(() => {
      (node.constraints as { vertical: string }).vertical = 'MAX';
    }).toThrow(TypeError);
  });

  it.todo('`setBoundVariableForPaint` returns a *new* paint (B-54, variables subset)');

  it('`combineAsVariants` needs ≥1 component, all on the same page and not inside an instance', async () => {
    const figma = createFakeFigma({ pages: ['A', 'B'] });
    const pageB = figma.root.children[1];
    if (!pageB) throw new Error('page missing');
    expect(() => figma.combineAsVariants([], figma.currentPage)).toThrow(/0 nodes/);
    expect(() => figma.combineAsVariants([figma.createFrame() as unknown as ComponentNode], figma.currentPage)).toThrow(
      /Only components/,
    );
    const a = figma.createComponent();
    await pageB.loadAsync();
    const b = figma.createComponent();
    pageB.appendChild(b);
    expect(() => figma.combineAsVariants([a, b], figma.currentPage)).toThrow(/same page/);
    // "not inside an instance": instances arrive with B-54, which adds that case.
    expect(figma.combineAsVariants([a], figma.currentPage).type).toBe('COMPONENT_SET');
  });

  it.todo('`createComponentFromNode` throws for a node inside a component or instance (not in the B-06 port)');

  it('Minimum size 0.01', () => {
    const figma = createFakeFigma();
    for (const node of [figma.createFrame(), figma.createRectangle(), figma.createSection(), figma.createText()]) {
      expect(() => node.resize(0.009, 10)).toThrow(/>= 0.01/);
      expect(() => node.resizeWithoutConstraints(10, -1)).toThrow(/>= 0.01/);
    }
  });

  it.todo('GRID: tracks cannot be FLEX on an axis where the container is HUG (B-111)');

  it("`counterAxisAlignItems = 'BASELINE'` is horizontal-only", () => {
    const figma = createFakeFigma();
    const { parent } = stack(figma, 'VERTICAL');
    expect(() => {
      parent.counterAxisAlignItems = 'BASELINE';
    }).toThrow(/horizontal/);
    parent.layoutMode = 'HORIZONTAL';
    parent.counterAxisAlignItems = 'BASELINE';
    expect(parent.counterAxisAlignItems).toBe('BASELINE');
  });

  it('Sync getters (`getNodeById`, `mainComponent` read, `instances`) throw under `dynamic-page`', () => {
    const figma = createFakeFigma();
    expect(() => figma.getNodeById(figma.root.id)).toThrow(/dynamic-page/);
    expect(() => figma.createComponent().instances).toThrow(/dynamic-page/);
    // `InstanceNode.mainComponent`: instances arrive with B-54.
  });
});

describe('BUILD §8.1 behaviour rules', () => {
  it('wrap-only properties throw on non-wrapping frames (typings:8055, 8113-8160)', () => {
    const figma = createFakeFigma();
    const { parent } = stack(figma);
    expect(() => {
      parent.counterAxisSpacing = 4;
    }).toThrow(/wrapping/);
    expect(() => {
      parent.counterAxisAlignContent = 'SPACE_BETWEEN';
    }).toThrow(/wrapping/);
    parent.layoutWrap = 'WRAP';
    parent.itemSpacing = 6;
    expect(parent.counterAxisSpacing).toBe(6);
    parent.counterAxisSpacing = 10;
    expect(parent.counterAxisSpacing).toBe(10);
    parent.counterAxisSpacing = null;
    expect(parent.counterAxisSpacing).toBe(6);
  });

  it('layoutGrow accepts only 0 and 1 (typings:8540-8542)', () => {
    const { child } = stack(createFakeFigma());
    expect(() => {
      child.layoutGrow = 0.5;
    }).toThrow(/0 or 1/);
  });

  it('a laid-out child that fills keeps FILL after reparenting into another stack', () => {
    const figma = createFakeFigma();
    const { child } = stack(figma);
    child.layoutSizingHorizontal = 'FILL';
    const other = figma.createFrame();
    other.layoutMode = 'VERTICAL';
    other.appendChild(child);
    // layoutGrow (primary axis of the old parent) now means vertical fill.
    expect([child.layoutSizingHorizontal, child.layoutSizingVertical]).toEqual(['FIXED', 'FILL']);
    figma.currentPage.appendChild(child);
    expect(child.layoutSizingVertical).toBe('FIXED');
  });
});
