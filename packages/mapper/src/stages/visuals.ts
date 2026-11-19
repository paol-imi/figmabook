import type { BlendMode, CComputed, MapperSettings, ScenePaint } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { solidPaint } from '../color';
import { addOnce, plainDiagnostic } from '../diagnostics';
import { containsRect } from '../geometry';
import { syntheticNode, type WorkNode, walkWork } from '../state';
import { background } from '../visuals/background';
import { boxShadows } from '../visuals/box-shadow';
import { outlineVisual } from '../visuals/outline';
import { cornerRadius } from '../visuals/radius';
import { applyReplaced } from '../visuals/replaced';
import { borderVisual } from '../visuals/stroke';
import { reportUnsupported, reportUnsupportedVisuals } from '../visuals/unsupported';
import type { VariantStage } from './types';

/*
 * Stage 7, visuals (07 §10): background fills (SOLID and IMAGE), borders (an INSIDE stroke,
 * or decomposed sides), outlines, box shadows, corner radii, opacity, blend mode, clipping
 * and replaced content. Text paints are stage 6.
 *
 * Synthetic layers this stage adds (07 §10, §12 rule 9): first children `…/shadow`
 * (backing rectangle), `…/bg` (clipped background) and `…/border-{t,r,b,l}` (decomposed
 * sides), bottom → top under the element's content, and an `…/outline` frame right after
 * the element (the root's last child). They keep exact geometry; auto layout (B-49) places
 * them as ABSOLUTE children.
 */

type ColorProfile = MapperSettings['mapper']['colorProfile'];

const BLEND_MODES: Readonly<Record<string, BlendMode>> = {
  multiply: 'MULTIPLY',
  screen: 'SCREEN',
  overlay: 'OVERLAY',
  darken: 'DARKEN',
  lighten: 'LIGHTEN',
  'color-dodge': 'COLOR_DODGE',
  'color-burn': 'COLOR_BURN',
  'hard-light': 'HARD_LIGHT',
  'soft-light': 'SOFT_LIGHT',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  hue: 'HUE',
  saturation: 'SATURATION',
  color: 'COLOR',
  luminosity: 'LUMINOSITY',
};

/** `mix-blend-mode` 1:1; `isolation: isolate` makes a frame NORMAL instead of PASS_THROUGH (07 §10.5). */
function blendMode(computed: CComputed, notes: Diagnostic[]): BlendMode | undefined {
  const mode = computed.mixBlendMode;
  if (mode !== 'normal') {
    const mapped = BLEND_MODES[mode];
    if (mapped) return mapped;
    notes.push(
      plainDiagnostic('PAINT_BLEND_UNSUPPORTED', { property: 'mix-blend-mode', value: mode, fallback: 'normal' }),
    );
  }
  return computed.isolation === 'isolate' ? 'NORMAL' : undefined;
}

/** `overflow` ≠ visible on either axis clips both, since Figma clips both (07 §10.5). */
function clipsContent(computed: CComputed, notes: Diagnostic[]): boolean {
  const clipX = computed.overflowX !== 'visible';
  const clipY = computed.overflowY !== 'visible';
  if (clipX !== clipY) {
    notes.push(
      plainDiagnostic('LAYOUT_OVERFLOW_AXIS_APPROX', {
        property: clipX ? 'overflow-x' : 'overflow-y',
        value: clipX ? computed.overflowX : computed.overflowY,
        fallback: 'clipped on both axes',
      }),
    );
  }
  return clipX || clipY;
}

const hasChildren = (node: WorkNode): boolean => node.kind === 'frame' || node.kind === 'component';

/** Whether every descendant lies within the node's box (so clipping it changes nothing). */
const contentInside = (node: WorkNode): boolean =>
  [...walkWork(node)].every((descendant) => containsRect(node.box, descendant.box));

