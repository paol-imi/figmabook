import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type BrowserContext, chromium, type LaunchOptions } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFontsLock, sha256File } from '../../scripts/fonts-lock.ts';
import { type StaticServer, serveStatic } from '../support/static-server.ts';
import { buildStorybook, packageRoot, readStoryIndex, sortedStoryIds } from '../support/storybook.ts';

/**
 * B-03 smoke test: build the static Storybook, serve it on 127.0.0.1 and render every story in
 * headless Chromium. A story passes when it renders without a Storybook error, logs no console
 * error, requests nothing outside 127.0.0.1, and the locked Inter faces load.
 */
const outDir = join(packageRoot, 'storybook-static');

let server: StaticServer;
let browser: Browser;
let context: BrowserContext;
let storyIds: string[] = [];
const outsideRequests: string[] = [];

beforeAll(async () => {
  await buildStorybook(outDir);
  storyIds = sortedStoryIds(await readStoryIndex(outDir));
  server = await serveStatic(outDir);

  const launch: LaunchOptions = {};
  // Lets CI or a dev machine point at a preinstalled Chromium matching the pinned Playwright.
  const executablePath = process.env.HOLOTYPE_CHROMIUM_PATH;
  if (executablePath !== undefined && executablePath !== '') launch.executablePath = executablePath;
  browser = await chromium.launch(launch);
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.hostname === '127.0.0.1') {
      await route.continue();
    } else {
      outsideRequests.push(url.href);
      await route.abort('blockedbyclient');
    }
  });
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await server?.close();
});

interface RenderResult {
  errors: string[];
  rootChildren: number;
  fontsOk: boolean;
  theme: string | null;
  bodyBackground: string;
}

async function renderStory(id: string, globals?: string): Promise<RenderResult> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  try {
    const query = new URLSearchParams({ id, viewMode: 'story' });
    if (globals !== undefined) query.set('globals', globals);
    await page.goto(`${server.url}iframe.html?${query}`, { waitUntil: 'load' });
    // Done when the story mounted its root element, or Storybook shows its error screen.
    await page.waitForFunction(
      () =>
        (document.querySelector('#storybook-root')?.childElementCount ?? 0) > 0 ||
        ['sb-show-errordisplay', 'sb-show-nopreview'].some((c) => document.body.classList.contains(c)),
    );
    const state = await page.evaluate(async () => {
      await Promise.all(['400', '500', '600', '700'].map((weight) => document.fonts.load(`${weight} 14px Inter`)));
      await document.fonts.ready;
      return {
        failed: !document.body.classList.contains('sb-show-main'),
        errorText: document.querySelector('#error-message')?.textContent ?? '',
        rootChildren: document.querySelector('#storybook-root')?.childElementCount ?? 0,
        fontsOk: document.fonts.check('600 14px Inter'),
        theme: document.documentElement.getAttribute('data-theme'),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
      };
    });
    if (state.failed) errors.push(`storybook: ${state.errorText || 'story did not render'}`);
    return {
      errors,
      rootChildren: state.rootChildren,
      fontsOk: state.fontsOk,
      theme: state.theme,
      bodyBackground: state.bodyBackground,
    };
  } finally {
    await page.close();
  }
}

describe('fixture Storybook smoke', () => {
  it('indexes the 53 committed stories', () => {
    expect(storyIds).toHaveLength(53);
  });

  it('renders every story with no errors, no outside requests and Inter loaded', async () => {
    const failures: string[] = [];
    for (const id of storyIds) {
      const result = await renderStory(id);
      if (result.errors.length > 0) failures.push(`${id}: ${result.errors.join(' | ')}`);
      if (result.rootChildren !== 1) failures.push(`${id}: expected one root element, got ${result.rootChildren}`);
      if (!result.fontsOk) failures.push(`${id}: document.fonts.check('600 14px Inter') is false`);
      if (result.theme !== 'light') failures.push(`${id}: data-theme is ${String(result.theme)}`);
    }
    expect(failures).toEqual([]);
    expect(outsideRequests).toEqual([]);
  });

  it('applies the dark theme global as data-theme on <html>', async () => {
    const result = await renderStory('components-button--primary', 'theme:dark');
    expect(result.errors).toEqual([]);
    expect(result.theme).toBe('dark');
    // --color-bg → --color-gray-900 (#0f172a) in the dark theme.
    expect(result.bodyBackground).toBe('rgb(15, 23, 42)');
  });

  it('ships exactly the font files pinned in fixtures/fonts.lock', async () => {
    const assets = join(outDir, 'assets');
    const fontFiles = (await readdir(assets)).filter((name) => /^inter-.*\.woff2?$/.test(name));
    const built = fontFiles.map((name) => sha256File(join(assets, name))).sort();
    const locked = readFontsLock()
      .faces.flatMap((face) => face.files.map((file) => file.sha256))
      .sort();
    expect(built).toEqual(locked);
  });
});
