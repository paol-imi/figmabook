/// <reference lib="dom" />
/*
 * S-07 prototype of the channel render driver (03 §5): one Playwright page stays on
 * `iframe.html`; each variant is one `page.evaluate` that drives the Storybook channel.
 * It implements the B-10 `RenderDriver` contract except `mode`, so B-40 can lift it.
 */
import type { Diagnostic } from '@holotype/shared';
import type { RenderRequest, RenderResult, SbCapabilities, SbError } from '@holotype/storybook';
import type { ConsoleMessage, ElementHandle, Page } from 'playwright';
import { consoleWarning, hmrWarning, outcomeError, renderError, unstableWarning } from './errors.ts';
import {
  awaitBoot,
  CONTROLLER_KEY,
  channelRender,
  installChannelController,
  type PageOutcome,
  type PageRenderReport,
  readDocId,
  type StepReport,
} from './page.ts';

export const DEFAULT_CHANNEL_TIMEOUT_MS = 15_000;

/** Extra time Node waits beyond the in-page deadline before it gives up on the page. */
const NODE_GRACE_MS = 3000;

const LAYOUT_STYLE_ID = 'holotype-s07-layout';

/** The B-10 fullscreen override (03 §6.1); not exported by `@holotype/storybook` yet. */
const FULLSCREEN_LAYOUT_CSS = [
  'body.sb-show-main{margin:0!important;padding:0!important;display:block!important;min-height:0!important}',
  'body.sb-show-main::after{content:none!important}',
  '#storybook-root{display:block!important;margin:0!important;padding:0!important;max-height:none!important}',
].join('\n');

export interface ChannelDriverContext {
  readonly page: Page;
  readonly baseUrl: string;
  readonly caps: SbCapabilities;
  /** Every story id of the unfiltered index. */
  readonly storyIds: ReadonlySet<string>;
}

export interface ChannelDriverOptions {
  readonly renderTimeoutMs?: number;
  /** Write args into the ArgsStore before `setCurrentStory` on a revisit. Default `true`. */
  readonly presetArgs?: boolean;
  /** When to run the 03 §5.5 stability check. Default: the first render of each component. */
  readonly stability?: 'first-per-component' | 'always' | 'never';
}

/** A channel render request: the B-10 request plus `remount` (03 §5.1). */
export interface ChannelRenderRequest extends RenderRequest {
  readonly remount?: boolean;
  /** Run the stability check for this render, whatever the driver's `stability` mode. */
  readonly stability?: boolean;
}

/** Measurements of one render, for the spike report. */
export interface ChannelRenderStats {
  readonly storyId: string;
  /** `boot`: this render navigated to `iframe.html`; `channel`: it did not. */
  readonly path: 'boot' | 'channel';
  readonly bootMs: number;
  readonly steps: readonly StepReport[];
  readonly renders: number;
  readonly skipped: boolean;
  readonly settleMs: number;
  /** In-page time of the channel step. */
  readonly pageMs: number;
  /** Node wall time of the whole render, handles included. */
  readonly totalMs: number;
  /** Documents Storybook replaced by itself during this render (a reload on teardown). */
  readonly selfReloads: number;
  readonly hmrEvents: readonly string[];
  readonly stable: boolean | null;
  /** What the 03 §5.5 heuristic said, for the report. */
  readonly planStable: boolean | null;
  readonly outcome: PageOutcome['kind'] | 'boot-error';
}

export interface ChannelDriver {
  readonly mode: 'channel';
  render(request: ChannelRenderRequest): Promise<RenderResult | SbError>;
  /** Measurements of the last render. */
  lastStats(): ChannelRenderStats | undefined;
  /** Hard reset: the next render boots a fresh document. */
  reload(): Promise<void>;
  dispose(): Promise<void>;
}

const isContextLoss = (error: unknown): boolean =>
  error instanceof Error &&
  /Execution context was destroyed|navigation|Target page, context or browser has been closed|frame was detached/i.test(
    error.message,
  );

