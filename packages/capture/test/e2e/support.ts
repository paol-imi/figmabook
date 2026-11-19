import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureDoc } from '@holotype/ir';
import { unwrap } from '@holotype/shared';
import { type ConnectedStorybook, connectStorybook } from '@holotype/storybook';
import type { Page } from 'playwright';
import { buildStorybook } from '../../../../fixtures/ds-react/test/support/storybook.ts';
import { canonicalCapture, stableCapture } from '../../src';
import type { CaptureOutcome, CaptureSuccess } from '../../src/types';

/** A fixture Storybook served on 127.0.0.1: built fresh, or `HOLOTYPE_STORYBOOK_STATIC` when set. */
export interface FixtureStorybook {
  readonly storybook: ConnectedStorybook;
  /** The static build directory. */
  readonly dir: string;
  close(): Promise<void>;
}

export async function openFixtureStorybook(): Promise<FixtureStorybook> {
  const prebuilt = process.env.HOLOTYPE_STORYBOOK_STATIC;
  let tempDir: string | undefined;
  let dir = prebuilt ?? '';
  if (prebuilt === undefined || prebuilt === '') {
    tempDir = await mkdtemp(join(tmpdir(), 'holotype-capture-e2e-'));
    dir = join(tempDir, 'storybook-static');
    await buildStorybook(dir);
  }
  const storybook = unwrap(await connectStorybook({ source: { kind: 'static', dir } }));
  return {
    storybook,
    dir,
    close: async () => {
      await storybook.close();
      if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
    },
  };
}

/** `HOLOTYPE_CHROMIUM_PATH`, when set (as in the storybook e2e). */
export function chromiumPath(): { chromiumPath?: string } {
  const path = process.env.HOLOTYPE_CHROMIUM_PATH;
  return path === undefined || path === '' ? {} : { chromiumPath: path };
}

/** Requests outside 127.0.0.1, collected and aborted (BUILD §3.1 rule 8). */
export function loopbackOnly(outside: string[]): (page: Page) => Promise<void> {
  return async (page) => {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'data:' || url.protocol === 'blob:' || url.hostname === '127.0.0.1') {
        await route.fallback();
      } else {
        outside.push(url.href);
        await route.abort('blockedbyclient');
      }
    });
  };
}

/** Requests outside 127.0.0.1, collected but not routed: routing changes what Chromium fetches. */
export function watchLoopback(page: Page, outside: string[]): void {
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.hostname !== '127.0.0.1') outside.push(url.href);
  });
}

export function expectCaptured(outcome: CaptureOutcome): CaptureSuccess {
  if (!outcome.ok) throw new Error(`capture failed: ${JSON.stringify(outcome.diagnostic)}`);
  return outcome;
}

/** The screenshot's stand-in key in goldens. */
const GOLDEN_SHOT = '0'.repeat(64);

/**
 * The golden form of a capture: volatile timing zeroed, the static build's folder name (it
 * differs under `HOLOTYPE_STORYBOOK_STATIC`), and the screenshot's hash and encoded size
 * replaced, pretty-printed canonical JSON. PNG bytes differ between Chromium builds and
 * machines even when the layout is identical, so the screenshot is compared across runs on
 * the same machine instead (the capture hash), never against the committed golden.
 */
export function goldenCapture(doc: CaptureDoc): string {
  const stable = stableCapture(doc);
  const storybookUrl = stable.target.storybookUrl.replace(/^static:[^/]*/, 'static:storybook-static');
  const shot = stable.screenshot?.sha;
  let json = canonicalCapture({ ...stable, target: { ...stable.target, storybookUrl } });
  if (shot !== undefined) json = json.replaceAll(shot, GOLDEN_SHOT);
  const golden = JSON.parse(json) as { assets?: Record<string, { bytes?: number }> };
  const asset = golden.assets?.[GOLDEN_SHOT];
  if (shot !== undefined && asset?.bytes !== undefined) asset.bytes = 0;
  return `${JSON.stringify(golden, null, 2)}\n`;
}
