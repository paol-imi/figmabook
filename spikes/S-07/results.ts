/** The S-07 results file (`S-07/results.json`): what each run measured. */
import type { FaultKind } from './faults.ts';
import type { LatencySummary } from './stats.ts';

export const RESULTS_FORMAT = 'holotype-s07-results/1';

export interface Environment {
  readonly chromium: string;
  readonly storybook: string;
  readonly framework: string;
  readonly node: string;
  readonly playwright: string;
  readonly os: string;
  readonly cpus: number;
  readonly cpuModel: string;
}

/** One variant of a loop. */
export interface VariantRecord {
  readonly index: number;
  readonly storyId: string;
  readonly ok: boolean;
  readonly code?: string;
  readonly warnings: readonly string[];
  readonly ms: number;
  /** Channel only: `select`, `args`, … steps and Storybook renders. */
  readonly steps?: readonly string[];
  /** Channel only: in-page time of each step, emit to done event. */
  readonly stepMs?: readonly number[];
  /** Channel only: fonts, two frames and the optional stability check. */
  readonly settleMs?: number;
  readonly renders?: number;
  readonly path?: 'boot' | 'channel';
  /** Channel only, when the stability check ran: strict result and the 03 §5.5 heuristic. */
  readonly stable?: boolean;
  readonly planStable?: boolean | null;
}

export interface LoopRun {
  readonly name: string;
  readonly driver: 'channel' | 'url';
  readonly userAgent: 'test-runner' | 'default';
  readonly presetArgs?: boolean;
  readonly order: 'grouped' | 'interleaved';
  /** Pages rendering in parallel (one browser context each). */
  readonly pages: number;
  readonly variants: number;
  readonly failures: number;
  readonly wallMs: number;
  /** Variants per second over the wall time (one page). */
  readonly throughput: number;
  readonly latency: LatencySummary;
  /** Channel only: latency of story switches vs args-only updates. */
  readonly bySwitch?: { readonly switch: LatencySummary; readonly argsOnly: LatencySummary };
  /** Channel only: Storybook renders per variant. */
  readonly rendersPerVariant?: number;
  readonly records: readonly VariantRecord[];
}

export interface ParityRecord {
  readonly index: number;
  readonly label: string;
  readonly channelHash: string | null;
  readonly urlHash: string | null;
  readonly equal: boolean;
  /** First differing JSON path of the canonical capture documents, when they differ. */
  readonly difference?: string;
  /** Equal once React `useId` values (`_r_<n>_`) are replaced by one placeholder. */
  readonly equalIgnoringReactIds: boolean;
}

export interface ParityRun {
  readonly sample: number;
  readonly equal: number;
  readonly equalIgnoringReactIds: number;
  readonly channelWallMs: number;
  readonly urlWallMs: number;
  readonly records: readonly ParityRecord[];
}

export interface FaultRecord {
  readonly index: number;
  readonly kind: FaultKind;
  readonly expected: string;
  readonly observed: string;
  readonly detected: boolean;
  readonly ms: number;
  /** The next variant rendered and matched its clean reference. */
  readonly recovered: boolean;
  readonly recoveryMs: number;
  readonly recoveryPath?: 'boot' | 'channel';
  /** Channel steps of the recovery probe, e.g. `args+heal`. */
  readonly recoverySteps?: string;
  /** Channel only, unstable faults: what the 03 §5.5 heuristic said. */
  readonly planHeuristic?: 'stable' | 'unstable';
}

export interface FaultRun {
  readonly driver: 'channel' | 'url';
  readonly variants: number;
  readonly wallMs: number;
  readonly healthyLatency: LatencySummary;
  /** Healthy variants that failed (should be 0). */
  readonly healthyFailures: number;
  readonly faults: readonly FaultRecord[];
}

export interface HmrEvent {
  /** Variant index the edit was made before. */
  readonly atVariant: number;
  readonly edit: string;
  /** Channel events that arrived after the edit, before the next render finished. */
  readonly events: readonly string[];
  /** Milliseconds from the file write until the change was visible to the loop (mid-render: the render). */
  readonly visibleAfterMs: number | null;
  readonly note: string;
}

export interface HmrRun {
  /** What discovery found on the dev server (no `project.json` there: conservative flags). */
  readonly caps: { readonly version: string | null; readonly storyFinishedEvent: boolean };
  readonly variants: number;
  readonly failures: number;
  readonly latency: LatencySummary;
  /** First render of each CSF file on the dev server (Vite compiles on demand). */
  readonly coldLatency: LatencySummary;
  readonly edits: readonly HmrEvent[];
  readonly records: readonly VariantRecord[];
}

export interface Results {
  readonly format: typeof RESULTS_FORMAT;
  readonly environment: Environment;
  readonly metadata?: { readonly stories: number; readonly loadStoryMs: number; readonly readyMs: number };
  readonly loops: readonly LoopRun[];
  readonly parity?: ParityRun;
  readonly faults: readonly FaultRun[];
  readonly hmr?: HmrRun;
}

/**
 * The results file text: indented JSON with one line per record, so a re-run diffs by
 * variant. Parses back to the same value.
 */
export function formatResults(results: Results): string {
  const marker = '\u0000';
  const text = JSON.stringify(
    results,
    (key, value: unknown) =>
      key === 'records' && Array.isArray(value) ? value.map((record) => `${marker}${JSON.stringify(record)}`) : value,
    2,
  );
  return `${text.replace(/"\\u0000((?:[^"\\]|\\.)*)"/g, (_, body: string) => JSON.parse(`"${body}"`) as string)}\n`;
}
