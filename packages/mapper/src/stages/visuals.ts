import type { BlendMode, CComputed, MapperSettings, ScenePaint } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { solidPaint } from '../color';
import { isTransparent } from '../css';
import { addOnce, plainDiagnostic } from '../diagnostics';
import { type WorkNode, walkWork } from '../state';
import { cornerRadius } from '../visuals/radius';
import { applyReplaced } from '../visuals/replaced';
import { borderStroke } from '../visuals/stroke';
import { reportUnsupportedVisuals } from '../visuals/unsupported';
import type { VariantStage } from './types';

/*
 * Stage 7, visuals (07 §10): SOLID background fills, borders as an INSIDE stroke, corner
 * radii, opacity, blend mode, clipping and replaced content. Text paints are stage 6.
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

function applyBoxVisuals(node: WorkNode, profile: ColorProfile, notes: Diagnostic[]): void {
  const { capture, fields } = node;
  const computed = capture.computed;
  const fills: ScenePaint[] = [];
  if (computed && !node.paintHidden) {
    if (!isTransparent(computed.background.color)) {
      fills.push(solidPaint(computed.background.color, profile, notes, 'background-color'));
    }
    const stroke = borderStroke(computed, profile, notes);
    if (stroke) fields.strokes = stroke;
    reportUnsupportedVisuals(capture, notes);
  }
  const content = applyReplaced(node, notes);
  if (content) fills.push(content);
  // A frame without fills must say so: Figma gives new frames a white fill.
  if (node.kind !== 'svg') fields.fills = fills;
  if (!computed) return;
  if (node.kind !== 'svg') {
    const radius = cornerRadius(computed, capture.borderBox, notes);
    if (radius) fields.radius = radius;
  }
  if (computed.opacity > 0 && computed.opacity < 1) fields.opacity = computed.opacity;
  const blend = blendMode(computed, notes);
  if (blend) fields.blendMode = blend;
  // Figma frames clip by default; the Scene states it either way.
  if (node.kind === 'frame' || node.kind === 'component') fields.clipsContent = clipsContent(computed, notes);
}

export const visualsStage: VariantStage = {
  step: 7,
  name: 'visuals',
  per: 'variant',
  run(variant, component) {
    const profile = component.input.config.mapper.colorProfile;
    for (const node of walkWork(variant.root)) {
      if (node.kind === 'text') continue;
      const notes: Diagnostic[] = [];
      applyBoxVisuals(node, profile, notes);
      for (const note of notes) addOnce(node.diagnostics, note);
    }
  },
};
