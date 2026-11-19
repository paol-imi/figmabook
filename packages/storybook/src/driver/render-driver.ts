import type { Diagnostic } from '@holotype/shared';
import { componentIdFromStoryId, isStoryId } from '../story-id';
import type {
  DisposeReport,
  DriverMode,
  DriverOptions,
  RenderDriver,
  RenderRequest,
  RenderResult,
  SbError,
  SbErrorCode,
  StabilityMode,
} from '../types';
import { createChannelEngine } from './channel-driver';
import { watchConsole } from './console-watch';
import { checkTimeout } from './deadline';
import { type AttemptResult, type DriverContext, isUnavailable, type RenderEngine } from './engine';
import { unrenderableError } from './errors';
import { addTestRunnerMarker, TEST_RUNNER_MARKER } from './page-scripts';
import { createUrlEngine } from './url-driver';

/** `T.render` (03 §5.3). */
export const DEFAULT_RENDER_TIMEOUT_MS = 15_000;

/** How long `dispose()` waits for the page at each step before it closes it. */
export const DEFAULT_DISPOSE_TIMEOUT_MS = 5000;

/** Codes that get a second attempt on a fresh document (02 §1.3). */
export const RETRIED_CODES: ReadonlySet<SbErrorCode> = new Set(['SB_RENDER_TIMEOUT', 'SB_STORY_ERROR']);

/** Failed fresh documents in a row after which a story is `SB_STORY_UNRENDERABLE` (03 §5.3). */
export const MAX_FAILED_RELOADS = 3;

/**
 * Makes sure Storybook sees the test-runner user agent (D-24, S-07 Q7). The capture contexts set
 * it already; any other page gets the marker added by an init script.
 */
async function ensureTestRunnerAgent(context: DriverContext): Promise<void> {
  const agent = await context.page.evaluate(() => navigator.userAgent).catch(() => '');
  if (!agent.includes(TEST_RUNNER_MARKER)) await context.page.addInitScript(addTestRunnerMarker, TEST_RUNNER_MARKER);
}

const sidOf = (storyId: string): string => (isStoryId(storyId) ? componentIdFromStoryId(storyId) : storyId);

interface FailureRecord {
  reloads: number;
  last?: SbError;
}

/**
 * Creates the render driver of one page (03 §5): the channel loop by default, the URL path with
 * `mode: 'url'` or when the preview has no channel API. A render that fails with
 * `SB_RENDER_TIMEOUT` or `SB_STORY_ERROR` is tried once more on a fresh document (02 §1.3); a
 * story whose renders failed on three fresh documents in a row is `SB_STORY_UNRENDERABLE` from
 * then on. Console errors of the whole render become `SB_CONSOLE_ERROR`.
 */
