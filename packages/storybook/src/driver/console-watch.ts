import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import type { ConsoleMessage, Request } from 'playwright';

/** Console errors kept per render in `SB_CONSOLE_ERROR`. */
export const MAX_CONSOLE_MESSAGES = 20;

/** The text Chromium logs for a subresource that failed (HTTP error status or network error). */
const LOAD_FAILED_PREFIX = 'Failed to load resource';

/** The console message as the watch reads it. */
export type ConsoleMessageLike = Pick<ConsoleMessage, 'type' | 'text' | 'location'>;

/** The page events the watch listens to. */
export interface ConsolePage {
  on(event: 'console', listener: (message: ConsoleMessageLike) => void): unknown;
  on(event: 'pageerror', listener: (error: Error) => void): unknown;
  on(event: 'request', listener: (request: Pick<Request, 'url'>) => void): unknown;
  off(event: 'console', listener: (message: ConsoleMessageLike) => void): unknown;
  off(event: 'pageerror', listener: (error: Error) => void): unknown;
  off(event: 'request', listener: (request: Pick<Request, 'url'>) => void): unknown;
}

/**
 * Whether a console error is Chromium's own `/favicon.ico` fetch failing. New headless Chromium
 * (the capture browser) asks for the favicon at the root of the origin, once per context, unless
 * request routing is on; a Storybook build has none, so the 404 is logged on whichever render a
 * worker does first. It is not the story's, and reporting it would make runs differ. The request comes from the browser process, so it never
 * shows up as a page `request` event: a story that fetches `/favicon.ico` itself still reports.
 */
export function isBrowserFaviconError(
  message: ConsoleMessageLike,
  baseUrl: string,
  pageRequests: ReadonlySet<string>,
): boolean {
  if (message.type() !== 'error' || !message.text().startsWith(LOAD_FAILED_PREFIX)) return false;
  const resource = message.location().url;
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return false;
  }
  return url.pathname === '/favicon.ico' && url.origin === new URL(baseUrl).origin && !pageRequests.has(url.href);
}

/** A running console watch: {@link ConsoleWatch.stop} ends it and returns what it collected. */
export interface ConsoleWatch {
  /** Stops listening; the first call returns `SB_CONSOLE_ERROR` when anything was logged. */
  stop(): Diagnostic[];
}

/**
 * Collects console errors and page errors while a render runs (`SB_CONSOLE_ERROR`, 03 §5.3),
 * minus the browser's own favicon request ({@link isBrowserFaviconError}).
 */
export function watchConsole(page: ConsolePage, baseUrl: string): ConsoleWatch {
  const messages: string[] = [];
  const requested = new Set<string>();
  let stopped = false;
  const onRequest = (request: Pick<Request, 'url'>) => {
    requested.add(request.url());
  };
  const onConsole = (message: ConsoleMessageLike) => {
    if (message.type() !== 'error' || isBrowserFaviconError(message, baseUrl, requested)) return;
    messages.push(message.text());
  };
  const onPageError = (error: Error) => messages.push(error.message);
  page.on('request', onRequest);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return {
    stop: () => {
      if (stopped) return [];
      stopped = true;
      page.off('request', onRequest);
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
