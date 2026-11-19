/**
 * The 200-variant loop on `fixtures/ds-react`: the same plan through the channel driver
 * (with and without the test-runner user agent, with and without args presetting) and
 * through the B-10 URL driver, one page each.
 */
import type { ConnectedStorybook, RenderResult, SbError } from '@holotype/storybook';
import type { ChannelDriver } from '../driver/channel-driver.ts';
import { lanes, type Variant } from '../plan.ts';
import type { LoopRun, VariantRecord } from '../results.ts';
import { openChannelDriver, type SpikeBrowser } from '../runtime.ts';
import { summarize, throughput } from '../stats.ts';

export interface LoopOptions {
  readonly name: string;
  readonly driver: 'channel' | 'url';
  readonly userAgent?: 'test-runner' | 'default';
  readonly presetArgs?: boolean;
  /** Pages rendering in parallel, components split across them (default 1). */
  readonly pages?: number;
  /** How the plan was ordered (`buildPlan` `order`), for the report. */
  readonly order?: 'grouped' | 'interleaved';
  readonly renderTimeoutMs?: number;
}

export function recordOf(
  variant: Variant,
  result: RenderResult | SbError,
  ms: number,
  channel?: ChannelDriver,
): VariantRecord {
  const stats = channel?.lastStats();
  return {
    index: variant.index,
    storyId: variant.storyId,
    ok: result.ok,
    ...(result.ok ? {} : { code: result.code }),
    warnings: result.warnings.map((warning) => warning.code),
    ms: Math.round(ms * 10) / 10,
    ...(stats === undefined
      ? {}
      : {
          steps: stats.steps.map((step) => step.step),
          stepMs: stats.steps.map((step) => Math.round(step.ms * 10) / 10),
          settleMs: Math.round(stats.settleMs * 10) / 10,
          renders: stats.renders,
          path: stats.path,
          ...(stats.stable === null ? {} : { stable: stats.stable, planStable: stats.planStable }),
        }),
  };
}

async function runLane(
  storybook: ConnectedStorybook,
  spike: SpikeBrowser,
  plan: readonly Variant[],
  options: LoopOptions,
  userAgent: 'test-runner' | 'default',
): Promise<VariantRecord[]> {
  const context = await spike.newContext(userAgent);
  const page = await context.newPage();
  const timeout = options.renderTimeoutMs === undefined ? {} : { renderTimeoutMs: options.renderTimeoutMs };
  const channel =
    options.driver === 'channel'
      ? await openChannelDriver(storybook, page, {
          ...timeout,
          ...(options.presetArgs === undefined ? {} : { presetArgs: options.presetArgs }),
          stability: 'never',
        })
      : undefined;
  const driver = channel ?? (await storybook.openDriver(page, { ...timeout, mode: 'url' }));
  const records: VariantRecord[] = [];
  for (const variant of plan) {
    const started = performance.now();
    const result = await driver.render({ storyId: variant.storyId, args: variant.args, globals: variant.globals });
    records.push(recordOf(variant, result, performance.now() - started, channel));
    if (result.ok) {
      await result.container.dispose();
      for (const handle of result.rootHandles) await handle.dispose();
    }
  }
  await driver.dispose();
  await context.close();
  return records;
}

export async function runLoop(
  storybook: ConnectedStorybook,
  spike: SpikeBrowser,
  plan: readonly Variant[],
  options: LoopOptions,
): Promise<LoopRun> {
  const userAgent = options.userAgent ?? 'test-runner';
  const split = lanes(plan, options.pages ?? 1);
  const wallStart = performance.now();
  const laneRecords = await Promise.all(split.map((lane) => runLane(storybook, spike, lane, options, userAgent)));
  const wallMs = performance.now() - wallStart;
  const records = laneRecords.flat().sort((a, b) => a.index - b.index);

  const ok = records.filter((record) => record.ok);
  // The first render of each page boots the preview in both drivers; it is reported, not averaged.
  const boots = new Set(split.map((lane) => lane[0]?.index));
  const steady = ok.filter((record) => !boots.has(record.index));
  const switches = steady.filter((record) => record.steps?.includes('select'));
  const argsOnly = steady.filter((record) => record.steps !== undefined && !record.steps.includes('select'));
  return {
    name: options.name,
    driver: options.driver,
    userAgent,
    ...(options.presetArgs === undefined ? {} : { presetArgs: options.presetArgs }),
    order: options.order ?? 'grouped',
    pages: split.length,
    variants: plan.length,
    failures: records.length - ok.length,
    wallMs: Math.round(wallMs),
    throughput: throughput(records.length, wallMs),
    latency: summarize(steady.map((record) => record.ms)),
    ...(options.driver === 'channel'
      ? {
          bySwitch: {
            switch: summarize(switches.map((record) => record.ms)),
            argsOnly: summarize(argsOnly.map((record) => record.ms)),
          },
          rendersPerVariant:
            Math.round((records.reduce((sum, record) => sum + (record.renders ?? 0), 0) / records.length) * 100) / 100,
        }
      : {}),
    records,
  };
}
