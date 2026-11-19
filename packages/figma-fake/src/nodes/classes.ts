import { figmaError, unsupported } from '../errors';
import { live, type NodeState } from '../state';
import { normalizePaints } from '../values';
import { stateOf, WithChildren } from './children';
import { variantPropertiesOf, WithComponentProperties, WithPublishable, WithVariant } from './component';
import { NodeCore } from './core';
import { WithAutoLayout, WithBaseFrame, WithFramePrototyping, WithGridLayout } from './frame';
import { resizeNode, WithDimensions, WithLayout } from './layout';
import {
  WithBackgrounds,
  WithBlend,
  WithComplexStrokes,
  WithCorners,
  WithFills,
  WithGeometry,
  WithIndividualStrokes,
  WithRectangleCorners,
  WithStrokes,
} from './paint';
import { assign } from './props';
import {
  WithAnnotations,
  WithAspectRatioLock,
  WithConstraints,
  WithDevStatus,
  WithExplicitModes,
  WithExport,
  WithMotion,
  WithReactions,
  WithScene,
} from './scene';
import { WithArcData, WithVectorLike } from './shapes';
import { WithText } from './text';
import { attachNode } from './tree';

// Mixin stacks, named after the typings interfaces they implement.

/** `BaseNodeMixin & SceneNodeMixin` (typings:6364, 6642). */
const SceneBase = WithScene(WithMotion(WithExplicitModes(NodeCore)));

/** `DefaultShapeMixin` (typings:9418-9426): base, scene, reactions, blend, geometry, layout, export. */
const DefaultShape = WithExport(WithLayout(WithGeometry(WithBlend(WithReactions(SceneBase)))));

/** Members shared by rectangles, ellipses, vectors and text: constraints, complex strokes, annotations, aspect lock. */
const ShapeBase = WithAspectRatioLock(WithAnnotations(WithComplexStrokes(WithConstraints(DefaultShape))));

