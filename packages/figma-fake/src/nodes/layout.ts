import { boundingBox, renderBounds } from '../bounds';
import { figmaError, setterName, unsupported } from '../errors';
import { live, type NodeState } from '../state';
import { checkEnum, checkNumber, deepFreeze } from '../values';
import type { Ctor } from './core';
import { assign } from './props';

/** Sizes below 0.01 are rejected: "Must be >= 0.01" (typings:7504-7505, 7519-7520). */
export const MIN_SIZE = 0.01;

export type Axis = 'h' | 'v';
type Sizing = 'FIXED' | 'HUG' | 'FILL';

function checkTransform(api: string, value: unknown): Transform {
  const row = (r: unknown): [number, number, number] => {
    if (!Array.isArray(r) || r.length !== 3) throw figmaError(api, 'Expected a 2x3 transform matrix');
    const [a, b, c]: unknown[] = r;
    return [checkNumber(api, 'transform', a), checkNumber(api, 'transform', b), checkNumber(api, 'transform', c)];
  };
  if (!Array.isArray(value) || value.length !== 2) throw figmaError(api, 'Expected a 2x3 transform matrix');
  return [row(value[0]), row(value[1])];
}

/** The axis an auto-layout frame grows along. GRID frames are treated as horizontal until B-111. */
export function primaryAxis(state: NodeState): Axis {
  return state.layoutMode === 'VERTICAL' ? 'v' : 'h';
}

export function ownMode(state: NodeState, axis: Axis): 'FIXED' | 'AUTO' {
  return axis === primaryAxis(state) ? state.primaryAxisSizingMode : state.counterAxisSizingMode;
}

export function setOwnMode(state: NodeState, axis: Axis, mode: 'FIXED' | 'AUTO'): void {
  if (axis === primaryAxis(state)) state.primaryAxisSizingMode = mode;
  else state.counterAxisSizingMode = mode;
}

export function isFill(state: NodeState, axis: Axis): boolean {
  if (!state.isLaidOut || !state.parent) return false;
  return axis === primaryAxis(state.parent) ? state.layoutGrow === 1 : state.layoutAlign === 'STRETCH';
}

function setFill(state: NodeState, axis: Axis, fill: boolean): void {
  if (!state.parent?.isAutoLayout) return;
  if (axis === primaryAxis(state.parent)) state.layoutGrow = fill ? 1 : 0;
  else state.layoutAlign = fill ? 'STRETCH' : 'INHERIT';
}

/**
 * A frame cannot hug an axis its children fill (layout-sim `fill-breaks-hug`,
 * https://help.figma.com/hc/en-us/articles/360040451373): making it hug turns those children
 * FIXED at their current size (README "Differences", verify S-05).
 */
export function demoteFillChildren(state: NodeState, axis: Axis): void {
  for (const child of state.children) {
    if (child.isLaidOut && isFill(child, axis)) setFill(child, axis, false);
  }
}

/** A text node with fixed width in `axis` (typings:11026-11035). */
function fixTextAxis(state: NodeState, axis: Axis): void {
  if (axis === 'h' && state.textAutoResize === 'WIDTH_AND_HEIGHT') state.textAutoResize = 'HEIGHT';
  if (axis === 'v' && (state.textAutoResize === 'HEIGHT' || state.textAutoResize === 'WIDTH_AND_HEIGHT')) {
    state.textAutoResize = 'NONE';
  }
}

/** `layoutSizingHorizontal` / `layoutSizingVertical` read-back (typings:7415-7500). */
export function sizingOf(state: NodeState, axis: Axis): Sizing {
  if (isFill(state, axis)) return 'FILL';
  if (state.isAutoLayout && ownMode(state, axis) === 'AUTO') return 'HUG';
  if (state.type === 'TEXT') {
    if (state.textAutoResize === 'WIDTH_AND_HEIGHT') return 'HUG';
    if (axis === 'v' && state.textAutoResize === 'HEIGHT') return 'HUG';
  }
  return 'FIXED';
}

/**
 * Sets a sizing mode. "`HUG` is only valid on auto-layout frames and text nodes. `FILL` is only
 * valid on auto-layout children. Setting these values when they don't apply will throw an
 * error" (typings:7420, 7498).
 */
