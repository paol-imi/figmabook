/*
 * Scene IR fixtures for the applier, shaped like `mapper` v0 output (BUILD B-12: absolute
 * frames, solid fills, uniform inside strokes, radius, opacity, one text node per block) plus
 * a kitchen sink for the kinds the slice applier handles. Hashes come from
 * `withSceneHashes`; `scenes.test.ts` checks every fixture against the schema and invariants.
 */
import {
  type BundleManifest,
  type Rect,
  type SceneComponent,
  type SceneFontRequest,
  type SceneNode,
  type SceneText,
  type SceneTextRange,
  type SceneVariant,
  variantKey,
  withSceneHashes,
} from '@holotype/ir';
import { sha256Hex } from '@holotype/ir/core';
import { zipSync } from 'fflate';

const UNHASHED = '0000000000000000';

type NodeExtra = Omit<Partial<SceneNode>, 'nk' | 'kind' | 'name' | 'size' | 'xy' | 'expect'>;

/** A node at `box` in its parent. `expect` is filled in by {@link component}. */
export function node(nk: string, kind: SceneNode['kind'], name: string, box: Rect, extra: NodeExtra = {}): SceneNode {
  return {
    nk,
    kind,
    name,
    irh: UNHASHED,
    size: { w: box.w, h: box.h },
    xy: { x: box.x, y: box.y },
    expect: { x: 0, y: 0, w: box.w, h: box.h },
    visible: true,
    ...extra,
  };
}

export const solid = (r: number, g: number, b: number, opacity = 1) =>
  ({ type: 'SOLID', color: { r, g, b }, opacity }) as const;

export function font(family: string, weight: number, styles: readonly string[], italic = false): SceneFontRequest {
  return {
    family,
    weight,
    italic,
    styleCandidates: [...styles],
    fallbackFamily: 'Inter',
    isCustom: family !== 'Inter',
  };
}

export const INTER_REGULAR = font('Inter', 400, ['Regular']);
export const INTER_SEMIBOLD = font('Inter', 600, ['Semi Bold', 'SemiBold']);

type RangeExtra = Partial<Omit<SceneTextRange, 'start' | 'end'>>;

export function range(start: number, end: number, extra: RangeExtra = {}): SceneTextRange {
  return {
    start,
    end,
    font: INTER_REGULAR,
    fontSize: 14,
    lineHeight: { unit: 'PIXELS', value: 20 },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    textCase: 'ORIGINAL',
    decoration: 'NONE',
    fills: [solid(0.1, 0.1, 0.1)],
    ...extra,
  };
}

export function text(characters: string, ranges: readonly SceneTextRange[], extra: Partial<SceneText> = {}): SceneText {
  return {
    characters,
    autoResize: 'NONE',
    alignH: 'LEFT',
    alignV: 'TOP',
    ranges: [...ranges],
    lines: [{ startChar: 0, endChar: characters.length }],
    wrapMode: 'reflow',
    widthBuffer: { max: 2 },
    ...extra,
  };
}

/** Sets every `expect` from the absolute layout: `xy` in the parent, or the parent's fallback box. */
function withExpect(root: SceneNode): SceneNode {
  const visit = (current: SceneNode, at: { x: number; y: number }): SceneNode => {
    const children = current.children?.map((child) => {
      const box = current.layout ? current.fallback?.children[child.nk] : undefined;
      const x = at.x + (box?.x ?? child.xy?.x ?? 0);
      const y = at.y + (box?.y ?? child.xy?.y ?? 0);
      return visit({ ...child, expect: { x, y, w: box?.w ?? child.size.w, h: box?.h ?? child.size.h } }, { x, y });
    });
    // An instance's fallback subtree is built in the instance's place.
    const fallback = current.instance?.fallback;
    const instance =
      fallback && current.instance
        ? { ...current.instance, fallback: visit({ ...fallback, expect: current.expect }, at) }
        : current.instance;
    return {
      ...current,
      ...(children === undefined ? {} : { children }),
      ...(instance === undefined ? {} : { instance }),
    };
  };
  const { xy: _xy, ...rest } = root;
  return visit({ ...rest, expect: { x: 0, y: 0, w: root.size.w, h: root.size.h } }, { x: 0, y: 0 });
}

export interface VariantSpec {
  readonly values?: Readonly<Record<string, string>>;
  readonly grid?: { readonly row: number; readonly col: number };
  readonly root: SceneNode;
}

