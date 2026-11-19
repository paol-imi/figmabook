import { figmaError, unsupported } from '../errors';
import { MIXED, type Mixed } from '../mixed';
import { live, type NodeState } from '../state';
import {
  checkBoolean,
  checkEnum,
  checkNumber,
  deepFreeze,
  isBlendMode,
  normalizeEffects,
  normalizePaints,
} from '../values';
import type { Ctor } from './core';
import { assign } from './props';

/** Style ids are read-only under `documentAccess: "dynamic-page"` (typings:8718, 8806, 11063). */
function readOnlyStyleId(property: string, asyncSetter: string): never {
  throw figmaError(
    `set_${property}`,
    `Cannot call with documentAccess: dynamic-page. Use node.${asyncSetter} instead.`,
  );
}

function setTextFills(state: NodeState, paints: readonly Paint[]): void {
  const text = state.text;
  if (!text) return;
  text.setRange('fills', 0, text.characters.length, paints);
  text.base = { ...text.base, fills: paints };
}

function hasPattern(paints: ReadonlyArray<Paint>): boolean {
  return Array.isArray(paints) && paints.some((paint) => paint?.type === 'PATTERN');
}

/**
 * `MinimalFillsMixin` (typings:8788-8821). Text fills are per character, so a text node returns
 * `figma.mixed` when its characters differ (typings:8794). Setting fills never needs a loaded
 * font ("Color and stroke properties … don't require font loading",
 * https://developers.figma.com/docs/plugins/working-with-text).
 */
export function WithFills<B extends Ctor>(Base: B) {
  return class extends Base implements MinimalFillsMixin {
    get fills(): ReadonlyArray<Paint> | Mixed {
      const state = live(this);
      if (state.text) return state.text.uniform('fills') ?? MIXED;
      return state.fills;
    }

    set fills(value: ReadonlyArray<Paint> | Mixed) {
      const state = live(this);
      const paints = normalizePaints('set_fills', value);
      if (state.text) setTextFills(state, paints);
      else state.fills = paints;
      state.ctx.record(state, 'set', 'fills', paints);
    }

    get fillStyleId(): string | Mixed {
      live(this);
      return '';
    }

    set fillStyleId(_value: string | Mixed) {
      readOnlyStyleId('fillStyleId', 'setFillStyleIdAsync');
    }

    setFillStyleIdAsync(_styleId: string): Promise<void> {
      return unsupported('setFillStyleIdAsync', 'B-139');
    }

    /** The async setter; pattern fills need their source node and are hardening (typings:8817-8820). */
    async setFillsAsync(paints: ReadonlyArray<Paint>): Promise<void> {
      if (hasPattern(paints)) unsupported('PatternPaint', 'hardening');
      const state = live(this);
      const normalized = normalizePaints('setFillsAsync', paints);
      if (state.text) setTextFills(state, normalized);
      else state.fills = normalized;
      state.ctx.record(state, 'setFillsAsync', null, normalized);
    }
  };
}

/** `DeprecatedBackgroundMixin.backgrounds`: the deprecated alias of `fills` on frames (typings:7670-7693). */
export function WithBackgrounds<B extends Ctor>(Base: B) {
  return class extends Base {
    get backgrounds(): ReadonlyArray<Paint> {
      return live(this).fills;
    }

    set backgrounds(value: ReadonlyArray<Paint>) {
      assign(this, 'fills', normalizePaints('set_backgrounds', value), 'backgrounds');
    }
  };
}

function uniformWeight(state: NodeState): number | Mixed {
  const weights = [state.strokeTopWeight, state.strokeRightWeight, state.strokeBottomWeight, state.strokeLeftWeight];
  return weights.every((w) => w === state.strokeTopWeight) ? state.strokeTopWeight : MIXED;
}

