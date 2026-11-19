import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@holotype/shared';
import { type Browser, type BrowserContext, chromium, type LaunchOptions, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildStorybook } from '../../../../fixtures/ds-react/test/support/storybook.ts';
import { type ConnectedStorybook, connectStorybook, type RenderDriver } from '../../src';
import { closeBounded, expectError, expectOk } from './support';

/**
 * B-10 e2e: discovery and URL renders (`mode: 'url'`, 03 §5.4) against a fresh static build of
 * `fixtures/ds-react`, served by the adapter itself on 127.0.0.1, in headless Chromium. The
 * channel loop has its own suite (`channel.e2e.ts`).
 */

let outDir: string;
let storybook: ConnectedStorybook;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let driver: RenderDriver;
const outsideRequests: string[] = [];

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'holotype-sb-e2e-'));
  await buildStorybook(outDir);
  storybook = unwrap(await connectStorybook({ source: { kind: 'static', dir: outDir } }));

  const launch: LaunchOptions = {};
  const executablePath = process.env.HOLOTYPE_CHROMIUM_PATH;
  if (executablePath !== undefined && executablePath !== '') launch.executablePath = executablePath;
  browser = await chromium.launch(launch);
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  // Tests talk only to 127.0.0.1 (BUILD §3.1 rule 8).
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.hostname === '127.0.0.1') {
      await route.fallback();
    } else {
      outsideRequests.push(url.href);
      await route.abort('blockedbyclient');
    }
  });
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await storybook?.close();
  if (outDir !== undefined) await rm(outDir, { recursive: true, force: true });
});

beforeEach(async () => {
  page = await context.newPage();
  driver = await storybook.openDriver(page, { mode: 'url' });
});

afterEach(async () => {
  // Bounded: a page stuck under load fails the test instead of hanging the hook.
  await closeBounded(driver, page);
});

