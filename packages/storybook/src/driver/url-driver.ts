/// <reference lib="dom" />
import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import type { ConsoleMessage, ElementHandle, Page } from 'playwright';
import type {
  DriverOptions,
  RenderDriver,
  RenderRequest,
  RenderResult,
  SbCapabilities,
  SbError,
  SbErrorCode,
} from '../types';
import { encodeUrlParam } from '../url-args';
import { type ErrorDetails, outcomeError, renderError, unencodableError } from './errors';
import {
  displayedChildren,
  FULLSCREEN_LAYOUT_CSS,
  findRootContainer,
  installEventRecorder,
  type PageOutcome,
  RECORDER_KEY,
  readOutcome,
  readPhases,
  settleFrame,
} from './page-scripts';

/** `T.render` (03 §5.3). */
export const DEFAULT_RENDER_TIMEOUT_MS = 15_000;

/** Root containers, in order (03 §6.1): SB ≥7, then older builds. */
export const DEFAULT_ROOT_SELECTORS: readonly string[] = ['#storybook-root', '#root'];

/** How long the post-timeout probe of the page may take. */
const PROBE_TIMEOUT_MS = 1000;

/** Console errors kept per render in `SB_CONSOLE_ERROR`. */
const MAX_CONSOLE_MESSAGES = 20;

export interface UrlDriverContext {
  readonly page: Page;
  readonly baseUrl: string;
  readonly caps: SbCapabilities;
  /** Every story id of the unfiltered index. */
  readonly storyIds: ReadonlySet<string>;
}

/** The `iframe.html` URL of one render (03 §5.4). `args` / `globals` are already encoded. */
export function buildIframeUrl(baseUrl: string, storyId: string, args: string, globals: string): string {
  const url = new URL('iframe.html', baseUrl);
  url.searchParams.set('id', storyId);
  url.searchParams.set('viewMode', 'story');
  if (args !== '') url.searchParams.set('args', args);
  if (globals !== '') url.searchParams.set('globals', globals);
  return url.href;
}

const isTimeout = (error: unknown): boolean => error instanceof Error && error.name === 'TimeoutError';