function setSizing(state: NodeState, axis: Axis, value: Sizing, api: string): void {
  if (value === 'HUG') {
    if (state.isAutoLayout) {
      setOwnMode(state, axis, 'AUTO');
      demoteFillChildren(state, axis);
    } else if (state.type === 'TEXT') {
      if (axis === 'h') state.textAutoResize = 'WIDTH_AND_HEIGHT';
      else if (state.textAutoResize !== 'WIDTH_AND_HEIGHT') state.textAutoResize = 'HEIGHT';
    } else throw figmaError(api, '"HUG" is only valid on auto-layout frames and text nodes');
    setFill(state, axis, false);
    return;
  }
  if (value === 'FILL') {
    if (!state.isLaidOut) throw figmaError(api, '"FILL" is only valid on children of auto-layout frames');
    setFill(state, axis, true);
  } else setFill(state, axis, false);
  if (state.isAutoLayout) setOwnMode(state, axis, 'FIXED');
  if (state.type === 'TEXT') fixTextAxis(state, axis);
}

/** Applies a parent's resize to its children's constraints (typings:7501-7515), recursively. */
export function applyConstraints(state: NodeState, dw: number, dh: number, sx: number, sy: number): void {
  if (state.type === 'PAGE' || state.type === 'SECTION') return;
  for (const child of state.children) {
    if (child.isLaidOut) continue;
    const { horizontal, vertical } = child.constraints;
    let { x, y } = child;
    let { width, height } = child;
    if (horizontal === 'MAX') x += dw;
    else if (horizontal === 'CENTER') x += dw / 2;
    else if (horizontal === 'STRETCH') width = Math.max(MIN_SIZE, width + dw);
    else if (horizontal === 'SCALE') [x, width] = [x * sx, Math.max(MIN_SIZE, width * sx)];
    if (vertical === 'MAX') y += dh;
    else if (vertical === 'CENTER') y += dh / 2;
    else if (vertical === 'STRETCH') height = Math.max(MIN_SIZE, height + dh);
    else if (vertical === 'SCALE') [y, height] = [y * sy, Math.max(MIN_SIZE, height * sy)];
    child.setPosition(x, y);
    if (width !== child.width || height !== child.height) {
      const [cw, ch] = [child.width, child.height];
      child.width = width;
      child.height = height;
      // A resized auto-layout child lays out its own children again.
      child.ctx.touch(child);
      applyConstraints(child, width - cw, height - ch, width / cw, height / ch);
    }
  }
}

/**
 * The shared body of `resize` and `resizeWithoutConstraints`.
 *
 * - Sizes below 0.01 throw (typings:7504).
 * - On an auto-layout frame both axes become FIXED, and an auto-layout child that filled its
 *   parent stops filling: "resize() on an auto-layout axis forces FIXED" (09 §6.2, typings:7776).
 * - On text, resizing fixes the width: auto-width text becomes `HEIGHT` (09 §6.2).
 */
export function resizeNode(state: NodeState, api: string, width: number, height: number, constraints: boolean): void {
  checkNumber(api, 'width', width, MIN_SIZE);
  checkNumber(api, 'height', height, MIN_SIZE);
  const [dw, dh, sx, sy] = [width - state.width, height - state.height, width / state.width, height / state.height];
  state.width = width;
  state.height = height;
  for (const axis of ['h', 'v'] as const) {
    if (state.isAutoLayout) setOwnMode(state, axis, 'FIXED');
    setFill(state, axis, false);
  }
  if (state.type === 'TEXT' && state.textAutoResize === 'WIDTH_AND_HEIGHT') state.textAutoResize = 'HEIGHT';
  if (constraints) applyConstraints(state, dw, dh, sx, sy);
  state.ctx.record(state, api, null, { width, height });
}

