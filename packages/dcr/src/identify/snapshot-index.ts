import type { JsonValue } from '@holotype/ir';
import type { FigmaSnapshot, SnapNode } from '../schema';
import { compareStrings, isObject, parseJson } from './json';

/*
 * Read-only lookups over a `FigmaSnapshot` (15 §4.1). Canonical tree order is the one order
 * a shuffled snapshot cannot change: pages by id, their top-level nodes by id, then layer
 * order (`children`, which is meaningful and never shuffled). "The earlier one in canonical
 * order" of 15 §4.2 means the earlier one here.
 */

/** A top-level node with its page. */
export interface TopLevel {
  readonly node: SnapNode;
  readonly page: { readonly id: string; readonly name: string };
}

/** The `src` plugin data of a managed set (10 §2.1). */
export interface SetSource {
  readonly title?: string;
  /** `index.json` `importPath`: the CSF file. */
  readonly storiesPath?: string;
  /** The component module. */
  readonly componentPath?: string;
  readonly exportName?: string;
}

/** One variant axis of a managed set, from its `axes` plugin data (10 §2.1). */
export interface SetAxis {
  readonly name: string;
  /** `arg:size`, or a story axis key such as `story`. */
  readonly key: string;
  readonly values: readonly string[];
}

export class SnapshotIndex {
  readonly snapshot: FigmaSnapshot;
  private readonly order = new Map<string, number>();
  private readonly tops: TopLevel[] = [];

  constructor(snapshot: FigmaSnapshot) {
    this.snapshot = snapshot;
    const pages = [...snapshot.pages].sort((a, b) => compareStrings(a.id, b.id));
    for (const page of pages) {
      for (const id of [...page.topLevel].sort(compareStrings)) {
        const node = snapshot.nodes[id];
        if (!node) continue;
        this.tops.push({ node, page: { id: page.id, name: page.name } });
        for (const visited of this.preorder(id)) this.order.set(visited.id, this.order.size);
      }
    }
  }

  node(id: string | undefined): SnapNode | undefined {
    return id === undefined ? undefined : this.snapshot.nodes[id];
  }

  /** Top-level nodes in canonical order. */
  topLevel(): readonly TopLevel[] {
    return this.tops;
  }

  /** The node's children that are in the snapshot, in layer order. */
  children(node: SnapNode): SnapNode[] {
    return (node.children ?? []).flatMap((id) => {
      const child = this.snapshot.nodes[id];
      return child ? [child] : [];
    });
  }

  /** The subtree of `id` in pre-order (layer order), the node first. */
  preorder(id: string): SnapNode[] {
    const out: SnapNode[] = [];
    const visit = (node: SnapNode | undefined) => {
      if (!node) return;
      out.push(node);
      for (const child of this.children(node)) visit(child);
    };
    visit(this.snapshot.nodes[id]);
    return out;
  }

  /** Position in canonical tree order; nodes outside the pages sort last, by id. */
  position(node: SnapNode): number {
    return this.order.get(node.id) ?? Number.MAX_SAFE_INTEGER;
  }

  parent(node: SnapNode): SnapNode | undefined {
    return this.node(node.parent);
  }

  /** Whether the node or one of its ancestors is locked (`holotype/lock`, 10 §9.4). */
  isLocked(node: SnapNode): boolean {
    for (let current: SnapNode | undefined = node; current; current = this.parent(current)) {
      if (current.data.lock === '1') return true;
    }
    return false;
  }

  /** A managed set's `src` plugin data. */
  source(set: SnapNode): SetSource {
    const src = parseJson(set.data.src);
    if (!isObject(src)) return {};
    const text = (key: string) => (typeof src[key] === 'string' ? (src[key] as string) : undefined);
    const out: { -readonly [K in keyof SetSource]?: string } = {};
    const title = text('title');
    const storiesPath = text('importPath');
    const componentPath = text('componentPath');
    const exportName = text('exportName');
    if (title !== undefined) out.title = title;
    if (storiesPath !== undefined) out.storiesPath = storiesPath;
    if (componentPath !== undefined) out.componentPath = componentPath;
    if (exportName !== undefined) out.exportName = exportName;
    return out;
  }

  /** A managed set's axes, in Figma order. */
  axes(set: SnapNode): SetAxis[] {
    const axes = parseJson(set.data.axes);
    if (!Array.isArray(axes)) return [];
    return axes.flatMap((axis) => {
      if (!isObject(axis) || typeof axis.name !== 'string' || typeof axis.key !== 'string') return [];
      const values = Array.isArray(axis.values) ? axis.values.filter((v): v is string => typeof v === 'string') : [];
      return [{ name: axis.name, key: axis.key, values }];
    });
  }

  /** A managed set's `props` plugin data: Holotype property key → Figma property id (10 §2.1). */
  propertyIds(set: SnapNode): Map<string, string> {
    const props = parseJson(set.data.props);
    const out = new Map<string, string>();
    if (!isObject(props)) return out;
    for (const key of Object.keys(props).sort(compareStrings)) {
      const id = props[key];
      if (typeof id === 'string') out.set(key, id);
    }
    return out;
  }

  /** A variant's `args` plugin data (`{ args, globals }`, 10 §2.1): its story args. */
  args(variant: SnapNode): Record<string, JsonValue> {
    const parsed = parseJson(variant.data.args);
    const args = isObject(parsed) ? parsed.args : undefined;
    return isObject(args) ? args : {};
  }
}
