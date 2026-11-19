import { join } from 'node:path';
import {
  ENGINE_VERSION as CAPTURE_VERSION,
  type CaptureOutcome,
  type Capturer,
  type CapturerOptions,
  type CaptureSuccess,
  createCapturer,
  PLAYWRIGHT_VERSION,
} from '@holotype/capture';
import { type HolotypeConfig, hash, type MapperSettings, type SceneComponent } from '@holotype/ir';
import { planSingleStory } from '@holotype/planner';
import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import {
  type ConnectedStorybook,
  type ConnectOptions,
  connectStorybook,
  isStoryId,
  type StorybookSource,
} from '@holotype/storybook';
import {
  type BundleAssetInput,
  buildBundleReport,
  type ComponentReportInput,
  countNodes,
  createBundle,
  type WrittenBundle,
  writeBundle,
  ZIP_SUFFIX,
} from '../bundle';
import { loadConfig } from '../config/load';
import { ExitCode, exitCodeFor } from '../exit-codes';
import { countByCode, type RunComponent, type RunReport } from '../run-report';
import { type ComponentWork, mapWork, skipReason } from './component';
import { resolveMapperSettings } from './settings';
import { redactSource, resolveSource } from './source';
import { CLI_VERSION, MAPPER_VERSION } from './versions';

/** `holotype capture` input: the flags, already parsed. */
export interface CaptureRunOptions {
  /** `--storybook <dir|url>`; overrides `storybook.source`. */
  readonly storybook?: string;
  /** `--story <id>`, in the order given. */
  readonly stories: readonly string[];
  /** `--out <dir|file.holotype.zip>`. Default `<output.dir>/<runId>.holotype.zip`. */
  readonly out?: string;
  /** `--config <path>`. Default: the nearest `holotype.config.*`. */
  readonly config?: string;
  /** Working directory; relative paths resolve against it. */
  readonly cwd: string;
  /** A Chromium binary (`HOLOTYPE_CHROMIUM_PATH`). */
  readonly chromiumPath?: string;
  /** The bundle's `createdAt` and run id. Default: the start of the run. */
  readonly createdAt?: Date;
  /** Aborts the run between steps (SIGINT). */
  readonly signal?: AbortSignal;
  /** Called as the run moves on, for the human output. */
  readonly onProgress?: (event: CaptureProgress) => void;
}

export type CaptureProgress =
  | { readonly kind: 'connected'; readonly storybook: ConnectedStorybook; readonly stories: number }
  | { readonly kind: 'captured'; readonly storyId: string; readonly ok: boolean };

/** Injected for tests: the Storybook connection, the capture engine and the clocks. */
export interface CaptureDeps {
  readonly connect: (options: ConnectOptions) => ReturnType<typeof connectStorybook>;
  readonly createCapturer: (options: CapturerOptions) => Capturer;
  /** Wall clock. */
  readonly now: () => Date;
  /** Monotonic milliseconds, for durations. */
  readonly elapsed: () => number;
}

export interface CaptureRunResult {
  readonly exitCode: ExitCode;
  readonly report: RunReport;
  readonly bundle?: WrittenBundle;
}

const DEFAULT_DEPS: CaptureDeps = {
  connect: connectStorybook,
  createCapturer,
  now: () => new Date(),
  elapsed: () => performance.now(),
};

/** Default `output.dir` (16 §17.1). */
export const DEFAULT_OUTPUT_DIR = '.holotype/out';

function usage(pointer: string, reason: string): Diagnostic {
  return createDiagnostic(diagnostic('PLAN_CONFIG_INVALID'), { pointer, reason });
}

