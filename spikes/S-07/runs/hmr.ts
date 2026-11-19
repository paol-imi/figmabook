/// <reference lib="dom" />
/**
 * HMR and index changes mid-run on the sandbox dev server (03 §9.2): a channel loop runs
 * while the spike edits a stylesheet, a component, adds a CSF file and edits a CSF file's args.
 * Every edit is undone at the end.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startDevServer } from '@holotype/sandboxes';
import { unwrap } from '@holotype/shared';
import { connectStorybook } from '@holotype/storybook';
import type { Page } from 'playwright';
import { CONTROLLER_KEY, type PageEvent } from '../driver/page.ts';
import { summarizeEvents } from '../events.ts';
import { healthyPlan } from '../faults.ts';
import type { Json, Variant } from '../plan.ts';
import type { HmrEvent, HmrRun, VariantRecord } from '../results.ts';
import { openChannelDriver, type SpikeBrowser } from '../runtime.ts';
import { summarize } from '../stats.ts';
import { recordOf } from './loop.ts';

export const HMR_VARIANTS = 60;
const POLL_LIMIT_MS = 15_000;

const ADDED_FILE = 'src/stories/Added.stories.tsx';
const ADDED_STORY = 'example-added--fresh';
const ADDED_SOURCE = `import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.tsx';

const meta = { title: 'Example/Added', component: Button, args: { label: 'Added mid-run' } } satisfies Meta<typeof Button>;

export default meta;
export const Fresh: StoryObj<typeof meta> = {};
`;

interface Edit {
  readonly before: number;
  readonly name: string;
  /** Story rendered right before the edit, so the edit can be observed on it. */
  readonly storyId: string;
  readonly file: string;
  readonly change: (source: string) => string;
  /** In-page check that the change is visible; also passed to the render after it. */
  readonly visible: (page: Page) => Promise<boolean>;
  /** Make the edit this long after a render of `storyId` with `args` started (mid-render). */
  readonly during?: { readonly args: Readonly<Record<string, Json>>; readonly afterMs: number };
}

const EDITS: readonly Edit[] = [
  {
    before: 15,
    name: 'stylesheet (button.css)',
    storyId: 'example-button--primary',
    file: 'src/stories/button.css',
    change: (source) => source.replace('background-color: #1ea7fd;', 'background-color: #d9480f;'),
    visible: (page) =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector('#storybook-root button') ?? document.body).backgroundColor ===
          'rgb(217, 72, 15)',
      ),
  },
  {
    before: 30,
    name: 'component (Button.tsx)',
    storyId: 'example-button--primary',
    file: 'src/stories/Button.tsx',
    change: (source) => source.replace('type="button"', 'type="button"\n      data-edited="yes"'),
    visible: (page) => page.evaluate(() => document.querySelector('#storybook-root [data-edited]') !== null),
  },
  {
    before: 45,
    name: 'new CSF file (index change)',
    storyId: 'example-button--primary',
    file: ADDED_FILE,
    change: () => ADDED_SOURCE,
    visible: async () => false, // checked by rendering the new story
  },
  {
    before: 52,
    name: 'CSF args (Button.stories.tsx)',
    storyId: 'example-button--secondary',
    file: 'src/stories/Button.stories.tsx',
    change: (source) => source.replace("label: 'Button' }", "label: 'Edited' }"),
    visible: (page) => page.evaluate(() => document.querySelector('#storybook-root')?.textContent === 'Edited'),
  },
  {
    before: 56,
    name: 'CSF edit while a loader runs (Probe.stories.tsx)',
    storyId: 'faults-probe--slow-loader',
    file: 'src/faults/Probe.stories.tsx',
    change: (source) => `${source}\n// Edited by S-07 while the SlowLoader story was loading.\n`,
    visible: async () => true,
    during: { args: { delayMs: 1500 }, afterMs: 300 },
  },
];

async function eventsSince(page: Page, seq: number): Promise<{ events: PageEvent[]; last: number }> {
  return page
    .evaluate(
      ([key, mark]) => {
        const state = (window as unknown as Record<string, { events: PageEvent[] } | undefined>)[key];
        const events = state?.events ?? [];
        return { events: events.filter((entry) => entry.seq > mark), last: events.at(-1)?.seq ?? -1 };
      },
      [CONTROLLER_KEY, seq] as const,
    )
    .catch(() => ({ events: [], last: -1 }));
}

