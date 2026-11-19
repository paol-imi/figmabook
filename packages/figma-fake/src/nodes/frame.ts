import { figmaError, setterName, unsupported } from '../errors';
import { live, type NodeState } from '../state';
import { checkBoolean, checkEnum, checkNumber, frozenCopy } from '../values';
import type { Ctor } from './core';
import { demoteFillChildren, primaryAxis } from './layout';
import { assign } from './props';

const LAYOUT_MODES = ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'] as const;

/**
 * "This property must be set to "HORIZONTAL" or "VERTICAL" in order for the
 * primaryAxisSizingMode, …, paddingTop, …, itemSpacing, counterAxisSpacing, itemReverseZIndex,
 * and strokesIncludedInLayout properties to be applicable" (typings:7704).
 *
 * Figma may silently ignore some of these writes on a frame without auto layout; the fake
 * always throws (09 §6.2 "padding, spacing and alignment need layoutMode ≠ NONE"), so a write
 * ordered before `layoutMode` is caught. Padding and `strokesIncludedInLayout` are also
 * accepted on GRID frames, which have padding too.
 */
function requireLayout(state: NodeState, property: string, stackOnly: boolean): void {
  const ok = stackOnly ? state.isStack : state.isAutoLayout;
  if (!ok) {
    const modes = stackOnly ? '"HORIZONTAL" or "VERTICAL"' : 'not "NONE"';
    throw figmaError(setterName(property), `${property} needs auto layout: set layoutMode (${modes}) first`);
  }
}

type Padding = 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom';

function setPadding(state: NodeState, field: Padding, value: number): void {
  requireLayout(state, field, false);
  state[field] = checkNumber(setterName(field), field, value);
  state.ctx.record(state, 'set', field, value);
}

