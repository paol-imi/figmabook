import { describe, expect, it } from 'vitest';
import { createFakeFigma } from '../src';
import { textNode } from './helpers';

describe('other node members', () => {
  it('visible, locked, expanded, clipsContent, guides, layoutGrids and exportSettings round-trip', () => {
    const frame = createFakeFigma().createFrame();
    frame.visible = false;
    frame.locked = true;
    frame.expanded = false;
    frame.clipsContent = false;
    frame.guides = [{ axis: 'X', offset: 10 }];
    frame.layoutGrids = [{ pattern: 'GRID', sectionSize: 8, visible: true, color: { r: 1, g: 0, b: 0, a: 0.1 } }];
    frame.exportSettings = [{ format: 'PNG' }];
    expect([frame.visible, frame.locked, frame.expanded, frame.clipsContent]).toEqual([false, true, false, false]);
    expect(frame.guides).toEqual([{ axis: 'X', offset: 10 }]);
    expect(Object.isFrozen(frame.layoutGrids[0])).toBe(true);
    expect(frame.exportSettings).toEqual([{ format: 'PNG' }]);
    expect(() => {
      frame.visible = 'yes' as unknown as boolean;
    }).toThrow(/boolean/);
  });

  it('annotations, aspect-ratio lock and devStatus (typings:6629-6640, 7545-7596, 9547-9586)', () => {
    const figma = createFakeFigma();
    const frame = figma.createFrame();
    frame.annotations = [{ label: 'Note' }];
    frame.resize(40, 20);
    frame.lockAspectRatio();
    expect(frame.targetAspectRatio).toEqual({ x: 40, y: 20 });
    frame.unlockAspectRatio();
    expect(frame.targetAspectRatio).toBeNull();
    frame.devStatus = { type: 'READY_FOR_DEV' };
    expect(frame.devStatus).toEqual({ type: 'READY_FOR_DEV' });
    const nested = figma.createFrame();
    frame.appendChild(nested);
    expect(() => {
      nested.devStatus = { type: 'COMPLETED' };
    }).toThrow(/directly under a page or section/);
    expect(frame.annotations).toEqual([{ label: 'Note' }]);
  });

  it('vectorPaths, handleMirroring and the read-only vectorNetwork (typings:9170-9189)', () => {
    const vector = createFakeFigma().createVector();
    vector.vectorPaths = [{ windingRule: 'NONZERO', data: 'M 0 0 L 10 10' }];
    vector.handleMirroring = 'ANGLE';
    expect(vector.vectorPaths).toEqual([{ windingRule: 'NONZERO', data: 'M 0 0 L 10 10' }]);
    expect(vector.handleMirroring).toBe('ANGLE');
    expect(() => {
      vector.vectorPaths = [{ windingRule: 'ODD', data: '' } as unknown as VectorPath];
    }).toThrow(/windingRule/);
    expect(() => {
      vector.vectorNetwork = { vertices: [], segments: [] };
    }).toThrow(/setVectorNetworkAsync/);
  });

  it('ellipse arcData (typings:10931-10934)', () => {
    const ellipse = createFakeFigma().createEllipse();
    ellipse.arcData = { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.5 };
    expect(ellipse.arcData.innerRadius).toBe(0.5);
    expect(() => {
      ellipse.arcData = { startingAngle: 0, endingAngle: 1, innerRadius: 2 };
    }).toThrow(/<= 1/);
  });

  it('section contents flag (typings:12328-12331)', () => {
    const section = createFakeFigma().createSection();
    section.sectionContentsHidden = true;
    expect(section.sectionContentsHidden).toBe(true);
  });

  it('page selection, backgrounds, divider names and the document colour profile', () => {
    const figma = createFakeFigma();
    const page = figma.currentPage;
    const a = figma.createFrame();
    page.selection = [a, a];
    expect(page.selection).toEqual([a]);
    const other = figma.createPage();
    const elsewhere = figma.createFrame();
    other.appendChild(elsewhere);
    expect(() => {
      page.selection = [elsewhere];
    }).toThrow(/this page/);
    page.backgrounds = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
    expect(page.backgrounds).toHaveLength(1);
    const divider = figma.createPage();
    divider.name = '---'.replace(/-/g, '—');
    expect(divider.isPageDivider).toBe(true);
    expect(page.isPageDivider).toBe(false);
    expect(figma.root.documentColorProfile).toBe('SRGB');
    expect(page.prototypeStartNode).toBeNull();
  });

  it('a document needs at least one page', () => {
    expect(() => createFakeFigma({ pages: [] })).toThrow(/at least one page/);
  });

  it('text paragraph and wrap properties need loaded fonts', async () => {
    const { figma, text } = await textNode('a');
    text.textWrapStyle = 'BALANCE';
    text.hangingPunctuation = true;
    text.listSpacing = 2;
    expect([text.textWrapStyle, text.hangingPunctuation, text.listSpacing]).toEqual(['BALANCE', true, 2]);
    figma.reset();
    expect(() => {
      text.textWrapStyle = 'PRETTY';
    }).toThrow(/unloaded font/);
  });

  it('layoutAlign and constrainProportions are stored', () => {
    const frame = createFakeFigma().createFrame();
    frame.layoutAlign = 'STRETCH';
    frame.constrainProportions = true;
    expect([frame.layoutAlign, frame.constrainProportions]).toEqual(['STRETCH', true]);
    expect(() => {
      frame.layoutAlign = 'BOTTOM' as 'MIN';
    }).toThrow(/layoutAlign/);
  });

  it('deprecated padding aliases write both sides', () => {
    const frame = createFakeFigma().createFrame();
    frame.layoutMode = 'HORIZONTAL';
    frame.horizontalPadding = 6;
    frame.verticalPadding = 3;
    expect([frame.paddingLeft, frame.paddingRight, frame.paddingTop, frame.paddingBottom]).toEqual([6, 6, 3, 3]);
  });
});
