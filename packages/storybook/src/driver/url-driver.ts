/// <reference lib="dom" />
import type { Diagnostic } from '@holotype/shared';
import type { RenderRequest, RenderResult, SbError, SbErrorCode } from '../types';
import { encodeUrlParam } from '../url-args';
import { Deadline, isTimeout } from './deadline';
import { type AttemptOptions, applyViewport, buildIframeUrl, type DriverContext, type RenderEngine } from './engine';
import { type ErrorDetails, outcomeError, renderError, timeoutFailure, unencodableError } from './errors';
import {
  FULLSCREEN_LAYOUT_CSS,
  installEventRecorder,
  type PageOutcome,
  RECORDER_KEY,
  readOutcome,
  readPhases,
  settleFrame,
} from './page-scripts';
import { findRoots, rootSelectors, stabilityWarning } from './roots';

/** How long the post-timeout probe of the page may take. */
const PROBE_TIMEOUT_MS = 1000;

/**
 * The URL path (03 §5.4): one navigation to `iframe.html?id=&args=&globals=` per render, then
 * the done event (`storyFinished` when the version has it, else `storyRendered`), the fullscreen
 * layout override, `document.fonts.ready` and two animation frames. Every render is a fresh
 * document; `remount` and `fresh` change nothing.
 */
export async function createUrlEngine(context: DriverContext, timeoutMs: number): Promise<RenderEngine> {
  const { page, baseUrl, caps, storyIds } = context;
  const doneEvent: 'storyFinished' | 'storyRendered' = caps.storyFinishedEvent ? 'storyFinished' : 'storyRendered';
  await page.addInitScript(installEventRecorder, RECORDER_KEY);

  async function render(request: RenderRequest, options: AttemptOptions): Promise<RenderResult | SbError> {
    const { storyId } = request;
    const deadline = new Deadline(timeoutMs);
    const fail = (code: SbErrorCode, details: ErrorDetails): SbError => ({
      ...renderError(storyId, code, details),
      via: 'url',
    });

    if (!storyIds.has(storyId)) return fail('SB_STORY_MISSING', { value: storyId, data: { baseUrl } });
    const args = encodeUrlParam(request.args ?? {});
    if (!args.ok) return unencodableError(storyId, 'args', args.error);
    const globals = encodeUrlParam(request.globals ?? {});
    if (!globals.ok) return unencodableError(storyId, 'globals', globals.error);
    const url = buildIframeUrl(baseUrl, storyId, args.value, globals.value);
    await applyViewport(page, request);

    const started = Date.now();
    try {
      const response = await page.goto(url, { waitUntil: 'commit', timeout: deadline.remaining() });
      if (response !== null && !response.ok()) {
        return fail('SB_IFRAME_UNREACHABLE', { value: `HTTP ${response.status()}`, data: { url } });
      }
    } catch (error) {
      if (isTimeout(error)) return timedOut(storyId, url);
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
      if (isTimeout(error)) return timedOut(storyId, url);
      throw error;
    }
    if (outcome.kind !== 'done') return { ...outcomeError(storyId, outcome, true), via: 'url' };

    const warnings: Diagnostic[] = [];
    try {
      if (request.keepLayout !== true) await deadline.race(page.addStyleTag({ content: FULLSCREEN_LAYOUT_CSS }));
      await deadline.race(page.evaluate(settleFrame));
      if (options.stability) {
        const unstable = await deadline.race(stabilityWarning(page, request));
        if (unstable !== undefined) warnings.push(unstable);
      }
    } catch (error) {
      if (isTimeout(error)) return timedOut(storyId, url);
      throw error;
    }

    const roots = await findRoots(page, request);
    if (roots === undefined) {
      const selectors = rootSelectors(request);
      return fail('SB_ROOT_NOT_FOUND', { value: selectors.join(', '), data: { url, selectors } });
    }
    return {
      ok: true,
      storyId,
      url,
      renderMs: Date.now() - started,
      phase: outcome.phase,
      via: 'url',
      container: roots.container,
      rootHandles: roots.rootHandles,
      portalHandles: [],
      warnings: [...warnings, ...roots.warnings],
    };
  }

  async function timedOut(storyId: string, url: string): Promise<SbError> {
    // The page may have no usable document after a stuck navigation: give the probe a second.
    const state = await new Deadline(PROBE_TIMEOUT_MS)
      .race(page.evaluate(readPhases, RECORDER_KEY))
      .catch(() => ({ preview: false, phases: [] as string[] }));
    return { ...timeoutFailure(storyId, timeoutMs, state, { url }), via: 'url' };
  }

  return {
    mode: 'url',
    render,
    async reset() {
      await page.goto('about:blank');
    },
    invalidate() {},
  };
}