/** A hashed Scene IR component. Variant property definitions are derived from the values. */
export function component(
  sid: string,
  name: string,
  variants: readonly VariantSpec[],
  extra: Partial<Pick<SceneComponent, 'dependencies'>> = {},
): SceneComponent {
  const keys = [...new Set(variants.flatMap((variant) => Object.keys(variant.values ?? {})))];
  const built: SceneVariant[] = variants.map((spec, i) => {
    const values = { ...(spec.values ?? {}) };
    const provenance = {
      storyId: `${sid}--${Object.values(values).join('-').toLowerCase() || 'default'}`,
      args: values,
      globals: {},
      state: null,
      viewport: { w: 1280, h: 800 },
      captureHash: `c0ffee${String(i).padStart(10, '0')}`,
    };
    return {
      vk: variantKey(provenance),
      irh: UNHASHED,
      values,
      provenance,
      grid: spec.grid ?? { row: 0, col: i },
      root: withExpect(spec.root),
      diagnostics: [],
    };
  });
  return withSceneHashes({
    kind: 'holotype/scene-component',
    sceneVersion: '0.1.0',
    sid,
    irh: UNHASHED,
    meta: {
      name,
      titlePath: ['Components', name],
      description: '',
      descriptionSource: 'none',
      links: [],
      storyIds: [...new Set(built.map((variant) => variant.provenance.storyId))],
      kind: variants.length > 1 ? 'component-set' : 'component',
    },
    properties: keys.map((key) => {
      const values = [...new Set(built.map((variant) => variant.values[key] ?? ''))];
      return {
        type: 'VARIANT',
        key,
        name: key,
        values,
        defaultValue: values[0] ?? '',
        source: { kind: 'arg', argName: key, classification: 'VARIANT', evidence: 'render-diff' },
      } as const;
    }),
    variants: built,
    setLayout: { mode: 'grid', columnsBy: keys, rowsBy: [], gap: { x: 24, y: 24 }, padding: 32, labels: false },
    dependencies: [...(extra.dependencies ?? [])],
    diagnostics: [],
  });
}

// ---------------------------------------------------------------------------------------
// Assets

/** A 1 × 1 transparent PNG. */
export const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
);
export const PNG_SHA = sha256Hex(PNG);

export const SVG_TEXT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M0 0L16 8L0 16Z" fill="#111111"/></svg>';
export const SVG = new TextEncoder().encode(SVG_TEXT);
export const SVG_SHA = sha256Hex(SVG);