/** `DimensionAndPositionMixin` (typings:7296-7391). */
export function WithDimensions<B extends Ctor>(Base: B) {
  return class extends Base implements DimensionAndPositionMixin {
    get x(): number {
      return live(this).x;
    }

    /** "Setting this property for these auto-layout children will no-op" (typings:7300-7303). */
    set x(value: number) {
      const state = live(this);
      checkNumber('set_x', 'x', value);
      if (!state.isLaidOut) state.setPosition(value, state.y);
      state.ctx.record(state, 'set', 'x', value);
    }

    get y(): number {
      return live(this).y;
    }

    set y(value: number) {
      const state = live(this);
      checkNumber('set_y', 'y', value);
      if (!state.isLaidOut) state.setPosition(state.x, value);
      state.ctx.record(state, 'set', 'y', value);
    }

    get width(): number {
      return live(this).width;
    }

    get height(): number {
      return live(this).height;
    }

    get minWidth(): number | null {
      return live(this).minWidth;
    }

    set minWidth(value: number | null) {
      assign(this, 'minWidth', checkMinMax(live(this), 'minWidth', value));
    }

    get maxWidth(): number | null {
      return live(this).maxWidth;
    }

    set maxWidth(value: number | null) {
      assign(this, 'maxWidth', checkMinMax(live(this), 'maxWidth', value));
    }

    get minHeight(): number | null {
      return live(this).minHeight;
    }

    set minHeight(value: number | null) {
      assign(this, 'minHeight', checkMinMax(live(this), 'minHeight', value));
    }

    get maxHeight(): number | null {
      return live(this).maxHeight;
    }

    set maxHeight(value: number | null) {
      assign(this, 'maxHeight', checkMinMax(live(this), 'maxHeight', value));
    }

    get relativeTransform(): Transform {
      return live(this).transform;
    }

    /** Auto-layout children keep their computed translation; rotation still applies (typings:7378-7380). */
    set relativeTransform(value: Transform) {
      const state = live(this);
      const [[a, b, x], [c, d, y]] = checkTransform('set_relativeTransform', value);
      state.transform = deepFreeze(
        state.isLaidOut
          ? [
              [a, b, state.x],
              [c, d, state.y],
            ]
          : [
              [a, b, x],
              [c, d, y],
            ],
      );
      state.ctx.record(state, 'set', 'relativeTransform', value);
    }

    get absoluteTransform(): Transform {
      return deepFreeze(live(this).absoluteTransform());
    }

    /** Axis-aligned bounds on the page, without strokes or effects (typings:7387-7390). */
    get absoluteBoundingBox(): Rect | null {
      return boundingBox(live(this));
    }
  };
}

/** "Applicable only to auto-layout frames and their direct children. Value must be positive" (typings:7321-7336). */
function checkMinMax(state: NodeState, name: string, value: number | null): number | null {
  const api = setterName(name);
  if (value === null) return null;
  checkNumber(api, name, value, 0);
  if (!state.isAutoLayout && !state.inAutoLayout) {
    throw figmaError(api, `${name} can only be set on auto-layout frames and their direct children`);
  }
  return value;
}

