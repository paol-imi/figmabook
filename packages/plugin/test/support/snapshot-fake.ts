/*
 * Builds the component sets of a `fixtures/dcr` snapshot (15 §4.1 `FigmaSnapshot`) in the fake,
 * from their read-back groups, so a test can read them back with `readGroups` and compare. The
 * groups use Figma property names (06 §6), so most fields are plain property writes; the order
 * of the writes follows the applier's (09 §6): container before children, sizing after the
 * parent has auto layout, text content before its sizing, bindings before sizing modes.
 *
 * Ids differ in the fake. `Built.toFixture` maps the fake's variable ids, node ids and
 * component property names back to the snapshot's, for comparison.
 */
import { readFileSync } from 'node:fs';
import type { JsonValue } from '@holotype/ir';
import type { FakeFigma } from './fake';

type Json = JsonValue;
type JsonObject = { [key: string]: Json };

export interface SnapNode {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly parent?: string;
  readonly children?: readonly string[];
  readonly data: Readonly<Record<string, string>>;
  readonly groups: Readonly<Record<string, JsonObject>>;
  readonly component?: { readonly propertyDefs?: Readonly<Record<string, JsonObject>> };
  readonly instance?: { readonly mainId?: string };
}

export interface Snapshot {
  readonly pages: ReadonlyArray<{ readonly topLevel: readonly string[] }>;
  readonly nodes: Readonly<Record<string, SnapNode>>;
  readonly variables: Readonly<
    Record<string, { readonly name: string; readonly resolvedType: string; readonly valuesByMode: JsonObject }>
  >;
}