describe('discovery', () => {
  it('reads the fixture build: Storybook 10, index v5, React + Vite', () => {
    expect(storybook.caps).toMatchObject({
      version: '10.6.7',
      indexFormat: 'v5',
      storyFinishedEvent: true,
      framework: '@storybook/react-vite',
      renderer: '@storybook/react',
      builder: 'vite',
    });
    expect(storybook.diagnostics).toEqual([]);
    expect(storybook.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('lists 52 stories and leaves out the `!figma` gallery', async () => {
    const stories = await storybook.listStories();
    expect(stories).toHaveLength(52);
    expect(stories.map((story) => story.id)).not.toContain('components-icon--gallery');
    expect(storybook.model.excluded).toEqual([
      { id: 'components-icon--gallery', title: 'Components/Icon', reason: 'tag-opt-out' },
    ]);
  });
});

describe('URL render', () => {
  it('renders components-button--primary and returns its root handle', async () => {
    expect(driver.mode).toBe('url');
    const result = expectOk(await driver.render({ storyId: 'components-button--primary' }));
    expect(result.via).toBe('url');
    expect(result.phase).toBe('finished');
    expect(result.url).toMatch(/iframe\.html\?id=components-button--primary&viewMode=story$/);
    expect(await result.container.evaluate((el) => el.id)).toBe('storybook-root');
    expect(result.rootHandles).toHaveLength(1);
    const [root] = result.rootHandles;
    expect(await root?.evaluate((el) => el.tagName)).toBe('BUTTON');
    expect(result.portalHandles).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('renders micro-flex--row with fonts loaded and the fullscreen layout forced', async () => {
    const result = expectOk(await driver.render({ storyId: 'micro-flex--row' }));
    expect(result.rootHandles).toHaveLength(1);
    const [root] = result.rootHandles;
    const state = await root?.evaluate((el) => ({
      children: el.childElementCount,
      rect: el.getBoundingClientRect().toJSON() as { x: number; y: number },
      bodyPadding: getComputedStyle(document.body).paddingTop,
      fontsLoaded: document.fonts.status,
    }));
    expect(state).toMatchObject({ children: 3, bodyPadding: '0px', fontsLoaded: 'loaded' });
    expect(state?.rect).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps the padded layout with keepLayout', async () => {
    const result = expectOk(await driver.render({ storyId: 'micro-flex--row', keepLayout: true }));
    const padding = await result.container.evaluate(() => getComputedStyle(document.body).paddingTop);
    expect(padding).toBe('16px');
  });

  it('passes args and globals through the URL', async () => {
    const result = expectOk(
      await driver.render({
        storyId: 'components-button--primary',
        args: { label: 'Hello world', variant: 'secondary' },
        globals: { theme: 'dark' },
      }),
    );
    expect(result.url).toContain('args=label%3AHello+world%3Bvariant%3Asecondary');
    const [root] = result.rootHandles;
    expect(await root?.evaluate((el) => el.textContent)).toBe('Hello world');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
  });

  it('renders 6 different stories in a row on one page', async () => {
    const ids = [
      'components-badge--default',
      'components-card--default',
      'components-input--default',
      'components-stack--row',
      'micro-text--single-line',
      'micro-borders--uniform',
    ];
    for (const storyId of ids) {
      const result = expectOk(await driver.render({ storyId }));
      expect(result.storyId).toBe(storyId);
      expect(result.rootHandles).toHaveLength(1);
    }
  });

  it('honours the viewport and a rootSelector', async () => {
    const result = expectOk(
      await driver.render({
        storyId: 'components-button--primary',
        viewport: { width: 640, height: 480 },
        rootSelector: '#storybook-root > button',
      }),
    );
    expect(page.viewportSize()).toEqual({ width: 640, height: 480 });
    expect(await result.container.evaluate((el) => el.tagName)).toBe('BUTTON');
  });
});

describe('console watch (SB_CONSOLE_ERROR)', () => {
  it("leaves out the 404 of the browser's own /favicon.ico request", async () => {
    // New headless Chromium (the capture browser, 05 §1.3) asks for the favicon once per
    // context, and only while no request routing is installed: this needs a browser and a
    // context of its own. Requests are watched instead of routed (BUILD §3.1 rule 8).
    const path = process.env.HOLOTYPE_CHROMIUM_PATH;
    const own = await chromium.launch(
      path === undefined || path === '' ? { channel: 'chromium' } : { executablePath: path },
    );
    try {
      const fresh = await own.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      const freshPage = await fresh.newPage();
      freshPage.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.hostname !== '127.0.0.1') {
          outsideRequests.push(url.href);
        }
      });
      const favicon: string[] = [];
      const faviconUrl = new URL('/favicon.ico', storybook.baseUrl).href;
      freshPage.on('console', (message) => {
        if (message.location().url === faviconUrl) favicon.push(message.text());
      });
      const freshDriver = await storybook.openDriver(freshPage, { mode: 'url' });
      const first = expectOk(await freshDriver.render({ storyId: 'micro-flex--row' }));
      await expect.poll(() => favicon.length, { timeout: 5000 }).toBeGreaterThan(0);
      const second = expectOk(await freshDriver.render({ storyId: 'components-badge--default' }));
      // The browser logged it; no render reports it.
      expect(favicon[0]).toMatch(/^Failed to load resource/);
      expect([...first.warnings, ...second.warnings]).toEqual([]);
      await freshDriver.dispose();
    } finally {
      await own.close();
    }
  });
});

describe('driver lifecycle', () => {
  it('reload() leaves the preview; render() then starts from a fresh document', async () => {
    expectOk(await driver.render({ storyId: 'components-badge--default' }));
    await driver.reload();
    expect(page.url()).toBe('about:blank');
    expectOk(await driver.render({ storyId: 'components-badge--default' }));
  });

  it('rejects overlapping renders and renders after dispose()', async () => {
    const first = driver.render({ storyId: 'components-badge--default' });
    await expect(driver.render({ storyId: 'components-badge--tones' })).rejects.toThrow(/in progress/);
    expectOk(await first);
    await driver.dispose();
    await expect(driver.render({ storyId: 'components-badge--default' })).rejects.toThrow(/after dispose/);
  });

  it('rejects a non-positive render timeout', async () => {
    await expect(storybook.openDriver(page, { renderTimeoutMs: 0 })).rejects.toThrow(RangeError);
    await expect(storybook.openDriver(page, { disposeTimeoutMs: -1 })).rejects.toThrow(/disposeTimeoutMs/);
  });
});

describe('render failures', () => {
  it('reports a story that throws while rendering as SB_STORY_ERROR, then renders the next story', async () => {
    // Make the Icon stories' default args name an icon that does not exist: `icons[name]` is
    // undefined and the component throws during React render.
    let rewritten = false;
    await page.route('**/assets/Icon.stories-*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const broken = body.replace(/name:\s*(["'`])star\1/, 'name:`no-such-icon`');
      rewritten = broken !== body;
      await route.fulfill({ response, body: broken });
    });
    const failed = expectError(await driver.render({ storyId: 'components-icon--default' }));
    expect(rewritten).toBe(true);
    expect(failed.code).toBe('SB_STORY_ERROR');
    expect(failed.diagnostic).toMatchObject({
      code: 'SB_STORY_ERROR',
      severity: 'error',
      sid: 'components-icon',
      data: { storyId: 'components-icon--default', event: 'storyThrewException' },
    });
    expect(String(failed.diagnostic.data?.message)).toMatch(/map|undefined/);
    // Storybook logs the exception too.
    expect(failed.warnings.map((warning) => warning.code)).toContain('SB_CONSOLE_ERROR');
    await page.unrouteAll();

    expectOk(await driver.render({ storyId: 'components-icon--default' }));
  });

  it('reports a story whose CSF file fails to load as SB_STORY_LOAD_FAILED', async () => {
    await page.route('**/assets/Badge.stories-*.js', (route) => route.abort('failed'));
    const failed = expectError(await driver.render({ storyId: 'components-badge--default' }));
    expect(failed.code).toBe('SB_STORY_LOAD_FAILED');
    expect(failed.diagnostic.data).toMatchObject({ event: 'storyMissing' });
  });

  it('reports an id that is not in the index as SB_STORY_MISSING without navigating', async () => {
    const failed = expectError(await driver.render({ storyId: 'components-button--no-such-story' }));
    expect(failed.code).toBe('SB_STORY_MISSING');
    expect(page.url()).toBe('about:blank');
  });

  it('reports SB_RENDER_TIMEOUT when the done event never comes', async () => {
    const short = await storybook.openDriver(page, { mode: 'url', renderTimeoutMs: 1500 });
    // Hold the Button stories module: the preview boots but the story never renders.
    await page.route('**/assets/Button.stories-*.js', () => {});
    const failed = expectError(await short.render({ storyId: 'components-button--primary' }));
    expect(failed.code).toBe('SB_RENDER_TIMEOUT');
    expect(failed.diagnostic.data).toMatchObject({ timeoutMs: 1500 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  it('reports SB_PREVIEW_INIT_TIMEOUT when the preview never boots', async () => {
    const short = await storybook.openDriver(page, { mode: 'url', renderTimeoutMs: 1500 });
    // Hold the preview entry module: `__STORYBOOK_PREVIEW__` never appears.
    await page.route('**/assets/iframe-*.js', () => {});
    const failed = expectError(await short.render({ storyId: 'components-button--primary' }));
    expect(failed.code).toBe('SB_PREVIEW_INIT_TIMEOUT');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  it('reports SB_IFRAME_UNREACHABLE when iframe.html fails', async () => {
    await page.route('**/iframe.html?*', (route) => route.fulfill({ status: 503, body: 'down' }));
    const failed = expectError(await driver.render({ storyId: 'components-button--primary' }));
    expect(failed.code).toBe('SB_IFRAME_UNREACHABLE');
    expect(failed.diagnostic.value).toBe('HTTP 503');
    // dispose() is bounded and leaves a page that still answers open.
    const started = Date.now();
    expect(await driver.dispose()).toEqual({ forced: 'none' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(page.isClosed()).toBe(false);
  });

  it('skips args the URL cannot carry with SB_URL_ARG_UNENCODABLE', async () => {
    const failed = expectError(
      await driver.render({ storyId: 'components-button--primary', args: { label: 'Hi <b>there</b>' } }),
    );
    expect(failed.code).toBe('SB_URL_ARG_UNENCODABLE');
    expect(failed.diagnostic.value).toBe('args.label');
  });

  it('reports an unmatched rootSelector as SB_ROOT_NOT_FOUND', async () => {
    const failed = expectError(
      await driver.render({ storyId: 'components-button--primary', rootSelector: '#nothing-here' }),
    );
    expect(failed.code).toBe('SB_ROOT_NOT_FOUND');
  });

  it('made no request outside 127.0.0.1', () => {
    expect(outsideRequests).toEqual([]);
  });
});