/** `MinimalStrokesMixin` (typings:8706-8771). */
export function WithStrokes<B extends Ctor>(Base: B) {
  return class extends Base implements MinimalStrokesMixin {
    get strokes(): ReadonlyArray<Paint> {
      return live(this).strokes;
    }

    set strokes(value: ReadonlyArray<Paint>) {
      assign(this, 'strokes', normalizePaints('set_strokes', value));
    }

    get strokeStyleId(): string {
      live(this);
      return '';
    }

    set strokeStyleId(_value: string) {
      readOnlyStyleId('strokeStyleId', 'setStrokeStyleIdAsync');
    }

    setStrokeStyleIdAsync(_styleId: string): Promise<void> {
      return unsupported('setStrokeStyleIdAsync', 'B-139');
    }

    /** `figma.mixed` when the individual weights differ (typings:8725-8737). */
    get strokeWeight(): number | Mixed {
      return uniformWeight(live(this));
    }

    /** "This value must be non-negative and can be fractional" (typings:8726). Sets all four sides. */
    set strokeWeight(value: number | Mixed) {
      const state = live(this);
      const weight = checkNumber('set_strokeWeight', 'strokeWeight', value, 0);
      state.strokeTopWeight = weight;
      state.strokeRightWeight = weight;
      state.strokeBottomWeight = weight;
      state.strokeLeftWeight = weight;
      state.ctx.record(state, 'set', 'strokeWeight', weight);
    }

    get strokeJoin(): StrokeJoin | Mixed {
      return live(this).strokeJoin;
    }

    set strokeJoin(value: StrokeJoin | Mixed) {
      assign(this, 'strokeJoin', checkEnum('set_strokeJoin', 'strokeJoin', value, ['MITER', 'BEVEL', 'ROUND']));
    }

    get strokeAlign(): 'CENTER' | 'INSIDE' | 'OUTSIDE' {
      return live(this).strokeAlign;
    }

    set strokeAlign(value: 'CENTER' | 'INSIDE' | 'OUTSIDE') {
      assign(this, 'strokeAlign', checkEnum('set_strokeAlign', 'strokeAlign', value, ['CENTER', 'INSIDE', 'OUTSIDE']));
    }

    get dashPattern(): ReadonlyArray<number> {
      return live(this).dashPattern;
    }

    set dashPattern(value: ReadonlyArray<number>) {
      if (!Array.isArray(value)) throw figmaError('set_dashPattern', 'Expected an array of numbers');
      const pattern = value.map((n: number) => checkNumber('set_dashPattern', 'dashPattern', n, 0));
      assign(this, 'dashPattern', deepFreeze(pattern));
    }

    get strokeGeometry(): VectorPaths {
      return unsupported('strokeGeometry', 'hardening');
    }

    async setStrokesAsync(strokes: ReadonlyArray<Paint>): Promise<void> {
      if (hasPattern(strokes)) unsupported('PatternPaint', 'hardening');
      const state = live(this);
      state.strokes = normalizePaints('setStrokesAsync', strokes);
      state.ctx.record(state, 'setStrokesAsync', null, state.strokes);
    }
  };
}

const STROKE_CAPS = [
  'NONE',
  'ROUND',
  'SQUARE',
  'ARROW_LINES',
  'ARROW_EQUILATERAL',
  'DIAMOND_FILLED',
  'TRIANGLE_FILLED',
  'CIRCLE_FILLED',
] as const;

/** `GeometryMixin` own members (typings:8944-8967). */
export function WithGeometry<B extends Ctor>(Base: B) {
  return class extends WithStrokes(WithFills(Base)) implements GeometryMixin {
    get strokeCap(): StrokeCap | Mixed {
      return live(this).strokeCap;
    }

    set strokeCap(value: StrokeCap | Mixed) {
      assign(this, 'strokeCap', checkEnum('set_strokeCap', 'strokeCap', value, STROKE_CAPS));
    }

    get strokeMiterLimit(): number {
      return live(this).strokeMiterLimit;
    }

    set strokeMiterLimit(value: number) {
      assign(this, 'strokeMiterLimit', checkNumber('set_strokeMiterLimit', 'strokeMiterLimit', value, 0));
    }

    outlineStroke(): VectorNode | null {
      return unsupported('outlineStroke', 'hardening');
    }

    get fillGeometry(): VectorPaths {
      return unsupported('fillGeometry', 'hardening');
    }
  };
}

/** `ComplexStrokesMixin` (typings:8971-8992): brushes and variable width are not modelled. */
export function WithComplexStrokes<B extends Ctor>(Base: B) {
  return class extends Base implements ComplexStrokesMixin {
    get variableWidthStrokeProperties(): VariableWidthStrokeProperties | null {
      live(this);
      return null;
    }

    set variableWidthStrokeProperties(_value: VariableWidthStrokeProperties | null) {
      unsupported('variableWidthStrokeProperties', 'hardening');
    }

    get complexStrokeProperties(): ComplexStrokeProperties {
      live(this);
      return { type: 'BASIC' };
    }

    set complexStrokeProperties(_value: ComplexStrokeProperties) {
      unsupported('complexStrokeProperties', 'hardening');
    }
  };
}

/** `IndividualStrokesMixin` (typings:8775-8784): each side non-negative. */
export function WithIndividualStrokes<B extends Ctor>(Base: B) {
  return class extends Base implements IndividualStrokesMixin {
    get strokeTopWeight(): number {
      return live(this).strokeTopWeight;
    }

    set strokeTopWeight(value: number) {
      assign(this, 'strokeTopWeight', checkNumber('set_strokeTopWeight', 'strokeTopWeight', value, 0));
    }

    get strokeRightWeight(): number {
      return live(this).strokeRightWeight;
    }

    set strokeRightWeight(value: number) {
      assign(this, 'strokeRightWeight', checkNumber('set_strokeRightWeight', 'strokeRightWeight', value, 0));
    }

    get strokeBottomWeight(): number {
      return live(this).strokeBottomWeight;
    }

    set strokeBottomWeight(value: number) {
      assign(this, 'strokeBottomWeight', checkNumber('set_strokeBottomWeight', 'strokeBottomWeight', value, 0));
    }

    get strokeLeftWeight(): number {
      return live(this).strokeLeftWeight;
    }

    set strokeLeftWeight(value: number) {
      assign(this, 'strokeLeftWeight', checkNumber('set_strokeLeftWeight', 'strokeLeftWeight', value, 0));
    }
  };
}

