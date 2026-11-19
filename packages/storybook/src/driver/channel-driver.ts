/// <reference lib="dom" />
import type { Diagnostic } from '@holotype/shared';
import type { RenderPath, RenderRequest, RenderResult, SbError } from '../types';
import {
  awaitPreview,
  awaitStoryRender,
  type ChannelRenderArgs,
  type ChannelReport,
  CONTROLLER_KEY,
  channelPhases,
  channelRender,
  readDocId,
} from './channel-scripts';
import { ensureChannelController } from './controller';
import { Deadline, isTimeout } from './deadline';
import {
  type AttemptOptions,
  type AttemptResult,
  applyViewport,
  buildIframeUrl,
  type ChannelUnavailable,
  type DriverContext,
  isUnavailable,
  type RenderEngine,
} from './engine';
import { hmrWarning, outcomeError, renderError, timeoutFailure } from './errors';
import { FULLSCREEN_LAYOUT_CSS } from './page-scripts';
import { findRoots, rootSelectors, stabilityWarning } from './roots';

/** Extra time Node gives an in-page step past the render deadline before it gives up on the page. */
const NODE_GRACE_MS = 2000;
/** How long the post-timeout probe of the page may take. */
const PROBE_TIMEOUT_MS = 1000;
/** How long to wait for the done event of a render that errored (S-07 Q4). */
const ERROR_GRACE_MS = 1000;
/** Poll interval while a document Storybook reloaded comes up. */
const ADOPT_POLL_MS = 25;
/** The id of the fullscreen layout style element in a channel document. */
export const LAYOUT_STYLE_ID = 'holotype-fullscreen-layout';

const CONTEXT_LOSS =
  /Execution context was destroyed|navigation|Target page, context or browser has been closed|frame was detached/i;

/** Storybook replaced the document under a running `evaluate` (S-07 Q6). */
const isContextLoss = (error: unknown): boolean => error instanceof Error && CONTEXT_LOSS.test(error.message);

/**
 * The channel render loop (03 §5.3, S-07 protocol): one `iframe.html` document per page, booted
 * once; each render is one `page.evaluate` that drives the preview's channel and settles there.
 * A render timeout makes the next render boot a fresh document (Q6); a document Storybook
 * replaced by itself is adopted once its own render is done, never navigated over, and the render
 * retried once with `SB_HMR_DURING_CAPTURE`; so are renders that saw an HMR event (Q10).
 */
