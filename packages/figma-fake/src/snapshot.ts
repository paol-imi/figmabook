import { definitionsOf, ownerOf, referencesOf, variantPropertiesOf } from './components/properties';
import { fullName } from './components/types';
import type { FakeContext } from './context';
import { newState } from './defaults';
import { type JsonValue, jsonEqual, toJson } from './json';
import { sizingOf } from './nodes/layout';
import type { FakeNodeType, NodeState } from './state';
import { DEFAULT_CHAR_STYLE, type StyleField } from './text-model';
import { collectionJson } from './variables/store';

/** One node in a snapshot: identity first, then every property that differs from a new node of its type. */
export interface FakeNodeSnapshot {
  readonly id: string;
  readonly type: FakeNodeType;
  readonly name: string;
  readonly [property: string]: JsonValue;
}

/** A canonical JSON view of the whole fake document, for L3 snapshot tests (12 §1.1). */
export interface FakeTree {
  readonly document: FakeNodeSnapshot;
  readonly currentPage: string;
  /** Hashes of images created with `createImage`, sorted. */
  readonly images: readonly string[];
  /** Local variable collections and variables, in creation order; absent when there are none. */
  readonly variables?: { readonly collections: readonly JsonValue[]; readonly variables: readonly JsonValue[] };
}

const SCENE = ['visible', 'locked', 'exportSettings'];
const LAYOUT_CHILD = [
  'layoutAlign',
  'layoutGrow',
  'layoutPositioning',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'constrainProportions',
  'constraints',
  'targetAspectRatio',
  'annotations',
];
const BLEND = ['opacity', 'blendMode', 'isMask', 'maskType', 'effects'];
const FILLS = ['fills'];
const STROKES = [
  'strokes',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'strokeAlign',
  'strokeJoin',
  'dashPattern',
];
const GEOMETRY = [...FILLS, ...STROKES, 'strokeCap', 'strokeMiterLimit'];
const CORNERS = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius', 'cornerSmoothing'];
const FRAME = [
  ...SCENE,
  ...LAYOUT_CHILD,
  ...BLEND,
  ...GEOMETRY,
  ...CORNERS,
  'devStatus',
  'clipsContent',
  'expanded',
  'guides',
  'layoutGrids',
  'layoutMode',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'itemSpacing',
  'counterAxisSpacing',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'counterAxisAlignContent',
  'layoutWrap',
  'itemReverseZIndex',
  'strokesIncludedInLayout',
];
const PUBLISHABLE = ['description', 'descriptionMarkdown', 'documentationLinks'];
const SHAPE = [...SCENE, ...LAYOUT_CHILD, ...BLEND, ...GEOMETRY];

/** Which state fields each node type exposes, following the typings' mixin lists. */
const FIELDS: Readonly<Record<FakeNodeType, readonly string[]>> = {
  DOCUMENT: [],
  PAGE: ['pageBackgrounds', 'prototypeBackgrounds', 'guides', 'exportSettings'],
  FRAME,
  COMPONENT: [...FRAME, ...PUBLISHABLE],
  COMPONENT_SET: [...FRAME, ...PUBLISHABLE],
  INSTANCE: FRAME,
  SECTION: [...SCENE, ...FILLS, ...STROKES, ...CORNERS, 'devStatus', 'targetAspectRatio', 'sectionContentsHidden'],
  RECTANGLE: [...SHAPE, ...CORNERS],
  ELLIPSE: [...SHAPE, ...CORNERS, 'arcData'],
  VECTOR: [...SHAPE, ...CORNERS, 'vectorPaths', 'handleMirroring'],
  TEXT: [
    ...SHAPE.filter((field) => field !== 'fills'),
    'textAlignHorizontal',
    'textAlignVertical',
    'textAutoResize',
    'textTruncation',
    'maxLines',
    'autoRename',
    'paragraphIndent',
    'paragraphSpacing',
    'listSpacing',
    'hangingPunctuation',
    'hangingList',
    'leadingTrim',
    'textWrapStyle',
  ],
};

/** Output names for fields stored under another name. */
const RENAMED: Readonly<Record<string, string>> = { pageBackgrounds: 'backgrounds' };

const STYLE_FIELDS = Object.keys(DEFAULT_CHAR_STYLE).filter((key): key is StyleField => key in DEFAULT_CHAR_STYLE);

function pluginDataJson(state: NodeState): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  if (state.pluginData.size > 0) out.pluginData = toJson(Object.fromEntries(state.pluginData));
  if (state.sharedPluginData.size > 0) {
    const shared: Record<string, JsonValue> = {};
    for (const [namespace, entries] of state.sharedPluginData) shared[namespace] = toJson(Object.fromEntries(entries));
    out.sharedPluginData = toJson(shared);
  }
  if (Object.keys(state.relaunchData).length > 0) out.relaunchData = toJson(state.relaunchData);
  return out;
}

