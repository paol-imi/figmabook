/**
 * S-07 render-loop spike (BUILD B-16): `pnpm -F @holotype/spikes s07 [run…] [options]`.
 *
 * Runs: `loop` (200 variants on fixtures/ds-react, channel vs URL), `parity` (capture hashes
 * channel vs URL on a sample), `faults` (failure injection on the generated `faults`
 * sandbox), `hmr` (dev-server edits mid-run). With no run named, all four run and
 * `S-07/results.json` is written; `report` prints the report tables from that file.
 *
 * Needs `pnpm build` first: it imports the built `@holotype/storybook` and `@holotype/capture`.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PLAYWRIGHT_VERSION } from '@holotype/capture';
import { unwrap } from '@holotype/shared';
import { type ConnectedStorybook, connectStorybook } from '@holotype/storybook';
import { buildStorybook } from '../../fixtures/ds-react/test/support/storybook.ts';
import { buildPlan } from './plan.ts';
import { renderReport } from './report.ts';
import { type Environment, formatResults, type LoopRun, RESULTS_FORMAT, type Results } from './results.ts';
import { runFaults } from './runs/faults.ts';
import { runHmr } from './runs/hmr.ts';
import { runLoop } from './runs/loop.ts';
import { runParity } from './runs/parity.ts';
import { prepareSandbox } from './runs/sandbox.ts';
import { launchBrowser, loadStoryMetas } from './runtime.ts';

const RUNS = ['loop', 'parity', 'faults', 'hmr'] as const;
type Run = (typeof RUNS)[number];

const RESULTS_PATH = new URL('./results.json', import.meta.url);

interface Options {
  readonly runs: readonly Run[];
  readonly variants: number;
  readonly report: boolean;
  readonly out: string | undefined;
}

function parse(argv: readonly string[]): Options {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { variants: { type: 'string' }, out: { type: 'string' } },
  });
  if (positionals.includes('report')) return { runs: [], variants: 0, report: true, out: values.out };
  for (const name of positionals) {
    if (!(RUNS as readonly string[]).includes(name))
      throw new Error(`Unknown run "${name}". Runs: ${RUNS.join(', ')}, report.`);
  }
  const variants = Number(values.variants ?? 200);
  if (!Number.isInteger(variants) || variants < 20)
    throw new Error(`--variants must be an integer ≥ 20, got ${values.variants}.`);
  return { runs: positionals.length === 0 ? RUNS : (positionals as Run[]), variants, report: false, out: values.out };
}

async function withDsReact<T>(work: (storybook: ConnectedStorybook) => Promise<T>): Promise<T> {
  const prebuilt = process.env.HOLOTYPE_STORYBOOK_STATIC;
  const dir = prebuilt === undefined || prebuilt === '' ? await mkdtemp(join(tmpdir(), 'holotype-s07-')) : prebuilt;
  try {
    if (dir !== prebuilt) await buildStorybook(dir);
    const storybook = unwrap(await connectStorybook({ source: { kind: 'static', dir } }));
    try {
      return await work(storybook);
    } finally {
      await storybook.close();
    }
  } finally {
    if (dir !== prebuilt) await rm(dir, { recursive: true, force: true });
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parse(argv);
  const target = options.out ?? RESULTS_PATH.pathname;
  if (options.report) {
    const results = JSON.parse(await readFile(target, 'utf8')) as Results;
    console.log(renderReport(results));
    return;
  }
  const spike = await launchBrowser();
  const log = (line: string) => console.error(`[S-07] ${line}`);
  try {
    const loops: LoopRun[] = [];
    let environment: Environment | undefined;
    const partial: { -readonly [K in keyof Results]?: Results[K] } = {};
    if (options.runs.includes('loop') || options.runs.includes('parity')) {
      await withDsReact(async (storybook) => {
        environment = {
          chromium: spike.version,
          storybook: storybook.caps.version ?? 'unknown',
          framework: storybook.caps.framework ?? 'unknown',
          node: process.version,
          playwright: PLAYWRIGHT_VERSION,
          os: `${platform()} ${release()}`,
          cpus: cpus().length,
          cpuModel: cpus()[0]?.model ?? 'unknown',
        };
        const context = await spike.newContext();
        const page = await context.newPage();
        const ids = storybook.model.stories.map((story) => story.id);
        const meta = await loadStoryMetas(page, storybook.baseUrl, ids);
        await context.close();
        partial.metadata = { stories: ids.length, loadStoryMs: Math.round(meta.ms), readyMs: Math.round(meta.readyMs) };
        log(`loadStory: ${ids.length} stories in ${Math.round(meta.ms)} ms`);
        const planOptions = { count: options.variants, themeGlobal: { name: 'theme', value: 'dark' } } as const;
        const plan = buildPlan(meta.metas, planOptions);
        const interleaved = buildPlan(meta.metas, { ...planOptions, order: 'interleaved' });
        if (options.runs.includes('loop')) {
          const configs = [
            { name: 'channel', driver: 'channel', plan },
            { name: 'channel, default user agent', driver: 'channel', userAgent: 'default', plan },
            { name: 'channel, interleaved order', driver: 'channel', order: 'interleaved', plan: interleaved },
            {
              name: 'channel, interleaved, no args preset',
              driver: 'channel',
              presetArgs: false,
              order: 'interleaved',
              plan: interleaved,
            },
            { name: 'channel, 4 pages', driver: 'channel', pages: 4, plan },
            { name: 'url', driver: 'url', plan },
            { name: 'url, 4 pages', driver: 'url', pages: 4, plan },
            { name: 'url, interleaved order', driver: 'url', order: 'interleaved', plan: interleaved },
          ] as const;
          for (const config of configs) {
            const run = await runLoop(storybook, spike, config.plan, config);
            log(
              `${run.name}: ${run.variants} variants, ${run.failures} failed, p50 ${run.latency.p50} ms, p95 ${run.latency.p95} ms, ${run.throughput}/s`,
            );
            loops.push(run);
          }
        }
        if (options.runs.includes('parity')) {
          partial.parity = await runParity(storybook, plan);
          log(`parity: ${partial.parity.equal}/${partial.parity.sample} capture hashes equal`);
        }
      });
    }
    const faults = [];
    if (options.runs.includes('faults') || options.runs.includes('hmr')) {
      const sandbox = await prepareSandbox(log);
      if (options.runs.includes('faults')) {
        for (const driver of ['channel', 'url'] as const) {
          const run = await runFaults(sandbox.staticDir, spike, driver, options.variants);
          const detected = run.faults.filter((fault) => fault.detected).length;
          const recovered = run.faults.filter((fault) => fault.recovered).length;
          log(`faults (${driver}): ${detected}/${run.faults.length} detected, ${recovered} recovered`);
          faults.push(run);
        }
      }
      if (options.runs.includes('hmr')) {
        partial.hmr = await runHmr(sandbox.dir, spike, log);
        log(`hmr: ${partial.hmr.variants} variants, ${partial.hmr.failures} failed`);
      }
    }
    const results: Results = {
      format: RESULTS_FORMAT,
      environment: environment ?? {
        chromium: spike.version,
        storybook: 'see sandbox',
        framework: '@storybook/react-vite',
        node: process.version,
        playwright: PLAYWRIGHT_VERSION,
        os: `${platform()} ${release()}`,
        cpus: cpus().length,
        cpuModel: cpus()[0]?.model ?? 'unknown',
      },
      ...(partial.metadata === undefined ? {} : { metadata: partial.metadata }),
      loops,
      ...(partial.parity === undefined ? {} : { parity: partial.parity }),
      faults,
      ...(partial.hmr === undefined ? {} : { hmr: partial.hmr }),
    };
    await writeFile(target, formatResults(results));
    log(`results → ${target}`);
    if (spike.blocked.length > 0)
      throw new Error(`Requests outside 127.0.0.1 were blocked: ${spike.blocked.join(', ')}`);
  } finally {
    await spike.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