/** `LayoutMixin`, `AutoLayoutChildrenMixin` and `GridChildrenMixin` (typings:7395-7541, 8522-8689). */
export function WithLayout<B extends Ctor>(Base: B) {
  return class extends WithDimensions(Base) implements LayoutMixin {
    get absoluteRenderBounds(): Rect | null {
      return renderBounds(live(this));
    }

    get constrainProportions(): boolean {
      return live(this).constrainProportions;
    }

    set constrainProportions(value: boolean) {
      assign(this, 'constrainProportions', value === true);
    }

    /** `Math.atan2(-m10, m00)` in degrees (typings:7407-7414). */
    get rotation(): number {
      const [[a], [c]] = live(this).transform;
      const degrees = (Math.atan2(-c, a) * 180) / Math.PI;
      return Object.is(degrees, -0) ? 0 : degrees;
    }

    /** Rotates about the top-left corner: translation is kept (typings:7408-7413). */
    set rotation(value: number) {
      const state = live(this);
      const radians = (checkNumber('set_rotation', 'rotation', value) * Math.PI) / 180;
      const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
      state.transform = deepFreeze([
        [cos, sin, state.x],
        [-sin, cos, state.y],
      ]);
      state.ctx.record(state, 'set', 'rotation', value);
    }

    get layoutSizingHorizontal(): Sizing {
      return sizingOf(live(this), 'h');
    }

    set layoutSizingHorizontal(value: Sizing) {
      const state = live(this);
      const api = 'set_layoutSizingHorizontal';
      setSizing(state, 'h', checkEnum(api, 'layoutSizingHorizontal', value, ['FIXED', 'HUG', 'FILL']), api);
      state.ctx.record(state, 'set', 'layoutSizingHorizontal', value);
    }

    get layoutSizingVertical(): Sizing {
      return sizingOf(live(this), 'v');
    }

    set layoutSizingVertical(value: Sizing) {
      const state = live(this);
      const api = 'set_layoutSizingVertical';
      setSizing(state, 'v', checkEnum(api, 'layoutSizingVertical', value, ['FIXED', 'HUG', 'FILL']), api);
      state.ctx.record(state, 'set', 'layoutSizingVertical', value);
    }

    resize(width: number, height: number): void {
      resizeNode(live(this), 'resize', width, height, true);
    }

    resizeWithoutConstraints(width: number, height: number): void {
      resizeNode(live(this), 'resizeWithoutConstraints', width, height, false);
    }

    rescale(_scale: number): void {
      unsupported('LayoutMixin.rescale', 'hardening');
    }

    // AutoLayoutChildrenMixin

    get layoutAlign(): 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'INHERIT' {
      return live(this).layoutAlign;
    }

    set layoutAlign(value: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'INHERIT') {
      assign(
        this,
        'layoutAlign',
        checkEnum('set_layoutAlign', 'layoutAlign', value, ['MIN', 'CENTER', 'MAX', 'STRETCH', 'INHERIT']),
      );
    }

    get layoutGrow(): number {
      return live(this).layoutGrow;
    }

    /** "0 and 1 are currently the only supported values" (typings:8540-8542). */
    set layoutGrow(value: number) {
      if (value !== 0 && value !== 1) throw figmaError('set_layoutGrow', 'layoutGrow must be 0 or 1');
      assign(this, 'layoutGrow', value);
    }

    get layoutPositioning(): 'AUTO' | 'ABSOLUTE' {
      return live(this).layoutPositioning;
    }

    /** `ABSOLUTE` takes a child out of its auto-layout parent's flow, so it needs one (typings:8547-8580). */
    set layoutPositioning(value: 'AUTO' | 'ABSOLUTE') {
      const state = live(this);
      const api = 'set_layoutPositioning';
      const mode = checkEnum(api, 'layoutPositioning', value, ['AUTO', 'ABSOLUTE']);
      if (mode === 'ABSOLUTE' && !state.inAutoLayout) {
        throw figmaError(api, 'layoutPositioning "ABSOLUTE" requires the node to be a child of an auto-layout frame');
      }
      assign(this, 'layoutPositioning', mode);
    }

    // GridChildrenMixin: GRID layout is B-111.

    setGridChildPosition(_rowIndex: number, _columnIndex: number): void {
      unsupported('GridChildrenMixin.setGridChildPosition', 'B-111');
    }

    get gridRowAnchorIndex(): number {
      return unsupported('GridChildrenMixin.gridRowAnchorIndex', 'B-111');
    }

    get gridColumnAnchorIndex(): number {
      return unsupported('GridChildrenMixin.gridColumnAnchorIndex', 'B-111');
    }

    get gridRowSpan(): number {
      return unsupported('GridChildrenMixin.gridRowSpan', 'B-111');
    }

    set gridRowSpan(_value: number) {
      unsupported('GridChildrenMixin.gridRowSpan', 'B-111');
    }

    get gridColumnSpan(): number {
      return unsupported('GridChildrenMixin.gridColumnSpan', 'B-111');
    }

    set gridColumnSpan(_value: number) {
      unsupported('GridChildrenMixin.gridColumnSpan', 'B-111');
    }

    get gridChildHorizontalAlign(): 'MIN' | 'CENTER' | 'MAX' | 'AUTO' {
      return unsupported('GridChildrenMixin.gridChildHorizontalAlign', 'B-111');
    }

    set gridChildHorizontalAlign(_value: 'MIN' | 'CENTER' | 'MAX' | 'AUTO') {
      unsupported('GridChildrenMixin.gridChildHorizontalAlign', 'B-111');
    }

    get gridChildVerticalAlign(): 'MIN' | 'CENTER' | 'MAX' | 'AUTO' {
      return unsupported('GridChildrenMixin.gridChildVerticalAlign', 'B-111');
    }

    set gridChildVerticalAlign(_value: 'MIN' | 'CENTER' | 'MAX' | 'AUTO') {
      unsupported('GridChildrenMixin.gridChildVerticalAlign', 'B-111');
    }
  };
}
