/*
 * `readGroups(node)`: the read-back of a node's managed properties as the seven `ah` groups
 * (06 §6 "ah", 10 §9.1, D-34). `normalizeGroups` from `@holotype/ir` does the rest, so the
 * applied hash, the branch baseline (`base:*`) and the DCR snapshot share one normalizer.
 *
 * Groups use Figma property names. The conventions, which `fixtures/dcr` relies on:
 * - `geom`: `width`, `height`; `x`, `y` only for a node its parent does not place (not auto
 *   layout, or `layoutPositioning: 'ABSOLUTE'`) and that is not a top-level frame or a
 *   variant (its place on the page or in the set is Holotype's grid); `rotation` when not 0.
 * - `layout`: the container fields while auto layout is on; sizing as a child, min/max when
 *   set. An instance's container fields are its main component's, so only its child fields.
 * - `paint`: fills, strokes and stroke geometry, per-corner radii, effects, compositing. A text
 *   node's fills are per range, in `text`; its `paint` keeps only what is not the default. An
 *   instance paints as its main component: changes on it are overrides (15 §4.1).
 * - `text`: content, paragraph and sizing fields; a single style segment is flattened into the
 *   group, several go in `segments`.
 * - `bind`: flat, `field → variable id` (`fills: [id]` per paint), plus
 *   `componentPropertyReferences`. Bindings never appear inside the value they bind. An
 *   instance keeps only its references and its property bindings.
 * - `inst`: the main component id and the instance's property values.
 * - A component set is read as `vis` only: its layout is Holotype's grid and its property
 *   definitions are snapshotted with the set (15 §3.3 `props`).
 *
 * Only members the Plugin API reads synchronously or through its async getters are used, all
 * through the node itself (no `figma` global, 09 §4).
 */
import type { AppliedGroup } from '@holotype/ir';
import {
  aliasIds,
  effectBindings,
  effectJson,
  isAlias,
  type JsonObject,
  paintBindings,
  paintJson,
  toJson,
} from './json';

/** One node's raw read-back: every group present, plain JSON. */
export type ReadGroups = { [G in AppliedGroup]: JsonObject };

/** The style fields of 06 §6 read per text segment. */
const SEGMENT_FIELDS = [
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'fills',
  'textCase',
  'textDecoration',
  'hyperlink',
  'boundVariables',
] as const satisfies (keyof StyledTextSegment)[];

type Segment = Pick<StyledTextSegment, (typeof SEGMENT_FIELDS)[number] | 'characters' | 'start' | 'end'>;

/** Parents whose children are placed by Holotype's grid or the canvas, not by the design. */
const UNPLACED_PARENTS: ReadonlySet<NodeType> = new Set(['DOCUMENT', 'PAGE', 'SECTION', 'COMPONENT_SET']);

/** Reads the seven groups of `node` (06 §6). */
export async function readGroups(node: SceneNode): Promise<ReadGroups> {
  const vis: JsonObject = { name: node.name, visible: node.visible };
  if (node.type === 'COMPONENT_SET') return { geom: {}, layout: {}, paint: {}, text: {}, vis, bind: {}, inst: {} };
  const segments = node.type === 'TEXT' ? textSegments(node) : [];
  return {
    geom: readGeom(node),
    layout: readLayout(node),
    paint: readPaint(node),
    text: node.type === 'TEXT' ? readText(node, segments) : {},
    vis,
    bind: readBind(node, segments),
    inst: node.type === 'INSTANCE' ? await readInstance(node) : {},
  };
}

function textSegments(node: TextNode): Segment[] {
  return node.characters.length === 0 ? [] : node.getStyledTextSegments([...SEGMENT_FIELDS]);
}

/** Whether the design, rather than auto layout or Holotype's grid, decides the node's position. */
function isPlacedFreely(node: SceneNode): boolean {
  const { parent } = node;
  if (parent === null || UNPLACED_PARENTS.has(parent.type)) return false;
  if ('layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE') return true;
  return !('layoutMode' in parent) || parent.layoutMode === 'NONE';
}

function readGeom(node: SceneNode): JsonObject {
  const out: JsonObject = {};
  if ('width' in node) {
    out.width = node.width;
    out.height = node.height;
  }
  if (isPlacedFreely(node)) {
    out.x = node.x;
    out.y = node.y;
  }
  if ('rotation' in node && node.rotation !== 0) out.rotation = node.rotation;
  return out;
}

