import type { BundleReport } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';
import type { ExitCode } from './exit-codes';

/**
 * `RunReport` (12 §7.1): the `--json` output of a command and its observability record. It
 * embeds `report.json` (`BundleReport`) under `bundle`. v0 adds `run.command`,
 * `run.exitCode`, `output`, `failure` and the run-level `diagnostics`, which 12 §7.1 does not list yet;
 * consumers ignore unknown fields (06 §7).
 */
export interface RunReport {
  readonly reportVersion: '1';
  readonly run: {
    readonly id: string;
    readonly command: string;
    readonly startedAt: string;
    readonly durationMs: number;
    readonly surface: 'cli';
    readonly exitCode: ExitCode;
    readonly generator: {
      readonly name: '@holotype/cli';
      readonly version: string;
      readonly chromium: string;
      readonly playwright: string;
    };
    /** Absent when the Storybook could not be reached. */
    readonly storybook?: {
      readonly version: string;
      readonly renderer: string;
      /** Redacted: a URL's origin and path, or `static:<folder name>`. */
      readonly source: string;
      readonly indexHash: string;
    };
  };
  readonly totals: {
    readonly components: number;
    readonly ok: number;
    readonly failed: number;
    readonly variants: number;
    readonly nodes: number;
    readonly autoLayoutCoverage: number;
  };
  readonly components: readonly RunComponent[];
  readonly diagnosticsByCode: Readonly<Record<string, number>>;
  readonly budgets: readonly {
    readonly name: string;
    readonly value: number;
    readonly limit: number;
    readonly ok: boolean;
  }[];
  /** Run-level diagnostics: config, Storybook and browser failures that stop the run. */
  readonly diagnostics: readonly Diagnostic[];
  /** A run-stopping failure that has no diagnostic code (a browser that does not start). */
  readonly failure?: { readonly message: string; readonly hint: string };
  /** Where the bundle was written. Absent when the command wrote none. */
  readonly output?: { readonly path: string; readonly kind: 'zip' | 'dir'; readonly bytes: number };
  readonly bundle?: BundleReport;
}

export interface RunComponent {
  readonly sid: string;
  readonly name: string;
  readonly status: 'ok' | 'partial' | 'failed' | 'skipped';
  readonly variants: number;
  /** Figma property name → type. */
  readonly properties: Readonly<Record<string, string>>;
  readonly timingsMs: { readonly capture: number; readonly map: number };
  readonly diagnostics: readonly Diagnostic[];
}

/** Diagnostic counts by code, keys sorted. */
export function countByCode(items: readonly Diagnostic[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.code, (counts.get(item.code) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
