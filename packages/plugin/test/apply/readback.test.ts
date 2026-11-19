import { APPLIED_HASH_LENGTH, appliedHash, changedGroups, normalizeGroups, splitAppliedHash } from '@holotype/ir/core';
import { describe, expect, it } from 'vitest';
import { IDENTITY_NAMESPACE } from '../../src/apply/identity';
import { appliedHashOf, readGroups } from '../../src/apply/readback';
import { applyToFake } from '../support/apply';
import { createFakeFigma, type FakeFigma } from '../support/fake';

const BLUE = { r: 0.1451, g: 0.3882, b: 0.9216 };
const solid = (color = BLUE): SolidPaint => ({ type: 'SOLID', color });

async function setup() {
  const figma = createFakeFigma();
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  return figma;
}

function autoLayoutFrame(figma: FakeFigma): FrameNode {
  const frame = figma.createFrame();
  frame.layoutMode = 'HORIZONTAL';
  frame.paddingLeft = 12;
  frame.paddingRight = 12;
  frame.paddingTop = 4;
  frame.paddingBottom = 4;
  frame.itemSpacing = 8;
  return frame;
}

describe('readGroups (06 §6 "ah")', () => {
  it('reads an auto layout frame with Figma property names', async () => {
    const figma = await setup();
    const frame = autoLayoutFrame(figma);
    frame.fills = [solid()];
    frame.topLeftRadius = 6;
    frame.name = 'Button';
    expect(await readGroups(frame)).toEqual({
      // Turning auto layout on makes the primary axis hug: 12 + 12 padding.
      geom: { width: 24, height: 100 },
      layout: {
        layoutMode: 'HORIZONTAL',
        paddingTop: 4,
        paddingRight: 12,
        paddingBottom: 4,
        paddingLeft: 12,
        itemSpacing: 8,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        strokesIncludedInLayout: false,
        layoutSizingHorizontal: 'HUG',
        layoutSizingVertical: 'FIXED',
      },
      paint: {
        // Figma fills in `visible: true` and `blendMode: 'NORMAL'`; they are left out.
        fills: [{ type: 'SOLID', color: BLUE, opacity: 1 }],
        strokes: [],
        strokeWeight: 1,
        strokeAlign: 'INSIDE',
        topLeftRadius: 6,
        topRightRadius: 0,
        bottomLeftRadius: 0,
        bottomRightRadius: 0,
        effects: [],
        opacity: 1,
        blendMode: 'PASS_THROUGH',
        clipsContent: true,
      },
      text: {},
      vis: { name: 'Button', visible: true },
      bind: {},
      inst: {},
    });
  });

  it('reads x and y only where the design places the node', async () => {
    const figma = await setup();
    const absolute = figma.createFrame();
    const placed = figma.createRectangle();
    absolute.appendChild(placed);
    placed.x = 5;
    placed.y = 7;
    placed.rotation = 30;
    const { geom } = await readGroups(placed);
    expect(geom).toMatchObject({ x: 5, y: 7 });
    expect(geom.rotation).toBeCloseTo(30, 9);
    // Top level on the page: the position is Holotype's grid, not the design.
    expect(Object.keys((await readGroups(absolute)).geom)).toEqual(['width', 'height']);

    const row = autoLayoutFrame(figma);
    const flowing = figma.createRectangle();
    const floating = figma.createRectangle();
    row.appendChild(flowing);
    row.appendChild(floating);
    floating.layoutPositioning = 'ABSOLUTE';
    expect(Object.keys((await readGroups(flowing)).geom)).toEqual(['width', 'height']);
    const free = await readGroups(floating);
    expect(Object.keys(free.geom)).toEqual(['width', 'height', 'x', 'y']);
    expect(free.layout.layoutPositioning).toBe('ABSOLUTE');
  });

  it('reads wrap, limits and per-side strokes when they are set', async () => {
    const figma = await setup();
    const frame = autoLayoutFrame(figma);
    frame.layoutWrap = 'WRAP';
    frame.counterAxisSpacing = 6;
    frame.minWidth = 40;
    frame.strokes = [solid()];
    frame.strokeTopWeight = 2;
    frame.dashPattern = [4, 2];
    const { layout, paint } = await readGroups(frame);
    expect(layout).toMatchObject({
      layoutWrap: 'WRAP',
      counterAxisSpacing: 6,
      counterAxisAlignContent: 'AUTO',
      minWidth: 40,
    });
    expect(layout).not.toHaveProperty('maxWidth');
    expect(paint).toMatchObject({ strokeTopWeight: 2, strokeRightWeight: 1, dashPattern: [4, 2] });
    expect(paint).not.toHaveProperty('strokeWeight');
  });

  it('leaves the container fields out while auto layout is off', async () => {
    const figma = await setup();
    expect((await readGroups(figma.createFrame())).layout).toEqual({
      layoutMode: 'NONE',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
    });
  });

  it('flattens a single text segment and keeps the text paint group to what is set', async () => {
    const figma = await setup();
    const text = figma.createText();
    text.characters = 'Save';
    text.fontSize = 14;
    text.lineHeight = { unit: 'PIXELS', value: 20 };
    text.fills = [solid()];
    const groups = await readGroups(text);
    expect(groups.text).toEqual({
      characters: 'Save',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 14,
      lineHeight: { unit: 'PIXELS', value: 20 },
      letterSpacing: { unit: 'PERCENT', value: 0 },
      fills: [{ type: 'SOLID', color: BLUE, opacity: 1 }],
      textCase: 'ORIGINAL',
      textDecoration: 'NONE',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP',
    });
    expect(groups.paint).toEqual({});
    text.opacity = 0.5;
    text.effects = [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 2, visible: true }];
    expect((await readGroups(text)).paint).toEqual({
      effects: [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 2, visible: true }],
      opacity: 0.5,
    });
  });

  it('lists several text segments and reads truncation', async () => {
    const figma = await setup();
    const text = figma.createText();
    text.characters = 'Hello world';
    text.setRangeFontName(6, 11, { family: 'Inter', style: 'Bold' });
    text.textAutoResize = 'NONE';
    text.textTruncation = 'ENDING';
    text.maxLines = 2;
    const groups = await readGroups(text);
    const segments = groups.text.segments as Array<Record<string, unknown>>;
    expect(segments.map(({ start, end, fontName }) => [start, end, fontName])).toEqual([
      [0, 6, { family: 'Inter', style: 'Regular' }],
      [6, 11, { family: 'Inter', style: 'Bold' }],
    ]);
    expect(groups.text).not.toHaveProperty('fontName');
    expect(groups.text).toMatchObject({ textTruncation: 'ENDING', maxLines: 2 });
  });

  it('reads an empty text from its node-level style', async () => {
    const figma = await setup();
    const text = figma.createText();
    text.fontSize = 18;
    expect((await readGroups(text)).text).toMatchObject({ characters: '', fontSize: 18, fills: [expect.any(Object)] });
  });

  it('moves variable bindings into a flat bind group', async () => {
    const figma = await setup();
    const collection = figma.variables.createVariableCollection('Tokens');
    const space = figma.variables.createVariable('space/2', collection, 'FLOAT');
    space.setValueForMode(collection.defaultModeId, 8);
    const brand = figma.variables.createVariable('color/brand', collection, 'COLOR');
    brand.setValueForMode(collection.defaultModeId, { r: 0, g: 0, b: 1, a: 1 });
    const size = figma.variables.createVariable('font/size', collection, 'FLOAT');
    size.setValueForMode(collection.defaultModeId, 16);

    const frame = autoLayoutFrame(figma);
    frame.setBoundVariable('itemSpacing', space);
    frame.fills = [solid(), figma.variables.setBoundVariableForPaint(solid(), 'color', brand)];
    const text = figma.createText();
    text.characters = 'Hi';
    text.setBoundVariable('fontSize', size);
    text.fills = [figma.variables.setBoundVariableForPaint(solid(), 'color', brand)];

    const groups = await readGroups(frame);
    expect(groups.bind).toEqual({ itemSpacing: space.id, fills: [null, brand.id] });
    expect(groups.paint.fills).toEqual([
      { type: 'SOLID', color: BLUE, opacity: 1 },
      { type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: 1 },
    ]);
    expect((await readGroups(text)).bind).toEqual({ fontSize: size.id, fills: [brand.id] });
  });

  it('reads a component set as vis only, and an instance by its main component and properties', async () => {
    const figma = await setup();
    const primary = figma.createComponent();
    primary.name = 'Variant=Primary';
    const label = figma.createText();
    label.characters = 'Button';
    primary.appendChild(label);
    const secondary = figma.createComponent();
    secondary.name = 'Variant=Secondary';
    const set = figma.combineAsVariants([primary, secondary], figma.currentPage);
    set.name = 'Button';
    const labelProperty = set.addComponentProperty('Label', 'TEXT', 'Button');
    label.componentPropertyReferences = { characters: labelProperty };

    expect(await readGroups(set)).toEqual({
      geom: {},
      layout: {},
      paint: {},
      text: {},
      vis: { name: 'Button', visible: true },
      bind: {},
      inst: {},
    });
    expect((await readGroups(label)).bind).toEqual({ componentPropertyReferences: { characters: labelProperty } });

    const card = figma.createFrame();
    card.layoutMode = 'VERTICAL';
    const instance = primary.createInstance();
    card.appendChild(instance);
    instance.setProperties({ [labelProperty]: 'Open' });
    const groups = await readGroups(instance);
    expect(groups.inst).toEqual({
      mainComponent: primary.id,
      componentProperties: { Variant: 'Primary', [labelProperty]: 'Open' },
    });
    // Container fields and paints are the main component's.
    expect(groups.paint).toEqual({});
    expect(groups.layout).toEqual({ layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED' });
    expect(groups.bind).toEqual({});
  });

  it('only reads: no document write', async () => {
    const figma = await setup();
    const frame = autoLayoutFrame(figma);
    frame.appendChild(figma.createText());
    figma.reset();
    await readGroups(frame);
    await appliedHashOf(frame);
    expect(figma.ops()).toEqual([]);
  });
});