/** Adds the element's own visuals; returns the synthetic layers to place right after it. */
function applyBoxVisuals(node: WorkNode, profile: ColorProfile, isRoot: boolean, notes: Diagnostic[]): WorkNode[] {
  const { capture, fields } = node;
  const computed = capture.computed;
  const container = hasChildren(node);
  const under: WorkNode[] = [];
  const after: WorkNode[] = [];
  const fills: ScenePaint[] = [];
  const radius = computed && node.kind !== 'svg' ? cornerRadius(computed, node.box, notes) : undefined;
  if (radius) fields.radius = radius;
  const clips = computed !== undefined && container && clipsContent(computed, notes);
  // Figma frames clip by default; the Scene states it either way.
  if (computed && container) fields.clipsContent = clips;
  if (computed && !node.paintHidden) {
    const back = background(computed, node.box, profile, notes);
    fills.push(...back.fills);
    if (back.inner && !container) {
      // A layer without children cannot hold the inner rectangle.
      fills.push(back.inner.paint);
      reportUnsupported(notes, 'background-clip', computed.background.clip.at(-1), 'clipped at the border box');
    } else if (back.inner) {
      const { inset } = back.inner;
      const inner = (r: number, a: number, b: number): number => Math.max(0, r - Math.max(a, b));
      const innerRadius = radius && {
        tl: inner(radius.tl, inset[0], inset[3]),
        tr: inner(radius.tr, inset[0], inset[1]),
        br: inner(radius.br, inset[2], inset[1]),
        bl: inner(radius.bl, inset[2], inset[3]),
      };
      under.push(
        syntheticNode(node, 'bg', 'rectangle', back.inner.box, {
          fills: [back.inner.paint],
          ...(innerRadius ? { radius: innerRadius } : {}),
        }),
      );
    }
    const content = applyReplaced(node, notes);
    if (content) fills.push(content);

    const border = borderVisual(computed, node.box, radius, container, profile, notes);
    if (border?.kind === 'stroke') fields.strokes = border.stroke;
    for (const side of border?.kind === 'sides' ? border.sides : []) {
      under.push(
        syntheticNode(node, `border-${side.side}`, 'vector', side.box, {
          fills: [solidPaint(side.color, profile, notes, 'border-color')],
          vector: { paths: [{ windingRule: 'NONZERO', data: side.path }] },
        }),
      );
    }

    const outline = outlineVisual(computed, node.box, radius, border !== undefined, profile, notes);
    if (outline?.kind === 'stroke') fields.strokes = outline.stroke;
    if (outline?.kind === 'frame') {
      const frame = syntheticNode(node, 'outline', 'frame', outline.box, {
        fills: [],
        strokes: outline.stroke,
        clipsContent: false,
        ...(outline.radius ? { radius: outline.radius } : {}),
      });
      if (!isRoot) after.push(frame);
      else if (!clips) node.children.push(frame);
      else reportUnsupported(notes, 'outline', undefined, 'left out: the root clips its content');
    }

    if (node.kind === 'svg' && computed.boxShadow.length > 0) {
      reportUnsupported(notes, 'box-shadow', undefined, 'left out of the icon');
    } else if (computed.boxShadow.length > 0) {
      const shadows = boxShadows(
        {
          shadows: computed.boxShadow,
          fills,
          stroked: fields.strokes !== undefined || border !== undefined,
          container,
          clips,
          contentInside: contentInside(node),
          profile,
        },
        notes,
      );
      if (shadows.ring) fields.strokes = shadows.ring;
      if (shadows.effects) fields.effects = shadows.effects;
      if (shadows.clipsContent) fields.clipsContent = true;
      if (shadows.backing) {
        const { fills: backingFills, effects } = shadows.backing;
        under.unshift(
          syntheticNode(node, 'shadow', 'rectangle', node.box, {
            fills: backingFills,
            effects,
            ...(radius ? { radius } : {}),
          }),
        );
      }
    }
    reportUnsupportedVisuals(capture, notes);
  } else {
    const content = applyReplaced(node, notes);
    if (content) fills.push(content);
  }
  // A frame without fills must say so: Figma gives new frames a white fill.
  if (node.kind !== 'svg') fields.fills = fills;
  if (computed) {
    if (computed.opacity > 0 && computed.opacity < 1) fields.opacity = computed.opacity;
    const blend = blendMode(computed, notes);
    if (blend) fields.blendMode = blend;
  }
  if (under.length > 0) node.children = [...under, ...node.children];
  return after;
}

/** Applies visuals to a subtree; returns the synthetic siblings the node needs after it. */
function visit(node: WorkNode, profile: ColorProfile, isRoot: boolean): WorkNode[] {
  node.children = node.children.flatMap((child) => [child, ...visit(child, profile, false)]);
  if (node.kind === 'text' || node.synthetic !== undefined) return [];
  const notes: Diagnostic[] = [];
  const after = applyBoxVisuals(node, profile, isRoot, notes);
  for (const note of notes) addOnce(node.diagnostics, note);
  return after;
}

export const visualsStage: VariantStage = {
  step: 7,
  name: 'visuals',
  per: 'variant',
  run(variant, component) {
    visit(variant.root, component.input.config.mapper.colorProfile, true);
  },
};