export async function createChannelEngine(context: DriverContext, timeoutMs: number): Promise<RenderEngine> {
  const { page, baseUrl, caps, storyIds } = context;
  const doneEvent: 'storyFinished' | 'storyRendered' = caps.storyFinishedEvent ? 'storyFinished' : 'storyRendered';
  const bootUrl = new URL('iframe.html?viewMode=story', baseUrl).href;
  await ensureChannelController(page);

  /** The document this engine booted or adopted; `null` when the next render must boot. */
  let docId: string | null = null;
  let layoutDisabled = false;

  const unavailable = (missing: readonly string[]): ChannelUnavailable => ({ ok: false, unavailable: true, missing });

  async function setLayout(keepLayout: boolean, install: boolean): Promise<void> {
    if (!install && keepLayout === layoutDisabled) return;
    await page.evaluate(
      ({ id, css, keep, add }) => {
        let style = document.getElementById(id) as HTMLStyleElement | null;
        if (style === null && add) {
          style = document.createElement('style');
          style.id = id;
          style.textContent = css;
          document.head.append(style);
        }
        if (style !== null) style.disabled = keep;
      },
      { id: LAYOUT_STYLE_ID, css: FULLSCREEN_LAYOUT_CSS, keep: keepLayout, add: install },
    );
    layoutDisabled = keepLayout;
  }

  async function probe(): Promise<{ preview: boolean; phases: readonly string[] }> {
    return new Deadline(PROBE_TIMEOUT_MS)
      .race(page.evaluate(channelPhases, CONTROLLER_KEY))
      .catch(() => ({ preview: false, phases: [] as string[] }));
  }

  /**
   * Navigates to `iframe.html?viewMode=story` (no story id: no render, no `storyMissing`
   * console error, S-07 Q13) and waits for the preview. The first story then renders through
   * the channel with its args preset, so a boot costs one render.
   */
  async function boot(
    storyId: string,
    deadline: Deadline,
    keepLayout: boolean,
  ): Promise<SbError | ChannelUnavailable | undefined> {
    docId = null;
    try {
      const response = await page.goto(bootUrl, { waitUntil: 'commit', timeout: deadline.remaining() });
      if (response !== null && !response.ok()) {
        return renderError(storyId, 'SB_IFRAME_UNREACHABLE', {
          value: `HTTP ${response.status()}`,
          data: { url: bootUrl },
        });
      }
      const state = await deadline.race(
        page.evaluate(awaitPreview, { key: CONTROLLER_KEY, timeoutMs: deadline.remaining() }),
        NODE_GRACE_MS,
      );
      if (state.kind === 'no-api') return unavailable(state.missing);
      if (state.kind === 'timeout') return timeoutFailure(storyId, timeoutMs, { preview: state.preview, phases: [] });
      docId = state.docId;
    } catch (error) {
      if (isTimeout(error)) return timeoutFailure(storyId, timeoutMs, await probe());
      return renderError(storyId, 'SB_IFRAME_UNREACHABLE', { value: (error as Error).message, data: { url: bootUrl } });
    }
    await setLayout(keepLayout, true);
    return undefined;
  }

  /**
   * Takes over a document Storybook loaded by itself (a reload on teardown, a dev-server full
   * reload): waits for its preview and for the render of the story in its URL, then installs the
   * layout. `false` when that fails; the next render then boots.
   */
  async function adopt(deadline: Deadline, keepLayout: boolean): Promise<boolean> {
    const previous = docId;
    docId = null;
    while (deadline.remaining() > 1) {
      try {
        const current = await page.evaluate(readDocId, CONTROLLER_KEY);
        if (current !== null && current !== previous) {
          const state = await page.evaluate(awaitPreview, { key: CONTROLLER_KEY, timeoutMs: deadline.remaining() });
          if (state.kind !== 'ready') return false;
          const storyId = new URL(page.url()).searchParams.get('id');
          if (storyId !== null) {
            const outcome = await page.evaluate(awaitStoryRender, {
              key: CONTROLLER_KEY,
              storyId,
              doneEvent,
              timeoutMs: deadline.remaining(),
            });
            if (outcome.kind === 'timeout') return false;
          }
          docId = state.docId;
          await setLayout(keepLayout, true);
          return true;
        }
      } catch (error) {
        if (!isContextLoss(error)) return false;
      }
      await new Promise((resolve) => setTimeout(resolve, ADOPT_POLL_MS));
    }
    return false;
  }

  async function render(request: RenderRequest, options: AttemptOptions): Promise<AttemptResult> {
    const { storyId } = request;
    if (!storyIds.has(storyId)) return renderError(storyId, 'SB_STORY_MISSING', { value: storyId, data: { baseUrl } });
    const deadline = new Deadline(timeoutMs);
    const started = Date.now();
    const keepLayout = request.keepLayout === true;
    const warnings: Diagnostic[] = [];
    const hmrEvents: string[] = [];
    let via: RenderPath = 'channel';
    await applyViewport(page, request);

    if (options.fresh) docId = null;
    if (docId !== null) {
      // A document we did not load: Storybook reloaded itself, or the dev server did.
      const current = await page.evaluate(readDocId, CONTROLLER_KEY).catch(() => null);
      if (current !== docId) {
        hmrEvents.push('preview-reloaded');
        if (!(await adopt(deadline, keepLayout))) docId = null;
      }
    }

    const args: ChannelRenderArgs = {
      key: CONTROLLER_KEY,
      storyId,
      args: request.args ?? {},
      globals: request.globals ?? {},
      remount: request.remount === true,
      doneEvent,
      timeoutMs,
      errorGraceMs: ERROR_GRACE_MS,
    };
    let report: ChannelReport | undefined;
    for (let attempt = 0; attempt < 2 && report === undefined; attempt += 1) {
      if (docId === null) {
        via = 'boot';
        const failed = await boot(storyId, deadline, keepLayout);
        if (failed !== undefined) return isUnavailable(failed) ? failed : { ...failed, via, warnings };
      } else {
        await setLayout(keepLayout, false);
      }
      try {
        const reported = await deadline.race(
          page.evaluate(channelRender, { ...args, timeoutMs: deadline.remaining() }),
          NODE_GRACE_MS,
        );
        if (reported.hmrEvents.length > 0 && attempt === 0) {
          // A module or the index changed while we rendered: render again on what is there now.
          hmrEvents.push(...reported.hmrEvents);
          continue;
        }
        report = reported;
      } catch (error) {
        if (isTimeout(error)) {
          docId = null;
          return { ...timeoutFailure(storyId, timeoutMs, await probe()), via, warnings };
        }
        if (!isContextLoss(error)) throw error;
        // Storybook replaced the document: tearing down a render that is still `loading` reloads
        // the preview (Q6). Adopt the new document once its own render is done, then retry.
        hmrEvents.push('preview-reloaded');
        if (!(await adopt(deadline, keepLayout))) docId = null;
      }
    }
    if (hmrEvents.length > 0) warnings.push(hmrWarning(storyId, [...new Set(hmrEvents)]));
    if (report === undefined) {
      docId = null;
      return {
        ...renderError(storyId, 'SB_RENDER_TIMEOUT', {
          value: `${timeoutMs} ms`,
          data: { timeoutMs, reason: 'the preview replaced its document twice during the render', events: hmrEvents },
        }),
        via,
        warnings,
      };
    }

    const { outcome } = report;
    if (outcome.kind === 'no-api') return unavailable(outcome.missing);
    if (outcome.kind === 'timeout') {
      // A render stuck in `loading` cannot be left through the channel without Storybook
      // reloading the page (Q6): the next render starts from a fresh document.
      docId = null;
      return { ...timeoutFailure(storyId, timeoutMs, { preview: true, phases: outcome.phases }), via, warnings };
    }
    if (outcome.kind !== 'done') return { ...outcomeError(storyId, outcome, true), via, warnings };

    try {
      if (options.stability) {
        const unstable = await deadline.race(stabilityWarning(page, request), NODE_GRACE_MS);
        if (unstable !== undefined) warnings.push(unstable);
      }
    } catch (error) {
      if (!isTimeout(error)) throw error;
      docId = null;
      return { ...timeoutFailure(storyId, timeoutMs, await probe()), via, warnings };
    }
    const roots = await findRoots(page, request);
    if (roots === undefined) {
      const selectors = rootSelectors(request);
      return {
        ...renderError(storyId, 'SB_ROOT_NOT_FOUND', { value: selectors.join(', '), data: { selectors } }),
        via,
        warnings,
      };
    }
    const result: RenderResult = {
      ok: true,
      storyId,
      url: buildIframeUrl(baseUrl, storyId),
      renderMs: Date.now() - started,
      phase: doneEvent === 'storyFinished' ? 'finished' : 'rendered',
      via,
      container: roots.container,
      rootHandles: roots.rootHandles,
      portalHandles: [],
      warnings: [...warnings, ...roots.warnings],
    };
    return result;
  }

  return {
    mode: 'channel',
    render,
    async reset() {
      docId = null;
      await page.goto('about:blank');
    },
    invalidate() {
      docId = null;
    },
  };
}