/** Auto layout container fields (06 §6 `layout`); grid tracks arrive with B-111. */
function readContainer(node: SceneNode & AutoLayoutMixin, out: JsonObject): void {
  out.layoutMode = node.layoutMode;
  if (node.layoutMode !== 'HORIZONTAL' && node.layoutMode !== 'VERTICAL') return;
  out.paddingTop = node.paddingTop;
  out.paddingRight = node.paddingRight;
  out.paddingBottom = node.paddingBottom;
  out.paddingLeft = node.paddingLeft;
  out.itemSpacing = node.itemSpacing;
  out.primaryAxisAlignItems = node.primaryAxisAlignItems;
  out.counterAxisAlignItems = node.counterAxisAlignItems;
  out.strokesIncludedInLayout = node.strokesIncludedInLayout;
  if (node.layoutWrap === 'WRAP') {
    out.layoutWrap = node.layoutWrap;
    out.counterAxisSpacing = node.counterAxisSpacing;
    out.counterAxisAlignContent = node.counterAxisAlignContent;
  }
  if (node.itemReverseZIndex) out.itemReverseZIndex = true;
}

const LIMITS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const;

function readLayout(node: SceneNode): JsonObject {
  const out: JsonObject = {};
  const own = node.type !== 'INSTANCE';
  if (own && 'layoutMode' in node) readContainer(node, out);
  if ('layoutSizingHorizontal' in node) {
    out.layoutSizingHorizontal = node.layoutSizingHorizontal;
    out.layoutSizingVertical = node.layoutSizingVertical;
  }
  if ('layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE') out.layoutPositioning = 'ABSOLUTE';
  if (own && 'minWidth' in node) {
    for (const limit of LIMITS) {
      const value = node[limit];
      if (value !== null) out[limit] = value;
    }
  }
  return out;
}

type StrokedNode = SceneNode & MinimalStrokesMixin;

function readStrokes(node: StrokedNode, out: JsonObject): void {
  out.strokes = node.strokes.map(paintJson);
  if ('strokeWeight' in node && typeof node.strokeWeight === 'number') {
    out.strokeWeight = node.strokeWeight;
  } else if ('strokeTopWeight' in node) {
    out.strokeTopWeight = node.strokeTopWeight;
    out.strokeRightWeight = node.strokeRightWeight;
    out.strokeBottomWeight = node.strokeBottomWeight;
    out.strokeLeftWeight = node.strokeLeftWeight;
  }
  out.strokeAlign = node.strokeAlign;
  if (node.dashPattern.length > 0) out.dashPattern = [...node.dashPattern];
}

function readCorners(node: SceneNode, out: JsonObject): void {
  if ('topLeftRadius' in node) {
    out.topLeftRadius = node.topLeftRadius;
    out.topRightRadius = node.topRightRadius;
    out.bottomLeftRadius = node.bottomLeftRadius;
    out.bottomRightRadius = node.bottomRightRadius;
  } else if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius !== 0) {
    out.cornerRadius = node.cornerRadius;
  }
}

/** For a leaf, `PASS_THROUGH` and `NORMAL` composite the same. */
const LEAF_DEFAULT_BLEND: ReadonlySet<BlendMode> = new Set(['PASS_THROUGH', 'NORMAL']);

/** A text node's paint group: only the stroke, effect and compositing values that are set. */
function readTextPaint(node: TextNode): JsonObject {
  const out: JsonObject = {};
  if (node.strokes.length > 0) readStrokes(node, out);
  if (node.effects.length > 0) out.effects = node.effects.map(effectJson);
  if (node.opacity !== 1) out.opacity = node.opacity;
  if (!LEAF_DEFAULT_BLEND.has(node.blendMode)) out.blendMode = node.blendMode;
  return out;
}

function readPaint(node: SceneNode): JsonObject {
  if (node.type === 'INSTANCE') return {};
  if (node.type === 'TEXT') return readTextPaint(node);
  const out: JsonObject = {};
  if ('fills' in node && typeof node.fills !== 'symbol') out.fills = node.fills.map(paintJson);
  if ('strokes' in node) readStrokes(node, out);
  readCorners(node, out);
  if ('effects' in node) out.effects = node.effects.map(effectJson);
  if ('opacity' in node) {
    out.opacity = node.opacity;
    out.blendMode = node.blendMode;
  }
  if ('clipsContent' in node) out.clipsContent = node.clipsContent;
  return out;
}

