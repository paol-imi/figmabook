import type { BudgetReport, BundleReport, SceneComponent, SceneNode } from '@holotype/ir';
import { compareSeverity, type Diagnostic } from '@holotype/shared';

/** One component's outcome, as `report.json` records it (06 §4.4). */
export interface ComponentReportInput {
  readonly sid: string;
  /** Diagnostics of the plan, capture and mapping of this component. */
  readonly diagnostics: readonly Diagnostic[];
  /** The scene, when the component was built. */
  readonly scene?: SceneComponent;
  /** Why the component is not in the bundle. */
  readonly skipped?: string;
  readonly budget?: BudgetReport;
}

const compare = (a: string | undefined, b: string | undefined): number => {
  const x = a ?? '';
  const y = b ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Diagnostics in canonical order: `(code, nodeKey, message)` (06 §5). */
export function sortDiagnostics(items: readonly Diagnostic[]): Diagnostic[] {
  return [...items].sort(
    (a, b) => compare(a.code, b.code) || compare(a.nodeKey, b.nodeKey) || compare(a.message, b.message),
  );
}

function* containers(node: SceneNode): Generator<SceneNode> {
  if ((node.children?.length ?? 0) > 0) yield node;
  for (const child of node.children ?? []) yield* containers(child);
}

/** Share of nodes with children that use auto layout; `0` when there are none. */
export function autoLayoutCoverage(scenes: readonly SceneComponent[]): number {
  let total = 0;
  let auto = 0;
  for (const scene of scenes) {
    for (const variant of scene.variants) {
      for (const node of containers(variant.root)) {
        total += 1;
        if (node.layout !== undefined) auto += 1;
      }
    }
  }
  return total === 0 ? 0 : auto / total;
}

/**
 * `report.json` (06 §4.4). `propertyQuality` is the share of planned properties that made
 * it into the scenes (`1` when none were planned); nothing is rasterized in this version.
 */
export function buildBundleReport(components: readonly ComponentReportInput[], plannedProperties = 0): BundleReport {
  const sorted = [...components].sort((a, b) => compare(a.sid, b.sid));
  const all = sorted.flatMap((component) => component.diagnostics);
  const byCode: Record<string, number> = {};
  for (const item of sortDiagnostics(all)) byCode[item.code] = (byCode[item.code] ?? 0) + 1;
  const scenes = sorted.flatMap((component) => (component.scene === undefined ? [] : [component.scene]));
  const emittedProperties = scenes.reduce(
    (sum, scene) => sum + scene.properties.filter((p) => p.type !== 'VARIANT').length,
    0,
  );
  return {
    kind: 'holotype/report',
    summary: {
      components: scenes.length,
      variants: scenes.reduce((sum, scene) => sum + scene.variants.length, 0),
      warnings: all.filter((item) => item.severity === 'warn').length,
      errors: all.filter((item) => compareSeverity(item.severity, 'error') >= 0).length,
      autoLayoutCoverage: autoLayoutCoverage(scenes),
      propertyQuality: plannedProperties === 0 ? 1 : Math.min(1, emittedProperties / plannedProperties),
      rasterizedNodes: 0,
    },
    byCode,
    components: sorted.map((component) => ({
      sid: component.sid,
      diagnostics: sortDiagnostics(component.diagnostics),
      ...(component.skipped === undefined ? {} : { skipped: { reason: component.skipped } }),
      ...(component.budget === undefined
        ? {}
        : {
            planner: {
              budget: {
                requested: component.budget.requested,
                emitted: component.budget.emitted,
                strategy: component.budget.strategy,
              },
              droppedAxes: [...component.budget.droppedAxes],
            },
          }),
    })),
  };
}
