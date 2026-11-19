import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@holotype/shared';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildSandbox,
  type DevServer,
  generateSandbox,
  installSandbox,
  startDevServer,
} from '../../../../tools/sandboxes/src/index.ts';
import { type ConnectedStorybook, connectStorybook, type RenderDriver, type RenderRequest } from '../../src';
import { closeBounded, docIdOf, expectError, expectOk, launchBrowser, loopbackContext } from './support';

/**
 * B-40 e2e: every fault kind of the S-07 injection run, through the channel driver, against the
 * `react-vite@10.6` sandbox with the `faults` overlay (`tools/sandboxes`). Each fault is followed
 * by a healthy render on the same page: the driver must recover. The last suite runs the dev
 * server and edits a CSF file while a render is in flight (S-07 Q6, Q10).
 */

const RENDER_TIMEOUT_MS = 3000;
const HEALTHY = 'faults-probe--healthy';

let outRoot: string;
let sandboxDir: string;
let storybook: ConnectedStorybook;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let driver: RenderDriver;
const outside: string[] = [];

beforeAll(async () => {
  outRoot = await mkdtemp(join(tmpdir(), 'holotype-sb-faults-e2e-'));
  const sandbox = await generateSandbox({ template: 'react-vite@10.6', overlays: ['faults'], outRoot });
  sandboxDir = sandbox.dir;
  await installSandbox(sandbox.dir);
  const staticDir = await buildSandbox(sandbox.dir, join(sandbox.dir, 'storybook-static'));
  storybook = unwrap(await connectStorybook({ source: { kind: 'static', dir: staticDir } }));
  browser = await launchBrowser();
  context = await loopbackContext(browser, outside);
  page = await context.newPage();
  driver = await storybook.openDriver(page, { renderTimeoutMs: RENDER_TIMEOUT_MS });
  expectOk(await driver.render({ storyId: HEALTHY }));
});

afterAll(async () => {
  await closeBounded(driver, page);
  await context?.close();
  await browser?.close();
  await storybook?.close();
  if (outRoot !== undefined) await rm(outRoot, { recursive: true, force: true });
});

/** The healthy probe after a fault: it renders, and shows its own label. */
async function recovers(label: string): Promise<void> {
  const result = expectOk(await driver.render({ storyId: HEALTHY, args: { label } }));
  expect(await result.rootHandles[0]?.evaluate((el) => el.textContent)).toBe(label);
  expect(result.warnings).toEqual([]);
}

const codes = (result: { warnings: readonly { code: string }[] }) => result.warnings.map((warning) => warning.code);

