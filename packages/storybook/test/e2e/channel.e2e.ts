import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@holotype/shared';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildStorybook } from '../../../../fixtures/ds-react/test/support/storybook.ts';
import { type ConnectedStorybook, connectStorybook, type RenderDriver, type RenderRequest } from '../../src';
import {
  closeBounded,
  docIdOf,
  expectError,
  expectOk,
  launchBrowser,
  loopbackContext,
  recordMetric,
  TEST_RUNNER_AGENT,
} from './support';

/**
 * B-40 e2e: the channel render loop (03 §5.3, S-07 protocol) against a fresh static build of
 * `fixtures/ds-react`, in headless Chromium with the D-24 test-runner user agent.
 */

let outDir: string;
let storybook: ConnectedStorybook;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let driver: RenderDriver;
const outside: string[] = [];

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'holotype-sb-channel-e2e-'));
  await buildStorybook(outDir);
  storybook = unwrap(await connectStorybook({ source: { kind: 'static', dir: outDir } }));
  browser = await launchBrowser();
  context = await loopbackContext(browser, outside);
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await storybook?.close();
  if (outDir !== undefined) await rm(outDir, { recursive: true, force: true });
});

/** Document loads of the page: the channel loop must not add any after its boot. */
let loads = 0;

beforeEach(async () => {
  page = await context.newPage();
  loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  driver = await storybook.openDriver(page);
});

afterEach(async () => {
  await closeBounded(driver, page);
});

/** Storybook done events recorded in the page since the document booted. */
const doneEvents = (): Promise<number> =>
  page.evaluate(
    () =>
      (
        window as unknown as { __holotypeSbChannel: { events: { event: string; dir: string }[] } }
      ).__holotypeSbChannel.events.filter((entry) => entry.dir === 'out' && entry.event === 'storyFinished').length,
  );

const rootText = async (request: RenderRequest): Promise<string | null> => {
  const result = expectOk(await driver.render(request));
  return (await result.rootHandles[0]?.evaluate((el) => el.textContent)) ?? null;
};

const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

