/**
 * `pnpm -F @holotype/spikes s19 [--mode dev|no-sourcemap|static|all] [--records <file>]`
 *
 * Runs the S-19 measurement on fixtures/ds-react and writes `S-19/results/summary.json`, the
 * source of the coverage tables in internal/spikes/S-19.md:
 * - `dev`: the dev server with `css.devSourcemap: true` (the fixture's `viteFinal`; branch mode);
 * - `no-sourcemap`: the dev server with CSS source maps off (`capture.devSourcemap: 'keep'`);
 * - `static`: a static build (library mode), where provenance is selector-only.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unwrap } from '@holotype/shared';
import { connectStorybook } from '@holotype/storybook';
import { buildStorybook } from '../../fixtures/ds-react/test/support/storybook.ts';
import { type FieldRecord, markdownTable, summarize } from './coverage.ts';
import { REPO_ROOT, startDevServer } from './dev-server.ts';
import { fieldGroup } from './resolver/fields.ts';
import { runSpike, type SpikeRun } from './spike.ts';

type Mode = 'dev' | 'no-sourcemap' | 'static';
const MODES: readonly Mode[] = ['dev', 'no-sourcemap', 'static'];

/** Story ids of the fixture's components and micro-fixtures that are opted in to Figma. */
async function measuredStories(url: string): Promise<string[]> {
  const storybook = unwrap(await connectStorybook({ source: url }));
  try {
    return (await storybook.listStories())
      .map((story) => story.id)
      .filter((id) => id.startsWith('components-') || id.startsWith('micro-'))
      .sort();
  } finally {
    await storybook.close();
  }
}

async function runMode(mode: Mode): Promise<SpikeRun> {
  const chromiumPath = process.env.HOLOTYPE_CHROMIUM_PATH;
  const chromium = chromiumPath === undefined || chromiumPath === '' ? {} : { chromiumPath };
  if (mode === 'static') {
    const dir = await mkdtemp(join(tmpdir(), 'holotype-s19-static-'));
    try {
      await buildStorybook(dir);
      const storybook = unwrap(await connectStorybook({ source: { kind: 'static', dir } }));
      try {
        const storyIds = await measuredStories(storybook.baseUrl);
        return await runSpike({ storybook, storyIds, repoRoot: REPO_ROOT, ...chromium });
      } finally {
        await storybook.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const server = await startDevServer({ sourcemaps: mode === 'dev' });
  try {
    const storybook = unwrap(await connectStorybook({ source: server.url }));
    try {
      const storyIds = await measuredStories(server.url);
      // Branch mode on the dev server also runs the dark theme: `[data-theme="dark"]` token scopes.
      const themes = mode === 'dev' ? (['light', 'dark'] as const) : (['light'] as const);
      return await runSpike({ storybook, storyIds, themes, repoRoot: REPO_ROOT, ...chromium });
    } finally {
      await storybook.close();
    }
  } finally {
    await server.close();
  }
}

/**
 * Fields with a problem, compact, for the report's failure modes: unresolved, a failed ground-truth
 * check, an unexplained value or a broken chain. `approximate` and `selector-only` are the mode's
 * expected outcome and are counted in the tables instead.
 */
function failures(records: readonly FieldRecord[]) {
  return records
    .filter(
      (r) =>
        r.field.status === 'unresolved' ||
        r.verdict.rule === 'wrong' ||
        r.verdict.definitions === 'wrong' ||
        r.verdict.selector === 'wrong' ||
        r.field.valueCheck === 'mismatch' ||
        r.field.varChain?.status === 'broken' ||
        r.field.varChain?.status === 'ambiguous',
    )
    .map((r) => ({
      storyId: r.storyId,
      theme: r.theme,
      path: r.path,
      property: r.field.property,
      status: r.field.status,
      ...(r.field.reason === undefined ? {} : { reason: r.field.reason }),
      ...(r.field.declaration === undefined
        ? {}
        : { declaration: `${r.field.declaration.name}: ${r.field.declaration.value}` }),
      ...(r.field.selector === undefined ? {} : { selector: r.field.selector }),
      ...(r.field.rule === undefined ? {} : { rule: `${r.field.rule.file}:${r.field.rule.line}:${r.field.rule.col}` }),
      ...(r.field.varChain === undefined ? {} : { chain: r.field.varChain.status }),
      valueCheck: r.field.valueCheck,
      ...(r.verdict.detail === undefined ? {} : { detail: r.verdict.detail }),
    }));
}

function summary(run: SpikeRun) {
  const byComponent = summarize(run.records, (r) => r.component);
  const byGroup = summarize(run.records, (r) => fieldGroup(r.field.property));
  const byTheme = summarize(run.records, (r) => r.theme);
  const diagnostics: Record<string, number> = {};
  for (const d of run.diagnostics) diagnostics[d.code] = (diagnostics[d.code] ?? 0) + 1;
  return {
    stories: new Set(run.records.map((r) => r.storyId)).size,
    nodes: new Set(run.records.map((r) => `${r.storyId} ${r.theme} ${r.nodeId}`)).size,
    byComponent,
    byGroup,
    byTheme,
    diagnostics,
    // Wall-clock: varies by machine, kept out of the comparison (rounded).
    cost: {
      matchedCalls: run.cost.matchedCalls,
      matchedMsPerCall: Math.round((run.cost.matchedMs / Math.max(1, run.cost.matchedCalls)) * 100) / 100,
      resolveMsPerField: Math.round((run.cost.resolveMs / Math.max(1, run.records.length)) * 1000) / 1000,
    },
    unmatched: run.unmatched,
    captureFailures: run.captureFailures,
    failures: failures(run.records),
  };
}

async function main(argv: readonly string[]): Promise<void> {
  const modeArg = argv[argv.indexOf('--mode') + 1];
  const modes = argv.includes('--mode') && modeArg !== 'all' ? MODES.filter((m) => m === modeArg) : MODES;
  if (modes.length === 0) throw new Error(`Unknown --mode "${modeArg}" (dev, no-sourcemap, static, all).`);
  const recordsPath = argv.includes('--records') ? argv[argv.indexOf('--records') + 1] : undefined;
  const out: Record<string, ReturnType<typeof summary>> = {};
  const all: Record<string, readonly FieldRecord[]> = {};
  let chromium = '';
  for (const mode of modes) {
    const started = Date.now();
    const run = await runMode(mode);
    chromium = run.chromium || chromium;
    out[mode] = summary(run);
    all[mode] = run.records;
    const s = out[mode];
    console.log(`\n## ${mode} (${s.stories} stories, ${s.nodes} nodes, ${Date.now() - started} ms)\n`);
    console.log(markdownTable(s.byComponent, 'component'));
    console.log();
    console.log(markdownTable(s.byGroup, 'field group'));
    console.log();
    console.log(markdownTable(s.byTheme, 'theme'));
    console.log('\ndiagnostics:', JSON.stringify(s.diagnostics), 'unmatched:', s.unmatched.length);
    console.log('cost:', JSON.stringify(s.cost));
  }
  const file = fileURLToPath(new URL('./results/summary.json', import.meta.url));
  const json = { format: 'holotype-s19-coverage/1', chromium, modes: out };
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`\nwrote ${file}`);
  if (recordsPath !== undefined) await writeFile(recordsPath, `${JSON.stringify(all, null, 2)}\n`);
}

await main(process.argv.slice(2));
