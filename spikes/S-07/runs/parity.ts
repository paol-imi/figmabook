/**
 * Capture parity: the real capture pipeline (`createCapturer`, B-11) over the channel driver
 * and over the URL driver, on a sample of the plan in plan order, compared by `captureHash`.
 */
import { type CaptureOutcome, createCapturer, VOLATILE_CAPTURE_FIELDS } from '@holotype/capture';
import type { ConnectedStorybook } from '@holotype/storybook';
import { firstDifference } from '../diff.ts';
import { sample, type Variant } from '../plan.ts';
import type { ParityRecord, ParityRun } from '../results.ts';
import { channelStorybook } from '../runtime.ts';

/**
 * The canonical capture without its volatile fields and with React `useId` values
 * (`_r_<base32>_` in React 19) replaced: they count mounts per page, so a warm page differs
 * from a fresh one.
 */
export function withoutReactIds(canonical: string): string {
  const doc = JSON.parse(canonical) as Record<string, unknown>;
  for (const field of VOLATILE_CAPTURE_FIELDS) delete doc[field];
  return JSON.stringify(doc).replace(/_r_[0-9a-z]+_/g, '_r_#_');
}

/** Every fifth variant: 40 of 200. */
export const PARITY_STEP = 5;

async function captureAll(
  storybook: Pick<ConnectedStorybook, 'openDriver' | 'origin'>,
  variants: readonly Variant[],
): Promise<{ outcomes: CaptureOutcome[]; wallMs: number }> {
  const executablePath = process.env.HOLOTYPE_CHROMIUM_PATH;
  const capturer = createCapturer({
    storybook,
    workers: 1,
    ...(executablePath === undefined || executablePath === '' ? {} : { chromiumPath: executablePath }),
  });
  const outcomes: CaptureOutcome[] = [];
  const started = performance.now();
  try {
    for (const variant of variants) {
      outcomes.push(await capturer.capture({ storyId: variant.storyId, args: variant.args, globals: variant.globals }));
    }
  } finally {
    await capturer.close();
  }
  return { outcomes, wallMs: performance.now() - started };
}

export async function runParity(storybook: ConnectedStorybook, plan: readonly Variant[]): Promise<ParityRun> {
  const variants = sample(plan, PARITY_STEP);
  const channel = await captureAll(channelStorybook(storybook), variants);
  const url = await captureAll(storybook, variants);
  const records: ParityRecord[] = variants.map((variant, position) => {
    const a = channel.outcomes[position];
    const b = url.outcomes[position];
    const channelHash = a?.ok ? a.hash : null;
    const urlHash = b?.ok ? b.hash : null;
    const equal = channelHash !== null && channelHash === urlHash;
    const difference =
      !equal && a?.ok && b?.ok
        ? firstDifference(JSON.parse(a.canonical), JSON.parse(b.canonical), VOLATILE_CAPTURE_FIELDS)
        : undefined;
    const equalIgnoringReactIds =
      equal || (a?.ok === true && b?.ok === true && withoutReactIds(a.canonical) === withoutReactIds(b.canonical));
    return {
      index: variant.index,
      label: variant.label,
      channelHash,
      urlHash,
      equal,
      equalIgnoringReactIds,
      ...(difference === undefined || difference === null ? {} : { difference }),
    };
  });
  return {
    sample: variants.length,
    equal: records.filter((record) => record.equal).length,
    equalIgnoringReactIds: records.filter((record) => record.equalIgnoringReactIds).length,
    channelWallMs: Math.round(channel.wallMs),
    urlWallMs: Math.round(url.wallMs),
    records,
  };
}