function watchConsole(page: Page): () => string[] {
  const messages: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error') messages.push(message.text());
  };
  const onPageError = (error: Error) => messages.push(error.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  let stopped = false;
  return () => {
    if (!stopped) {
      stopped = true;
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
    return messages;
  };
}

function iframeUrl(baseUrl: string, storyId: string): string {
  const url = new URL('iframe.html', baseUrl);
  url.searchParams.set('id', storyId);
  url.searchParams.set('viewMode', 'story');
  return url.href;
}

async function withNodeDeadline<T>(work: Promise<T>, ms: number): Promise<T | 'node-timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'node-timeout'>((resolve) => {
    timer = setTimeout(() => resolve('node-timeout'), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export async function createChannelDriver(
  context: ChannelDriverContext,
  options: ChannelDriverOptions = {},
): Promise<ChannelDriver> {
  const { page, baseUrl, caps, storyIds } = context;
  const timeoutMs = options.renderTimeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`renderTimeoutMs must be a positive number of milliseconds, got ${timeoutMs}.`);
  }
  const doneEvent: 'storyFinished' | 'storyRendered' = caps.storyFinishedEvent ? 'storyFinished' : 'storyRendered';
  const stabilityMode = options.stability ?? 'first-per-component';
  const presetArgs = options.presetArgs ?? true;
  await page.addInitScript(installChannelController, CONTROLLER_KEY);

  let docId: string | null = null;
  let needsBoot = true;
  let keptLayout = false;
  let busy = false;
  let disposed = false;
  let last: ChannelRenderStats | undefined;
  const seenComponents = new Set<string>();

  async function applyLayout(keepLayout: boolean): Promise<void> {
    if (keepLayout === keptLayout) return;
    await page.evaluate(
      ([id, keep]) => {
        const style = document.getElementById(id) as HTMLStyleElement | null;
        if (style !== null) style.disabled = keep;
      },
      [LAYOUT_STYLE_ID, keepLayout] as const,
    );
    keptLayout = keepLayout;
  }

  async function installLayout(keepLayout: boolean): Promise<void> {
    await page.addStyleTag({ content: FULLSCREEN_LAYOUT_CSS }).then((handle) =>
      handle.evaluate((element, id) => {
        (element as HTMLStyleElement).id = id;
      }, LAYOUT_STYLE_ID),
    );
    keptLayout = false;
    await applyLayout(keepLayout);
  }

  /** Navigates to the story; resolves with the boot outcome. */
  async function boot(storyId: string): Promise<PageOutcome> {
    const url = iframeUrl(baseUrl, storyId);
    const response = await page.goto(url, { waitUntil: 'commit', timeout: timeoutMs });
    if (response !== null && !response.ok()) throw new Error(`iframe.html answered HTTP ${response.status()}`);
    const outcome = await page.evaluate(awaitBoot, { key: CONTROLLER_KEY, storyId, doneEvent, timeoutMs });
    docId = await page.evaluate(readDocId, CONTROLLER_KEY);
    needsBoot = outcome.kind === 'timeout';
    return outcome;
  }

  /**
   * Takes over a document Storybook reloaded by itself: waits for it to load and for the boot
   * render of the story in its URL. `false` when that fails; the caller then navigates.
   */
  async function adoptReload(keepLayout: boolean): Promise<boolean> {
    // The old context dies when the reload request starts, before the new document commits:
    // wait for a document id we have not seen, retrying while contexts come and go.
    const previous = docId;
    const end = performance.now() + timeoutMs;
    while (performance.now() < end) {
      try {
        const current = await page.evaluate(readDocId, CONTROLLER_KEY);
        if (current !== null && current !== previous) {
          const storyId = new URL(page.url()).searchParams.get('id');
          if (storyId === null) return false;
          const remaining = Math.max(1, Math.round(end - performance.now()));
          const outcome = await page.evaluate(awaitBoot, {
            key: CONTROLLER_KEY,
            storyId,
            doneEvent,
            timeoutMs: remaining,
          });
          if (outcome.kind === 'timeout') return false;
          docId = current;
          await installLayout(keepLayout);
          return true;
        }
      } catch (error) {
        if (!isContextLoss(error)) return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  async function handles(container: ElementHandle<Element>): Promise<ElementHandle<Element>[]> {
    const list = await container.evaluateHandle((element) => {
      const skipped = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);
      return Array.from(element.children).filter(
        (child) => !skipped.has(child.tagName.toUpperCase()) && getComputedStyle(child).display !== 'none',
      );
    });
    const properties = await list.getProperties();
    const found: ElementHandle<Element>[] = [];
    for (const [key, property] of [...properties.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
      const element = /^\d+$/.test(key) ? property.asElement() : null;
      if (element === null) await property.dispose();
      else found.push(element as ElementHandle<Element>);
    }
    await list.dispose();
    return found;
  }

  async function renderOnce(request: ChannelRenderRequest): Promise<RenderResult | SbError> {
    const { storyId } = request;
    const started = performance.now();
    if (!storyIds.has(storyId)) return renderError(storyId, 'SB_STORY_MISSING', { value: storyId, data: { baseUrl } });
    if (request.viewport !== undefined) {
      const current = page.viewportSize();
      if (current?.width !== request.viewport.width || current.height !== request.viewport.height) {
        await page.setViewportSize(request.viewport);
      }
    }
    const warnings: Diagnostic[] = [];
    let path: ChannelRenderStats['path'] = 'channel';
    let bootMs = 0;
    let selfReloads = 0;

    // A document we did not navigate to: Storybook reloaded itself, or a dev server full reload.
    if (!needsBoot) {
      const current = await page.evaluate(readDocId, CONTROLLER_KEY).catch(() => null);
      if (current !== docId) {
        warnings.push(hmrWarning(storyId, ['preview-reloaded']));
        needsBoot = true;
      }
    }

    const sid = storyId.split('--')[0] ?? storyId;
    const stability =
      request.stability ??
      (stabilityMode === 'always' || (stabilityMode === 'first-per-component' && !seenComponents.has(sid)));
    const pageRequest = {
      key: CONTROLLER_KEY,
      storyId,
      args: request.args ?? {},
      ...(request.globals === undefined ? {} : { globals: request.globals }),
      remount: request.remount === true,
      presetArgs,
      doneEvent,
      timeoutMs,
      stability,
    } as const;

    let report: PageRenderReport | undefined;
    for (let attempt = 0; attempt < 2 && report === undefined; attempt += 1) {
      if (needsBoot) {
        path = 'boot';
        const bootStart = performance.now();
        let outcome: PageOutcome;
        try {
          outcome = await boot(storyId);
        } catch (error) {
          last = stats({ storyId, path, bootMs, started, selfReloads, outcome: 'boot-error' });
          return renderError(storyId, 'SB_IFRAME_UNREACHABLE', { value: (error as Error).message, data: { baseUrl } });
        }
        bootMs = performance.now() - bootStart;
        if (outcome.kind === 'timeout') {
          const preview = await page.evaluate(() => '__STORYBOOK_PREVIEW__' in window).catch(() => false);
          last = stats({ storyId, path, bootMs, started, selfReloads, outcome: 'boot-error' });
          return preview
            ? outcomeError(storyId, outcome, true, timeoutMs)
            : renderError(storyId, 'SB_PREVIEW_INIT_TIMEOUT', { value: `${timeoutMs} ms`, data: { timeoutMs } });
        }
        await installLayout(request.keepLayout === true);
        if (outcome.kind !== 'done') {
          last = stats({ storyId, path, bootMs, started, selfReloads, outcome: 'boot-error' });
          return outcomeError(storyId, outcome, true, timeoutMs);
        }
      } else {
        await applyLayout(request.keepLayout === true);
      }
      try {
        const result = await withNodeDeadline(page.evaluate(channelRender, pageRequest), timeoutMs + NODE_GRACE_MS);
        if (result === 'node-timeout') {
          needsBoot = true;
          last = stats({ storyId, path, bootMs, started, selfReloads, outcome: 'timeout' });
          return outcomeError(storyId, { kind: 'timeout', phases: [] }, true, timeoutMs);
        }
        report = result;
      } catch (error) {
        if (!isContextLoss(error)) throw error;
        // Storybook replaced the document: tearing down a render that is still `loading` (a
        // story switch, or an HMR update of its CSF file) reloads the preview. Adopt the new
        // document once its own boot render is done, then retry once; navigating over the
        // reload instead can hang.
        selfReloads += 1;
        needsBoot = !(await adoptReload(request.keepLayout === true));
      }
    }
    if (report === undefined) {
      // `SB_STORY_UNRENDERABLE` is not an `SbErrorCode` yet (B-40 adds it).
      return renderError(storyId, 'SB_RENDER_TIMEOUT', {
        value: storyId,
        data: { reason: 'the preview replaced its document twice during the render', selfReloads },
      });
    }

    seenComponents.add(sid);
    if (selfReloads > 0) warnings.push(hmrWarning(storyId, ['preview-reloaded']));
    else if (report.hmrEvents.length > 0) warnings.push(hmrWarning(storyId, report.hmrEvents));
    if (report.stable === false) warnings.push(unstableWarning(storyId));
    last = stats({ storyId, path, bootMs, started, selfReloads, outcome: report.outcome.kind, report });
    const { outcome } = report;
    if (outcome.kind !== 'done') {
      // A render stuck in `loading` cannot be left by the channel without Storybook reloading
      // the page: start the next render from a fresh document instead.
      if (outcome.kind === 'timeout') needsBoot = true;
      return { ...outcomeError(storyId, outcome, true, timeoutMs), warnings };
    }

    const selector = request.rootSelector ?? '#storybook-root';
    const found = await page.evaluateHandle((query) => document.querySelector(query), selector);
    const container = found.asElement();
    if (container === null) {
      await found.dispose();
      return { ...renderError(storyId, 'SB_ROOT_NOT_FOUND', { value: selector }), warnings };
    }
    const element = container as ElementHandle<Element>;
    return {
      ok: true,
      storyId,
      url: iframeUrl(baseUrl, storyId),
      renderMs: performance.now() - started,
      phase: doneEvent === 'storyFinished' ? 'finished' : 'rendered',
      container: element,
      rootHandles: await handles(element),
      portalHandles: [],
      warnings,
    };
  }

  function stats(input: {
    storyId: string;
    path: ChannelRenderStats['path'];
    bootMs: number;
    started: number;
    selfReloads: number;
    outcome: ChannelRenderStats['outcome'];
    report?: PageRenderReport;
  }): ChannelRenderStats {
    const { report } = input;
    return {
      storyId: input.storyId,
      path: input.path,
      bootMs: input.bootMs,
      steps: report?.steps ?? [],
      renders: report?.renders ?? 0,
      skipped: report?.skipped ?? false,
      settleMs: report?.settleMs ?? 0,
      pageMs: report?.totalMs ?? 0,
      totalMs: performance.now() - input.started,
      selfReloads: input.selfReloads,
      hmrEvents: report?.hmrEvents ?? [],
      stable: report?.stable ?? null,
      planStable: report?.planStable ?? null,
      outcome: input.outcome,
    };
  }

  return {
    mode: 'channel',
    async render(request) {
      if (disposed) throw new Error('ChannelDriver.render() was called after dispose().');
      if (busy) throw new Error('ChannelDriver.render() was called while another render is in progress.');
      busy = true;
      const stopConsole = watchConsole(page);
      try {
        const result = await renderOnce(request);
        const logged = stopConsole();
        return logged.length === 0
          ? result
          : { ...result, warnings: [...result.warnings, consoleWarning(request.storyId, logged)] };
      } finally {
        stopConsole();
        busy = false;
      }
    },
    lastStats: () => last,
    async reload() {
      await page.goto('about:blank');
      needsBoot = true;
      docId = null;
    },
    async dispose() {
      disposed = true;
    },
  };
}
