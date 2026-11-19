import type { SceneComponent } from '@holotype/ir';
import { createDiagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import { describe, expect, it, vi } from 'vitest';
import { notifyMessage } from '../../src/apply/bundle';
import { COMPONENTS_PAGE } from '../../src/apply/page';
import { applyToFake } from '../support/apply';
import { createFakeFigma, type FakeFigma, type Op } from '../support/fake';
import { ASSETS, badge, card, component, FIXTURES, microFlexRow, node, PNG_SHA, solid } from '../support/scenes';

const opLine = ({ method, nodeId, property, value }: Op): string =>
  [method, nodeId ?? '-', property ?? '-', JSON.stringify(value)].join(' ');

/** The L3 snapshot: the fake document plus the operation log, one op per line. */
const snapshotOf = (figma: FakeFigma): string =>
  `${JSON.stringify({ tree: figma.snapshot(), ops: figma.ops().map(opLine) }, null, 2)}\n`;

const componentsPage = (figma: FakeFigma): PageNode => {
  const page = figma.root.children.find((child) => child.name === COMPONENTS_PAGE);
  if (page === undefined) throw new Error('No Components page');
  return page;
};

const codes = (items: readonly { code: string }[]) => items.map((item) => item.code);

describe('applyBundle: Scene IR → figma-fake (L3)', () => {
  it.each(FIXTURES.map((scene) => [scene.sid, scene] as const))(
    '%s: document and op log snapshot, byte-identical on two runs',
    async (sid, scene) => {
      const first = await applyToFake({ scenes: [scene] });
      const second = await applyToFake({ scenes: [scene] });
      expect(snapshotOf(second.figma)).toBe(snapshotOf(first.figma));
      expect(first.result.summary).toMatchObject({ componentsOk: 1, componentsFailed: 0, cancelled: false });
      await expect(snapshotOf(first.figma)).toMatchFileSnapshot(`./__snapshots__/${sid}.fake.json`);
    },
  );

  it('applies every fixture without a fake throw, each variant matching its expected boxes', async () => {
    const { result } = await applyToFake();
    expect(result.summary).toEqual({
      componentsOk: 3,
      componentsFailed: 0,
      variants: 4,
      durationMs: 0,
      cancelled: false,
    });
    expect(codes(result.report.diagnostics)).not.toContain('APPLY_COMPONENT_FAILED');
    expect(result.report.components.flatMap((c) => c.variants.map((v) => v.readback.maxDelta))).toEqual([0, 0, 0, 0]);
  });

  it('reports what it fell back on: missing font once, layout and instance per variant', async () => {
    const { result } = await applyToFake({ scenes: [card] });
    expect(codes(result.report.diagnostics)).toEqual([
      'FONT_MISSING',
      'APPLY_LAYOUT_FALLBACK',
      'APPLY_INSTANCE_TARGET_MISSING',
      'APPLY_LAYOUT_FALLBACK',
      'APPLY_INSTANCE_TARGET_MISSING',
    ]);
    expect(result.report.diagnostics[0]).toMatchObject({ value: 'Acme Sans Bold', fallback: 'Inter Bold' });
  });

  it('writes an ApplyReport (06 §4.5) with one entry per built component', async () => {
    const { figma, result } = await applyToFake();
    const roots = componentsPage(figma).children;
    expect(result.report).toMatchObject({
      kind: 'holotype/apply-report',
      applyId: 'apply-fixture',
      fileKey: figma.fileKey,
    });
    expect(result.report.components.map(({ sid, status, setId }) => ({ sid, status, setId }))).toEqual([
      { sid: 'micro-flex', status: 'synced', setId: roots[0]?.id },
      { sid: 'components-badge', status: 'synced', setId: roots[1]?.id },
      { sid: 'components-card', status: 'synced', setId: roots[2]?.id },
    ]);
    expect(result.report.components[2]?.variants.map((v) => v.vk)).toEqual(card.variants.map((v) => v.vk));
  });
});

describe('applyBundle: page, placement and session effects', () => {
  it('creates the Components page when absent and reuses it next time, stacking below its content', async () => {
    const figma = createFakeFigma();
    await applyToFake({ fake: figma, scenes: [microFlexRow] });
    expect(figma.root.children.map((page) => page.name)).toEqual(['Page 1', COMPONENTS_PAGE]);
    figma.reset();
    await applyToFake({ fake: figma, scenes: [badge] });
    expect(figma.root.children.map((page) => page.name)).toEqual(['Page 1', COMPONENTS_PAGE]);
    expect(componentsPage(figma).children.map((root) => [root.name, root.y])).toEqual([
      ['Flex row', 0],
      ['Badge', 56 + 96],
    ]);
  });

  it('places variants on their grid with the set gap, components top to bottom', async () => {
    const { figma } = await applyToFake({ scenes: [card, badge] });
    expect(componentsPage(figma).children.map((root) => [root.name, root.x, root.y])).toEqual([
      ['Card / Elevation=Flat', 0, 0],
      ['Card / Elevation=Raised', 240 + 24, 0],
      ['Badge', 0, 160 + 96],
    ]);
  });

  it('selects the new frames on the Components page and announces the result', async () => {
    const { figma } = await applyToFake();
    const page = componentsPage(figma);
    expect(figma.currentPage).toBe(page);
    expect(page.selection.map((selected) => selected.name)).toEqual(page.children.map((root) => root.name));
    expect(figma.notifications()).toEqual(['Imported 3 components (4 variants).']);
  });

  it('commits one undo step per component, or one for the run', async () => {
    const perComponent = createFakeFigma();
    const commits = vi.spyOn(perComponent, 'commitUndo');
    await applyToFake({ fake: perComponent });
    expect(commits).toHaveBeenCalledTimes(3);
    const single = createFakeFigma();
    const singleCommits = vi.spyOn(single, 'commitUndo');
    await applyToFake({ fake: single, options: { undo: 'single' } });
    expect(singleCommits).toHaveBeenCalledTimes(1);
  });

  it('pulls each asset once per session, even when several variants use it', async () => {
    const { assetRequests } = await applyToFake({ scenes: [card] });
    expect(assetRequests.sort()).toEqual(ASSETS.map((asset) => asset.sha).sort());
  });

  it('reports progress per component, ending at the total', async () => {
    const onProgress = vi.fn();
    await applyToFake({ options: { onProgress } });
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { done: 0, total: 4 },
      { done: 0, total: 4, current: 'Flex row' },
      { done: 1, total: 4, current: 'Flex row' },
      { done: 1, total: 4, current: 'Badge' },
      { done: 2, total: 4, current: 'Badge' },
      { done: 2, total: 4, current: 'Card' },
      { done: 4, total: 4, current: 'Card' },
    ]);
  });

  it('streams diagnostics after each component', async () => {
    const onDiagnostics = vi.fn();
    await applyToFake({ options: { onDiagnostics } });
    expect(onDiagnostics).toHaveBeenCalledTimes(1);
    expect(codes(onDiagnostics.mock.calls[0]?.[0] ?? [])).toContain('FONT_MISSING');
  });
});

