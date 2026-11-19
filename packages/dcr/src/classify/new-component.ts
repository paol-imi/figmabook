import type { JsonValue } from '@holotype/ir';
import { field, isObject, sortedKeys } from '../identify/json';
import type { SetSource, SnapshotIndex } from '../identify/snapshot-index';
import type { DcrItemOf, SnapNode } from '../schema';
import type { ExtractContext, ItemDraft } from './context';
import { pascalCase } from './text';
import { defaultVariant, propertyName, UsageBuilder } from './usage';

/*
 * `component.new` (15 §4.4): a local component or set without `holotype/sid`. The item holds
 * its structure (the usage tree of the default variant), the API it proposes (its variant
 * axes and properties) and where it would live in code, mirroring an existing component's
 * layout. Nearest-component scoring and the snippet are added by the screens and render
 * stages (15 §4.8, §7.3).
 */

type ComponentApi = DcrItemOf<'component.new'>['api'];
type PropertyType = ComponentApi['properties'][number]['type'];

/** The path key of a new component: page, sections and its own name (`Components/Product card`). */
export function componentKey(index: SnapshotIndex, node: SnapNode, page: string): string {
  const names = [node.name];
  for (let parent = index.parent(node); parent; parent = index.parent(parent)) names.unshift(parent.name);
  return [page, ...names].join('/');
}

function apiOf(node: SnapNode): ComponentApi {
  const defs = node.component?.propertyDefs;
  const api: ComponentApi = { axes: [], properties: [] };
  if (!isObject(defs)) return api;
  for (const id of sortedKeys(defs)) {
    const def = defs[id];
    const type = field(def, 'type');
    const fallback: JsonValue | undefined = field(def, 'defaultValue');
    if (type === 'VARIANT') {
      const options = field(def, 'variantOptions');
      const values = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [];
      api.axes.push({ name: id, values, default: typeof fallback === 'string' ? fallback : (values[0] ?? '') });
    } else if (typeof type === 'string') {
      api.properties.push({
        name: propertyName(id),
        type: type as PropertyType,
        ...(fallback === undefined ? {} : { default: fallback }),
      });
    }
  }
  api.properties.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return api;
}

const extension = (path: string): string => /(\.[^./]+)$/.exec(path)?.[1] ?? '';
const parentDir = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Where the new component would live: the reference component's layout with the new name
 * (`src/components/Card/Card.tsx` → `src/components/ProductCard/ProductCard.tsx`), plus a CSS
 * module and a stories file next to it (the React + Vite slice convention).
 */
export function suggestedFiles(exportName: string, reference: SetSource | undefined) {
  const component = reference?.componentPath;
  if (component === undefined || reference?.exportName === undefined) return undefined;
  const dir = parentDir(component);
  const ownFolder = baseName(dir) === reference.exportName;
  const root = ownFolder ? parentDir(dir) : dir;
  const target = ownFolder ? (root.length > 0 ? `${root}/${exportName}` : exportName) : dir;
  if (target.length === 0) return undefined;
  const stories = reference.storiesPath === undefined ? '.stories.tsx' : `.stories${extension(reference.storiesPath)}`;
  return {
    exportName,
    dir: target,
    files: [`${exportName}${extension(component) || '.tsx'}`, `${exportName}.module.css`, `${exportName}${stories}`],
  };
}

export function newComponent(
  ctx: ExtractContext,
  node: SnapNode,
  key: string,
  reference: SetSource | undefined,
): ItemDraft {
  const root = node.type === 'COMPONENT_SET' ? (defaultVariant(ctx, node) ?? node) : node;
  const usage = new UsageBuilder(ctx);
  const structure = [usage.build(root, `${node.name}:0`)];
  const suggested = suggestedFiles(pascalCase(node.name), reference);
  const { diagnostics, questions } = usage.findings;
  return {
    item: {
      kind: 'component.new',
      title: `New component "${node.name}"`,
      designerTitle: `New component ${node.name}`,
      target: { key, figmaNodeId: node.id },
      structure,
      api: apiOf(node),
      ...(suggested === undefined ? {} : { suggested }),
      acceptance: { type: 'structure', story: 'must-add', visual: { sMaskedMin: 0.97, boxDeltaMax: 1 } },
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    },
    before: false,
    questions,
    headline: `New component ${node.name}`,
  };
}
