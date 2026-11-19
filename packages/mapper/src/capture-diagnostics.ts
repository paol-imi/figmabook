import type { CaptureDoc, CNode } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { type WorkNode, walkWork } from './state';

/*
 * Capture facts about nodes (`CAP_CSS_UNSUPPORTED`, …) name the capture node id in
 * `nodeKey` (06 §1). Only the mapper knows which Scene layer a capture node became, so it
 * carries them into the variant with the layer's `nk`: a node that was dropped or merged
 * reports on its nearest emitted ancestor, and a fact about no node stays variant-level.
 */

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Diagnostics in the 06 §5 array order: by `(code, nodeKey, message)`, stable otherwise. */
export function sortDiagnostics(items: readonly Diagnostic[]): Diagnostic[] {
  return [...items].sort(
    (a, b) => compare(a.code, b.code) || compare(a.nodeKey ?? '', b.nodeKey ?? '') || compare(a.message, b.message),
  );
}

function parents(nodes: readonly CNode[], out = new Map<string, string>()): Map<string, string> {
  for (const node of nodes) {
    for (const child of node.children) out.set(child.id, node.id);
    parents(node.children, out);
  }
  return out;
}

/** The capture document's diagnostics, keyed by the `nk` of the layer each node became. */
export function captureDiagnostics(capture: CaptureDoc, root: WorkNode, vk: string, sid: string): Diagnostic[] {
  const keys = new Map<string, string>();
  for (const node of walkWork(root)) {
    if (node.synthetic !== undefined) continue;
    keys.set(node.capture.id, node.nk);
    if (node.wrapper) keys.set(node.wrapper.id, node.nk);
  }
  const parentOf = parents([capture.root, ...capture.portals]);
  return capture.diagnostics.map((item) => {
    const { nodeKey, ...rest } = item;
    let id = nodeKey;
    while (id !== undefined && !keys.has(id)) id = parentOf.get(id);
    const nk = id === undefined ? undefined : keys.get(id);
    return { ...rest, ...(nk === undefined ? {} : { nodeKey: nk }), variantKey: vk, sid };
  });
}
