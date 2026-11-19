import type { SnapshotIndex, TopLevel } from '../identify/snapshot-index';
import type { DcrScope, SnapNode } from '../schema';

/*
 * What a scope covers (15 §4.6 `DcrScope`, D-57). Managed components are always compared with
 * their baselines in `changed` and `all` (an unchanged one yields nothing); new top-level
 * frames, sections and components are those absent from `branch:meta.baseFrames` in `changed`,
 * every one in `all`, the frames marked Ready for dev in `ready`, the page's in `page`, and the
 * selected ones in `selection`.
 */

export interface ScopedNodes {
  /** Managed component sets to diff. */
  readonly sets: readonly TopLevel[];
  /** Local components and sets without `sid`. */
  readonly newComponents: readonly TopLevel[];
  /** Top-level frames, sections and other layers: screens (15 §4.10). */
  readonly frames: readonly TopLevel[];
  /** Whether variables are in scope (`changed` and `all`). */
  readonly variables: boolean;
}

/** A Holotype-managed top-level node that is not a component proposal: doc frames, icons. */
const isHolotypeOwned = (node: SnapNode): boolean => node.data.sid !== undefined && node.type !== 'COMPONENT_SET';
const isManagedSet = (node: SnapNode): boolean => node.type === 'COMPONENT_SET' && node.data.sid !== undefined;
const isComponent = (node: SnapNode): boolean => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';

/** Whether a top-level node contains (or is) one of `ids`. */
function contains(index: SnapshotIndex, top: SnapNode, ids: ReadonlySet<string>): boolean {
  return index.preorder(top.id).some((node) => ids.has(node.id));
}

export function scopedNodes(index: SnapshotIndex, scope: DcrScope, baseFrames: ReadonlySet<string>): ScopedNodes {
  const sets: TopLevel[] = [];
  const newComponents: TopLevel[] = [];
  const frames: TopLevel[] = [];
  const selected = scope.kind === 'selection' ? new Set(scope.ids) : undefined;
  for (const top of index.topLevel()) {
    const { node, page } = top;
    if (node.data.lock === '1' || isHolotypeOwned(node)) continue;
    const managed = isManagedSet(node);
    let inScope: boolean;
    switch (scope.kind) {
      case 'changed':
        inScope = managed || !baseFrames.has(node.id);
        break;
      case 'all':
        inScope = true;
        break;
      case 'ready':
        inScope = !managed && node.devStatus === 'READY_FOR_DEV';
        break;
      case 'page':
        inScope = page.name === scope.name;
        break;
      case 'selection':
        inScope = contains(index, node, selected as ReadonlySet<string>);
        break;
    }
    if (!inScope) continue;
    if (managed) sets.push(top);
    else if (isComponent(node)) newComponents.push(top);
    else frames.push(top);
  }
  return { sets, newComponents, frames, variables: scope.kind === 'changed' || scope.kind === 'all' };
}
