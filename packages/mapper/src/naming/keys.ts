import type { CNode } from '@holotype/ir';
import type { WorkNode } from '../state';
import { semanticClass } from './classes';

/*
 * Node keys (`nk`, 10 §4, 07 §13.3): a path of segments from `root`. A segment is, in order,
 * the explicit key (`data-holotype-key`), the test id, the framework component boundary,
 * the ARIA role or label, or else the path signature `<tag>.<first semantic class>`.
 * Rect values never enter a key, so the same DOM structure always gets the same keys.
 * Repeated segments among siblings get `#2`, `#3` in child order; `#` cannot occur in a
 * segment, so a suffixed key never collides with another layer's key.
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

/** Sets `nk` on every node of a variant tree. */
export function assignKeys(root: WorkNode, context: KeyContext): void {
  root.nk = ROOT_KEY;
  const visit = (node: WorkNode): void => {
    const seen = new Map<string, number>();
    for (const child of node.children) {
      const segment = keySegment(child.capture, context);
      const count = (seen.get(segment) ?? 0) + 1;
      seen.set(segment, count);
      child.nk = `${node.nk}/${count === 1 ? segment : `${segment}#${count}`}`;
      visit(child);
    }
  };
  visit(root);
}
