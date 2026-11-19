/*
 * The per-node write sequence (09 §6), top-down and pre-order: a node is complete (identity
 * written) before its children, which are written bottom → top in paint order. Slice scope:
 * absolute layout. A container with auto layout is written from its `fallback` boxes, which
 * are pixel-correct by construction (D-15), with `APPLY_LAYOUT_FALLBACK`; auto layout is B-56.
 * Nested instances are B-142: their fallback subtree is built instead.
 */
import type { SceneNode as IrNode, Rect } from '@holotype/ir';
import { createDiagnostic, diagnostic } from '@holotype/shared';
import { type VariantIdentity, writeIdentity, writeProvisionalKey } from '../identity';
import { createNode } from './create';
import { orderedWriters } from './index';
import type { WriteContext } from './types';

const WRITE_ORDER = orderedWriters();

/** A written node, by `nk`, for read-back. */
export interface WrittenNode {
  readonly node: SceneNode;
  readonly scene: IrNode;
}

export interface TreeWriter {
  readonly context: WriteContext;
  /** Called between node writes: the time slice (09 §12). */
  readonly tick: () => Promise<void>;
  /** Every node written so far, by `nk`. */
  readonly written: Map<string, WrittenNode>;
  /** The `nk` of the node being written, for `APPLY_COMPONENT_FAILED` (09 §13). */
  current?: string;
}

const boxOf = (scene: IrNode): Rect => ({
  x: scene.xy?.x ?? 0,
  y: scene.xy?.y ?? 0,
  w: scene.size.w,
  h: scene.size.h,
});

/** The boxes of a container's children: its absolute fallback when it has auto layout. */
function childBoxes(scene: IrNode, children: readonly IrNode[], context: WriteContext): Rect[] {
  if (scene.layout === undefined) return children.map(boxOf);
  context.emit(
    createDiagnostic(diagnostic('APPLY_LAYOUT_FALLBACK'), undefined, {
      sid: context.sid,
      variantKey: context.variantKey,
      nodeKey: scene.nk,
      property: 'layoutMode',
      value: scene.layout.mode,
      fallback: 'children placed at their captured positions (absolute layout)',
    }),
  );
  return children.map((child) => scene.fallback?.children[child.nk] ?? boxOf(child));
}

/**
 * What is built for an `instance` node: its fallback subtree under the instance's own key,
 * name and hash, or an empty frame (`APPLY_INSTANCE_TARGET_MISSING`).
 */
function resolveInstance(scene: IrNode, context: WriteContext): IrNode {
  if (scene.kind !== 'instance') return scene;
  const fallback = scene.instance?.fallback;
  context.emit(
    createDiagnostic(diagnostic('APPLY_INSTANCE_TARGET_MISSING'), undefined, {
      sid: context.sid,
      variantKey: context.variantKey,
      nodeKey: scene.nk,
      ...(scene.instance?.component.kind === 'local' ? { value: scene.instance.component.sid } : {}),
      fallback: fallback ? 'the captured layers, as frames' : 'an empty frame of the same size',
    }),
  );
  const { instance: _instance, children: _children, ...own } = scene;
  return fallback
    ? {
        ...fallback,
        nk: scene.nk,
        name: scene.name,
        irh: scene.irh,
        kind: fallback.kind === 'instance' ? 'frame' : fallback.kind,
      }
    : { ...own, kind: 'frame' };
}

/** Writes `scene` and its subtree as child `index` of `parent`. Returns the Figma node. */
export async function writeNode(
  writer: TreeWriter,
  scene: IrNode,
  parent: BaseNode & ChildrenMixin,
  index: number,
  box: Rect,
  variant?: VariantIdentity,
): Promise<SceneNode> {
  const { context } = writer;
  writer.current = scene.nk;
  const target = resolveInstance(scene, context);
  // 0. create, and mark it at once so an interrupted write is found and finished (09 §13).
  const created = createNode(target, box, context);
  const { node } = created;
  writeProvisionalKey(node, target.nk);
  // 1. attach first; 2. defaults hygiene: createFrame() starts at 100 × 100 with a white fill.
  parent.insertChild(index, node);
  created.afterAttach?.();
  if (created.freshFrame && node.type === 'FRAME') {
    node.fills = [];
    node.clipsContent = false;
  }
  // 4–8. size, position, content, visuals.
  for (const step of WRITE_ORDER) step.write({ node, scene: target, box: created.box }, context);
  // 10. name and identity last: they mark the node as fully written.
  node.name = target.name;
  writeIdentity(node, target, variant);
  writer.written.set(target.nk, { node, scene: target });
  // 11. children.
  const children = target.children ?? [];
  if (children.length === 0) return node;
  if (!('insertChild' in node)) {
    throw new TypeError(`A ${target.kind} node ("${target.nk}") cannot have children.`);
  }
  const boxes = childBoxes(target, children, context);
  for (const [i, child] of children.entries()) {
    await writer.tick();
    await writeNode(writer, child, node, i, boxes[i] ?? boxOf(child));
  }
  return node;
}