describe('applyBundle: failures, cancel and recovery (09 §12–13)', () => {
  it('stops between variants on cancel: the component is partial, the rest are not built', async () => {
    let variantsWritten = 0;
    const figma = createFakeFigma();
    const result = await applyToFake({
      fake: figma,
      scenes: [card, badge],
      options: {
        isCancelled: () => variantsWritten > 0,
        slicer: {
          tick: async () => {
            variantsWritten = componentsPage(figma).children.length;
          },
        },
      },
    });
    expect(result.result.summary).toMatchObject({ componentsOk: 0, variants: 1, cancelled: true });
    expect(result.result.report.components).toMatchObject([{ sid: 'components-card', status: 'partial' }]);
    expect(codes(result.result.report.diagnostics)).toContain('APPLY_CANCELLED');
    expect(componentsPage(figma).children.map((root) => root.name)).toEqual(['Card / Elevation=Flat']);
    expect(figma.notifications()).toEqual(['Import cancelled. 0 components imported; import again to finish.']);
  });

  it('builds nothing when cancelled before the first component', async () => {
    const { result } = await applyToFake({ options: { isCancelled: () => true } });
    expect(result.summary).toMatchObject({ componentsOk: 0, variants: 0, cancelled: true });
    expect(codes(result.report.diagnostics)).toEqual(['APPLY_CANCELLED']);
  });

  it('fails a component that cannot be loaded and goes on with the next one', async () => {
    const unreadable = createDiagnostic(diagnostic('APPLY_BUNDLE_CORRUPT'), undefined, { value: 'components/x.json' });
    const { result } = await applyToFake({
      scenes: [microFlexRow, badge],
      options: {
        loadComponent: async (entry) => {
          if (entry.sid === 'micro-flex') throw new HolotypeError(unreadable);
          return badge;
        },
      },
    });
    expect(result.summary).toMatchObject({ componentsOk: 1, componentsFailed: 1 });
    expect(result.report.diagnostics).toMatchObject([
      { code: 'APPLY_BUNDLE_CORRUPT', sid: 'micro-flex' },
      { code: 'APPLY_COMPONENT_FAILED', sid: 'micro-flex', value: 'components/micro-flex.json' },
    ]);
  });

  it('keeps what was written when Figma throws mid-component, marked for resume', async () => {
    const broken = component('broken', 'Broken', [
      {
        root: node(
          'root',
          'component',
          'Broken',
          { x: 0, y: 0, w: 40, h: 40 },
          {
            fills: [],
            children: [
              node('root/ok', 'rectangle', 'Ok', { x: 0, y: 0, w: 10, h: 10 }, { fills: [solid(0, 0, 0)] }),
              node('root/bad', 'rectangle', 'Bad', { x: 0, y: 0, w: 10, h: 10 }, { fills: [], opacity: 2 }),
            ],
          },
        ),
      },
    ]);
    const { figma, result } = await applyToFake({ scenes: [broken, badge] });
    expect(result.summary).toMatchObject({ componentsOk: 1, componentsFailed: 1 });
    expect(result.report.diagnostics).toMatchObject([
      { code: 'APPLY_COMPONENT_FAILED', sid: 'broken', nodeKey: 'root/bad' },
    ]);
    const [root] = componentsPage(figma).children;
    expect(
      root && 'children' in root ? root.children.map((child) => child.getSharedPluginData('holotype', 'nk')) : [],
    ).toEqual(['root/ok', 'root/bad']);
    expect(figma.notifications()).toEqual(['Imported 1 component; 1 failed. See the Holotype report.']);
  });

  it('skips components the CLI could not build', async () => {
    const figma = createFakeFigma();
    const { manifest } = (await import('../support/scenes')).bundleOf([badge]);
    const { applyBundle } = await import('../../src/apply/bundle');
    const loadComponent = vi.fn(async () => badge);
    const result = await applyBundle({
      port: figma,
      manifest: {
        ...manifest,
        components: manifest.components.map((entry) => ({ ...entry, status: 'failed' as const })),
      },
      loadComponent,
      loadAsset: async () => ({ mime: '', bytes: new Uint8Array() }),
      slicer: { tick: async () => {} },
      isCancelled: () => false,
      now: () => 0,
      applyId: 'a',
    });
    expect(loadComponent).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({ componentsOk: 0, componentsFailed: 0, variants: 0 });
  });
});