/** `AutoLayoutMixin` (typings:7694-8201). Child positions and HUG sizes come from layout-sim (`layout/relayout.ts`). */
export function WithAutoLayout<B extends Ctor>(Base: B) {
  return class extends Base implements AutoLayoutMixin {
    get layoutMode(): (typeof LAYOUT_MODES)[number] {
      return live(this).layoutMode;
    }

    set layoutMode(value: (typeof LAYOUT_MODES)[number]) {
      assign(this, 'layoutMode', checkEnum('set_layoutMode', 'layoutMode', value, LAYOUT_MODES));
    }

    get paddingLeft(): number {
      return live(this).paddingLeft;
    }

    set paddingLeft(value: number) {
      setPadding(live(this), 'paddingLeft', value);
    }

    get paddingRight(): number {
      return live(this).paddingRight;
    }

    set paddingRight(value: number) {
      setPadding(live(this), 'paddingRight', value);
    }

    get paddingTop(): number {
      return live(this).paddingTop;
    }

    set paddingTop(value: number) {
      setPadding(live(this), 'paddingTop', value);
    }

    get paddingBottom(): number {
      return live(this).paddingBottom;
    }

    set paddingBottom(value: number) {
      setPadding(live(this), 'paddingBottom', value);
    }

    /** Deprecated alias of paddingLeft and paddingRight (typings:7761-7764). */
    get horizontalPadding(): number {
      return live(this).paddingLeft;
    }

    set horizontalPadding(value: number) {
      this.paddingLeft = value;
      this.paddingRight = value;
    }

    /** Deprecated alias of paddingTop and paddingBottom (typings:7765-7768). */
    get verticalPadding(): number {
      return live(this).paddingTop;
    }

    set verticalPadding(value: number) {
      this.paddingTop = value;
      this.paddingBottom = value;
    }

    get primaryAxisSizingMode(): 'FIXED' | 'AUTO' {
      return live(this).primaryAxisSizingMode;
    }

    set primaryAxisSizingMode(value: 'FIXED' | 'AUTO') {
      const state = live(this);
      requireLayout(state, 'primaryAxisSizingMode', false);
      const mode = checkEnum('set_primaryAxisSizingMode', 'value', value, ['FIXED', 'AUTO']);
      if (mode === 'AUTO') demoteFillChildren(state, primaryAxis(state));
      assign(this, 'primaryAxisSizingMode', mode);
    }

    get counterAxisSizingMode(): 'FIXED' | 'AUTO' {
      return live(this).counterAxisSizingMode;
    }

    set counterAxisSizingMode(value: 'FIXED' | 'AUTO') {
      const state = live(this);
      requireLayout(state, 'counterAxisSizingMode', false);
      const mode = checkEnum('set_counterAxisSizingMode', 'value', value, ['FIXED', 'AUTO']);
      if (mode === 'AUTO') demoteFillChildren(state, primaryAxis(state) === 'h' ? 'v' : 'h');
      assign(this, 'counterAxisSizingMode', mode);
    }

    get strokesIncludedInLayout(): boolean {
      return live(this).strokesIncludedInLayout;
    }

    set strokesIncludedInLayout(value: boolean) {
      requireLayout(live(this), 'strokesIncludedInLayout', false);
      assign(this, 'strokesIncludedInLayout', checkBoolean('set_strokesIncludedInLayout', 'value', value));
    }

    get layoutWrap(): 'NO_WRAP' | 'WRAP' {
      return live(this).layoutWrap;
    }

    /** "Setting it on layers with a different layoutMode will throw an Error" (typings:7875). */
    set layoutWrap(value: 'NO_WRAP' | 'WRAP') {
      requireLayout(live(this), 'layoutWrap', true);
      assign(this, 'layoutWrap', checkEnum('set_layoutWrap', 'layoutWrap', value, ['NO_WRAP', 'WRAP']));
    }

    get primaryAxisAlignItems(): 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' | 'SPACE_EVENLY' | 'SPACE_AROUND' {
      return live(this).primaryAxisAlignItems;
    }

    set primaryAxisAlignItems(value: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' | 'SPACE_EVENLY' | 'SPACE_AROUND') {
      requireLayout(live(this), 'primaryAxisAlignItems', true);
      const options = ['MIN', 'MAX', 'CENTER', 'SPACE_BETWEEN', 'SPACE_EVENLY', 'SPACE_AROUND'] as const;
      assign(this, 'primaryAxisAlignItems', checkEnum('set_primaryAxisAlignItems', 'value', value, options));
    }

    get counterAxisAlignItems(): 'MIN' | 'MAX' | 'CENTER' | 'BASELINE' {
      return live(this).counterAxisAlignItems;
    }

    /** "`BASELINE` can only be set on horizontal auto-layout frames" (typings:7977). */
    set counterAxisAlignItems(value: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE') {
      const state = live(this);
      const api = 'set_counterAxisAlignItems';
      requireLayout(state, 'counterAxisAlignItems', true);
      const align = checkEnum(api, 'value', value, ['MIN', 'MAX', 'CENTER', 'BASELINE']);
      if (align === 'BASELINE' && state.layoutMode !== 'HORIZONTAL') {
        throw figmaError(api, '"BASELINE" can only be set on horizontal auto-layout frames');
      }
      assign(this, 'counterAxisAlignItems', align);
    }

    get counterAxisAlignContent(): 'AUTO' | 'SPACE_BETWEEN' {
      return live(this).counterAxisAlignContent;
    }

    /** "Changing this property on a non-wrapping auto-layout frame will throw an error" (typings:8055). */
    set counterAxisAlignContent(value: 'AUTO' | 'SPACE_BETWEEN') {
      const state = live(this);
      const api = 'set_counterAxisAlignContent';
      if (!state.isStack || state.layoutWrap !== 'WRAP') {
        throw figmaError(api, 'counterAxisAlignContent can only be set on wrapping auto-layout frames');
      }
      assign(this, 'counterAxisAlignContent', checkEnum(api, 'value', value, ['AUTO', 'SPACE_BETWEEN']));
    }

    get itemSpacing(): number {
      return live(this).itemSpacing;
    }

    /** Negative spacing is valid (typings:8162-8199 use `itemSpacing = -20`). */
    set itemSpacing(value: number) {
      requireLayout(live(this), 'itemSpacing', true);
      assign(this, 'itemSpacing', checkNumber('set_itemSpacing', 'itemSpacing', value));
    }

    /** "Once set to null, it will start returning the value of itemSpacing" (typings:8113-8160). */
    get counterAxisSpacing(): number {
      const state = live(this);
      return state.counterAxisSpacing ?? state.itemSpacing;
    }

    set counterAxisSpacing(value: number | null) {
      const state = live(this);
      const api = 'set_counterAxisSpacing';
      if (!state.isStack || state.layoutWrap !== 'WRAP') {
        throw figmaError(api, 'counterAxisSpacing can only be set on wrapping auto-layout frames');
      }
      assign(this, 'counterAxisSpacing', value === null ? null : checkNumber(api, 'counterAxisSpacing', value, 0));
    }

    get itemReverseZIndex(): boolean {
      return live(this).itemReverseZIndex;
    }

    set itemReverseZIndex(value: boolean) {
      requireLayout(live(this), 'itemReverseZIndex', true);
      assign(this, 'itemReverseZIndex', checkBoolean('set_itemReverseZIndex', 'value', value));
    }
  };
}