async function pollUntil(check: () => Promise<boolean>, limitMs: number): Promise<number | null> {
  const started = performance.now();
  while (performance.now() - started < limitMs) {
    if (await check().catch(() => false)) return Math.round(performance.now() - started);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

export async function runHmr(sandboxDir: string, spike: SpikeBrowser, log: (line: string) => void): Promise<HmrRun> {
  const originals = new Map<string, string>();
  for (const edit of EDITS) {
    if (edit.file !== ADDED_FILE) originals.set(edit.file, await readFile(join(sandboxDir, edit.file), 'utf8'));
  }
  const server = await startDevServer(sandboxDir);
  log(`dev server on ${server.url}`);
  const storybook = unwrap(await connectStorybook({ source: { kind: 'url', url: server.url } }));
  const storyIds = new Set([...storybook.model.stories, ...storybook.model.excluded].map((story) => story.id));
  const context = await spike.newContext();
  const page = await context.newPage();
  const driver = await openChannelDriver(storybook, page, { stability: 'never' }, storyIds);
  const plan = healthyPlan(HMR_VARIANTS);
  const records: VariantRecord[] = [];
  const edits: HmrEvent[] = [];
  const seenFiles = new Set<string>();
  const cold: number[] = [];
  const warm: number[] = [];

  const render = async (variant: Variant) => {
    const started = performance.now();
    const result = await driver.render({ storyId: variant.storyId, args: variant.args, globals: variant.globals });
    const ms = performance.now() - started;
    const record = recordOf(variant, result, ms, driver);
    records.push(record);
    const file = variant.storyId.split('--')[0] ?? '';
    if (record.ok) (seenFiles.has(file) ? warm : cold).push(ms);
    seenFiles.add(file);
    if (result.ok) {
      await result.container.dispose();
      for (const handle of result.rootHandles) await handle.dispose();
    }
    return result;
  };

  try {
    for (const variant of plan) {
      const edit = EDITS.find((candidate) => candidate.before === variant.index);
      if (edit?.during !== undefined) {
        const { last } = await eventsSince(page, Number.MAX_SAFE_INTEGER);
        const path = join(sandboxDir, edit.file);
        const started = performance.now();
        const pending = render({
          ...variant,
          index: -1,
          storyId: edit.storyId,
          args: edit.during.args,
          label: edit.name,
        });
        await new Promise((resolve) => setTimeout(resolve, edit.during?.afterMs));
        await writeFile(path, edit.change(await readFile(path, 'utf8')));
        const result = await pending;
        const stats = driver.lastStats();
        const warnings = [...new Set(result.warnings.map((warning) => warning.code))];
        const outcome = result.ok ? 'ok' : result.code;
        const note = `render ${outcome}${warnings.length === 0 ? '' : ` + ${warnings.join(', ')}`}; ${
          stats?.selfReloads ?? 0
        } preview reload(s), path ${stats?.path ?? '?'}`;
        const { events } = await eventsSince(page, last);
        edits.push({
          atVariant: variant.index,
          edit: edit.name,
          events: summarizeEvents(events),
          visibleAfterMs: Math.round(performance.now() - started),
          note,
        });
        log(`hmr: ${edit.name}: ${note}`);
      } else if (edit !== undefined) {
        await render({ ...variant, index: -1, storyId: edit.storyId, args: {}, label: `before ${edit.name}` });
        const { last } = await eventsSince(page, Number.MAX_SAFE_INTEGER);
        const path = join(sandboxDir, edit.file);
        const source = edit.file === ADDED_FILE ? '' : await readFile(path, 'utf8');
        await writeFile(path, edit.change(source));
        let visibleAfterMs: number | null;
        let note: string;
        if (edit.file === ADDED_FILE) {
          const seen = new Set<string>();
          let indexedAfterMs: number | null = null;
          const written = performance.now();
          visibleAfterMs = await pollUntil(async () => {
            const index = (await (await fetch(new URL('index.json', server.url))).json()) as {
              entries: Record<string, unknown>;
            };
            if (!(ADDED_STORY in index.entries)) return false;
            indexedAfterMs ??= Math.round(performance.now() - written);
            storyIds.add(ADDED_STORY);
            const result = await driver.render({ storyId: ADDED_STORY });
            if (result.ok) {
              await result.container.dispose();
              for (const handle of result.rootHandles) await handle.dispose();
            } else {
              seen.add(result.code);
            }
            return result.ok;
          }, POLL_LIMIT_MS);
          const before = seen.size === 0 ? '' : ` (${[...seen].join(', ')} before that)`;
          note =
            visibleAfterMs === null
              ? 'the new story never rendered through the channel'
              : `index.json listed it after ${indexedAfterMs ?? '?'} ms; rendered through the channel without a reload${before}`;
        } else {
          visibleAfterMs = await pollUntil(() => edit.visible(page), POLL_LIMIT_MS);
          // The next channel render of the same story must keep the change.
          const again = await render({ ...variant, index: -1, storyId: edit.storyId, args: {}, label: 'after edit' });
          const kept = again.ok && (await edit.visible(page).catch(() => false));
          note = `${visibleAfterMs === null ? 'not visible in place' : 'visible in place'}; next channel render ${
            again.ok ? (kept ? 'kept it' : 'lost it') : `failed (${again.code})`
          }`;
        }
        const { events } = await eventsSince(page, last);
        edits.push({
          atVariant: variant.index,
          edit: edit.name,
          events: summarizeEvents(events),
          visibleAfterMs,
          note,
        });
        log(`hmr: ${edit.name}: ${note} (${visibleAfterMs ?? '–'} ms)`);
      }
      await render(variant);
    }
  } finally {
    await context.close();
    await storybook.close();
    await server.stop();
    for (const [file, source] of originals) await writeFile(join(sandboxDir, file), source);
    await rm(join(sandboxDir, ADDED_FILE), { force: true });
  }
  const planned = records.filter((record) => record.index >= 0);
  return {
    caps: { version: storybook.caps.version, storyFinishedEvent: storybook.caps.storyFinishedEvent },
    variants: planned.length,
    failures: planned.filter((record) => !record.ok).length,
    latency: summarize(warm),
    coldLatency: summarize(cold),
    edits,
    records,
  };
}
