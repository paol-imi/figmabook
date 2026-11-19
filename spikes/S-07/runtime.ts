/// <reference lib="dom" />
/*
 * S-07 runtime helpers: the browser with the D-24 capture environment, story metadata through
 * `loadStory` (03 §4.1), DOM signatures, and the bridge from the channel driver to the
 * capturer. Runs in Node with Playwright's Chromium.
 */
import { createHash } from 'node:crypto';
import {
  CHROMIUM_ARGS,
  captureUserAgent,
  contextOptions,
  ENGINE_VERSION,
  resolveEnvironment,
  seededRandomScript,
} from '@holotype/capture';
import type { ConnectedStorybook, DriverOptions, RenderDriver } from '@holotype/storybook';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { type ChannelDriver, type ChannelDriverOptions, createChannelDriver } from './driver/channel-driver.ts';
import type { Json, StoryMetaLite } from './plan.ts';

export interface SpikeBrowser {
  readonly browser: Browser;
  readonly version: string;
  /** Opens a context with the capture environment; `ua: 'default'` drops the test-runner marker. */
  newContext(ua?: 'test-runner' | 'default'): Promise<BrowserContext>;
  /** Requests to hosts other than 127.0.0.1 that were blocked (BUILD §3.1 rule 8). */
  readonly blocked: string[];
  close(): Promise<void>;
}

/** Launches Chromium as the capturer does (05 §1.3). `HOLOTYPE_CHROMIUM_PATH` picks a binary. */
export async function launchBrowser(): Promise<SpikeBrowser> {
  const executablePath = process.env.HOLOTYPE_CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(executablePath === undefined || executablePath === '' ? { channel: 'chromium' } : { executablePath }),
    args: [...CHROMIUM_ARGS],
  });
  const cdp = await browser.newBrowserCDPSession();
  const { userAgent } = (await cdp.send('Browser.getVersion')) as { userAgent: string };
  await cdp.detach();
  const env = resolveEnvironment();
  const blocked: string[] = [];
  return {
    browser,
    version: browser.version(),
    blocked,
    async newContext(ua = 'test-runner') {
      const agent = ua === 'test-runner' ? captureUserAgent(userAgent, ENGINE_VERSION) : userAgent;
      const context = await browser.newContext(contextOptions(env, agent));
      if (env.clock !== false) await context.clock.setFixedTime(new Date(env.clock));
      await context.addInitScript({ content: seededRandomScript() });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (['data:', 'blob:'].includes(url.protocol) || url.hostname === '127.0.0.1') {
          await route.fallback();
        } else {
          blocked.push(url.href);
          await route.abort('blockedbyclient');
        }
      });
      return context;
    },
    close: () => browser.close(),
  };
}

/** Every story id of the index, filtered or not. */
export function allStoryIds(storybook: ConnectedStorybook): Set<string> {
  return new Set([
    ...storybook.model.stories.map((story) => story.id),
    ...storybook.model.excluded.map((story) => story.id),
  ]);
}

export function openChannelDriver(
  storybook: ConnectedStorybook,
  page: Page,
  options: ChannelDriverOptions = {},
  storyIds: ReadonlySet<string> = allStoryIds(storybook),
): Promise<ChannelDriver> {
  return createChannelDriver({ page, baseUrl: storybook.baseUrl, caps: storybook.caps, storyIds }, options);
}

/**
 * A `ConnectedStorybook` whose `openDriver` returns the channel driver, so `createCapturer`
 * runs the real capture pipeline over it. B-10's `RenderDriver.mode` is `'url'` only; the
 * capturer never reads it, and B-40 widens it to `'url' | 'channel'`.
 */
export function channelStorybook(storybook: ConnectedStorybook, options: ChannelDriverOptions = {}) {
  return {
    openDriver: async (page: Page, driverOptions?: DriverOptions): Promise<RenderDriver> => {
      const timeout = driverOptions?.renderTimeoutMs ?? options.renderTimeoutMs;
      const driver = await openChannelDriver(storybook, page, {
        ...options,
        ...(timeout === undefined ? {} : { renderTimeoutMs: timeout }),
      });
      return { mode: 'url', render: driver.render, reload: driver.reload, dispose: driver.dispose };
    },
  };
}

/**
 * Story metadata through per-id `loadStory` (03 §4.1), made JSON-safe in the page. Resolves
 * with the metas and how long the batch took.
 */
export async function loadStoryMetas(
  page: Page,
  baseUrl: string,
  ids: readonly string[],
): Promise<{ metas: StoryMetaLite[]; ms: number; readyMs: number }> {
  const url = new URL('iframe.html', baseUrl);
  url.searchParams.set('id', '__holotype__');
  url.searchParams.set('viewMode', 'story');
  await page.goto(url.href);
  await page.waitForFunction(() => '__STORYBOOK_PREVIEW__' in window);
  return page.evaluate(async (storyIds) => {
    type ArgType = { options?: unknown; control?: unknown };
    type Story = { id: string; title: string; initialArgs: Record<string, unknown>; argTypes: Record<string, ArgType> };
    type Preview = { ready?: () => Promise<void>; loadStory(options: { storyId: string }): Promise<Story> };
    const preview = (window as unknown as { __STORYBOOK_PREVIEW__: Preview }).__STORYBOOK_PREVIEW__;
    const safe = (value: unknown, depth = 0): unknown => {
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
      if (depth > 6) return { $nonJson: 'deep' };
      if (Array.isArray(value)) return value.map((item) => safe(item, depth + 1));
      if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        if ('$$typeof' in (value as object)) return { $nonJson: 'react-element' };
        return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, safe(v, depth + 1)]));
      }
      return { $nonJson: typeof value === 'object' ? 'object' : typeof value };
    };
    const t0 = performance.now();
    await preview.ready?.();
    const readyMs = performance.now() - t0;
    const metas = [];
    for (const storyId of storyIds) {
      const story = await preview.loadStory({ storyId });
      const argTypes: Record<string, { options?: unknown; control?: unknown }> = {};
      for (const [name, argType] of Object.entries(story.argTypes)) {
        const control = argType.control;
        const kind =
          control === false
            ? false
            : typeof control === 'string'
              ? control
              : typeof control === 'object' && control !== null && 'type' in control
                ? String((control as { type: unknown }).type)
                : undefined;
        argTypes[name] = {
          ...(Array.isArray(argType.options) ? { options: safe(argType.options) } : {}),
          ...(kind === undefined ? {} : { control: kind }),
        };
      }
      metas.push({ id: story.id, title: story.title, initialArgs: safe(story.initialArgs), argTypes });
    }
    return { metas: metas as never, ms: performance.now() - t0, readyMs };
  }, ids);
}

/**
 * A short hash of what the root shows: its outer HTML and the rects of every element in it.
 * Equal signatures mean the same DOM at the same geometry.
 */
export async function domSignature(page: Page, selector = '#storybook-root'): Promise<string> {
  const facts = await page.evaluate((query) => {
    const root = document.querySelector(query);
    if (root === null) return 'no-root';
    const rects = [root, ...root.querySelectorAll('*')].map((element) => {
      const rect = element.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100).join(',');
    });
    return `${root.outerHTML}\n${rects.join(';')}`;
  }, selector);
  return createHash('sha256').update(facts).digest('hex').slice(0, 16);
}

/** Whether `selector` matches inside the story root. */
export function rootHas(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((query) => document.querySelector(`#storybook-root ${query}`) !== null, selector);
}

export type JsonRecord = Readonly<Record<string, Json>>;