/** `--story` checks before anything else runs (exit 2). */
export function checkStories(stories: readonly string[]): Diagnostic[] {
  if (stories.length === 0) {
    return [usage('--story', 'name at least one story id, e.g. --story components-button--primary')];
  }
  const problems: Diagnostic[] = [];
  const bySid = new Map<string, string>();
  for (const id of stories) {
    if (!isStoryId(id)) {
      problems.push(usage('--story', `"${id}" is not a story id (expected <component>--<story>)`));
      continue;
    }
    const sid = id.slice(0, id.indexOf('--'));
    const other = bySid.get(sid);
    if (other === id) problems.push(usage('--story', `"${id}" is given twice`));
    else if (other !== undefined) {
      problems.push(
        usage(
          '--story',
          `"${other}" and "${id}" are stories of one component; capture one story per component for now`,
        ),
      );
    } else bySid.set(sid, id);
  }
  return problems;
}

/** `20261119T101500Z-<8 hex of the story list>`: sortable, and the same for the same run. */
export function makeRunId(createdAt: Date, stories: readonly string[]): string {
  const stamp = isoSeconds(createdAt).replace(/[-:]/g, '');
  return `${stamp}-${hash(stories).slice(0, 8)}`;
}

/** ISO 8601 without milliseconds. */
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** The part of the config that changes the output (06 §4.2 `config.hash`); paths are left out. */
export function configHash(config: HolotypeConfig, settings: MapperSettings): string {
  return hash({
    capture: config.capture ?? {},
    include: config.include ?? ['**'],
    exclude: config.exclude ?? [],
    requireTag: config.storybook.requireTag ?? false,
    mapper: settings,
  });
}

/** The assets the captures produced (bytes plus the capture's metadata), by sha256. */
function collectAssets(captures: Iterable<CaptureSuccess>): Map<string, BundleAssetInput> {
  const assets = new Map<string, BundleAssetInput>();
  for (const capture of captures) {
    for (const [sha, bytes] of capture.assets) {
      const meta = capture.doc.assets[sha];
      if (meta === undefined) continue;
      assets.set(sha, {
        sha,
        mime: meta.mime,
        bytes,
        ...(meta.natural === undefined ? {} : { natural: meta.natural }),
      });
    }
  }
  return assets;
}

type ReportPatch = Partial<Omit<RunReport, 'run'>> & { readonly run?: Partial<RunReport['run']> };

/**
 * `holotype capture` (11 §3.3, BUILD B-13): plans each story as a one-variant component,
 * captures it, maps it to Scene IR and writes a bundle. Expected failures never throw: the
 * result carries the exit code (11 §3.2) and the `RunReport` (12 §7.1).
 */