/** The style of one segment, without its bindings. */
function segmentStyle(source: Segment): JsonObject {
  const out: JsonObject = {
    fontName: toJson(source.fontName),
    fontSize: source.fontSize,
    lineHeight: toJson(source.lineHeight),
    letterSpacing: toJson(source.letterSpacing),
    fills: source.fills.map(paintJson),
    textCase: source.textCase,
    textDecoration: source.textDecoration,
  };
  if (source.hyperlink !== null) out.hyperlink = toJson(source.hyperlink);
  return out;
}

const EMPTY_TEXT_FIELDS = [
  'fontName',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
] as const;

/**
 * The style of an empty text, which has no segments: its node-level values (never mixed
 * without characters; a mixed one is left out rather than guessed). It has no characters to
 * link, so no `hyperlink`.
 */
function emptyTextStyle(node: TextNode): JsonObject {
  const out: JsonObject = {};
  for (const field of EMPTY_TEXT_FIELDS) {
    const value = node[field];
    if (typeof value !== 'symbol') out[field] = toJson(value);
  }
  if (typeof node.fills !== 'symbol') out.fills = node.fills.map(paintJson);
  return out;
}

function readText(node: TextNode, segments: readonly Segment[]): JsonObject {
  const [first] = segments;
  const out: JsonObject = {
    characters: node.characters,
    ...(segments.length > 1 ? {} : first ? segmentStyle(first) : emptyTextStyle(node)),
    textAutoResize: node.textAutoResize,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
  };
  if (segments.length > 1) {
    out.segments = segments.map((segment) => ({ start: segment.start, end: segment.end, ...segmentStyle(segment) }));
  }
  if (node.textTruncation !== 'DISABLED') out.textTruncation = node.textTruncation;
  if (node.maxLines !== null) out.maxLines = node.maxLines;
  return out;
}

/** A segment's bindings: its text fields and its fills' colors. */
function segmentBindings(segment: Segment): JsonObject {
  const out = aliasIds(segment.boundVariables ?? {});
  const fills = paintBindings(segment.fills);
  if (fills) out.fills = fills;
  return out;
}

/** Node-level binding keys read from elsewhere: paints and text ranges carry their own. */
const PER_VALUE_BINDINGS: ReadonlySet<string> = new Set(['fills', 'strokes', 'effects', 'textRangeFills']);

function readBind(node: SceneNode, segments: readonly Segment[]): JsonObject {
  const out: JsonObject = {};
  const references = node.componentPropertyReferences;
  if (references && Object.keys(references).length > 0) out.componentPropertyReferences = toJson(references);
  for (const [field, value] of Object.entries(node.boundVariables ?? {})) {
    if (node.type === 'INSTANCE' ? field !== 'componentProperties' : PER_VALUE_BINDINGS.has(field)) continue;
    if (isAlias(value)) out[field] = value.id;
    else if (field === 'componentProperties' && value) out.componentProperties = aliasIds(value);
  }
  // An instance's other bindings are its main component's (see `paint`).
  if (node.type === 'INSTANCE') return out;
  if (node.type === 'TEXT') {
    const bound = segments.map(segmentBindings);
    if (bound.length === 1 && bound[0]) Object.assign(out, bound[0]);
    else if (bound.some((item) => Object.keys(item).length > 0)) out.segments = bound;
  } else if ('fills' in node && typeof node.fills !== 'symbol') {
    const fills = paintBindings(node.fills);
    if (fills) out.fills = fills;
  }
  if ('strokes' in node) {
    const strokes = paintBindings(node.strokes);
    if (strokes) out.strokes = strokes;
  }
  if ('effects' in node) {
    const effects = effectBindings(node.effects);
    if (effects) out.effects = effects;
  }
  return out;
}

async function readInstance(node: InstanceNode): Promise<JsonObject> {
  const main = await node.getMainComponentAsync();
  const properties: JsonObject = {};
  for (const [name, property] of Object.entries(node.componentProperties)) properties[name] = property.value;
  return { mainComponent: main?.id ?? null, componentProperties: properties };
}