/** `GridLayoutMixin` (typings:8264-8521): GRID is B-111. */
export function WithGridLayout<B extends Ctor>(Base: B) {
  return class extends Base implements GridLayoutMixin {
    get gridRowCount(): number {
      return unsupported('GridLayoutMixin.gridRowCount', 'B-111');
    }

    set gridRowCount(_value: number) {
      unsupported('GridLayoutMixin.gridRowCount', 'B-111');
    }

    get gridColumnCount(): number {
      return unsupported('GridLayoutMixin.gridColumnCount', 'B-111');
    }

    set gridColumnCount(_value: number) {
      unsupported('GridLayoutMixin.gridColumnCount', 'B-111');
    }

    get gridRowGap(): number {
      return unsupported('GridLayoutMixin.gridRowGap', 'B-111');
    }

    set gridRowGap(_value: number) {
      unsupported('GridLayoutMixin.gridRowGap', 'B-111');
    }

    get gridColumnGap(): number {
      return unsupported('GridLayoutMixin.gridColumnGap', 'B-111');
    }

    set gridColumnGap(_value: number) {
      unsupported('GridLayoutMixin.gridColumnGap', 'B-111');
    }

    get gridRowSizes(): Array<GridTrackSize> {
      return unsupported('GridLayoutMixin.gridRowSizes', 'B-111');
    }

    set gridRowSizes(_value: Array<GridTrackSize>) {
      unsupported('GridLayoutMixin.gridRowSizes', 'B-111');
    }

    get gridColumnSizes(): Array<GridTrackSize> {
      return unsupported('GridLayoutMixin.gridColumnSizes', 'B-111');
    }

    set gridColumnSizes(_value: Array<GridTrackSize>) {
      unsupported('GridLayoutMixin.gridColumnSizes', 'B-111');
    }

    appendChildAt(_node: SceneNode, _rowIndex: number, _columnIndex: number): void {
      unsupported('GridLayoutMixin.appendChildAt', 'B-111');
    }

    get gridAutoTracks(): 'NONE' | 'ROWS' {
      return unsupported('GridLayoutMixin.gridAutoTracks', 'B-111');
    }

    set gridAutoTracks(_value: 'NONE' | 'ROWS') {
      unsupported('GridLayoutMixin.gridAutoTracks', 'B-111');
    }

    get gridItemsPositioning(): 'MANUAL' | 'ROW_AUTO_FLOW' {
      return unsupported('GridLayoutMixin.gridItemsPositioning', 'B-111');
    }

    set gridItemsPositioning(_value: 'MANUAL' | 'ROW_AUTO_FLOW') {
      unsupported('GridLayoutMixin.gridItemsPositioning', 'B-111');
    }

    reorderRows(_options: GridTrackReorderOptions): ReadonlyArray<GridTrackReorderEntry> {
      return unsupported('GridLayoutMixin.reorderRows', 'B-111');
    }

    reorderColumns(_options: GridTrackReorderOptions): ReadonlyArray<GridTrackReorderEntry> {
      return unsupported('GridLayoutMixin.reorderColumns', 'B-111');
    }
  };
}

