import {
  type CaptureDoc,
  type CComputed,
  type CNode,
  type Color,
  type CPaintOrder,
  type Rect,
  type SceneNode,
  variantKey,
} from '@holotype/ir';
import { mapComponent } from '../src';
import { loadCapture, singleInput } from './support';

/*
 * Small Capture IR trees built in code, for rule tests. Elements start with a neutral style:
 * no background, border, padding, radius or shadow, overflow visible.
 */

const template = loadCapture('card');

export const rgb = (r: number, g: number, b: number, a = 1): Color => ({ r, g, b, a, space: 'srgb' });

/** The neutral computed style, optionally patched. */
export function style(patch: (computed: CComputed) => void = () => {}): CComputed {
  const computed = structuredClone(template.root.computed) as CComputed;
  computed.overflowX = 'visible';
  computed.overflowY = 'visible';
  computed.padding = [0, 0, 0, 0];
  computed.border = {
    width: [0, 0, 0, 0],
    style: ['none', 'none', 'none', 'none'],
    color: [rgb(0, 0, 0), rgb(0, 0, 0), rgb(0, 0, 0), rgb(0, 0, 0)],
  };
  computed.radius = { h: [0, 0, 0, 0], v: [0, 0, 0, 0] };
  computed.background = { color: rgb(0, 0, 0, 0), layers: [], clip: ['border-box'] };
  computed.boxShadow = [];
  patch(computed);
  return computed;
}

let domIndex = 0;

/** Restarts tree order, so a built tree does not depend on what was built before it. */
export function resetTreeOrder(): void {
  domIndex = 0;
}

export interface ElementOptions {
  readonly tag?: string;
  readonly source?: Partial<CNode['source']>;
  readonly paint?: Partial<CPaintOrder>;
  readonly style?: (computed: CComputed) => void;
  readonly extra?: Partial<CNode>;
}

/** An element at `box` (page space). */
export function element(path: string, box: Rect, children: CNode[] = [], options: ElementOptions = {}): CNode {
  return {
    id: path,
    type: 'element',
    source: { tag: options.tag ?? 'div', path, ...options.source },
    borderBox: box,
    computed: style(options.style),
    children,
    paint: { stackingContext: false, zIndex: 'auto', layer: 'block', domIndex: domIndex++, ...options.paint },
    ...options.extra,
  };
}

/** A one-line text block filling `box`. */
export function text(path: string, box: Rect, characters = 'Label', styleId = 'body'): CNode {
  return {
    id: path,
    type: 'text',
    source: { tag: '#text', path },
    borderBox: box,
    text: {
      characters,
      runs: [{ start: 0, end: characters.length, styleId }],
      lines: [{ top: box.y, height: box.h, startChar: 0, endChar: characters.length, left: box.x, width: box.w }],
      whiteSpace: 'normal',
      textOverflow: 'clip',
      lineClamp: null,
      wrap: 'wrap',
      textAlign: 'left',
      indent: 0,
    },
    children: [],
    paint: { stackingContext: false, zIndex: 'auto', layer: 'inline', domIndex: domIndex++ },
  };
}

/** A capture document around `root`, keyed by its own variant key. */
export function captureOf(root: CNode, patch: Partial<CaptureDoc> = {}): CaptureDoc {
  const target = { ...template.target, storyId: 'built--story', sid: 'built' };
  return {
    ...template,
    target: { ...target, vk: variantKey(target) },
    rootRect: root.borderBox,
    root,
    textStyles: template.textStyles,
    diagnostics: [],
    ...patch,
  };
}

/** Maps a built tree; returns the variant root and the variant diagnostics. */
export function mapTree(root: CNode, patch: Partial<CaptureDoc> = {}) {
  const { scene } = mapComponent(singleInput(captureOf(root, patch)));
  const [variant] = scene.variants;
  if (variant === undefined) throw new Error('no variant');
  return { root: variant.root, diagnostics: variant.diagnostics, scene };
}

/** The node with key `nk`. */
export function byKey(root: SceneNode, nk: string): SceneNode {
  const found = findKey(root, nk);
  if (found === undefined) throw new Error(`no node ${nk}`);
  return found;
}

function findKey(node: SceneNode, nk: string): SceneNode | undefined {
  if (node.nk === nk) return node;
  for (const child of node.children ?? []) {
    const found = findKey(child, nk);
    if (found) return found;
  }
  return undefined;
}

export const keys = (node: SceneNode | undefined): string[] => (node?.children ?? []).map((child) => child.nk);