/** `CornerMixin` (typings:8996-9015): `figma.mixed` when the corners differ. */
export function WithCorners<B extends Ctor>(Base: B) {
  return class extends Base implements CornerMixin {
    get cornerRadius(): number | Mixed {
      const s = live(this);
      const radii = [s.topLeftRadius, s.topRightRadius, s.bottomRightRadius, s.bottomLeftRadius];
      return radii.every((r) => r === s.topLeftRadius) ? s.topLeftRadius : MIXED;
    }

    /** "This value must be non-negative and can be fractional" (typings:9002). Sets all four corners. */
    set cornerRadius(value: number | Mixed) {
      const state = live(this);
      const radius = checkNumber('set_cornerRadius', 'cornerRadius', value, 0);
      state.topLeftRadius = radius;
      state.topRightRadius = radius;
      state.bottomRightRadius = radius;
      state.bottomLeftRadius = radius;
      state.ctx.record(state, 'set', 'cornerRadius', radius);
    }

    get cornerSmoothing(): number {
      return live(this).cornerSmoothing;
    }

    /** "Ranges from 0 to 1" (typings:9007-9014). */
    set cornerSmoothing(value: number) {
      const smoothing = checkNumber('set_cornerSmoothing', 'cornerSmoothing', value, 0);
      if (smoothing > 1) throw figmaError('set_cornerSmoothing', 'Expected "cornerSmoothing" to be <= 1');
      assign(this, 'cornerSmoothing', smoothing);
    }
  };
}

/** `RectangleCornerMixin` (typings:9019-9036). */
export function WithRectangleCorners<B extends Ctor>(Base: B) {
  return class extends Base implements RectangleCornerMixin {
    get topLeftRadius(): number {
      return live(this).topLeftRadius;
    }

    set topLeftRadius(value: number) {
      assign(this, 'topLeftRadius', checkNumber('set_topLeftRadius', 'topLeftRadius', value, 0));
    }

    get topRightRadius(): number {
      return live(this).topRightRadius;
    }

    set topRightRadius(value: number) {
      assign(this, 'topRightRadius', checkNumber('set_topRightRadius', 'topRightRadius', value, 0));
    }

    get bottomLeftRadius(): number {
      return live(this).bottomLeftRadius;
    }

    set bottomLeftRadius(value: number) {
      assign(this, 'bottomLeftRadius', checkNumber('set_bottomLeftRadius', 'bottomLeftRadius', value, 0));
    }

    get bottomRightRadius(): number {
      return live(this).bottomRightRadius;
    }

    set bottomRightRadius(value: number) {
      assign(this, 'bottomRightRadius', checkNumber('set_bottomRightRadius', 'bottomRightRadius', value, 0));
    }
  };
}

const MASK_TYPES = ['ALPHA', 'VECTOR', 'LUMINANCE'] as const;

/** `MinimalBlendMixin` and `BlendMixin` (typings:9494-9545, 7597-7660). */
export function WithBlend<B extends Ctor>(Base: B) {
  return class extends Base implements BlendMixin {
    get opacity(): number {
      return live(this).opacity;
    }

    /** "Must be between 0 and 1" (typings:9495-9498). */
    set opacity(value: number) {
      const opacity = checkNumber('set_opacity', 'opacity', value, 0);
      if (opacity > 1) throw figmaError('set_opacity', 'Expected "opacity" to be <= 1');
      assign(this, 'opacity', opacity);
    }

    get blendMode(): BlendMode {
      return live(this).blendMode;
    }

    set blendMode(value: BlendMode) {
      if (!isBlendMode(value)) throw figmaError('set_blendMode', `Invalid blend mode "${String(value)}"`);
      assign(this, 'blendMode', value);
    }

    get isMask(): boolean {
      return live(this).isMask;
    }

    set isMask(value: boolean) {
      assign(this, 'isMask', checkBoolean('set_isMask', 'isMask', value));
    }

    get maskType(): MaskType {
      return live(this).maskType;
    }

    set maskType(value: MaskType) {
      assign(this, 'maskType', checkEnum('set_maskType', 'maskType', value, MASK_TYPES));
    }

    get effects(): ReadonlyArray<Effect> {
      return live(this).effects;
    }

    set effects(value: ReadonlyArray<Effect>) {
      assign(this, 'effects', normalizeEffects('set_effects', value));
    }

    get effectStyleId(): string {
      live(this);
      return '';
    }

    set effectStyleId(_value: string) {
      readOnlyStyleId('effectStyleId', 'setEffectStyleIdAsync');
    }

    setEffectStyleIdAsync(_styleId: string): Promise<void> {
      return unsupported('setEffectStyleIdAsync', 'B-139');
    }
  };
}
