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
  close(): Promise<void>;
}

export async function openFixtureStorybook(): Promise<FixtureStorybook> {
  const prebuilt = process.env.HOLOTYPE_STORYBOOK_STATIC;
  let outDir: string | undefined;
  if (prebuilt === undefined || prebuilt === '') {
    outDir = await mkdtemp(join(tmpdir(), 'holotype-capture-e2e-'));
    await buildStorybook(outDir);
  }
  const storybook = unwrap(await connectStorybook({ source: { kind: 'static', dir: outDir ?? prebuilt ?? '' } }));
  return {
    storybook,
    close: async () => {
      await storybook.close();
      if (outDir !== undefined) await rm(outDir, { recursive: true, force: true });
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

export function expectCaptured(outcome: CaptureOutcome): CaptureSuccess {
  if (!outcome.ok) throw new Error(`capture failed: ${JSON.stringify(outcome.diagnostic)}`);
  return outcome;
}

/**
 * The golden form of a capture: volatile timing zeroed, the ephemeral server port and the
 * screenshot bytes hash replaced (the hash is checked across runs instead), pretty-printed
 * canonical JSON.
 */
export function goldenCapture(doc: CaptureDoc): string {
  const stable = stableCapture(doc);
  const url = new URL(stable.target.storybookUrl);
  url.port = '6006';
  const shot = stable.screenshot?.sha;
  let json = canonicalCapture({ ...stable, target: { ...stable.target, storybookUrl: url.href } });
  if (shot !== undefined) json = json.replaceAll(shot, '0'.repeat(64));
  return `${JSON.stringify(JSON.parse(json), null, 2)}\n`;
}
