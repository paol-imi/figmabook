import type { CNode } from '@holotype/ir';
import { sourceElement, type WorkNode, walkWork } from '../state';
import { semanticClass } from './classes';

/*
 * Node keys (`nk`, 10 §4, 07 §13.3): a path of segments from `root`. A segment is, in order,
 * the explicit key (`data-holotype-key`), the test id, the framework component boundary,
 * the ARIA role or label, or else the path signature `<tag>.<first semantic class>`.
 * Rect values never enter a key, so the same DOM structure always gets the same keys.
 * Repeated segments among siblings get `#2`, `#3` in DOM order; `#` cannot occur in a
 * segment, so a suffixed key never collides with another layer's key, and any key that is
 * still taken in the variant gets the next free suffix.
 */

export interface KeyContext {
  /** Capture node id → display name, for nodes that are a framework component's root. */
  readonly boundaries: ReadonlyMap<string, string>;
  readonly keepClass: (className: string) => boolean;
}

export const ROOT_KEY = 'root';

/** `StarIcon` → `star-icon`, `btn_label` → `btn-label`; letters outside a–z, 0–9 are dropped. */
export function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tagSlug(node: CNode): string {
  const tag = node.source.pseudo ?? node.source.tag.replace(/^[#:]+/, '');
  return kebab(tag) || 'node';
}

/** The path signature of 10 §4 rule 3.5: `<tag>` or `<tag>.<class>`. */
export function pathSignature(node: CNode, keepClass: (className: string) => boolean): string {
  const className = semanticClass(node.source.classes, keepClass);
  const cleanClass = className?.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleanClass ? `${tagSlug(node)}.${cleanClass}` : tagSlug(node);
}

/** The key segment of one node, before sibling disambiguation. */
export function keySegment(node: CNode, context: KeyContext): string {
  const { source } = node;
  const anchors = [source.figmaKey, source.testId, context.boundaries.get(node.id), source.role, source.ariaLabel];
  for (const anchor of anchors) {
    const slug = anchor === undefined ? '' : kebab(anchor);
    if (slug !== '') return slug;
  }
  return pathSignature(node, context.keepClass);
}

/** The children a node has for keys: the layers it had before hoisting, in DOM order (10 §4). */
function logicalChildren(node: WorkNode, hoisted: ReadonlyMap<WorkNode, WorkNode[]>): WorkNode[] {
  const own = node.children.filter((child) => child.synthetic === undefined && child.hoistedFrom === undefined);
  return [...own, ...(hoisted.get(node) ?? [])].sort(
    (a, b) => sourceElement(a).paint.domIndex - sourceElement(b).paint.domIndex,
  );
}

/** `key`, or `key#2`, `key#3`… when another layer of the variant already has it. */
function unique(key: string, taken: Set<string>): string {
  let candidate = key;
  for (let n = 2; taken.has(candidate); n++) candidate = `${key}#${n}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Sets `nk` on every node of a variant tree. Keys follow the DOM structure, so a hoisted
 * layer keeps the key of its original path (07 §7.3), and a text layer that replaced its
 * element (07 §11 rule 3) takes the element's segment. A synthetic layer is its owner's key
 * plus its role (`root/card/bg`).
 */
export function assignKeys(root: WorkNode, context: KeyContext): void {
  const all = [...walkWork(root)];
  const hoisted = new Map<WorkNode, WorkNode[]>();
  for (const node of all) {
    if (node.hoistedFrom === undefined) continue;
    hoisted.set(node.hoistedFrom.parent, [...(hoisted.get(node.hoistedFrom.parent) ?? []), node]);
  }
  const taken = new Set<string>([ROOT_KEY]);
  root.nk = ROOT_KEY;
  const visit = (node: WorkNode): void => {
    const seen = new Map<string, number>();
    for (const child of logicalChildren(node, hoisted)) {
      const segment = keySegment(sourceElement(child), context);
      const count = (seen.get(segment) ?? 0) + 1;
      seen.set(segment, count);
      child.nk = unique(`${node.nk}/${count === 1 ? segment : `${segment}#${count}`}`, taken);
      visit(child);
    }
  };
  visit(root);
  const owners = new Map<CNode, WorkNode>();
  for (const node of all) if (node.synthetic === undefined) owners.set(node.capture, node);
  for (const node of all) {
    if (node.synthetic === undefined) continue;
    const owner = owners.get(node.capture);
    node.nk = unique(`${owner?.nk ?? ROOT_KEY}/${node.synthetic}`, taken);
  }
}