/** `ContainerMixin`, `DeprecatedBackgroundMixin` and `BaseFrameMixin` own members (typings:9430-9485, 7661-7693). */
export function WithBaseFrame<B extends Ctor>(Base: B) {
  return class extends Base implements ContainerMixin, Omit<DeprecatedBackgroundMixin, 'backgrounds'> {
    get expanded(): boolean {
      return live(this).expanded;
    }

    set expanded(value: boolean) {
      assign(this, 'expanded', checkBoolean('set_expanded', 'expanded', value));
    }

    get backgroundStyleId(): string {
      return unsupported('backgroundStyleId', 'B-139');
    }

    set backgroundStyleId(_value: string) {
      unsupported('backgroundStyleId', 'B-139');
    }

    get detachedInfo(): DetachedInfo | null {
      live(this);
      return null;
    }

    get layoutGrids(): ReadonlyArray<LayoutGrid> {
      return live(this).layoutGrids;
    }

    set layoutGrids(value: ReadonlyArray<LayoutGrid>) {
      if (!Array.isArray(value)) throw figmaError('set_layoutGrids', 'Expected an array');
      assign(this, 'layoutGrids', frozenCopy(value));
    }

    get gridStyleId(): string {
      return unsupported('gridStyleId', 'B-139');
    }

    set gridStyleId(_value: string) {
      unsupported('gridStyleId', 'B-139');
    }

    setGridStyleIdAsync(_styleId: string): Promise<void> {
      return unsupported('setGridStyleIdAsync', 'B-139');
    }

    get clipsContent(): boolean {
      return live(this).clipsContent;
    }

    set clipsContent(value: boolean) {
      assign(this, 'clipsContent', checkBoolean('set_clipsContent', 'clipsContent', value));
    }

    get guides(): ReadonlyArray<Guide> {
      return live(this).guides;
    }

    set guides(value: ReadonlyArray<Guide>) {
      if (!Array.isArray(value)) throw figmaError('set_guides', 'Expected an array');
      assign(this, 'guides', frozenCopy(value));
    }

    get inferredAutoLayout(): InferredAutoLayoutResult | null {
      return unsupported('inferredAutoLayout', 'hardening');
    }
  };
}

/** `FramePrototypingMixin` (typings:9140-9169): prototyping is not modelled. */
export function WithFramePrototyping<B extends Ctor>(Base: B) {
  return class extends Base implements FramePrototypingMixin {
    get overflowDirection(): OverflowDirection {
      live(this);
      return 'NONE';
    }

    set overflowDirection(_value: OverflowDirection) {
      unsupported('overflowDirection', 'hardening');
    }

    get numberOfFixedChildren(): number {
      live(this);
      return 0;
    }

    set numberOfFixedChildren(_value: number) {
      unsupported('numberOfFixedChildren', 'hardening');
    }

    get overlayPositionType(): OverlayPositionType {
      return unsupported('overlayPositionType', 'hardening');
    }

    get overlayBackground(): OverlayBackground {
      return unsupported('overlayBackground', 'hardening');
    }

    get overlayBackgroundInteraction(): OverlayBackgroundInteraction {
      return unsupported('overlayBackgroundInteraction', 'hardening');
    }
  };
}