describe('fault kinds (S-07 failure injection)', () => {
  it('throws: SB_STORY_ERROR, then recovers', async () => {
    const failed = expectError(await driver.render({ storyId: 'faults-probe--throws' }));
    expect(failed.code).toBe('SB_STORY_ERROR');
    expect(failed.diagnostic.data).toMatchObject({ event: 'storyThrewException' });
    expect(String(failed.diagnostic.data?.message)).toContain('crashed on purpose');
    await recovers('after throws');
  });

  it('throws via args: SB_STORY_ERROR, then the same story renders again (remount, Q5)', async () => {
    const failed = expectError(await driver.render({ storyId: HEALTHY, args: { crash: true, label: 'Crash' } }));
    expect(failed.code).toBe('SB_STORY_ERROR');
    await recovers('after throws-args');
  });

  it('a story with args the URL cannot carry renders through the channel', async () => {
    const result = expectOk(await driver.render({ storyId: HEALTHY, args: { label: 'Hi <b>there</b> & more' } }));
    expect(await result.rootHandles[0]?.evaluate((el) => el.textContent)).toBe('Hi <b>there</b> & more');
  });

  it('never settles: SB_RENDER_TIMEOUT, then recovers on a fresh document (Q6)', async () => {
    const before = await docIdOf(page);
    const failed = expectError(await driver.render({ storyId: 'faults-probe--never-settles' }));
    expect(failed).toMatchObject({ code: 'SB_RENDER_TIMEOUT', attempts: 2 });
    expect(failed.diagnostic.data).toMatchObject({ timeoutMs: RENDER_TIMEOUT_MS });
    const next = expectOk(await driver.render({ storyId: HEALTHY, args: { label: 'after never-settles' } }));
    expect(next.via).toBe('boot');
    expect(await docIdOf(page)).not.toBe(before);
  });

  it('slow loader: renders after its delay', async () => {
    const started = Date.now();
    const result = expectOk(await driver.render({ storyId: 'faults-probe--slow-loader', args: { delayMs: 1500 } }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    expect(result.via).toBe('channel');
    await recovers('after slow-loader');
  });

  it('console error: renders with SB_CONSOLE_ERROR', async () => {
    const result = expectOk(await driver.render({ storyId: 'faults-probe--console-error' }));
    expect(codes(result)).toEqual(['SB_CONSOLE_ERROR']);
    expect(result.warnings[0]?.data).toMatchObject({ messages: [expect.stringContaining('logged on purpose')] });
    await recovers('after console-error');
  });

  it('play fails: SB_PLAY_ERROR (storyFinished says "success", Q4), not retried', async () => {
    const failed = expectError(await driver.render({ storyId: 'faults-probe--play-fails' }));
    expect(failed).toMatchObject({ code: 'SB_PLAY_ERROR', attempts: 1 });
    expect(failed.diagnostic.data).toMatchObject({ event: 'playFunctionThrewException' });
    await recovers('after play-fails');
  });

  it('unstable root: renders with CAP_UNSTABLE_RENDER (stricter check, Q17)', async () => {
    const result = expectOk(await driver.render({ storyId: 'faults-unstable--ticking', checkStability: true }));
    expect(codes(result)).toEqual(['CAP_UNSTABLE_RENDER']);
    expect(result.warnings[0]?.data).toMatchObject({ tries: 3 });
    await recovers('after unstable');
  });

  it('a stable root passes the same check', async () => {
    const result = expectOk(await driver.render({ storyId: HEALTHY, args: { label: 'stable' }, checkStability: true }));
    expect(result.warnings).toEqual([]);
  });

  it('React-node arg: a node from another story renders through the channel (Q15)', async () => {
    const request: RenderRequest = {
      storyId: 'faults-slots--empty',
      args: { content: { $fromStory: 'faults-slots--filled', arg: 'content' } },
    };
    const result = expectOk(await driver.render(request));
    expect(await result.rootHandles[0]?.evaluate((el) => el.querySelector('[data-filled]')?.textContent)).toBe(
      'Filled slot',
    );
    // The URL path cannot carry it.
    const urlPage = await context.newPage();
    const urlDriver = await storybook.openDriver(urlPage, { mode: 'url' });
    try {
      expect(expectError(await urlDriver.render(request)).code).toBe('SB_URL_ARG_UNENCODABLE');
    } finally {
      await closeBounded(urlDriver, urlPage);
    }
    await recovers('after react-node-arg');
  });

  it('made no request outside 127.0.0.1', () => {
    expect(outside).toEqual([]);
  });
});

describe('dev server and HMR (S-07 Q6, Q10)', () => {
  let server: DevServer | undefined;
  let devStorybook: ConnectedStorybook | undefined;
  let devPage: Page | undefined;
  let devDriver: RenderDriver | undefined;

  afterAll(async () => {
    await closeBounded(devDriver, devPage);
    await devStorybook?.close();
    await server?.stop();
  });

  it('adopts the document Storybook reloads during a render and flags SB_HMR_DURING_CAPTURE', async () => {
    server = await startDevServer(sandboxDir);
    devStorybook = unwrap(await connectStorybook({ source: server.url }));
    devPage = await context.newPage();
    let loads = 0;
    devPage.on('load', () => {
      loads += 1;
    });
    devDriver = await devStorybook.openDriver(devPage, { renderTimeoutMs: 15_000 });
    expectOk(await devDriver.render({ storyId: HEALTHY, args: { label: 'warm' } }));
    expectOk(await devDriver.render({ storyId: 'faults-probe--slow-loader', args: { delayMs: 100 } }));

    // Edit the CSF file 300 ms into a render whose loader takes 1.5 s: Storybook tears the render
    // down and reloads the preview by itself.
    const file = join(sandboxDir, 'src', 'faults', 'Probe.stories.tsx');
    const source = await readFile(file, 'utf8');
    const pending = devDriver.render({ storyId: 'faults-probe--slow-loader', args: { delayMs: 1500 } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await writeFile(file, `${source}\n// Edited by the B-40 e2e while the SlowLoader story was loading.\n`);
    try {
      const result = expectOk(await pending);
      expect(codes(result)).toContain('SB_HMR_DURING_CAPTURE');
      // The driver did not navigate over the reload: every load after the boot is Storybook's own.
      const next = expectOk(await devDriver.render({ storyId: HEALTHY, args: { label: 'after hmr' } }));
      expect(next.via).toBe('channel');
      expect(loads).toBeGreaterThanOrEqual(1);
    } finally {
      await writeFile(file, source);
    }
  });
});