describe('ah after apply (10 §9.1)', () => {
  async function applied() {
    const { figma } = await applyToFake();
    const nodes: SceneNode[] = [];
    for (const page of figma.root.children) {
      await page.loadAsync();
      nodes.push(...page.findAll((node) => node.getSharedPluginData(IDENTITY_NAMESPACE, 'nk') !== ''));
    }
    return { figma, nodes };
  }

  it('stores on every managed node the ah recomputed from the untouched node', async () => {
    const { nodes } = await applied();
    expect(nodes.length).toBeGreaterThan(20);
    for (const node of nodes) {
      const stored = node.getSharedPluginData(IDENTITY_NAMESPACE, 'ah');
      expect(stored, node.name).toHaveLength(APPLIED_HASH_LENGTH);
      expect(stored, node.name).toBe(await appliedHashOf(node));
    }
  });

  it('is the same on a second apply of the same bundle', async () => {
    const first = await applied();
    const second = await applied();
    const hashes = (nodes: readonly SceneNode[]) =>
      nodes.map((node) => node.getSharedPluginData(IDENTITY_NAMESPACE, 'ah'));
    expect(hashes(second.nodes)).toEqual(hashes(first.nodes));
  });

  it('an edited fill changes only the paint sub-hash', async () => {
    const { nodes } = await applied();
    const frame = nodes.find((node): node is FrameNode => node.type === 'FRAME');
    if (!frame) throw new Error('No frame was applied');
    const stored = frame.getSharedPluginData(IDENTITY_NAMESPACE, 'ah');
    frame.fills = [solid({ r: 1, g: 0, b: 0 })];
    expect(changedGroups(stored, await appliedHashOf(frame))).toEqual(['paint']);
  });

  it('an edited text changes only the text sub-hash; float noise changes nothing', async () => {
    const { nodes } = await applied();
    const text = nodes.find((node): node is TextNode => node.type === 'TEXT' && node.textAutoResize === 'NONE');
    if (!text) throw new Error('No fixed-size text was applied');
    const stored = text.getSharedPluginData(IDENTITY_NAMESPACE, 'ah');
    const groups = await readGroups(text);
    const noisy = { ...groups, geom: { ...groups.geom, width: Number(groups.geom.width) + 0.0002 } };
    expect(appliedHash(normalizeGroups(noisy))).toBe(stored);
    // The applier loaded the text's fonts in this document already.
    text.characters = `${text.characters}!`;
    expect(changedGroups(stored, await appliedHashOf(text))).toEqual(['text']);
    expect(splitAppliedHash(stored).paint).toBe(splitAppliedHash(await appliedHashOf(text)).paint);
  });
});