describe('applyBundle: content fallbacks', () => {
  it('leaves out an image fill Figma refuses (APPLY_IMAGE_REJECTED) and builds the rest', async () => {
    const notAnImage = { sha: PNG_SHA, mime: 'image/png', bytes: new TextEncoder().encode('not a png') };
    const { figma, result } = await applyToFake({ scenes: [card], assets: [notAnImage, ...ASSETS.slice(1)] });
    expect(result.summary.componentsOk).toBe(1);
    expect(result.report.diagnostics.filter((d) => d.code === 'APPLY_IMAGE_REJECTED')).toMatchObject([
      { sid: 'components-card', value: PNG_SHA },
    ]);
    const avatar = componentsPage(figma).findOne((n) => n.name === 'Avatar');
    expect(avatar && 'fills' in avatar ? avatar.fills : null).toEqual([]);
  });

  it('builds an empty frame for an SVG Figma cannot import (SVG_IMPORT_FAILED)', async () => {
    const [png, svg] = ASSETS;
    if (png === undefined || svg === undefined) throw new Error('fixture');
    const { figma, result } = await applyToFake({
      scenes: [card],
      assets: [png, { ...svg, bytes: new TextEncoder().encode('<not-svg/>') }],
    });
    expect(result.summary.componentsOk).toBe(1);
    // One per variant that uses the icon.
    expect(result.report.diagnostics.filter((d) => d.code === 'SVG_IMPORT_FAILED')).toMatchObject([
      { nodeKey: 'root/row/icon', value: svg.sha, variantKey: card.variants[0]?.vk },
      { nodeKey: 'root/row/icon', value: svg.sha, variantKey: card.variants[1]?.vk },
    ]);
    const icons = componentsPage(figma).findAll((n) => n.name === 'Icon / chevron');
    expect(icons.map((icon) => [icon.type, icon.width, icon.height])).toEqual([
      ['FRAME', 16, 16],
      ['FRAME', 16, 16],
    ]);
  });

  it('keeps the SVG wrapper frame when the scene does not unwrap it', async () => {
    const scene = component('icon', 'Icon', [
      {
        root: node(
          'root',
          'component',
          'Icon',
          { x: 0, y: 0, w: 32, h: 32 },
          {
            fills: [],
            children: [
              node(
                'root/svg',
                'svg',
                'Glyph',
                { x: 0, y: 0, w: 32, h: 32 },
                { svg: { asset: { sha: ASSETS[1]?.sha ?? '' }, unwrap: false } },
              ),
            ],
          },
        ),
      },
    ]);
    const { figma } = await applyToFake({ scenes: [scene] });
    const glyph = componentsPage(figma).findOne((n) => n.name === 'Glyph');
    expect(glyph?.type).toBe('FRAME');
    expect(glyph && 'children' in glyph ? glyph.children.map((child) => child.type) : []).toEqual(['VECTOR']);
    expect([glyph?.width, glyph?.height]).toEqual([32, 32]);
  });

  it('fails a component when no font at all can be loaded', async () => {
    const { result } = await applyToFake({ scenes: [badge], fake: { fonts: [] } });
    expect(result.summary).toMatchObject({ componentsOk: 0, componentsFailed: 1 });
    expect(result.report.diagnostics).toMatchObject([
      { code: 'FONT_MISSING', severity: 'error' },
      { code: 'APPLY_COMPONENT_FAILED', sid: 'components-badge' },
    ]);
  });

  it('writes a rotated node with its relative transform', async () => {
    const angle = Math.PI / 4;
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    const rotated: SceneComponent = component('rotated', 'Rotated', [
      {
        root: node(
          'root',
          'component',
          'Rotated',
          { x: 0, y: 0, w: 100, h: 100 },
          {
            fills: [],
            children: [
              node(
                'root/box',
                'rectangle',
                'Box',
                { x: 50, y: 0, w: 20, h: 20 },
                {
                  fills: [solid(0, 0, 0)],
                  relativeTransform: [
                    [c, -s, 50],
                    [s, c, 0],
                  ],
                },
              ),
            ],
          },
        ),
      },
    ]);
    const { figma } = await applyToFake({ scenes: [rotated] });
    const box = componentsPage(figma).findOne((n) => n.name === 'Box');
    expect(box && 'rotation' in box ? box.rotation : undefined).toBeCloseTo(-45);
    expect(box?.relativeTransform[0][2]).toBe(50);
  });
});

describe('notifyMessage', () => {
  it.each([
    [
      { componentsOk: 1, componentsFailed: 0, variants: 1, durationMs: 0, cancelled: false },
      'Imported 1 component (1 variant).',
    ],
    [
      { componentsOk: 2, componentsFailed: 1, variants: 3, durationMs: 0, cancelled: false },
      'Imported 2 components; 1 failed. See the Holotype report.',
    ],
    [
      { componentsOk: 1, componentsFailed: 0, variants: 2, durationMs: 0, cancelled: true },
      'Import cancelled. 1 component imported; import again to finish.',
    ],
  ])('%j → %s', (summary, message) => {
    expect(notifyMessage(summary)).toBe(message);
  });
});
