/*
 * One import session on the main thread (09 §3, §5): pulls each component from the UI,
 * checks it, applies it, and streams `progress`, `diagnostics` and `done` back. The UI has
 * already validated the bundle with the full schemas (B-14 import screen); main repeats the
 * cheap checks that protect its own writes (shape, `sid`, version) without the schema
 * validators, which would not fit the main bundle budget (D-04).
 */
import type { BundleComponentEntry, SceneComponent } from '@holotype/ir';
import { checkVersion, SUPPORTED_SCENE_MAJORS } from '@holotype/ir/core';
import { createDiagnostic, diagnostic, HolotypeError } from '@holotype/shared';
import type { MainChannel } from '../channel';
import type { Host, SessionOpen } from '../host';
import type { FigmaPort } from '../port';
import { diagnosticBatches } from '../protocol';
import { type ApplyBundleOptions, type ApplyProgress, type ApplyResult, applyBundle } from './bundle';
import { createPuller, type Puller } from './pull';
import { createSlicer } from './slicer';

/** `progress` messages go out at most this often (09 §12). */
export const PROGRESS_INTERVAL_MS = 100;

export interface ImportSessionOptions {
  readonly message: SessionOpen;
  readonly host: Pick<Host, 'cancelRequested'>;
  readonly channel: MainChannel;
  readonly port: FigmaPort;
  readonly now: () => number;
  /** Gives the editor a turn between slices (09 §12). */
  readonly yieldToEditor: () => Promise<void>;
  /** A fresh `applyId`. */
  readonly createId: () => string;
}

function corrupt(entry: BundleComponentEntry, reason: string): HolotypeError {
  return new HolotypeError(
    createDiagnostic(diagnostic('APPLY_BUNDLE_CORRUPT'), undefined, {
      sid: entry.sid,
      value: entry.file,
      data: { reason },
    }),
  );
}

/** Parses a pulled component and checks what main relies on. */
export function parseComponent(entry: BundleComponentEntry, json: string): SceneComponent {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw corrupt(entry, `not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value !== 'object' || value === null || !('kind' in value) || value.kind !== 'holotype/scene-component') {
    throw corrupt(entry, 'not a component file');
  }
  const scene = value as Partial<SceneComponent>; // shape checked by the UI's validators; spot-checked here
  const unsupported = checkVersion('Component', scene.sceneVersion, SUPPORTED_SCENE_MAJORS);
  if (unsupported) throw new HolotypeError({ ...unsupported, sid: entry.sid });
  if (scene.sid !== entry.sid) throw corrupt(entry, `component id ${String(scene.sid)} does not match ${entry.sid}`);
  if (!Array.isArray(scene.variants) || scene.variants.length === 0) throw corrupt(entry, 'no variants');
  return value as SceneComponent;
}

/** A random-enough id for one apply: the main thread has no `crypto` (09 §3.1). */
export function createApplyId(now: number = Date.now(), random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 0x100000000)
    .toString(16)
    .padStart(8, '0');
  return `${now.toString(36)}-${suffix}`;
}

export async function runImportSession(options: ImportSessionOptions): Promise<ApplyResult> {
  const { channel, now } = options;
  const pull = createPuller(channel);
  let lastProgress = Number.NEGATIVE_INFINITY;
  const onProgress = ({ done, total, current }: ApplyProgress) => {
    const at = now();
    if (at - lastProgress < PROGRESS_INTERVAL_MS && done < total) return;
    lastProgress = at;
    channel.send({ t: 'progress', stage: 'apply', done, total, ...(current === undefined ? {} : { current }) });
  };
  const result = await applyBundle(applyOptions(options, pull, onProgress)).catch((error: unknown) => {
    // A failure outside any component (e.g. the page cannot be created) ends the run.
    if (error instanceof HolotypeError) throw error;
    throw new HolotypeError(
      createDiagnostic(diagnostic('APPLY_COMPONENT_FAILED'), undefined, {
        severity: 'fatal',
        data: { reason: error instanceof Error ? error.message : String(error) },
      }),
    );
  });
  channel.send({ t: 'done', summary: result.summary, report: result.report });
  return result;
}

function applyOptions(
  options: ImportSessionOptions,
  pull: Puller,
  onProgress: (progress: ApplyProgress) => void,
): ApplyBundleOptions {
  const { channel, message, now } = options;
  return {
    port: options.port,
    manifest: message.manifest,
    loadComponent: async (entry) => parseComponent(entry, (await pull.component(entry.sid)).json),
    loadAsset: async (sha) => {
      const { mime, bytes } = await pull.asset(sha);
      return { mime, bytes };
    },
    slicer: createSlicer({ now, yieldToEditor: options.yieldToEditor }),
    isCancelled: () => options.host.cancelRequested,
    now,
    applyId: options.createId(),
    undo: message.options.undo ?? 'per-component',
    onProgress,
    onDiagnostics: (items) => {
      for (const batch of diagnosticBatches(items)) channel.send(batch);
    },
  };
}