export async function runCapture(
  options: CaptureRunOptions,
  deps: Partial<CaptureDeps> = {},
): Promise<CaptureRunResult> {
  const { connect, createCapturer: makeCapturer, now, elapsed } = { ...DEFAULT_DEPS, ...deps };
  const startedAt = now();
  const started = elapsed();
  const createdAt = options.createdAt ?? startedAt;
  const runId = makeRunId(createdAt, options.stories);
  const baseRun: Omit<RunReport['run'], 'exitCode' | 'durationMs'> = {
    id: runId,
    command: 'capture',
    startedAt: startedAt.toISOString(),
    surface: 'cli',
    generator: { name: '@holotype/cli', version: CLI_VERSION, chromium: 'unknown', playwright: PLAYWRIGHT_VERSION },
  };
  const finish = (exitCode: ExitCode, patch: ReportPatch = {}, bundle?: WrittenBundle): CaptureRunResult => {
    const { run, failure, output, bundle: bundleReport, ...rest } = patch;
    const report: RunReport = {
      reportVersion: '1',
      run: { ...baseRun, ...run, durationMs: Math.round(elapsed() - started), exitCode },
      totals: rest.totals ?? { components: 0, ok: 0, failed: 0, variants: 0, nodes: 0, autoLayoutCoverage: 0 },
      components: rest.components ?? [],
      diagnosticsByCode: rest.diagnosticsByCode ?? countByCode(rest.diagnostics ?? []),
      budgets: rest.budgets ?? [],
      diagnostics: rest.diagnostics ?? [],
      ...(failure === undefined ? {} : { failure }),
      ...(output === undefined ? {} : { output }),
      ...(bundleReport === undefined ? {} : { bundle: bundleReport }),
    };
    return { exitCode, report, ...(bundle === undefined ? {} : { bundle }) };
  };

  const storyProblems = checkStories(options.stories);
  if (storyProblems.length > 0) return finish(ExitCode.Usage, { diagnostics: storyProblems });

  const overrides = options.storybook === undefined ? {} : { storybook: options.storybook };
  const loaded = await loadConfig(options.cwd, overrides, options.config);
  if (!loaded.ok) return finish(ExitCode.Usage, { diagnostics: loaded.error });
  const { config, warnings: configWarnings } = loaded.value;
  const settings = resolveMapperSettings(config);
  const source: StorybookSource = resolveSource(config.storybook.source, options.cwd);

  const connected = await connect({
    source,
    filter: {
      ...(config.storybook.requireTag === undefined ? {} : { requireTag: config.storybook.requireTag }),
      ...(config.include === undefined ? {} : { include: config.include }),
      ...(config.exclude === undefined ? {} : { exclude: config.exclude }),
    },
  });
  if (!connected.ok) {
    return finish(ExitCode.StorybookUnreachable, { diagnostics: [...configWarnings, ...connected.error] });
  }
  const storybook = connected.value;
  const runDiagnostics: Diagnostic[] = [...configWarnings, ...storybook.diagnostics];
  const storybookInfo: NonNullable<RunReport['run']['storybook']> = {
    version: storybook.caps.version ?? 'unknown',
    renderer: storybook.caps.renderer ?? storybook.caps.framework ?? 'unknown',
    source: redactSource(source),
    indexHash: storybook.model.indexHash,
  };
  options.onProgress?.({ kind: 'connected', storybook, stories: options.stories.length });

  const works: ComponentWork[] = options.stories.map((storyId) => {
    const sid = storyId.slice(0, storyId.indexOf('--'));
    const work: ComponentWork = {
      storyId,
      sid,
      name: sid,
      diagnostics: [],
      captures: new Map(),
      status: 'failed',
      timings: { capture: 0, map: 0 },
    };
    const plan = planSingleStory(storybook.model, storyId);
    if (!plan.ok) {
      work.diagnostics.push({ ...plan.error, sid });
      return work;
    }
    work.plan = plan.value;
    work.name = plan.value.identity.displayName;
    work.story = storybook.model.stories.find((story) => story.id === storyId);
    return work;
  });

  let chromium = 'unknown';
  const capturer = makeCapturer({
    storybook,
    ...(config.capture === undefined ? {} : { config: config.capture }),
    ...(options.chromiumPath === undefined ? {} : { chromiumPath: options.chromiumPath }),
  });
  let browserError: Error | undefined;
  try {
    const jobs = works.flatMap((work) =>
      (work.plan?.variants ?? []).map(async (variant) => {
        const t0 = elapsed();
        const outcome: CaptureOutcome = await capturer.capture({
          storyId: variant.render.storyId,
          sid: work.sid,
          vk: variant.vk,
          args: variant.render.args,
          globals: variant.render.globals,
          viewport: variant.render.viewport,
        });
        work.timings.capture += elapsed() - t0;
        options.onProgress?.({ kind: 'captured', storyId: variant.render.storyId, ok: outcome.ok });
        return { work, outcome };
      }),
    );
    const outcomes = await Promise.all(jobs);
    for (const { work, outcome } of outcomes) {
      work.diagnostics.push(...outcome.warnings.map((item) => ({ ...item, sid: work.sid })));
      if (outcome.ok) {
        work.captures.set(outcome.doc.target.vk, outcome);
        work.diagnostics.push(...outcome.doc.diagnostics);
        chromium = outcome.doc.engine.chromium;
      } else {
        work.diagnostics.push({ ...outcome.diagnostic, sid: work.sid });
      }
    }
  } catch (error) {
    // capture() throws only when the browser itself fails: launch, or a crash it cannot retry.
    browserError = error instanceof Error ? error : new Error(String(error));
  } finally {
    await capturer.close().catch(() => undefined);
    await storybook.close();
  }
  if (browserError !== undefined) {
    return finish(ExitCode.Browser, {
      run: { storybook: storybookInfo },
      diagnostics: runDiagnostics,
      failure: {
        message: `The browser could not capture: ${browserError.message.split('\n')[0] ?? ''}`,
        hint: 'Install the pinned Chromium (pnpm exec playwright install chromium), or set HOLOTYPE_CHROMIUM_PATH to a Chromium binary.',
      },
    });
  }
  if (options.signal?.aborted === true) {
    return finish(ExitCode.Interrupted, { run: { storybook: storybookInfo }, diagnostics: runDiagnostics });
  }

  for (const work of works) {
    mapWork(work, { source, baseUrl: storybook.baseUrl, settings, elapsed });
  }

  const built = works.filter((work): work is ComponentWork & { scene: SceneComponent } => work.scene !== undefined);
  const reportInputs: ComponentReportInput[] = works.map((work) => ({
    sid: work.sid,
    diagnostics: work.diagnostics,
    ...(work.scene === undefined ? { skipped: skipReason(work) } : { scene: work.scene }),
    ...(work.plan === undefined ? {} : { budget: work.plan.budget }),
  }));
  const bundleReport = buildBundleReport(reportInputs);
  const allDiagnostics = [...runDiagnostics, ...works.flatMap((work) => work.diagnostics)];
  const patch = {
    run: { generator: { ...baseRun.generator, chromium }, storybook: storybookInfo },
    totals: {
      components: works.length,
      ok: works.filter((work) => work.status === 'ok').length,
      failed: works.filter((work) => work.status === 'failed').length,
      variants: built.reduce((sum, work) => sum + work.scene.variants.length, 0),
      nodes: built.reduce((sum, work) => sum + countNodes(work.scene), 0),
      autoLayoutCoverage: bundleReport.summary.autoLayoutCoverage,
    },
    components: works.map(
      (work): RunComponent => ({
        sid: work.sid,
        name: work.name,
        status: work.status,
        variants: work.scene?.variants.length ?? 0,
        properties: Object.fromEntries((work.scene?.properties ?? []).map((p) => [p.name, p.type])),
        timingsMs: { capture: Math.round(work.timings.capture), map: Math.round(work.timings.map) },
        diagnostics: work.diagnostics,
      }),
    ),
    diagnostics: runDiagnostics,
    diagnosticsByCode: countByCode(allDiagnostics),
  } satisfies ReportPatch;
  // Nothing to import: no bundle, and the run failed.
  if (built.length === 0) return finish(ExitCode.Errors, patch);

  const cfgHash = configHash(config, settings);
  const bundle = createBundle({
    runId,
    createdAt: isoSeconds(createdAt),
    generator: {
      name: '@holotype/cli',
      version: CLI_VERSION,
      mapper: MAPPER_VERSION,
      capture: CAPTURE_VERSION,
      chromium,
      playwright: PLAYWRIGHT_VERSION,
    },
    source: {
      storybookVersion: storybookInfo.version,
      ...(storybook.caps.renderer === undefined ? {} : { renderer: storybook.caps.renderer }),
      ...(storybook.caps.builder === undefined ? {} : { builder: storybook.caps.builder }),
      origin: storybookInfo.source,
      fingerprint: storybook.model.indexHash,
    },
    configHash: cfgHash,
    components: built.map((work) => ({
      scene: work.scene,
      status: work.status === 'partial' ? 'partial' : 'ok',
      ...(work.plan === undefined ? {} : { planHash: hash(work.plan) }),
    })),
    assets: collectAssets(built.flatMap((work) => [...work.captures.values()])),
    report: bundleReport,
  });
  const out = options.out ?? join(config.output?.dir ?? DEFAULT_OUTPUT_DIR, `${runId}${ZIP_SUFFIX}`);
  const written = await writeBundle(bundle, out, options.cwd);
  return finish(
    exitCodeFor(allDiagnostics),
    { ...patch, output: { path: written.path, kind: written.kind, bytes: written.bytes }, bundle: bundleReport },
    written,
  );
}