/** Text as runs of equal style, each listing only the fields that differ from a new text node. */
function textJson(state: NodeState): Record<string, JsonValue> {
  const text = state.text;
  if (!text) return {};
  const diff = (style: (typeof text.styles)[number]): Record<string, JsonValue> => {
    const out: Record<string, JsonValue> = {};
    for (const field of STYLE_FIELDS) {
      if (!jsonEqual(style[field], DEFAULT_CHAR_STYLE[field])) out[field] = toJson(style[field]);
    }
    return out;
  };
  if (text.characters.length === 0) return { characters: '', textStyle: [diff(text.base)] };
  const runs = text.segments(STYLE_FIELDS, 0, text.characters.length);
  return {
    characters: text.characters,
    textStyle: runs.map((run) => ({ start: run.start, end: run.end, ...diff(text.styleAt(run.start)) })),
  };
}

/**
 * Component and variable state: an instance's main component and the property values set on it,
 * a component's stored property definitions, a layer's property references, and its field
 * bindings (variable ids).
 */
function componentJson(state: NodeState): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  if (state.type === 'INSTANCE' && state.mainComponent) {
    out.mainComponent = state.mainComponent.id;
    const owner = ownerOf(state.mainComponent);
    const values: Record<string, JsonValue> = {};
    for (const [id, value] of state.propertyValues) {
      const def = owner.propertyDefs.get(id);
      if (def) values[fullName(def)] = toJson(value);
    }
    if (Object.keys(values).length > 0) out.componentProperties = values;
  }
  if ((state.type === 'COMPONENT' || state.type === 'COMPONENT_SET') && state.propertyDefs.size > 0) {
    const defs = definitionsOf(state);
    out.componentPropertyDefinitions = toJson(
      Object.fromEntries(Object.entries(defs).filter(([, def]) => def.type !== 'VARIANT')),
    );
  }
  const refs = state.propertyRefs ? referencesOf(state) : null;
  if (refs && Object.keys(refs).length > 0) out.componentPropertyReferences = toJson(refs);
  if (state.bindings.size > 0) {
    out.boundVariables = toJson(Object.fromEntries([...state.bindings].map(([field, alias]) => [field, alias.id])));
  }
  return out;
}

/**
 * Serializes the document. Every node lists `id`, `type`, `name`, then its geometry, plugin
 * data and each property whose value differs from a freshly created node of the same type in
 * sorted key order, then `children`. `JSON.stringify(snapshot())` is canonical: the same
 * document always gives the same bytes.
 */
export function snapshotTree(ctx: FakeContext): FakeTree {
  const pristine = new Map<FakeNodeType, NodeState>();
  const defaultsOf = (type: FakeNodeType): NodeState => {
    const existing = pristine.get(type);
    if (existing) return existing;
    const fresh = newState(ctx, type, '', '');
    pristine.set(type, fresh);
    return fresh;
  };

  const nodeJson = (state: NodeState): FakeNodeSnapshot => {
    const base = defaultsOf(state.type);
    const props: Record<string, JsonValue> = {};
    const isScene = state.type !== 'DOCUMENT' && state.type !== 'PAGE';
    if (isScene) {
      props.x = state.x;
      props.y = state.y;
      props.width = state.width;
      props.height = state.height;
      const [[a, b], [c, d]] = state.transform;
      if (a !== 1 || b !== 0 || c !== 0 || d !== 1) props.relativeTransform = toJson(state.transform);
    }
    for (const field of FIELDS[state.type]) {
      const value: unknown = Reflect.get(state, field);
      if (!jsonEqual(value, Reflect.get(base, field))) props[RENAMED[field] ?? field] = toJson(value);
    }
    if (isScene && state.type !== 'SECTION') {
      for (const [axis, name] of [
        ['h', 'layoutSizingHorizontal'],
        ['v', 'layoutSizingVertical'],
      ] as const) {
        const sizing = sizingOf(state, axis);
        if (sizing !== 'FIXED') props[name] = sizing;
      }
    }
    const variant = state.type === 'COMPONENT' ? variantPropertiesOf(state) : null;
    if (variant) props.variantProperties = toJson(variant);
    Object.assign(props, textJson(state), pluginDataJson(state), componentJson(state));
    if (state.type === 'PAGE' && !state.loaded) props.loaded = false;
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(props).sort()) sorted[key] = props[key] ?? null;
    const hasChildren = state.children.length > 0 || state.type === 'DOCUMENT' || state.type === 'PAGE';
    if (hasChildren) sorted.children = state.children.map(nodeJson);
    return { id: state.id, type: state.type, name: state.name, ...sorted };
  };

  const collections = ctx.variables.liveCollections();
  return {
    document: nodeJson(ctx.root),
    currentPage: ctx.currentPage.id,
    images: [...ctx.images.keys()].sort(),
    ...(collections.length > 0
      ? {
          variables: {
            collections: collections.map((collection) => toJson(collectionJson(collection))),
            variables: ctx.variables.liveVariables().map((variable) => toJson(variable.snapshotJson())),
          },
        }
      : {}),
  };
}
