import { createInstanceState, retarget, setViewFactory } from '../components/instances';
import { defaultVariantOf, instanceProperties, setInstanceProperties, variantGroups } from '../components/properties';
import { figmaError, unsupported } from '../errors';
import { live, type NodeState } from '../state';
import { normalizePaints } from '../values';
import { stateOf, WithChildren } from './children';
import { WithComponentProperties, WithPublishable, WithVariant } from './component';
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
import { attachNode, checkInstanceTarget } from './tree';

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

  /** "By default, the instance will be parented under `figma.currentPage`" (typings:11213-11216). */
  createInstance(): InstanceNode {
    const main = live(this);
    const instance = createInstanceState(main);
    const page = main.ctx.currentPage;
    attachNode('createInstance', page, instance, page.children.length);
    main.ctx.record(instance, 'createInstance', null, main.id);
    return instance.instanceView;
  }

  createSlot(): SlotNode {
    return unsupported('ComponentNode.createSlot', 'B-142');
  }

  /** "All of the instances of this component in the document" (typings:11217-11220), in document order. */
  async getInstancesAsync(): Promise<InstanceNode[]> {
    const main = live(this);
    return [main.ctx.root, ...main.ctx.root.descendants()]
      .filter((node) => node.type === 'INSTANCE' && node.mainComponent === main && !node.removed)
      .map((node) => node.instanceView);
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
    const first = defaultVariantOf(live(this));
    if (!first) throw figmaError('defaultVariant', 'The component set has no variants');
    return first.componentView;
  }

  /** Every variant property with its values in first-seen order (typings:11188-11195). */
  get variantGroupProperties(): { [property: string]: { values: string[] } } {
    const groups: { [property: string]: { values: string[] } } = {};
    for (const [property, values] of variantGroups(live(this))) groups[property] = { values };
    return groups;
  }
}

/** A component to point an instance at: a live component that does not contain the instance. */
function targetComponent(api: string, instance: NodeState, node: unknown): NodeState {
  const target = stateOf(api, node);
  if (target.type !== 'COMPONENT') throw figmaError(api, 'Expected a component node');
  checkInstanceTarget(api, instance, target);
  return target;
}

/** `InstanceNode` (typings:11244-11330): basic instances (BUILD §8.1); overrides are B-125. */
export class FakeInstanceNode extends WithVariant(DefaultFrame) implements InstanceNode {
  constructor(state: NodeState) {
    super(state);
    state.views.node = this;
    state.views.scene = this;
    state.views.container = this;
    state.views.instance = this;
  }

  get type(): 'INSTANCE' {
    return 'INSTANCE';
  }

  clone(): InstanceNode {
    return cloneUnsupported('InstanceNode');
  }

  /** The main component, or `null` once it was deleted (typings:11253-11256). */
  async getMainComponentAsync(): Promise<ComponentNode | null> {
    const main = live(this).mainComponent;
    return main && !main.removed ? main.componentView : null;
  }

  /** "Write-only" under `documentAccess: "dynamic-page"` (typings:11257-11262). */
  get mainComponent(): ComponentNode | null {
    throw figmaError(
      'get_mainComponent',
      'Cannot read mainComponent with documentAccess: dynamic-page. Use node.getMainComponentAsync instead.',
    );
  }

  /** Points the instance at `value` and clears its overrides (typings:11257-11262). */
  set mainComponent(value: ComponentNode | null) {
    const state = live(this);
    const target = targetComponent('set_mainComponent', state, value);
    retarget(state, target, false);
    state.ctx.record(state, 'set', 'mainComponent', target.id);
  }

  /** Swaps the main component and keeps overrides on layers that match by name (typings:11263-11275). */
  swapComponent(componentNode: ComponentNode): void {
    const state = live(this);
    const target = targetComponent('swapComponent', state, componentNode);
    retarget(state, target, true);
    state.ctx.record(state, 'swapComponent', null, target.id);
  }

  setProperties(properties: { [propertyName: string]: string | boolean | VariableAlias }): void {
    const state = live(this);
    setInstanceProperties(state, properties);
    state.ctx.record(state, 'setProperties', null, properties);
  }

  get componentProperties(): ComponentProperties {
    return instanceProperties(live(this));
  }

  detachInstance(): FrameNode {
    return unsupported('InstanceNode.detachInstance', 'hardening');
  }

  /** 1 unless scaled with the scale tool, which the API cannot do (typings:11303-11310). */
  get scaleFactor(): number {
    live(this);
    return 1;
  }

  set scaleFactor(_value: number) {
    unsupported('InstanceNode.scaleFactor', 'hardening');
  }

  /** Exposed nested instances arrive with nested instances (B-142); none are exposed before. */
  get exposedInstances(): InstanceNode[] {
    live(this);
    return [];
  }

  get isExposedInstance(): boolean {
    live(this);
    return false;
  }

  set isExposedInstance(_value: boolean) {
    unsupported('InstanceNode.isExposedInstance', 'B-142');
  }

  get overrides(): { id: string; overriddenFields: NodeChangeProperty[] }[] {
    return unsupported('InstanceNode.overrides', 'B-125');
  }

  resetOverrides(): void {
    unsupported('InstanceNode.resetOverrides', 'B-125');
  }

  removeOverrides(): void {
    unsupported('InstanceNode.removeOverrides', 'B-125');
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
    state.views.text = this;
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

/** Builds the public node for a state of a scene type; used for instance sublayers and copies. */
export function createView(state: NodeState): void {
  switch (state.type) {
    case 'FRAME':
      new FakeFrameNode(state);
      return;
    case 'COMPONENT':
      new FakeComponentNode(state);
      return;
    case 'COMPONENT_SET':
      new FakeComponentSetNode(state);
      return;
    case 'INSTANCE':
      new FakeInstanceNode(state);
      return;
    case 'SECTION':
      new FakeSectionNode(state);
      return;
    case 'RECTANGLE':
      new FakeRectangleNode(state);
      return;
    case 'ELLIPSE':
      new FakeEllipseNode(state);
      return;
    case 'VECTOR':
      new FakeVectorNode(state);
      return;
    case 'TEXT':
      new FakeTextNode(state);
      return;
    case 'PAGE':
    case 'DOCUMENT':
      throw new Error(`figma-fake internal error: cannot build a ${state.type} view here`);
  }
}

setViewFactory(createView);