describe('channel render loop', () => {
  it('renders 50 different stories on one page without a reload', async () => {
    const stories = (await storybook.listStories()).slice(0, 50);
    expect(stories).toHaveLength(50);
    const times: number[] = [];
    const started = Date.now();
    let docId: string | null = null;
    for (const [index, story] of stories.entries()) {
      const t0 = Date.now();
      const result = expectOk(await driver.render({ storyId: story.id }));
      times.push(Date.now() - t0);
      expect(result.storyId).toBe(story.id);
      expect(result.via).toBe(index === 0 ? 'boot' : 'channel');
      expect(result.rootHandles.length).toBeGreaterThan(0);
      expect(result.warnings).toEqual([]);
      if (index === 0) docId = await docIdOf(page);
    }
    const wallMs = Date.now() - started;
    expect(driver.mode).toBe('channel');
    expect(loads).toBe(1);
    expect(await docIdOf(page)).toBe(docId);
    // One Storybook render per story switch: the args are preset before `setCurrentStory` (S-07 Q8).
    expect(await doneEvents()).toBe(50);
    const warm = times.slice(1).sort((a, b) => a - b);
    await recordMetric(
      `channel loop: 50 stories in ${wallMs} ms (${((50 * 1000) / wallMs).toFixed(1)}/s), boot ${times[0]} ms, ` +
        `warm p50 ${percentile(warm, 0.5)} ms, p95 ${percentile(warm, 0.95)} ms, max ${warm.at(-1)} ms`,
    );
  });

  it('renders 100 variants (args, globals, switches) on one page; measures throughput without stability checks', async () => {
    const fast = await storybook.openDriver(page, { stability: 'never' });
    const stories = (await storybook.listStories()).slice(0, 50);
    const variants: RenderRequest[] = stories.flatMap((story, i) => [
      { storyId: story.id },
      i % 2 === 0 ? { storyId: story.id, globals: { theme: 'dark' } } : { storyId: story.id, remount: true },
    ]);
    const times: number[] = [];
    const started = Date.now();
    for (const request of variants) {
      const t0 = Date.now();
      expectOk(await fast.render(request));
      times.push(Date.now() - t0);
    }
    const wallMs = Date.now() - started;
    expect(loads).toBe(1);
    const warm = times.slice(1).sort((a, b) => a - b);
    await recordMetric(
      `channel loop, no stability check: ${variants.length} variants in ${wallMs} ms ` +
        `(${((variants.length * 1000) / wallMs).toFixed(1)}/s), warm p50 ${percentile(warm, 0.5)} ms, ` +
        `p95 ${percentile(warm, 0.95)} ms, max ${warm.at(-1)} ms`,
    );
    await fast.dispose();
  });

  it('applies the full arg set: initial values come back, undefined unsets, args persist per story (Q1, Q2)', async () => {
    expect(await rootText({ storyId: 'components-button--primary', args: { label: 'Saved' } })).toBe('Saved');
    expect(await rootText({ storyId: 'components-badge--default' })).toBe('Badge');
    // Storybook kept `label: 'Saved'` for the button; the driver sends the full set back.
    expect(await rootText({ storyId: 'components-button--primary' })).toBe('Button');
    expect(await rootText({ storyId: 'components-button--primary', args: { label: undefined } })).toBe('');
    expect(await rootText({ storyId: 'components-button--primary', args: { label: 'Again' } })).toBe('Again');
  });

  it('skips a render that would change nothing (Q3), and switches with one render (Q8)', async () => {
    expectOk(await driver.render({ storyId: 'components-button--primary', args: { label: 'One' } }));
    const before = await doneEvents();
    expectOk(await driver.render({ storyId: 'components-button--primary', args: { label: 'One' } }));
    expect(await doneEvents()).toBe(before);
    expectOk(await driver.render({ storyId: 'components-badge--default', args: { label: 'Two' } }));
    expect(await doneEvents()).toBe(before + 1);
  });

  it('applies globals over initialGlobals and resets them when left out', async () => {
    const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expectOk(await driver.render({ storyId: 'components-card--default', globals: { theme: 'dark' } }));
    expect(await theme()).toBe('dark');
    expectOk(await driver.render({ storyId: 'components-card--default' }));
    expect(await theme()).toBe('light');
  });

  it('remounts on request', async () => {
    expectOk(await driver.render({ storyId: 'components-input--default' }));
    await page.fill('#storybook-root input', 'typed');
    expectOk(await driver.render({ storyId: 'components-input--default' }));
    expect(await page.inputValue('#storybook-root input')).toBe('typed');
    expectOk(await driver.render({ storyId: 'components-input--default', remount: true }));
    expect(await page.inputValue('#storybook-root input')).toBe('');
  });

  it('forces the fullscreen layout, keeps the padded one with keepLayout, then forces it again', async () => {
    const padding = () => page.evaluate(() => getComputedStyle(document.body).paddingTop);
    expectOk(await driver.render({ storyId: 'micro-flex--row' }));
    expect(await padding()).toBe('0px');
    expectOk(await driver.render({ storyId: 'micro-flex--row', keepLayout: true }));
    expect(await padding()).toBe('16px');
    expectOk(await driver.render({ storyId: 'micro-flex--column' }));
    expect(await padding()).toBe('0px');
  });

  it('honours the viewport and a rootSelector, and reports SB_ROOT_NOT_FOUND', async () => {
    const result = expectOk(
      await driver.render({
        storyId: 'components-button--primary',
        viewport: { width: 640, height: 480 },
        rootSelector: '#storybook-root > button',
      }),
    );
    expect(page.viewportSize()).toEqual({ width: 640, height: 480 });
    expect(await result.container.evaluate((el) => el.tagName)).toBe('BUTTON');
    const failed = expectError(await driver.render({ storyId: 'components-button--primary', rootSelector: '#nope' }));
    expect(failed.code).toBe('SB_ROOT_NOT_FOUND');
  });

  it('matches the URL path: same markup and geometry for the same variants', async () => {
    const variants: RenderRequest[] = [
      { storyId: 'components-button--primary', args: { label: 'Parity', variant: 'secondary' } },
      { storyId: 'components-badge--tones' },
      { storyId: 'components-card--default', globals: { theme: 'dark' } },
      { storyId: 'components-card--default' },
      { storyId: 'micro-text--mixed-inline' },
      { storyId: 'components-stack--row' },
    ];
    const signature = async (request: RenderRequest, on: RenderDriver, where: Page) => {
      expectOk(await on.render(request));
      return where.evaluate(() => {
        const root = document.querySelector('#storybook-root') as Element;
        const rects = [root, ...root.querySelectorAll('*')].map((el) => JSON.stringify(el.getBoundingClientRect()));
        return `${root.outerHTML}\n${rects.join(';')}\n${document.documentElement.getAttribute('data-theme')}`;
      });
    };
    const urlPage = await context.newPage();
    const urlDriver = await storybook.openDriver(urlPage, { mode: 'url' });
    try {
      for (const request of variants) {
        expect(await signature(request, driver, page)).toBe(await signature(request, urlDriver, urlPage));
      }
    } finally {
      await closeBounded(urlDriver, urlPage);
    }
  });

  it('adds the test-runner marker for a context without it (D-24, S-07 Q7)', async () => {
    const plain = await loopbackContext(browser, outside, 'Mozilla/5.0 HeadlessChrome/153');
    const plainPage = await plain.newPage();
    const plainDriver = await storybook.openDriver(plainPage);
    try {
      expectOk(await plainDriver.render({ storyId: 'components-badge--default' }));
      expect(await plainPage.evaluate(() => navigator.userAgent)).toBe(
        'Mozilla/5.0 HeadlessChrome/153 StorybookTestRunner',
      );
      expect(await page.evaluate(() => navigator.userAgent)).toBe(TEST_RUNNER_AGENT);
    } finally {
      await closeBounded(plainDriver, plainPage);
      await plain.close();
    }
  });

  it('reload() leaves the preview; the next render boots a fresh document', async () => {
    expectOk(await driver.render({ storyId: 'components-badge--default' }));
    const first = await docIdOf(page);
    await driver.reload();
    expect(page.url()).toBe('about:blank');
    const result = expectOk(await driver.render({ storyId: 'components-badge--default' }));
    expect(result.via).toBe('boot');
    expect(await docIdOf(page)).not.toBe(first);
  });
});