export async function createRenderDriver(context: DriverContext, options: DriverOptions = {}): Promise<RenderDriver> {
  const timeoutMs = checkTimeout(options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS);
  const stabilityMode: StabilityMode = options.stability ?? 'first-per-component';
  await ensureTestRunnerAgent(context);
  const channel = options.mode === 'url' ? undefined : await createChannelEngine(context, timeoutMs);
  let url: RenderEngine | undefined;
  let engine: RenderEngine;
  if (channel === undefined) {
    url = await createUrlEngine(context, timeoutMs);
    engine = url;
  } else {
    engine = channel;
  }
  const checked = new Set<string>();
  const failures = new Map<string, FailureRecord>();
  const unrenderable = new Map<string, SbError>();
  const disposeTimeoutMs = checkTimeout(options.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS, 'disposeTimeoutMs');
  let busy = false;
  let disposed = false;
  let inFlight: Promise<unknown> | undefined;
  let disposing: Promise<DisposeReport> | undefined;

  /** Switches to the URL path for good: this preview cannot be driven through its channel. */
  async function fallBack(): Promise<RenderEngine> {
    channel?.invalidate();
    url ??= await createUrlEngine(context, timeoutMs);
    engine = url;
    return url;
  }

  async function attempt(request: RenderRequest, fresh: boolean, stability: boolean): Promise<RenderResult | SbError> {
    let result: AttemptResult = await engine.render(request, { fresh, stability });
    if (isUnavailable(result)) result = await (await fallBack()).render(request, { fresh: true, stability });
    if (isUnavailable(result)) throw new Error('The URL render path cannot be unavailable.');
    return result;
  }

  /** Counts a failed attempt on a fresh document; `true` when the story is now unrenderable. */
  function recordFailure(storyId: string, result: SbError): boolean {
    if (result.via !== 'boot' && result.via !== 'url') return false;
    const record = failures.get(storyId) ?? { reloads: 0 };
    record.reloads += 1;
    record.last = result;
    failures.set(storyId, record);
    return record.reloads >= MAX_FAILED_RELOADS;
  }

  async function renderWithRetry(request: RenderRequest): Promise<RenderResult | SbError> {
    const { storyId } = request;
    const known = unrenderable.get(storyId);
    if (known !== undefined) return known;
    const sid = sidOf(storyId);
    const stability =
      request.checkStability ??
      (stabilityMode === 'always' || (stabilityMode === 'first-per-component' && !checked.has(sid)));

    const warnings: Diagnostic[] = [];
    let attempts = 0;
    let result: RenderResult | SbError | undefined;
    for (const fresh of [false, true]) {
      attempts += 1;
      result = await attempt(request, fresh, stability);
      warnings.push(...result.warnings);
      if (result.ok) break;
      if (recordFailure(storyId, result)) {
        const reloads = failures.get(storyId)?.reloads ?? 0;
        const failed: SbError = {
          ...unrenderableError(storyId, reloads, result),
          ...(result.via === undefined ? {} : { via: result.via }),
        };
        unrenderable.set(storyId, failed);
        return { ...failed, warnings, attempts };
      }
      if (!RETRIED_CODES.has(result.code)) break;
    }
    if (result === undefined) throw new Error('A render made no attempt.');
    if (result.ok) {
      failures.delete(storyId);
      if (stability) checked.add(sid);
    }
    return { ...result, warnings, attempts };
  }

  return {
    get mode(): DriverMode {
      return engine.mode;
    },
    async render(request: RenderRequest): Promise<RenderResult | SbError> {
      if (disposed) throw new Error('RenderDriver.render() was called after dispose().');
      if (busy) throw new Error('RenderDriver.render() was called while another render is in progress.');
      busy = true;
      const consoleWatch = watchConsole(context.page, context.baseUrl);
      try {
        const running = renderWithRetry(request);
        inFlight = running;
        const result = await running;
        const logged = consoleWatch.stop();
        return logged.length === 0 ? result : { ...result, warnings: [...result.warnings, ...logged] };
      } finally {
        consoleWatch.stop();
        busy = false;
        inFlight = undefined;
      }
    },
    async reload() {
      await engine.reset();
    },
    dispose() {
      disposed = true;
      disposing ??= disposeBounded(context.page, inFlight, disposeTimeoutMs);
      return disposing;
    },
  };
}

/** Resolves `work`, or `'timeout'` after `ms`; a rejection counts as done. */
async function within(work: Promise<unknown>, ms: number): Promise<'done' | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([
      work.then(
        () => 'done' as const,
        () => 'done' as const,
      ),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded dispose: waits for a render still in flight, then checks that the page still answers,
 * each within `timeoutMs`. A page that does not answer would hang its owner's `page.close()`, so
 * it is closed here (`page.close`, then its browser context), each step bounded too.
 */
export async function disposeBounded(
  page: DriverContext['page'],
  inFlight: Promise<unknown> | undefined,
  timeoutMs: number,
): Promise<DisposeReport> {
  if (page.isClosed()) return { forced: 'none' };
  let reason: string | undefined;
  if (inFlight !== undefined && (await within(inFlight, timeoutMs)) === 'timeout') {
    reason = `a render was still running ${timeoutMs} ms after dispose()`;
  } else if (
    (await within(
      page.evaluate(() => true),
      timeoutMs,
    )) === 'timeout'
  ) {
    reason = `the page did not answer within ${timeoutMs} ms of dispose()`;
  }
  if (reason === undefined) return { forced: 'none' };
  if ((await within(page.close({ runBeforeUnload: false }), timeoutMs)) === 'done') return { forced: 'page', reason };
  if ((await within(page.context().close(), timeoutMs)) === 'done') return { forced: 'context', reason };
  return { forced: 'stuck', reason: `${reason}; closing its page and context did not return either` };
}