class Deadline {
  private readonly end: number;
  constructor(readonly timeoutMs: number) {
    this.end = Date.now() + timeoutMs;
  }
  /** Milliseconds left, at least 1 so Playwright never reads 0 as "no timeout". */
  remaining(): number {
    return Math.max(1, this.end - Date.now());
  }
  /** Races `work` against the deadline; rejects with a `TimeoutError` when it passes. */
  async race<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Timed out after ${this.timeoutMs} ms`);
        error.name = 'TimeoutError';
        reject(error);
      }, this.remaining());
    });
    try {
      return await Promise.race([work, expired]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Collects console errors and page errors while a render runs (`SB_CONSOLE_ERROR`, 03 §5.3). */
function watchConsole(page: Page): { stop(): Diagnostic[] } {
  const messages: string[] = [];
  let stopped = false;
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error') messages.push(message.text());
  };
  const onPageError = (error: Error) => messages.push(error.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return {
    stop: () => {
      if (stopped) return [];
      stopped = true;
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      if (messages.length === 0) return [];
      const kept = messages.slice(0, MAX_CONSOLE_MESSAGES);
      return [
        createDiagnostic(diagnostic('SB_CONSOLE_ERROR'), undefined, {
          value: kept[0] ?? '',
          data: { count: messages.length, messages: kept },
        }),
      ];
    },
  };
}

/**
 * Creates the URL-path driver (03 §5.4): one navigation to `iframe.html?id=&args=&globals=` per
 * render, then the done event (`storyFinished` when the version has it, else `storyRendered`),
 * `document.fonts.ready` and two animation frames.
 */
export async function createUrlDriver(context: UrlDriverContext, options: DriverOptions = {}): Promise<RenderDriver> {
  const { page, baseUrl, caps, storyIds } = context;
  const timeoutMs = options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`renderTimeoutMs must be a positive number of milliseconds, got ${timeoutMs}.`);
  }
  const doneEvent: 'storyFinished' | 'storyRendered' = caps.storyFinishedEvent ? 'storyFinished' : 'storyRendered';
  await page.addInitScript(installEventRecorder, RECORDER_KEY);

  let busy = false;
  let disposed = false;

  async function renderOnce(request: RenderRequest, deadline: Deadline): Promise<RenderResult | SbError> {
    const { storyId } = request;
    const fail = (code: SbErrorCode, details: ErrorDetails) => renderError(storyId, code, details);

    if (!storyIds.has(storyId)) return fail('SB_STORY_MISSING', { value: storyId, data: { baseUrl } });
    const args = encodeUrlParam(request.args ?? {});
    if (!args.ok) return unencodableError(storyId, 'args', args.error);
    const globals = encodeUrlParam(request.globals ?? {});
    if (!globals.ok) return unencodableError(storyId, 'globals', globals.error);
    const url = buildIframeUrl(baseUrl, storyId, args.value, globals.value);

    if (request.viewport !== undefined) {
      const current = page.viewportSize();
      if (current?.width !== request.viewport.width || current.height !== request.viewport.height) {
        await page.setViewportSize(request.viewport);
      }
    }

    const started = Date.now();
    try {
      const response = await page.goto(url, { waitUntil: 'commit', timeout: deadline.remaining() });
      if (response !== null && !response.ok()) {
        return fail('SB_IFRAME_UNREACHABLE', { value: `HTTP ${response.status()}`, data: { url } });
      }
    } catch (error) {
      if (isTimeout(error)) return timeoutError(storyId, url, deadline);
      return fail('SB_IFRAME_UNREACHABLE', { value: (error as Error).message, data: { url } });
    }

    let outcome: PageOutcome;
    try {
      const handle = await page.waitForFunction(
        readOutcome,
        { key: RECORDER_KEY, storyId, doneEvent },
        { timeout: deadline.remaining() },
      );
      outcome = (await handle.jsonValue()) as PageOutcome;
      await handle.dispose();
    } catch (error) {
      if (isTimeout(error)) return timeoutError(storyId, url, deadline);
      throw error;
    }
    if (outcome.kind !== 'done') return outcomeError(storyId, outcome, true);

    try {
      if (request.keepLayout !== true) await deadline.race(page.addStyleTag({ content: FULLSCREEN_LAYOUT_CSS }));
      await deadline.race(page.evaluate(settleFrame));
    } catch (error) {
      if (isTimeout(error)) return timeoutError(storyId, url, deadline);
      throw error;
    }

    const selectors = request.rootSelector === undefined ? DEFAULT_ROOT_SELECTORS : [request.rootSelector];
    const found = await page.evaluateHandle(findRootContainer, selectors);
    const container = found.asElement();
    if (container === null) {
      await found.dispose();
      return fail('SB_ROOT_NOT_FOUND', { value: selectors.join(', '), data: { url, selectors } });
    }
    const result: RenderResult = {
      ok: true,
      storyId,
      url,
      renderMs: Date.now() - started,
      phase: outcome.phase,
      container,
      rootHandles: await childHandles(container),
      portalHandles: [],
      warnings: [],
    };
    return result;
  }

  async function timeoutError(storyId: string, url: string, deadline: Deadline): Promise<SbError> {
    // The page may have no usable document after a stuck navigation: give the probe a second.
    const state = await new Deadline(PROBE_TIMEOUT_MS)
      .race(page.evaluate(readPhases, RECORDER_KEY))
      .catch(() => ({ preview: false, phases: [] as string[] }));
    const code = state.preview ? 'SB_RENDER_TIMEOUT' : 'SB_PREVIEW_INIT_TIMEOUT';
    return renderError(storyId, code, {
      value: `${deadline.timeoutMs} ms`,
      data: { url, timeoutMs: deadline.timeoutMs, phases: state.phases },
    });
  }

  return {
    mode: 'url',
    async render(request: RenderRequest): Promise<RenderResult | SbError> {
      if (disposed) throw new Error('RenderDriver.render() was called after dispose().');
      if (busy) throw new Error('RenderDriver.render() was called while another render is in progress.');
      busy = true;
      const consoleWatch = watchConsole(page);
      try {
        const result = await renderOnce(request, new Deadline(timeoutMs));
        const logged = consoleWatch.stop();
        return logged.length === 0 ? result : { ...result, warnings: [...result.warnings, ...logged] };
      } finally {
        consoleWatch.stop();
        busy = false;
      }
    },
    async reload() {
      await page.goto('about:blank');
    },
    async dispose() {
      disposed = true;
    },
  };
}

async function childHandles(container: ElementHandle<Element>): Promise<ElementHandle<Element>[]> {
  const list = await container.evaluateHandle(displayedChildren);
  const properties = await list.getProperties();
  const handles: ElementHandle<Element>[] = [];
  const indexed = [...properties.entries()]
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([a], [b]) => Number(a) - Number(b));
  for (const [, property] of indexed) {
    const element = property.asElement();
    if (element === null) await property.dispose();
    else handles.push(element as ElementHandle<Element>);
  }
  await list.dispose();
  return handles;
}