export interface Asset {
  readonly sha: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export const ASSETS: readonly Asset[] = [
  { sha: PNG_SHA, mime: 'image/png', bytes: PNG },
  { sha: SVG_SHA, mime: 'image/svg+xml', bytes: SVG },
];

// ---------------------------------------------------------------------------------------
// Components

/** `micro-flex--row`: a row of three boxes, absolutely placed (the D1 demo story). */
export const microFlexRow = component('micro-flex', 'Flex row', [
  {
    root: node(
      'root',
      'component',
      'Flex row',
      { x: 0, y: 0, w: 152, h: 56 },
      {
        fills: [solid(0.96, 0.96, 0.96)],
        children: [8, 56, 104].map((x, i) =>
          node(
            `root/box-${i + 1}`,
            'rectangle',
            `Box ${i + 1}`,
            { x, y: 8, w: 40, h: 40 },
            {
              fills: [solid(0.2 + i * 0.2, 0.4, 0.8)],
              radius: { tl: 4, tr: 4, br: 4, bl: 4 },
            },
          ),
        ),
      },
    ),
  },
]);

/** `components-badge--default`: a pill with a centered label (the other D1 story). */
export const badge = component('components-badge', 'Badge', [
  {
    root: node(
      'root',
      'component',
      'Badge',
      { x: 0, y: 0, w: 48, h: 20 },
      {
        fills: [solid(0.05, 0.6, 1)],
        radius: { tl: 10, tr: 10, br: 10, bl: 10 },
        strokes: { paints: [solid(0, 0.4, 0.8)], align: 'INSIDE', weight: { t: 1, r: 1, b: 1, l: 1 } },
        children: [
          node(
            'root/label',
            'text',
            'Label',
            { x: 8, y: 2, w: 32, h: 16 },
            {
              text: text(
                'New',
                [
                  range(0, 3, {
                    font: INTER_SEMIBOLD,
                    fontSize: 12,
                    lineHeight: { unit: 'PIXELS', value: 16 },
                    fills: [solid(1, 1, 1)],
                  }),
                ],
                {
                  alignH: 'CENTER',
                },
              ),
            },
          ),
        ],
      },
    ),
  },
]);

const ACME_BOLD = font('Acme Sans', 700, ['Bold']);

function cardRoot(raised: boolean): SceneNode {
  return node(
    'root',
    'component',
    `Elevation=${raised ? 'Raised' : 'Flat'}`,
    { x: 0, y: 0, w: 240, h: 160 },
    {
      fills: [solid(1, 1, 1)],
      radius: { tl: 12, tr: 12, br: 12, bl: 12 },
      clipsContent: true,
      ...(raised
        ? {
            effects: [
              {
                type: 'DROP_SHADOW',
                color: { r: 0, g: 0, b: 0, a: 0.2 },
                offset: { x: 0, y: 4 },
                radius: 12,
                spread: 0,
              },
            ],
          }
        : {}),
      layout: {
        mode: 'VERTICAL',
        padding: { t: 16, r: 16, b: 16, l: 16 },
        itemSpacing: 8,
        wrap: false,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        strokesIncludedInLayout: false,
        itemReverseZIndex: false,
        verified: { simulator: '0.0.0', maxDelta: 0, tolerance: 0.6, responsive: 'single-snapshot' },
      },
      fallback: {
        size: { w: 240, h: 160 },
        children: {
          'root/title': { x: 16, y: 16, w: 208, h: 20 },
          'root/row': { x: 16, y: 44, w: 208, h: 40 },
          'root/divider': { x: 16, y: 92, w: 208, h: 1 },
          'root/glow': { x: 16, y: 101, w: 40, h: 40 },
          'root/hidden': { x: 64, y: 101, w: 40, h: 40 },
        },
      },
      children: [
        node(
          'root/title',
          'text',
          'Title',
          { x: 0, y: 0, w: 208, h: 20 },
          {
            child: { positioning: 'AUTO', sizingH: 'FILL', sizingV: 'HUG' },
            text: text(
              'Pro plan · details',
              [
                range(0, 8, { font: ACME_BOLD, fontSize: 16 }),
                range(8, 18, { decoration: 'UNDERLINE', hyperlink: 'https://example.com/plans', textCase: 'UPPER' }),
              ],
              { autoResize: 'HEIGHT' },
            ),
          },
        ),
        node(
          'root/row',
          'frame',
          'Row',
          { x: 0, y: 0, w: 208, h: 40 },
          {
            fills: [],
            children: [
              node(
                'root/row/avatar',
                'ellipse',
                'Avatar',
                { x: 0, y: 0, w: 40, h: 40 },
                {
                  fills: [{ type: 'IMAGE', asset: { sha: PNG_SHA }, scaleMode: 'FILL' }],
                },
              ),
              node(
                'root/row/icon',
                'svg',
                'Icon / chevron',
                { x: 52, y: 12, w: 16, h: 16 },
                {
                  svg: { asset: { sha: SVG_SHA }, unwrap: true },
                },
              ),
              node(
                'root/row/tag',
                'instance',
                'Tag',
                { x: 80, y: 8, w: 48, h: 24 },
                {
                  instance: {
                    component: { kind: 'local', sid: 'components-badge' },
                    properties: {},
                    match: { method: 'reference', maxDelta: 0 },
                    fallback: node(
                      'root/row/tag',
                      'frame',
                      'Tag',
                      { x: 80, y: 8, w: 48, h: 24 },
                      {
                        fills: [solid(0.9, 0.9, 1)],
                        children: [
                          node(
                            'root/row/tag/dot',
                            'ellipse',
                            'Dot',
                            { x: 4, y: 8, w: 8, h: 8 },
                            { fills: [solid(0, 0.6, 0)] },
                          ),
                        ],
                      },
                    ),
                  },
                },
              ),
            ],
          },
        ),
        node(
          'root/divider',
          'vector',
          'Divider',
          { x: 0, y: 0, w: 208, h: 1 },
          {
            vector: { paths: [{ windingRule: 'NONZERO', data: 'M 0 0 L 208 0' }] },
            fills: [],
            strokes: {
              paints: [solid(0.85, 0.85, 0.85)],
              align: 'CENTER',
              weight: { t: 1, r: 1, b: 1, l: 1 },
              cap: 'ROUND',
              dashPattern: [4, 2],
            },
          },
        ),
        node(
          'root/glow',
          'rectangle',
          'Glow',
          { x: 0, y: 0, w: 40, h: 40 },
          {
            opacity: 0.5,
            blendMode: 'MULTIPLY',
            fills: [
              {
                type: 'GRADIENT_LINEAR',
                gradientTransform: [
                  [1, 0, 0],
                  [0, 1, 0],
                ],
                gradientStops: [
                  { position: 0, color: { r: 1, g: 0.5, b: 0, a: 1 } },
                  { position: 1, color: { r: 1, g: 0, b: 0.5, a: 0 } },
                ],
              },
            ],
            strokes: { paints: [solid(0, 0, 0)], align: 'OUTSIDE', weight: { t: 2, r: 0, b: 2, l: 0 } },
            effects: [{ type: 'LAYER_BLUR', radius: 4 }],
          },
        ),
        node(
          'root/hidden',
          'rectangle',
          'Hidden',
          { x: 0, y: 0, w: 40, h: 40 },
          { visible: false, fills: [solid(1, 0, 0)] },
        ),
      ],
    },
  );
}

/** A two-variant card with everything the slice applier writes, and what it falls back on. */
export const card = component(
  'components-card',
  'Card',
  [
    { values: { Elevation: 'Flat' }, grid: { row: 0, col: 0 }, root: cardRoot(false) },
    { values: { Elevation: 'Raised' }, grid: { row: 0, col: 1 }, root: cardRoot(true) },
  ],
  { dependencies: ['components-badge'] },
);

export const FIXTURES: readonly SceneComponent[] = [microFlexRow, badge, card];

// ---------------------------------------------------------------------------------------
// Bundles

const encoder = new TextEncoder();

const countNodes = (root: SceneNode): number =>
  1 + (root.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);

export interface BundleFiles {
  readonly manifest: BundleManifest;
  /** Every file of the bundle, `manifest.json` first. */
  readonly files: Record<string, Uint8Array>;
}

/** A complete bundle of `scenes` and `assets`, with a correct `integrity` block. */
export function bundleOf(
  scenes: readonly SceneComponent[] = FIXTURES,
  assets: readonly Asset[] = ASSETS,
  patch: (manifest: BundleManifest) => BundleManifest = (manifest) => manifest,
): BundleFiles {
  const files: Record<string, Uint8Array> = {};
  const integrity: Record<string, string> = {};
  for (const scene of scenes) {
    const bytes = encoder.encode(JSON.stringify(scene));
    files[`components/${scene.sid}.json`] = bytes;
    integrity[`components/${scene.sid}.json`] = sha256Hex(bytes);
  }
  for (const asset of assets) {
    files[`assets/${asset.sha}`] = asset.bytes;
    integrity[`assets/${asset.sha}`] = sha256Hex(asset.bytes);
  }
  const variants = scenes.reduce((sum, scene) => sum + scene.variants.length, 0);
  const nodes = scenes.reduce((sum, scene) => sum + scene.variants.reduce((n, v) => n + countNodes(v.root), 0), 0);
  const manifest = patch({
    kind: 'holotype/bundle',
    bundleVersion: '0.1.0',
    runId: 'run-fixture',
    createdAt: '2026-11-19T10:00:00Z',
    sceneVersion: '0.1.0',
    features: [],
    generator: {
      name: '@holotype/cli',
      version: '0.0.0',
      mapper: '0.0.0',
      capture: '0.0.0',
      chromium: '140.0.0.0',
      playwright: '1.63.0',
    },
    createdBy: 'cli',
    source: { storybookVersion: '10.6.7', origin: 'http://localhost:6006/', fingerprint: 'a'.repeat(64) },
    config: { hash: '0123456789abcdef' },
    components: scenes.map((scene) => ({
      sid: scene.sid,
      name: scene.meta.name,
      titlePath: scene.meta.titlePath,
      irh: scene.irh,
      file: `components/${scene.sid}.json`,
      bytes: files[`components/${scene.sid}.json`]?.length ?? 0,
      variants: scene.variants.length,
      nodes: scene.variants.reduce((n, v) => n + countNodes(v.root), 0),
      dependencies: scene.dependencies,
      status: 'ok',
    })),
    assets: [...assets]
      .sort((a, b) => (a.sha < b.sha ? -1 : 1))
      .map(({ sha, mime, bytes }) => ({ sha, mime, bytes: bytes.length })),
    fonts: [],
    totals: {
      components: scenes.length,
      variants,
      nodes,
      assetBytes: assets.reduce((sum, a) => sum + a.bytes.length, 0),
    },
    integrity: { algo: 'sha256', files: integrity },
  });
  return { manifest, files: { 'manifest.json': encoder.encode(JSON.stringify(manifest)), ...files } };
}

/** The bundle as a `.holotype.zip`, `manifest.json` first. */
export function zipOf(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  return zipSync({ ...files }, { level: 6, mtime: new Date(2000, 0, 1) });
}
