import { type CaptureDoc, type CNode, checkSceneInvariants, type Rect, type SceneNode, variantKey } from '@holotype/ir';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mapComponent } from '../src';
import { px } from '../src/geometry';
import { loadCapture, singleInput } from './support';

/*
 * L2 properties (12 §1.1): for generated capture trees, every Scene node's absolute rect
 * equals the capture rect of the element it stands for (a text that took its bare parent's
 * place stands for the parent, 07 §11), and no painted box or visible text is dropped.
 */

interface Spec {
  readonly text: boolean;
  readonly painted: boolean;
  /** Text: fill the parent's box exactly (so a bare parent collapses into it, 07 §11). */
  readonly fit: boolean;
  /** Elements: padding (blocks the collapse) and border colors. */
  readonly padded: boolean;
  readonly border: 'none' | 'uniform' | 'sides';
  /** Quarter pixels, relative to the parent's origin. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly children: readonly Spec[];
}

const quarter = (min: number, max: number) => fc.integer({ min: min * 4, max: max * 4 }).map((n) => n / 4);

const { tree } = fc.letrec<{ tree: Spec; leaf: Spec }>((arb) => ({
  leaf: fc.record({
    text: fc.boolean(),
    painted: fc.boolean(),
    fit: fc.boolean(),
    padded: fc.boolean(),
    border: fc.constantFrom('none', 'uniform', 'sides'),
    x: quarter(-20, 200),
    y: quarter(-20, 200),
    w: quarter(0, 120),
    h: quarter(0, 60),
    children: fc.constant([]),
  }),
  tree: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    arb('leaf'),
    fc.record({
      text: fc.constant(false),
      painted: fc.boolean(),
      fit: fc.constant(false),
      padded: fc.boolean(),
      border: fc.constantFrom('none', 'uniform', 'sides'),
      x: quarter(-20, 200),
      y: quarter(-20, 200),
      w: quarter(0, 300),
      h: quarter(0, 200),
      children: fc.array(arb('tree'), { maxLength: 4 }),
    }),
  ),
}));

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`card fixture has no ${what}`);
  return value;
}

const template = loadCapture('card');
const elementComputed = required(template.root.computed, 'root computed style');
const textStyle = required(template.textStyles.body, 'body text style');

function build(spec: Spec, path: string, originX: number, originY: number, parent?: Rect): CNode {
  const borderBox: Rect =
    spec.text && spec.fit && parent ? parent : { x: originX + spec.x, y: originY + spec.y, w: spec.w, h: spec.h };
  const paint = { stackingContext: false, zIndex: 'auto' as const, layer: 'block' as const, domIndex: 0 };
  if (spec.text) {
    return {
      id: path,
      type: 'text',
      source: { tag: 'span', path },
      borderBox,
      text: {
        characters: 'Text',
        runs: [{ start: 0, end: 4, styleId: 'body' }],
        lines: [{ top: borderBox.y, height: spec.h, startChar: 0, endChar: 4, left: borderBox.x, width: spec.w }],
        whiteSpace: 'normal',
        textOverflow: 'clip',
        lineClamp: null,
        wrap: 'wrap',
        textAlign: 'left',
        indent: 0,
      },
      children: [],
      paint,
    };
  }
  const computed = structuredClone(elementComputed);
  const red = { r: 1, g: 0, b: 0, a: 1, space: 'srgb' as const };
  const blue = { ...red, r: 0, b: 1 };
  computed.border.width = spec.border === 'none' ? [0, 0, 0, 0] : [1, 2, 1, 2];
  computed.border.style = ['solid', 'solid', 'solid', 'solid'];
  computed.border.color = spec.border === 'sides' ? [red, blue, red, blue] : [red, red, red, red];
  computed.radius = { h: [0, 0, 0, 0], v: [0, 0, 0, 0] };
  if (!spec.padded) computed.padding = [0, 0, 0, 0];
  computed.overflowX = 'visible';
  computed.overflowY = 'visible';
  computed.background.color = { r: 0.5, g: 0.5, b: 0.5, a: spec.painted ? 1 : 0, space: 'srgb' };
  return {
    id: path,
    type: 'element',
    source: { tag: 'div', path },
    borderBox,
    computed,
    children: spec.children.map((child, i) => build(child, `${path}>div:${i}`, borderBox.x, borderBox.y, borderBox)),
    paint,
  };
}

function captureOf(spec: Spec): CaptureDoc {
  const root = build({ ...spec, text: false }, 'div:0', 37.5, 12.25);
  const target = { ...template.target, storyId: 'generated--story' };
  const vk = variantKey(target);
  return { ...template, target: { ...target, vk }, rootRect: root.borderBox, root, textStyles: { body: textStyle } };
}

function byPath(node: CNode, out = new Map<string, CNode>()): Map<string, CNode> {
  out.set(node.source.path, node);
  for (const child of node.children) byPath(child, out);
  return out;
}

/** Visits Scene nodes with their absolute position, summed from `xy`. */
function* placed(node: SceneNode, x = 0, y = 0): Generator<{ node: SceneNode; x: number; y: number }> {
  const nx = px(x + (node.xy?.x ?? 0));
  const ny = px(y + (node.xy?.y ?? 0));
  yield { node, x: nx, y: ny };
  for (const child of node.children ?? []) yield* placed(child, nx, ny);
}

const isVisibleContent = (node: CNode): boolean =>
  node.borderBox.w > 0 &&
  node.borderBox.h > 0 &&
  (node.type === 'text' || node.computed?.background.color.a === 1 || (node.computed?.border.width[0] ?? 0) > 0);

describe('absolute geometry', () => {
  it('keeps every node at its capture rect through normalization and simplification', () => {
    fc.assert(
      fc.property(tree, (spec) => {
        const capture = captureOf(spec);
        const captured = byPath(capture.root);
        const { scene } = mapComponent(singleInput(capture));
        const root = scene.variants[0]?.root;
        if (!root) throw new Error('no variant');
        const origin = capture.root.borderBox;
        for (const { node, x, y } of placed(root)) {
          // Synthetic layers (borders, backgrounds) have no element of their own.
          if (node.source === undefined) continue;
          const source = captured.get(node.source.path);
          if (!source) throw new Error(`no capture node for ${node.nk}`);
          const expected = {
            x: px(source.borderBox.x - origin.x),
            y: px(source.borderBox.y - origin.y),
            w: px(source.borderBox.w),
            h: px(source.borderBox.h),
          };
          expect(node.expect).toEqual(expected);
          expect({ x, y, w: node.size.w, h: node.size.h }).toEqual(expected);
        }
        expect(checkSceneInvariants(scene)).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it('keeps every painted box and every visible text', () => {
    fc.assert(
      fc.property(tree, (spec) => {
        const capture = captureOf(spec);
        const root = mapComponent(singleInput(capture)).scene.variants[0]?.root;
        if (!root) throw new Error('no variant');
        const emitted = new Set([...placed(root)].map(({ node }) => node.source?.path));
        const all = byPath(capture.root);
        for (const node of all.values()) {
          if (!isVisibleContent(node)) continue;
          // A text block may have taken its bare parent's place (07 §11 rule 3).
          const parent = node.source.path.replace(/>[^>]*$/, '');
          const kept = emitted.has(node.source.path) || (node.type === 'text' && emitted.has(parent));
          expect(kept, node.source.path).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });
});