describe('channel failures', () => {
  it('reports a story that throws as SB_STORY_ERROR (retried on a fresh document), and the next render succeeds', async () => {
    let rewritten = false;
    await page.route('**/assets/Icon.stories-*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const broken = body.replace(/name:\s*(["'`])star\1/, 'name:`no-such-icon`');
      rewritten = broken !== body;
      await route.fulfill({ response, body: broken });
    });
    expectOk(await driver.render({ storyId: 'components-badge--default' }));
    const failed = expectError(await driver.render({ storyId: 'components-icon--default' }));
    expect(rewritten).toBe(true);
    expect(failed).toMatchObject({ code: 'SB_STORY_ERROR', attempts: 2, via: 'boot' });
    expect(failed.diagnostic).toMatchObject({
      code: 'SB_STORY_ERROR',
      sid: 'components-icon',
      data: { storyId: 'components-icon--default', event: 'storyThrewException' },
    });
    expect(failed.warnings.map((warning) => warning.code)).toContain('SB_CONSOLE_ERROR');
    await page.unrouteAll();
    const next = expectOk(await driver.render({ storyId: 'components-button--primary' }));
    expect(next.via).toBe('channel');
  });

  it('throws through args, then renders the same story again after a remount (Q5)', async () => {
    expectOk(await driver.render({ storyId: 'components-icon--default' }));
    const failed = expectError(await driver.render({ storyId: 'components-icon--default', args: { name: 'nope' } }));
    expect(failed.code).toBe('SB_STORY_ERROR');
    const healed = expectOk(await driver.render({ storyId: 'components-icon--default', args: { name: 'check' } }));
    expect(healed.rootHandles).toHaveLength(1);
    expect(await page.evaluate(() => document.body.classList.contains('sb-show-errordisplay'))).toBe(false);
  });

  it('reports a story whose CSF file fails to load as SB_STORY_LOAD_FAILED, then goes on', async () => {
    await page.route('**/assets/Badge.stories-*.js', (route) => route.abort('failed'));
    const failed = expectError(await driver.render({ storyId: 'components-badge--default' }));
    expect(failed.code).toBe('SB_STORY_LOAD_FAILED');
    expect(failed.diagnostic.data).toMatchObject({ event: 'loadStory' });
    expectOk(await driver.render({ storyId: 'components-button--primary' }));
  });

  it('reports an id that is not in the index as SB_STORY_MISSING without navigating', async () => {
    const failed = expectError(await driver.render({ storyId: 'components-button--no-such-story' }));
    expect(failed.code).toBe('SB_STORY_MISSING');
    expect(page.url()).toBe('about:blank');
  });

  it('reports SB_RENDER_TIMEOUT, retries on a fresh document, and boots fresh for the next render (Q6)', async () => {
    const short = await storybook.openDriver(page, { renderTimeoutMs: 1500 });
    expectOk(await short.render({ storyId: 'components-badge--default' }));
    await page.route('**/assets/Button.stories-*.js', () => {});
    const failed = expectError(await short.render({ storyId: 'components-button--primary' }));
    expect(failed).toMatchObject({ code: 'SB_RENDER_TIMEOUT', attempts: 2 });
    expect(failed.diagnostic.data).toMatchObject({ timeoutMs: 1500 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const next = expectOk(await short.render({ storyId: 'components-badge--tones' }));
    expect(next.via).toBe('boot');
    await short.dispose();
  });

  it('marks a story SB_STORY_UNRENDERABLE after three failed fresh documents (03 §5.3)', async () => {
    const short = await storybook.openDriver(page, { renderTimeoutMs: 800 });
    await page.route('**/assets/Button.stories-*.js', () => {});
    const codes: string[] = [];
    for (let i = 0; i < 3; i += 1)
      codes.push(expectError(await short.render({ storyId: 'components-button--primary' })).code);
    expect(codes).toEqual(['SB_RENDER_TIMEOUT', 'SB_STORY_UNRENDERABLE', 'SB_STORY_UNRENDERABLE']);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const marked = expectError(await short.render({ storyId: 'components-button--primary' }));
    expect(marked.diagnostic).toMatchObject({
      code: 'SB_STORY_UNRENDERABLE',
      data: { reloads: 3, lastCode: 'SB_RENDER_TIMEOUT' },
    });
    expectOk(await short.render({ storyId: 'components-badge--default' }));
    await short.dispose();
  });

  it('reports SB_PREVIEW_INIT_TIMEOUT when the preview never boots', async () => {
    const short = await storybook.openDriver(page, { renderTimeoutMs: 1500 });
    await page.route('**/assets/iframe-*.js', () => {});
    const failed = expectError(await short.render({ storyId: 'components-button--primary' }));
    expect(failed.code).toBe('SB_PREVIEW_INIT_TIMEOUT');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  it('reports SB_IFRAME_UNREACHABLE when iframe.html fails, and dispose() returns promptly', async () => {
    await page.route('**/iframe.html?*', (route) => route.fulfill({ status: 503, body: 'down' }));
    const failed = expectError(await driver.render({ storyId: 'components-button--primary' }));
    expect(failed.code).toBe('SB_IFRAME_UNREACHABLE');
    expect(failed.diagnostic.value).toBe('HTTP 503');
    const started = Date.now();
    expect(await driver.dispose()).toEqual({ forced: 'none' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('closes a page that stopped answering on dispose(), within its bound', async () => {
    // Its own context: when closing the page hangs too, dispose() closes the context.
    const own = await loopbackContext(browser, outside);
    const stuckPage = await own.newPage();
    const stuck = await storybook.openDriver(stuckPage, { disposeTimeoutMs: 500 });
    expectOk(await stuck.render({ storyId: 'components-badge--default' }));
    // Block the page's main thread: nothing it is asked answers any more.
    void stuckPage
      .evaluate(() => {
        for (;;) {
          // busy
        }
      })
      .catch(() => undefined);
    const started = Date.now();
    const report = await stuck.dispose();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(report).toMatchObject({
      forced: expect.stringMatching(/^(page|context)$/),
      reason: 'the page did not answer within 500 ms of dispose()',
    });
    await own.close().catch(() => undefined);
  });

  it('falls back to the URL path when the preview has no channel API', async () => {
    // Hide the story store from outside the preview: Storybook itself keeps working.
    await page.addInitScript(() => {
      let real: object | undefined;
      Object.defineProperty(window, '__STORYBOOK_PREVIEW__', {
        configurable: true,
        get: () =>
          real === undefined
            ? undefined
            : new Proxy(real, {
                get: (target, key) => (key === 'storyStoreValue' ? undefined : Reflect.get(target, key)),
              }),
        set: (value: object) => {
          real = value;
        },
      });
    });
    const result = expectOk(
      await driver.render({ storyId: 'components-button--primary', args: { label: 'Fallback' } }),
    );
    expect(driver.mode).toBe('url');
    expect(result.via).toBe('url');
    expect(await result.rootHandles[0]?.evaluate((el) => el.textContent)).toBe('Fallback');
    expect(expectOk(await driver.render({ storyId: 'components-badge--default' })).via).toBe('url');
  });

  it('made no request outside 127.0.0.1', () => {
    expect(outside).toEqual([]);
  });
});
