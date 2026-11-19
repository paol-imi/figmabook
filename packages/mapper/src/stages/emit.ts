import {
  type CaptureDoc,
  captureNumKind,
  hash,
  type Rect,
  SCENE_VERSION,
  type SceneComponent,
  type SceneComponentMeta,
  type SceneNode,
  type SceneVariant,
} from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import { captureDiagnostics, sortDiagnostics } from '../capture-diagnostics';
import { px, relativeRect } from '../geometry';
import { placeVariants } from '../set-grid';
import { type ComponentState, sourceElement, type VariantState, type WorkNode } from '../state';
import type { ComponentStage } from './types';

/*
 * Stage 14, emission (07 §6.3): the work trees become Scene nodes. Layout is absolute, so
 * every child is placed by `xy` relative to its parent's border box, and every node gets
 * `expect`, its browser rect relative to the variant root. Auto layout and its `fallback`
 * arrive with B-49. Capture facts about nodes are carried over with their final keys, and
 * variant diagnostics are sorted by `(code, nodeKey, message)` (06 §5). The component
 * document is assembled here; hashes come next.
 */

/** Stands in for an `irh` until the hashing stage computes it. */
export const UNHASHED = '0000000000000000';

/** Node diagnostics with their final keys, in tree order. */
function nodeDiagnostics(root: WorkNode, vk: string, sid: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const visit = (node: WorkNode): void => {
    for (const item of node.diagnostics) out.push({ ...item, nodeKey: node.nk, variantKey: vk, sid });
    node.children.forEach(visit);
  };
  visit(root);
  return out;
}

function emitNode(node: WorkNode, rootBox: Rect, parentExpect: Rect | undefined): SceneNode {
  const expect = relativeRect(node.box, rootBox);
  const scene: SceneNode = {
    nk: node.nk,
    kind: node.kind,
    name: node.name,
    irh: UNHASHED,
    size: { w: expect.w, h: expect.h },
    expect,
    visible: node.visible,
    ...node.fields,
  };
  // A synthetic layer has no element of its own; its key names its owner.
  if (node.synthetic === undefined) {
    const { source } = sourceElement(node);
    scene.source = {
      path: source.path,
      tag: source.tag,
      ...(source.component ? { component: source.component.name } : {}),
    };
  }
  // Positions derive from the rounded `expect` rects, so a child's `xy` chain sums exactly to its `expect`.
  if (parentExpect) scene.xy = { x: px(expect.x - parentExpect.x), y: px(expect.y - parentExpect.y) };
  if (node.children.length > 0) scene.children = node.children.map((child) => emitNode(child, rootBox, expect));
  return scene;
}

/** A content hash of the capture, for provenance; timing differs between identical renders, so it is left out. */
function captureHash(capture: CaptureDoc): string {
  const { timing: _timing, ...content } = capture;
  return hash(content, { numKind: captureNumKind });
}

function emitVariant(variant: VariantState, component: ComponentState, cell: SceneVariant['grid']): SceneVariant {
  const { capture, planned, root } = variant;
  const { sid } = component.input;
  const values: Record<string, string> = {};
  for (const def of component.properties) {
    const value = planned.values[def.key];
    if (def.type === 'VARIANT' && value !== undefined) values[def.key] = value;
  }
  const { target } = capture;
  return {
    vk: planned.vk,
    irh: UNHASHED,
    values,
    provenance: {
      storyId: target.storyId,
      args: target.args,
      globals: target.globals,
      state: target.state,
      viewport: target.viewport,
      captureHash: captureHash(capture),
    },
    grid: cell,
    root: emitNode(root, capture.root.borderBox, undefined),
    diagnostics: sortDiagnostics([
      ...variant.diagnostics.map((item) => ({ ...item, variantKey: planned.vk, sid })),
      ...nodeDiagnostics(root, planned.vk, sid),
      ...captureDiagnostics(capture, root, planned.vk, sid),
    ]),
  };
}

function emitMeta(component: ComponentState): SceneComponentMeta {
  const { meta, plan } = component.input;
  const { identity } = meta;
  const storyIds =
    meta.storyIds.length > 0 ? [...meta.storyIds] : [...new Set(plan.variants.map((v) => v.render.storyId))];
  const out: SceneComponentMeta = {
    name: identity.displayName,
    titlePath: [...meta.titlePath],
    description: meta.description,
    descriptionSource: meta.descriptionSource,
    links: meta.links.map(({ label, url }) => ({ label, url })),
    storyIds,
    importPath: identity.importPath,
    framework: identity.framework,
    kind: component.variants.length > 1 ? 'component-set' : 'component',
  };
  if (identity.exportName !== undefined) out.exportName = identity.exportName;
  if (identity.componentPath !== undefined) out.componentPath = identity.componentPath;
  return out;
}

export const emitStage: ComponentStage = {
  step: 14,
  name: 'emit',
  per: 'component',
  run(component) {
    const { input } = component;
    const grid = placeVariants({
      properties: component.properties,
      layoutGrid: input.plan.layoutGrid,
      variants: component.variants.map((variant) => variant.planned.values),
      maxColumns: input.config.grid.maxColumns,
    });
    const variants = component.variants
      .map((variant, i) => emitVariant(variant, component, grid.cells[i] ?? { row: 0, col: i }))
      .sort((a, b) => a.grid.row - b.grid.row || a.grid.col - b.grid.col);
    const scene: SceneComponent = {
      kind: 'holotype/scene-component',
      sceneVersion: SCENE_VERSION,
      sid: input.sid,
      irh: UNHASHED,
      meta: emitMeta(component),
      properties: component.properties,
      variants,
      setLayout: {
        mode: 'grid',
        columnsBy: grid.columnsBy,
        rowsBy: grid.rowsBy,
        gap: { x: input.config.grid.gap, y: input.config.grid.gap },
        padding: input.config.grid.padding,
        labels: variants.length > 1,
      },
      dependencies: [],
      diagnostics: component.diagnostics,
    };
    component.scene = scene;
  },
};
