/*
 * One component, the unit of undo and resume (09 §5.5, §13): its resources are prepared, then
 * each variant is written as one frame on the page. A variant is atomic: cancel is checked
 * only between variants (09 §12). An exception fails the component with
 * `APPLY_COMPONENT_FAILED`; nodes already written stay in place, marked with their `nk`.
 */
import type { SceneComponent, SceneVariant } from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import type { FigmaPort } from '../port';
import { identityVersion, writeAppliedHash } from './identity';
import { variantGrid } from './placement';
import { appliedHashOf, readbackDelta } from './readback';
import type { ResourceCache } from './resources';
import { type TreeWriter, writeNode } from './write/node';

export interface ComponentRun {
  readonly port: FigmaPort;
  /** The page the variants go on (loaded). */
  readonly page: PageNode;
  readonly top: number;
  readonly resources: ResourceCache;
  readonly sceneMajor: number;
  readonly emit: (diagnostic: Diagnostic) => void;
  readonly tick: () => Promise<void>;
  readonly isCancelled: () => boolean;
}

export interface AppliedVariant {
  readonly vk: string;
  readonly node: SceneNode;
  readonly maxDelta: number;
}

export interface ComponentOutcome {
  readonly sid: string;
  readonly status: 'synced' | 'partial' | 'failed';
  readonly variants: readonly AppliedVariant[];
  /** The bottom edge of the component's grid on the page. */
  readonly bottom: number;
}

/** A display name for a variant frame: without a component set the name carries the component. */
export function variantFrameName(scene: SceneComponent, variant: SceneVariant): string {
  return scene.variants.length === 1 ? scene.meta.name : `${scene.meta.name} / ${variant.root.name}`;
}

/**
 * Reads back every node of a complete variant and stores its `ah` (10 §9.1). It runs after the
 * whole variant is written, so a parent's groups already reflect its children (hug sizes).
 */
async function stampAppliedHashes(writer: TreeWriter, tick: () => Promise<void>): Promise<void> {
  for (const [nk, { node }] of writer.written) {
    writer.current = nk;
    writeAppliedHash(node, await appliedHashOf(node));
    await tick();
  }
}

export async function applyComponent(scene: SceneComponent, run: ComponentRun): Promise<ComponentOutcome> {
  const grid = variantGrid(scene, { x: 0, y: run.top });
  const variants: AppliedVariant[] = [];
  let current: string | undefined;
  try {
    const resources = await run.resources.prepare(scene);
    for (const [i, variant] of scene.variants.entries()) {
      if (i > 0 && run.isCancelled()) return { sid: scene.sid, status: 'partial', variants, bottom: grid.bottom };
      const writer: TreeWriter = {
        context: { port: run.port, sid: scene.sid, variantKey: variant.vk, resources, emit: run.emit },
        tick: run.tick,
        written: new Map(),
      };
      const root = { ...variant.root, name: variantFrameName(scene, variant) };
      const box = grid.boxes[i] ?? { x: 0, y: run.top, w: root.size.w, h: root.size.h };
      try {
        const node = await writeNode(writer, root, run.page, run.page.children.length, box, {
          sid: scene.sid,
          variant,
          v: identityVersion(run.sceneMajor),
        });
        const maxDelta = readbackDelta(node, writer.written.values());
        await stampAppliedHashes(writer, run.tick);
        variants.push({ vk: variant.vk, node, maxDelta });
      } finally {
        current = writer.current;
      }
      await run.tick();
    }
    return { sid: scene.sid, status: 'synced', variants, bottom: grid.bottom };
  } catch (error) {
    if (error instanceof HolotypeError) for (const item of error.diagnostics) run.emit({ ...item, sid: scene.sid });
    run.emit(
      createDiagnostic(diagnostic('APPLY_COMPONENT_FAILED'), undefined, {
        sid: scene.sid,
        ...(current === undefined ? {} : { nodeKey: current }),
        fallback: 'the layers written so far were kept; import again to finish',
        data: { reason: error instanceof Error ? error.message : String(error) },
      }),
    );
    return { sid: scene.sid, status: 'failed', variants, bottom: grid.bottom };
  }
}