/** Reads `fixtures/dcr/<name>/branch.json`. */
export function loadSnapshot(name: string): Snapshot {
  const url = new URL(`../../../../fixtures/dcr/${name}/branch.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Snapshot;
}

export interface Built {
  /** Fake node per snapshot node id, for every node of the built sets. */
  readonly nodes: ReadonlyMap<string, SceneNode>;
  /** Replaces the fake's ids and property names in a value by the snapshot's. */
  readonly toFixture: (value: Json) => Json;
}

const CONTAINER_FIRST = 'layoutMode';
const CHILD_LAYOUT = new Set(['layoutSizingHorizontal', 'layoutSizingVertical', 'layoutPositioning']);
const TEXT_FIRST = ['fontName', 'characters'];
const TEXT_LAST = ['textAutoResize', 'textTruncation', 'maxLines'];

const objectOf = (value: Json | undefined): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};

export async function buildSnapshot(figma: FakeFigma, snapshot: Snapshot, roots: readonly string[]): Promise<Built> {
  const page = figma.currentPage;
  const nodes = new Map<string, SceneNode>();
  const variables = new Map<string, Variable>();
  const back = new Map<string, string>();
  const propertyNames = new Map<string, string>();

  // Variables, one collection, one mode.
  const collection = figma.variables.createVariableCollection('Tokens');
  for (const [id, source] of Object.entries(snapshot.variables)) {
    const variable = figma.variables.createVariable(
      source.name,
      collection,
      source.resolvedType as VariableResolvedDataType,
    );
    variables.set(id, variable);
    back.set(variable.id, id);
  }
  // Values once every variable exists: a snapshot alias is `{ alias: <variable id> }`.
  for (const [id, source] of Object.entries(snapshot.variables)) {
    const [value] = Object.values(source.valuesByMode);
    const alias = objectOf(value).alias;
    const target = typeof alias === 'string' ? variables.get(alias) : undefined;
    variables
      .get(id)
      ?.setValueForMode(
        collection.defaultModeId,
        target ? figma.variables.createVariableAlias(target) : (value as VariableValue),
      );
  }
  const variable = (id: Json): Variable => {
    const found = typeof id === 'string' ? variables.get(id) : undefined;
    if (!found) throw new Error(`No variable ${String(id)} in the snapshot`);
    return found;
  };

  for (const node of Object.values(snapshot.nodes)) {
    const font = node.groups.text?.fontName;
    if (font) await figma.loadFontAsync(font as unknown as FontName);
  }

  /** A main component outside the built sets (an icon): an empty component of the same size. */
  const standIn = (id: string, groups: Readonly<Record<string, JsonObject>>): ComponentNode => {
    const main = figma.createComponent();
    main.resizeWithoutConstraints(Number(groups.geom?.width ?? 16), Number(groups.geom?.height ?? 16));
    nodes.set(id, main as SceneNode);
    back.set(main.id, id);
    return main;
  };

  const writeText = (node: TextNode, text: JsonObject): void => {
    node.fontName = text.fontName as unknown as FontName;
    node.characters = String(text.characters ?? '');
    for (const [key, value] of Object.entries(text)) {
      if (TEXT_FIRST.includes(key) || TEXT_LAST.includes(key)) continue;
      Reflect.set(node, key, value);
    }
    for (const key of TEXT_LAST) if (key in text) Reflect.set(node, key, text[key]);
  };

  const bindPaints = (paints: Json, ids: Json): Paint[] =>
    (paints as unknown as Paint[]).map((paint, i) => {
      const id = Array.isArray(ids) ? ids[i] : null;
      return id && paint.type === 'SOLID'
        ? figma.variables.setBoundVariableForPaint(paint, 'color', variable(id))
        : paint;
    });

  const writeBindings = (node: SceneNode, groups: Readonly<Record<string, JsonObject>>): void => {
    const bind = groups.bind ?? {};
    for (const [field, id] of Object.entries(bind)) {
      if (field === 'componentPropertyReferences') continue;
      if (field === 'fills') {
        const paints = node.type === 'TEXT' ? groups.text?.fills : groups.paint?.fills;
        (node as GeometryMixin).fills = bindPaints(paints ?? [], id);
      } else if (field === 'strokes') {
        (node as MinimalStrokesMixin).strokes = bindPaints(groups.paint?.strokes ?? [], id);
      } else {
        node.setBoundVariable(field as VariableBindableNodeField, variable(id));
      }
    }
  };

  const build = (id: string, parent: BaseNode & ChildrenMixin): SceneNode => {
    const source = snapshot.nodes[id];
    if (!source) throw new Error(`No node ${id} in the snapshot`);
    const { groups } = source;
    let node: SceneNode;
    if (source.type === 'INSTANCE') {
      const mainId = source.instance?.mainId ?? String(groups.inst?.mainComponent);
      const main = nodes.get(mainId) ?? standIn(mainId, groups);
      node = (main as ComponentNode).createInstance();
    } else if (source.type === 'TEXT') {
      node = figma.createText();
    } else if (source.type === 'COMPONENT') {
      node = figma.createComponent();
    } else {
      node = figma.createFrame();
    }
    parent.appendChild(node);
    nodes.set(id, node);
    back.set(node.id, id);
    const layout = groups.layout ?? {};
    if (node.type !== 'INSTANCE') {
      if (CONTAINER_FIRST in layout) Reflect.set(node, CONTAINER_FIRST, layout[CONTAINER_FIRST]);
      for (const [key, value] of Object.entries(layout)) {
        if (key !== CONTAINER_FIRST && !CHILD_LAYOUT.has(key)) Reflect.set(node, key, value);
      }
      for (const [key, value] of Object.entries(groups.paint ?? {})) Reflect.set(node, key, value);
    }
    if (node.type === 'TEXT') {
      writeText(node, groups.text ?? {});
      if (groups.text?.textAutoResize !== 'WIDTH_AND_HEIGHT') {
        node.resize(Number(groups.geom?.width), Number(groups.geom?.height));
      }
    } else {
      (node as FrameNode).resizeWithoutConstraints(Number(groups.geom?.width), Number(groups.geom?.height));
    }
    // A bound width or height resizes the node, which fixes both axes: sizing comes after.
    writeBindings(node, groups);
    for (const key of CHILD_LAYOUT) if (key in layout) Reflect.set(node, key, layout[key]);
    node.name = source.name;
    for (const child of source.children ?? []) build(child, node as unknown as BaseNode & ChildrenMixin);
    node.visible = groups.vis?.visible !== false;
    return node;
  };

  /** Second pass, once every property exists: references, instance properties, visibility. */
  const finish = (id: string): void => {
    const source = snapshot.nodes[id];
    const node = nodes.get(id);
    if (!source || !node) return;
    const references = objectOf(source.groups.bind?.componentPropertyReferences);
    if (Object.keys(references).length > 0) {
      node.componentPropertyReferences = Object.fromEntries(
        Object.entries(references).map(([field, name]) => [field, propertyNames.get(String(name)) ?? String(name)]),
      );
    }
    if (node.type === 'INSTANCE') {
      const values = objectOf(source.groups.inst?.componentProperties);
      node.setProperties(
        Object.fromEntries(
          Object.entries(values).map(([name, value]) => [propertyNames.get(name) ?? name, value as string | boolean]),
        ),
      );
    }
    node.visible = source.groups.vis?.visible !== false;
    for (const child of source.children ?? []) finish(child);
  };

  for (const rootId of roots) {
    const root = snapshot.nodes[rootId];
    if (root?.type !== 'COMPONENT_SET') throw new Error(`${rootId} is not a component set`);
    const variants = (root.children ?? []).map((child) => build(child, page) as ComponentNode);
    const set = figma.combineAsVariants(variants, page);
    set.name = root.name;
    nodes.set(rootId, set);
    back.set(set.id, rootId);
    for (const [name, def] of Object.entries(root.component?.propertyDefs ?? {})) {
      if (def.type === 'VARIANT') continue;
      const [base = name] = name.split('#');
      const created = set.addComponentProperty(
        base,
        def.type as ComponentPropertyType,
        def.defaultValue as string | boolean,
      );
      propertyNames.set(name, created);
      back.set(created, name);
    }
    for (const child of root.children ?? []) finish(child);
  }

  const toFixture = (value: Json): Json => {
    if (typeof value === 'string') return back.get(value) ?? value;
    if (Array.isArray(value)) return value.map(toFixture);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [back.get(key) ?? key, toFixture(item)]));
  };
  return { nodes, toFixture };
}
