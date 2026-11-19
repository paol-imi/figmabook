/*
 * Applies a bundle's components in manifest order (09 §5.5, slice scope: no index, plan,
 * tokens or component sets yet). Every write goes through the `FigmaPort`. One undo step per
 * component (or one for the whole run), then the new frames are selected and announced
 * (09 §5.6), and an `ApplyReport` (06 §4.5) describes the result.
 */
import type { ApplyReport, BundleComponentEntry, BundleManifest, SceneComponent } from '@holotype/ir';
import { parseMajor } from '@holotype/ir/core';
import { createDiagnostic, type Diagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import type { FigmaPort } from '../port';
import type { ApplySummary } from '../protocol';
import { applyComponent, type ComponentOutcome } from './component';
import { ensureComponentsPage } from './page';
import { COMPONENT_SPACING, nextComponentTop } from './placement';
import { type LoadAsset, ResourceCache } from './resources';
import type { Slicer } from './slicer';

export interface ApplyProgress {
  readonly done: number;
  readonly total: number;
  /** The component being built. */
  readonly current?: string;
}

export interface ApplyBundleOptions {
  readonly port: FigmaPort;
  readonly manifest: BundleManifest;
  /** Fetches and parses one component's Scene IR. A `HolotypeError` fails that component only. */
  readonly loadComponent: (entry: BundleComponentEntry) => Promise<SceneComponent>;
  readonly loadAsset: LoadAsset;
  readonly slicer: Slicer;
  /** Checked between variants (09 §12). */
  readonly isCancelled: () => boolean;
  /** A clock in milliseconds, for `durationMs`. */
  readonly now: () => number;
  readonly applyId: string;
  /** `single`: one undo step at the end instead of one per component (09 §12). */
  readonly undo?: 'per-component' | 'single';
  readonly onProgress?: (progress: ApplyProgress) => void;
  /** Receives diagnostics as they are emitted, after each component. */
  readonly onDiagnostics?: (items: readonly Diagnostic[]) => void;
}

export interface ApplyResult {
  readonly summary: ApplySummary;
  readonly report: ApplyReport;
}

function componentFailed(entry: BundleComponentEntry, error: unknown): Diagnostic[] {
  const own = error instanceof HolotypeError ? error.diagnostics.map((item) => ({ ...item, sid: entry.sid })) : [];
  return [
    ...own,
    createDiagnostic(diagnostic('APPLY_COMPONENT_FAILED'), undefined, {
      sid: entry.sid,
      value: entry.file,
      fallback: 'nothing was written for this component',
      data: { reason: error instanceof Error ? error.message : String(error) },
    }),
  ];
}

/** The Figma toast after an import (09 §5.6), in the plugin's plain wording (11 §6.12). */
export function notifyMessage(summary: ApplySummary): string {
  const ok = summary.componentsOk;
  const components = `${ok} component${ok === 1 ? '' : 's'}`;
  if (summary.cancelled) return `Import cancelled. ${components} imported; import again to finish.`;
  if (summary.componentsFailed > 0) {
    return `Imported ${components}; ${summary.componentsFailed} failed. See the Holotype report.`;
  }
  return `Imported ${components} (${summary.variants} variant${summary.variants === 1 ? '' : 's'}).`;
}

export async function applyBundle(options: ApplyBundleOptions): Promise<ApplyResult> {
  const { port, manifest } = options;
  const started = options.now();
  const diagnostics: Diagnostic[] = [];
  let pending: Diagnostic[] = [];
  const emit = (item: Diagnostic) => {
    diagnostics.push(item);
    pending.push(item);
  };
  const flush = () => {
    if (pending.length > 0) options.onDiagnostics?.(pending);
    pending = [];
  };

  const entries = manifest.components.filter((entry) => entry.status !== 'failed');
  const total = entries.reduce((sum, entry) => sum + entry.variants, 0);
  const page = await ensureComponentsPage(port);
  const resources = new ResourceCache(port, options.loadAsset, emit);
  const sceneMajor = parseMajor(manifest.sceneVersion) ?? 0;
  const outcomes: ComponentOutcome[] = [];
  let failed = 0;
  let done = 0;
  let cancelled = false;
  let top = nextComponentTop(page);

  options.onProgress?.({ done, total });
  for (const entry of entries) {
    if (options.isCancelled()) {
      cancelled = true;
      break;
    }
    options.onProgress?.({ done, total, current: entry.name });
    let scene: SceneComponent;
    try {
      scene = await options.loadComponent(entry);
    } catch (error) {
      for (const item of componentFailed(entry, error)) emit(item);
      failed += 1;
      done += entry.variants;
      flush();
      continue;
    }
    const outcome = await applyComponent(scene, {
      port,
      page,
      top,
      resources,
      sceneMajor,
      emit,
      tick: () => options.slicer.tick(),
      isCancelled: options.isCancelled,
    });
    outcomes.push(outcome);
    if (outcome.status === 'failed') failed += 1;
    if (outcome.status === 'partial') cancelled = true;
    if (options.undo !== 'single') port.commitUndo();
    done += scene.variants.length;
    top = outcome.bottom + COMPONENT_SPACING;
    options.onProgress?.({ done: Math.min(done, total), total, current: entry.name });
    flush();
    if (cancelled) break;
  }
  if (options.undo === 'single') port.commitUndo();
  if (cancelled) emit(createDiagnostic(diagnostic('APPLY_CANCELLED')));
  flush();

  const roots = outcomes.flatMap((outcome) => outcome.variants.map((variant) => variant.node));
  if (roots.length > 0) {
    await port.setCurrentPageAsync(page);
    page.selection = roots;
  }
  const summary: ApplySummary = {
    componentsOk: outcomes.filter((outcome) => outcome.status === 'synced').length,
    componentsFailed: failed,
    variants: outcomes.reduce((sum, outcome) => sum + outcome.variants.length, 0),
    durationMs: Math.max(0, Math.round(options.now() - started)),
    cancelled,
  };
  port.notify(notifyMessage(summary), { timeout: 6000, error: summary.componentsFailed > 0 });
  return { summary, report: applyReport(options, outcomes, diagnostics) };
}

/**
 * The `ApplyReport`. Slice scope: there is no component set yet, so `setId` is the node id of
 * the component's first variant frame, and a component with no frame at all is reported
 * through its diagnostics only (see plan gaps).
 */
function applyReport(
  options: Pick<ApplyBundleOptions, 'applyId' | 'port'>,
  outcomes: readonly ComponentOutcome[],
  diagnostics: readonly Diagnostic[],
): ApplyReport {
  return {
    kind: 'holotype/apply-report',
    applyId: options.applyId,
    fileKey: options.port.fileKey ?? null,
    components: outcomes.flatMap((outcome) => {
      const [first] = outcome.variants;
      if (first === undefined) return [];
      return [
        {
          sid: outcome.sid,
          setId: first.node.id,
          status: outcome.status,
          variants: outcome.variants.map(({ vk, node, maxDelta }) => ({ vk, nodeId: node.id, readback: { maxDelta } })),
        },
      ];
    }),
    diagnostics: [...diagnostics],
  };
}
