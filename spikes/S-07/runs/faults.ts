/**
 * Failure injection on the `faults` sandbox: the fault plan through one driver on one page,
 * then every recovery probe re-rendered on a fresh page as the clean reference.
 */
import { unwrap } from '@holotype/shared';
import { connectStorybook, type RenderDriver, type RenderResult, type SbError } from '@holotype/storybook';
import type { Page } from 'playwright';
import type { ChannelDriver } from '../driver/channel-driver.ts';
import { type FaultVariant, faultPlan, meetsExpectation, type Observed } from '../faults.ts';
import type { FaultRecord, FaultRun, VariantRecord } from '../results.ts';
import { domSignature, openChannelDriver, rootHas, type SpikeBrowser } from '../runtime.ts';
import { summarize } from '../stats.ts';
import { recordOf } from './loop.ts';

/** A short render timeout keeps the hung-loader faults cheap; healthy renders take < 100 ms. */
export const FAULT_TIMEOUT_MS = 4000;

interface Rendered {
  readonly record: VariantRecord;
  readonly observed: Observed;
  readonly signature: string | null;
  readonly path?: 'boot' | 'channel';
}

async function renderVariant(
  page: Page,
  driver: RenderDriver | ChannelDriver,
  variant: FaultVariant,
  channel: ChannelDriver | undefined,
): Promise<Rendered> {
  const started = performance.now();
  const result: RenderResult | SbError = await driver.render({
    storyId: variant.storyId,
    args: variant.args,
    globals: variant.globals,
    ...(variant.stability === undefined ? {} : { stability: variant.stability }),
  });
  const ms = performance.now() - started;
  const record = recordOf(variant, result, ms, channel);
  const expect = variant.expect;
  const selectorFound =
    result.ok && expect.ok && expect.selector !== undefined ? await rootHas(page, expect.selector) : undefined;
  const signature = result.ok ? await domSignature(page) : null;
  if (result.ok) {
    await result.container.dispose();
    for (const handle of result.rootHandles) await handle.dispose();
  }
  return {
    record,
    observed: {
      ok: result.ok,
      ...(result.ok ? {} : { code: result.code }),
      warnings: record.warnings,
      ms,
      ...(selectorFound === undefined ? {} : { selectorFound }),
    },
    signature,
    ...(record.path === undefined ? {} : { path: record.path }),
  };
}

const describeExpectation = (variant: FaultVariant): string => {
  const { expect } = variant;
  if (!expect.ok) return expect.code;
  if (expect.warning !== undefined) return `ok + ${expect.warning}`;
  if (expect.minMs !== undefined) return `ok, ≥ ${expect.minMs} ms`;
  if (expect.selector !== undefined) return `ok, ${expect.selector} rendered`;
  return 'ok';
};

const describeObserved = (observed: Observed): string => {
  if (!observed.ok) return observed.code ?? 'error';
  const warnings = observed.warnings.length === 0 ? '' : ` + ${[...new Set(observed.warnings)].join(', ')}`;
  return `ok${warnings}`;
};

export async function runFaults(
  staticDir: string,
  spike: SpikeBrowser,
  driverKind: 'channel' | 'url',
  count: number,
): Promise<FaultRun> {
  const storybook = unwrap(await connectStorybook({ source: { kind: 'static', dir: staticDir } }));
  const plan = faultPlan(count);
  try {
    const context = await spike.newContext();
    const page = await context.newPage();
    const options = { renderTimeoutMs: FAULT_TIMEOUT_MS };
    const channel =
      driverKind === 'channel'
        ? await openChannelDriver(storybook, page, { ...options, stability: 'never' })
        : undefined;
    const driver = channel ?? (await storybook.openDriver(page, { ...options, mode: 'url' }));
    const rendered: Rendered[] = [];
    const wallStart = performance.now();
    for (const variant of plan) rendered.push(await renderVariant(page, driver, variant, channel));
    const wallMs = performance.now() - wallStart;
    await context.close();

    // Clean references: each recovery probe on its own fresh page.
    const references = new Map<number, string | null>();
    for (const variant of plan.filter((candidate) => candidate.recoveryOf !== null)) {
      const fresh = await spike.newContext();
      const freshPage = await fresh.newPage();
      const freshChannel =
        driverKind === 'channel'
          ? await openChannelDriver(storybook, freshPage, { ...options, stability: 'never' })
          : undefined;
      const freshDriver = freshChannel ?? (await storybook.openDriver(freshPage, { ...options, mode: 'url' }));
      const reference = await renderVariant(freshPage, freshDriver, variant, freshChannel);
      references.set(variant.index, reference.signature);
      await fresh.close();
    }

    const faults: FaultRecord[] = [];
    for (const variant of plan) {
      if (variant.fault === null) continue;
      const own = rendered[variant.index] as Rendered;
      const next = rendered[variant.index + 1];
      const reference = references.get(variant.index + 1);
      faults.push({
        index: variant.index,
        kind: variant.fault,
        expected: describeExpectation(variant),
        observed: describeObserved(own.observed),
        detected: meetsExpectation(variant.expect, own.observed),
        ms: Math.round(own.observed.ms),
        recovered: next?.observed.ok === true && next.signature !== null && next.signature === reference,
        recoveryMs: Math.round(next?.observed.ms ?? 0),
        ...(next?.path === undefined ? {} : { recoveryPath: next.path }),
        ...(next?.record.steps === undefined ? {} : { recoverySteps: next.record.steps.join('+') || 'skip' }),
        ...(own.record.planStable === undefined || own.record.planStable === null
          ? {}
          : { planHeuristic: own.record.planStable ? ('stable' as const) : ('unstable' as const) }),
      });
    }
    const healthy = plan.filter((variant) => variant.fault === null && variant.index > 0);
    const healthyRecords = healthy.map((variant) => (rendered[variant.index] as Rendered).record);
    return {
      driver: driverKind,
      variants: plan.length,
      wallMs: Math.round(wallMs),
      healthyLatency: summarize(
        healthy
          .filter((variant) => variant.recoveryOf === null)
          .map((variant) => (rendered[variant.index] as Rendered).record)
          .filter((record) => record.ok)
          .map((record) => record.ms),
      ),
      healthyFailures: healthyRecords.filter((record) => !record.ok).length,
      faults,
    };
  } finally {
    await storybook.close();
  }
}