/** `BaseFrameMixin` (typings:9430-9485). */
const BaseFrame = WithBaseFrame(
  WithBackgrounds(
    WithDevStatus(
      WithAnnotations(
        WithAspectRatioLock(
          WithGridLayout(
            WithAutoLayout(
              WithIndividualStrokes(
                WithExport(
                  WithLayout(
                    WithConstraints(
                      WithBlend(
                        WithRectangleCorners(WithCorners(WithComplexStrokes(WithGeometry(WithChildren(SceneBase))))),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
);

/** `DefaultFrameMixin` (typings:9489): `BaseFrameMixin` plus prototyping and reactions. */
const DefaultFrame = WithReactions(WithFramePrototyping(BaseFrame));

function cloneUnsupported(type: string): never {
  return unsupported(`${type}.clone`, 'B-125');
}

/** `FrameNode` (typings:10816-10825). */
export class FakeFrameNode extends DefaultFrame implements FrameNode {
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
    state.views.container = this;
  }

  get type(): 'FRAME' {
    return 'FRAME';
  }

  clone(): FrameNode {
    return cloneUnsupported('FrameNode');
  }
}

/** `ComponentNode` (typings:11200-11230). */
export class FakeComponentNode
  extends WithComponentProperties(WithVariant(WithPublishable(DefaultFrame)))
  implements ComponentNode
{
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
    state.views.container = this;
    state.views.component = this;
  }

  get type(): 'COMPONENT' {
    return 'COMPONENT';
  }

  clone(): ComponentNode {
    return cloneUnsupported('ComponentNode');
  }

  createInstance(): InstanceNode {
    return unsupported('ComponentNode.createInstance');
  }

  createSlot(): SlotNode {
    return unsupported('ComponentNode.createSlot', 'B-142');
  }

  /** Instances arrive with B-54; until then no component has any. */
  async getInstancesAsync(): Promise<InstanceNode[]> {
    live(this);
    return [];
  }

  /** "Accessing this property will throw an exception if the plugin manifest contains `"documentAccess": "dynamic-page"`" (typings:11224-11229). */
  get instances(): InstanceNode[] {
    throw figmaError(
      'instances',
      'Cannot access instances with documentAccess: dynamic-page. Use node.getInstancesAsync instead.',
    );
  }
}

/** `ComponentSetNode` (typings:11175-11196). */
export class FakeComponentSetNode
  extends WithComponentProperties(WithPublishable(BaseFrame))
  implements ComponentSetNode
{
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
    state.views.container = this;
  }

  get type(): 'COMPONENT_SET' {
    return 'COMPONENT_SET';
  }

  clone(): ComponentSetNode {
    return cloneUnsupported('ComponentSetNode');
  }

  /** "The top-left-most variant, spatially" (typings:11184-11187): smallest y, then smallest x. */
  get defaultVariant(): ComponentNode {
    const variants = [...live(this).children].sort((a, b) => a.y - b.y || a.x - b.x);
    const first = variants[0];
    if (!first) throw figmaError('defaultVariant', 'The component set has no variants');
    return first.componentView;
  }

  /** Every variant property with its values in first-seen order (typings:11188-11195). */
  get variantGroupProperties(): { [property: string]: { values: string[] } } {
    const groups: { [property: string]: { values: string[] } } = {};
    for (const child of live(this).children) {
      for (const [property, value] of Object.entries(variantPropertiesOf(child) ?? {})) {
        const group = groups[property] ?? { values: [] };
        if (!group.values.includes(value)) group.values.push(value);
        groups[property] = group;
      }
    }
    return groups;
  }
}

/** `RectangleNode` (typings:10885-10903). */
export class FakeRectangleNode
  extends WithIndividualStrokes(WithRectangleCorners(WithCorners(ShapeBase)))
  implements RectangleNode
{
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
  }

  get type(): 'RECTANGLE' {
    return 'RECTANGLE';
  }

  clone(): RectangleNode {
    return cloneUnsupported('RectangleNode');
  }
}

/** `EllipseNode` (typings:10915-10935). */
export class FakeEllipseNode extends WithArcData(WithCorners(ShapeBase)) implements EllipseNode {
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
  }

  get type(): 'ELLIPSE' {
    return 'ELLIPSE';
  }

  clone(): EllipseNode {
    return cloneUnsupported('EllipseNode');
  }
}

/** `VectorNode` (typings:10984-11001). */
export class FakeVectorNode extends WithVectorLike(WithCorners(ShapeBase)) implements VectorNode {
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
  }

  get type(): 'VECTOR' {
    return 'VECTOR';
  }

  clone(): VectorNode {
    return cloneUnsupported('VectorNode');
  }
}

/** `TextNode` (typings:11002-11070). */
export class FakeTextNode extends WithText(ShapeBase) implements TextNode {
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
  }

  get type(): 'TEXT' {
    return 'TEXT';
  }

  clone(): TextNode {
    return cloneUnsupported('TextNode');
  }
}

/** `SectionNode` (typings:12314-12354): `OpaqueNodeMixin` geometry, fills, strokes and corners, no blend or layout. */
export class FakeSectionNode
  extends WithRectangleCorners(
    WithCorners(
      WithStrokes(WithAspectRatioLock(WithDevStatus(WithFills(WithDimensions(WithExport(WithChildren(SceneBase))))))),
    ),
  )
  implements SectionNode
{
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
    state.views.container = this;
  }

  get type(): 'SECTION' {
    return 'SECTION';
  }

  get sectionContentsHidden(): boolean {
    return live(this).sectionContentsHidden;
  }

  set sectionContentsHidden(value: boolean) {
    assign(this, 'sectionContentsHidden', value === true);
  }

  clone(): SectionNode {
    return cloneUnsupported('SectionNode');
  }

  /** Sections never propagate constraints, so both resizes are the same (typings:12336-12353). */
  resizeWithoutConstraints(width: number, height: number): void {
    resizeNode(live(this), 'resizeWithoutConstraints', width, height, false);
  }

  resize(width: number, height: number): void {
    resizeNode(live(this), 'resize', width, height, false);
  }
}

const PAGE_DIVIDER = /^(\*+|–+|—+| +)$/;

/** `PageNode` (typings:10621-10815). */
export class FakePageNode extends WithExport(WithExplicitModes(WithChildren(NodeCore))) implements PageNode {
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.container = this;
    state.views.page = this;
  }

  get type(): 'PAGE' {
    return 'PAGE';
  }

  clone(): PageNode {
    return cloneUnsupported('PageNode');
  }

  get guides(): ReadonlyArray<Guide> {
    return live(this).guides;
  }

  set guides(value: ReadonlyArray<Guide>) {
    if (!Array.isArray(value)) throw figmaError('set_guides', 'Expected an array');
    assign(this, 'guides', Object.freeze(value.map((guide: Guide) => Object.freeze({ ...guide }))));
  }

  /** Each page keeps its own selection; it is not a document write (typings:10651-10668). */
  get selection(): ReadonlyArray<SceneNode> {
    const state = live(this);
    return Object.freeze(state.selection.filter((node) => !stateOf('selection', node).removed));
  }

  set selection(value: ReadonlyArray<SceneNode>) {
    const state = live(this);
    const unique = [...new Set(value)];
    for (const node of unique) {
      if (stateOf('set_selection', node).page() !== state) {
        throw figmaError('set_selection', 'Selected nodes must be on this page');
      }
    }
    state.selection = Object.freeze(unique);
  }

  get selectedTextRange(): { node: TextNode; start: number; end: number } | null {
    live(this);
    return null;
  }

  set selectedTextRange(_value: { node: TextNode; start: number; end: number } | null) {
    unsupported('PageNode.selectedTextRange', 'hardening');
  }

  get flowStartingPoints(): ReadonlyArray<{ nodeId: string; name: string }> {
    return live(this).flowStartingPoints;
  }

  set flowStartingPoints(_value: ReadonlyArray<{ nodeId: string; name: string }>) {
    unsupported('PageNode.flowStartingPoints', 'hardening');
  }

  /** The canvas background (typings:10690-10693). */
  get backgrounds(): ReadonlyArray<Paint> {
    return live(this).pageBackgrounds;
  }

  set backgrounds(value: ReadonlyArray<Paint>) {
    assign(this, 'pageBackgrounds', normalizePaints('set_backgrounds', value), 'backgrounds');
  }

  get prototypeBackgrounds(): ReadonlyArray<Paint> {
    return live(this).prototypeBackgrounds;
  }

  set prototypeBackgrounds(value: ReadonlyArray<Paint>) {
    assign(this, 'prototypeBackgrounds', normalizePaints('set_prototypeBackgrounds', value), 'prototypeBackgrounds');
  }

  get prototypeStartNode(): FrameNode | GroupNode | ComponentNode | InstanceNode | null {
    live(this);
    return null;
  }

  /** "only possible when the page node is empty and has a page divider name" (typings:10718-10721). */
  get isPageDivider(): boolean {
    const state = live(this);
    return state.children.length === 0 && PAGE_DIVIDER.test(state.name);
  }

  /** Loads the page so its children can be read and changed (typings:10722-10725). Not a write. */
  async loadAsync(): Promise<void> {
    live(this).loaded = true;
  }

  on(_type: 'nodechange', _callback: (event: NodeChangeEvent) => void): void {
    unsupported('PageNode.on', 'hardening');
  }

  once(_type: 'nodechange', _callback: (event: NodeChangeEvent) => void): void {
    unsupported('PageNode.once', 'hardening');
  }

  off(_type: 'nodechange', _callback: (event: NodeChangeEvent) => void): void {
    unsupported('PageNode.off', 'hardening');
  }

  get focusedNode(): SceneNode | null {
    live(this);
    return null;
  }

  set focusedNode(_value: SceneNode | null) {
    unsupported('PageNode.focusedNode', 'hardening');
  }

  // MeasurementsMixin (typings:9587-9669): not modelled.

  getMeasurements(): Measurement[] {
    return unsupported('PageNode.getMeasurements', 'hardening');
  }

  getMeasurementsForNode(_node: SceneNode): Measurement[] {
    return unsupported('PageNode.getMeasurementsForNode', 'hardening');
  }

  addMeasurement(
    _start: { node: SceneNode; side: MeasurementSide },
    _end: { node: SceneNode; side: MeasurementSide },
    _options?: { offset?: MeasurementOffset; freeText?: string },
  ): Measurement {
    return unsupported('PageNode.addMeasurement', 'hardening');
  }

  editMeasurement(_id: string, _newValue: { offset?: MeasurementOffset; freeText?: string }): Measurement {
    return unsupported('PageNode.editMeasurement', 'hardening');
  }

  deleteMeasurement(_id: string): void {
    unsupported('PageNode.deleteMeasurement', 'hardening');
  }
}

/** Document-wide traversal needs `figma.loadAllPagesAsync()` under dynamic-page (typings:10497-10560). */
function requireAllPages(api: string): never {
  throw figmaError(api, 'Cannot call with documentAccess: dynamic-page. Call figma.loadAllPagesAsync() first.');
}

/** `DocumentNode` (typings:10462-10585). */
export class FakeDocumentNode extends NodeCore implements DocumentNode {
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.document = this;
  }

  get type(): 'DOCUMENT' {
    return 'DOCUMENT';
  }

  /** Pages are listed even when they are not loaded. */
  get children(): ReadonlyArray<PageNode> {
    return Object.freeze(live(this).children.map((page) => page.pageView));
  }

  get documentColorProfile(): 'LEGACY' | 'SRGB' | 'DISPLAY_P3' {
    live(this);
    return 'SRGB';
  }

  appendChild(child: PageNode): void {
    const state = live(this);
    const page = stateOf('appendChild', child);
    attachNode('appendChild', state, page, state.children.length);
    state.ctx.record(state, 'appendChild', null, page.id);
  }

  insertChild(index: number, child: PageNode): void {
    const state = live(this);
    const page = stateOf('insertChild', child);
    attachNode('insertChild', state, page, index);
    state.ctx.record(state, 'insertChild', null, { index, child: page.id });
  }

  findChildren(callback?: (node: PageNode) => boolean): Array<PageNode> {
    const pages = [...this.children];
    return callback ? pages.filter(callback) : pages;
  }

  findChild(callback: (node: PageNode) => boolean): PageNode | null {
    return this.children.find(callback) ?? null;
  }

  findAll(_callback?: (node: PageNode | SceneNode) => boolean): Array<PageNode | SceneNode> {
    return requireAllPages('findAll');
  }

  findOne(_callback: (node: PageNode | SceneNode) => boolean): PageNode | SceneNode | null {
    return requireAllPages('findOne');
  }

  findAllWithCriteria<T extends NodeType[]>(
    _criteria: FindAllCriteria<T>,
  ): Array<{ type: T[number] } & (PageNode | SceneNode)> {
    return requireAllPages('findAllWithCriteria');
  }

  findWidgetNodesByWidgetId(_widgetId: string): Array<WidgetNode> {
    return requireAllPages('findWidgetNodesByWidgetId');
  }
}
