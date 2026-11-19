import type { Page } from 'playwright';
import type { DriverMode, RenderRequest, RenderResult, SbCapabilities, SbError } from '../types';

/** What a driver works on: one page of one Storybook. */
export interface DriverContext {
  readonly page: Page;
  readonly baseUrl: string;
  readonly caps: SbCapabilities;
  /** Every story id of the unfiltered index. */
  readonly storyIds: ReadonlySet<string>;
}

/** How one render attempt runs. */
export interface AttemptOptions {
  /** Start from a fresh document (the retry of 02 §1.3) instead of the warm page. */
  readonly fresh: boolean;
  /** Run the stability check after settle (03 §5.5 step 8). */
  readonly stability: boolean;
}

/** The channel cannot drive this preview (no `__STORYBOOK_PREVIEW__` API): use the URL path. */
export interface ChannelUnavailable {
  readonly ok: false;
  readonly unavailable: true;
  /** What the preview lacks, e.g. `storyStoreValue.loadStory`. */
  readonly missing: readonly string[];
}

export type AttemptResult = RenderResult | SbError | ChannelUnavailable;

export const isUnavailable = (result: AttemptResult): result is ChannelUnavailable =>
  !result.ok && 'unavailable' in result;

/**
 * One way of rendering on a page: the channel loop or the URL path. Engines do one attempt per
 * call; the driver around them owns retries, the console watch and call ordering.
 */
export interface RenderEngine {
  readonly mode: DriverMode;
  render(request: RenderRequest, options: AttemptOptions): Promise<AttemptResult>;
  /** Leaves the preview (`about:blank`); the next render starts from a fresh document. */
  reset(): Promise<void>;
  /** The page was used by another engine: do not trust its document any more. */
  invalidate(): void;
}

/** Applies the request's viewport when it differs from the page's. */
export async function applyViewport(page: Page, request: RenderRequest): Promise<void> {
  if (request.viewport === undefined) return;
  const current = page.viewportSize();
  if (current?.width !== request.viewport.width || current.height !== request.viewport.height) {
    await page.setViewportSize(request.viewport);
  }
}

/** The `iframe.html` URL of one story (03 §5.4); `args` / `globals` are already encoded. */
export function buildIframeUrl(baseUrl: string, storyId: string, args = '', globals = ''): string {
  const url = new URL('iframe.html', baseUrl);
  url.searchParams.set('id', storyId);
  url.searchParams.set('viewMode', 'story');
  if (args !== '') url.searchParams.set('args', args);
  if (globals !== '') url.searchParams.set('globals', globals);
  return url.href;
}