const tinted = (computed: CComputed) => {
  computed.background.color = rgb(0.95, 0.95, 0.97);
};

/** Four solid border sides of one width. */
const sides = (computed: CComputed, width: number, colors: readonly [Color, Color, Color, Color]) => {
  computed.border = {
    width: [width, width, width, width],
    style: ['solid', 'solid', 'solid', 'solid'],
    color: [...colors],
  };
};

/**
 * A kitchen sink of the synthetic layers B-48 adds, mapped to a golden scene that the plugin
 * applies to figma-fake: decomposed borders, a clipped background, a shadow backing
 * rectangle, a ring stroke, an outline frame, a hoisted escape with its clip frame and a
 * collapsed text-only element.
 */
export function layersCapture(): CaptureDoc {
  resetTreeOrder();
  const shade = rgb(0, 0, 0, 0.2);
  const blue = rgb(0.2, 0.4, 0.9);
  const root = element(
    'div:0',
    { x: 0, y: 0, w: 320, h: 200 },
    [
      element('div:0>div:0', { x: 16, y: 16, w: 80, h: 40 }, [], {
        source: { classes: ['_sides_ab12c_1'] },
        style: (computed) => {
          tinted(computed);
          sides(computed, 2, [rgb(1, 0, 0), rgb(0, 0.6, 0), rgb(1, 0, 0), rgb(0, 0, 1)]);
        },
      }),
      element('div:0>div:1', { x: 112, y: 16, w: 80, h: 40 }, [], {
        source: { classes: ['_inset_ab12c_7'] },
        style: (computed) => {
          computed.background = { color: blue, layers: [], clip: ['padding-box'] };
          sides(computed, 4, [shade, shade, shade, shade]);
          computed.radius = { h: [8, 8, 8, 8], v: [8, 8, 8, 8] };
        },
      }),
      element(
        'div:0>div:2',
        { x: 208, y: 16, w: 96, h: 40 },
        [text('div:0>div:2>#text:0', { x: 216, y: 26, w: 100, h: 20 }, 'Overflowing label')],
        {
          source: { classes: ['_raised_ab12c_12'] },
          style: (computed) => {
            computed.background.color = rgb(1, 1, 1);
            computed.boxShadow = [{ inset: false, x: 0, y: 4, blur: 8, spread: 2, color: shade }];
            computed.radius = { h: [6, 6, 6, 6], v: [6, 6, 6, 6] };
          },
        },
      ),
      element('div:0>div:3', { x: 16, y: 80, w: 80, h: 32 }, [], {
        source: { classes: ['_ring_ab12c_20'] },
        style: (computed) => {
          computed.boxShadow = [{ inset: false, x: 0, y: 0, blur: 0, spread: 2, color: blue }];
        },
      }),
      element('div:0>button:4', { x: 112, y: 80, w: 80, h: 32 }, [], {
        tag: 'button',
        style: (computed) => {
          tinted(computed);
          computed.radius = { h: [4, 4, 4, 4], v: [4, 4, 4, 4] };
          computed.outline = { width: 2, style: 'solid', color: blue, offset: 2 };
        },
      }),
      element(
        'div:0>section:5',
        { x: 16, y: 128, w: 120, h: 40 },
        [
          element('div:0>section:5>div:0', { x: 16, y: 128, w: 60, h: 40 }, [], { style: tinted }),
          element('div:0>section:5>div:1', { x: 96, y: 150, w: 40, h: 40 }, [], {
            source: { classes: ['_badge_ab12c_30'] },
            paint: { layer: 'positive', zIndex: 2, stackingContext: true },
            style: (computed) => {
              computed.background.color = rgb(0.9, 0.2, 0.2);
            },
          }),
        ],
        {
          tag: 'section',
          style: (computed) => {
            computed.overflowX = 'hidden';
            computed.overflowY = 'hidden';
          },
        },
      ),
      element('div:0>footer:6', { x: 16, y: 168, w: 288, h: 24 }, [], { tag: 'footer', style: tinted }),
      element(
        'div:0>span:7',
        { x: 208, y: 80, w: 60, h: 20 },
        [text('div:0>span:7>#text:0', { x: 208, y: 80, w: 60, h: 20 }, 'Caption')],
        { tag: 'span' },
      ),
    ],
    {
      style: (computed) => {
        computed.background.color = rgb(1, 1, 1);
      },
    },
  );
  const target = { ...template.target, storyId: 'mapper-layers--kitchen-sink', sid: 'mapper-layers' };
  return { ...captureOf(root), target: { ...target, vk: variantKey(target) } };
}
