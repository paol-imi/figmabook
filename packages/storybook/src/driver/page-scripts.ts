/// <reference lib="dom" />
/*
 * Functions that run inside the preview page. Playwright serializes them with
 * `Function.prototype.toString`, so each one is self-contained: no imports, no references to
 * module scope, only its argument and browser globals.
 */

/** Name of the window property that holds the recorder state. */
export const RECORDER_KEY = '__holotypeSbEvents';

/** A Storybook channel event as the recorder keeps it: strings only, nothing live. */
export interface RecordedEvent {
  readonly event: string;
  readonly storyId?: string;
  readonly status?: string;
  readonly message?: string;
  readonly stack?: string;
  readonly newPhase?: string;
}

/** What the page reports once a render is over (03 §5.2). */
export type PageOutcome =
  | { readonly kind: 'done'; readonly phase: 'finished' | 'rendered' }
  | {
      readonly kind: 'error';
      /** The Storybook event, or `errordisplay` for the error overlay backstop. */
      readonly event: string;
      readonly message: string;
      readonly stack?: string;
    }
  | { readonly kind: 'missing'; readonly message?: string; readonly stack?: string };

/**
 * Init script: records the Storybook channel events of each document from the first one on.
 * The preview assigns `globalThis.__STORYBOOK_ADDONS_CHANNEL__` while it boots, before any
 * story renders; an accessor on that property subscribes as soon as the channel exists.
 */
export function installEventRecorder(key: string): void {
  type Channel = { on(event: string, listener: (payload: unknown) => void): void };
  type Host = Record<string, unknown> & { __STORYBOOK_ADDONS_CHANNEL__?: unknown };
  const host = window as unknown as Host;
  if (host[key] !== undefined) return;
  const events: RecordedEvent[] = [];
  host[key] = events;

  const names = [
    'storyRendered',
    'storyFinished',
    'storyMissing',
    'storyErrored',
    'storyThrewException',
    'playFunctionThrewException',
    'unhandledErrorsWhilePlaying',
    'storyRenderPhaseChanged',
  ];
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  const record = (event: string, payload: unknown): void => {
    const first: unknown = Array.isArray(payload) ? payload[0] : payload;
    const fields = typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {};
    const entry: RecordedEvent & Record<string, string> = { event };
    const storyId = typeof payload === 'string' ? payload : text(fields.storyId);
    const values: Record<string, string | undefined> = {
      storyId,
      status: text(fields.status),
      message: text(fields.message) ?? text(fields.title),
      stack: text(fields.stack) ?? text(fields.description),
      newPhase: text(fields.newPhase),
    };
    for (const [name, value] of Object.entries(values)) if (value !== undefined) entry[name] = value;
    events.push(entry);
  };

  const attached = new WeakSet<object>();
  const attach = (channel: unknown): void => {
    if (typeof channel !== 'object' || channel === null || attached.has(channel)) return;
    const on = (channel as Partial<Channel>).on;
    if (typeof on !== 'function') return;
    attached.add(channel);
    for (const name of names) on.call(channel, name, (payload: unknown) => record(name, payload));
  };

  let current: unknown = host.__STORYBOOK_ADDONS_CHANNEL__;
  attach(current);
  Object.defineProperty(host, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (next: unknown) => {
      current = next;
      attach(next);
    },
  });
}

/**
 * `waitForFunction` predicate: `false` while the render is in flight, then its outcome. Errors
 * win over the done event; the error overlay (`body.sb-show-errordisplay`) is a backstop.
 */
export function readOutcome(arg: {
  readonly key: string;
  readonly storyId: string;
  readonly doneEvent: 'storyFinished' | 'storyRendered';
}): PageOutcome | false {
  const events = (window as unknown as Record<string, RecordedEvent[] | undefined>)[arg.key] ?? [];
  const overlay = (): { message: string; stack?: string } => {
    const message = document.querySelector('#error-message')?.textContent?.trim() ?? '';
    const stack = document.querySelector('#error-stack')?.textContent?.trim() ?? '';
    return stack === '' ? { message } : { message, stack };
  };
  const errorEvents = [
    'storyErrored',
    'storyThrewException',
    'playFunctionThrewException',
    'unhandledErrorsWhilePlaying',
  ];
  let done: PageOutcome | undefined;
  for (const entry of events) {
    if (entry.event === 'storyMissing') return { kind: 'missing', ...overlay() };
    if (errorEvents.includes(entry.event)) {
      const message = entry.message ?? overlay().message;
      const stack = entry.stack ?? overlay().stack;
      return stack === undefined
        ? { kind: 'error', event: entry.event, message }
        : { kind: 'error', event: entry.event, message, stack };
    }
    if (entry.event === arg.doneEvent && (entry.storyId === undefined || entry.storyId === arg.storyId)) {
      done =
        entry.status === 'error'
          ? { kind: 'error', event: entry.event, ...overlay() }
          : { kind: 'done', phase: arg.doneEvent === 'storyFinished' ? 'finished' : 'rendered' };
    }
  }
  if (done !== undefined) return done;
  if (document.body?.classList.contains('sb-show-errordisplay'))
    return { kind: 'error', event: 'errordisplay', ...overlay() };
  return false;
}

/** The render phases recorded so far, for timeout diagnostics. */
export function readPhases(key: string): { readonly preview: boolean; readonly phases: string[] } {
  const host = window as unknown as Record<string, unknown>;
  const events = (host[key] as RecordedEvent[] | undefined) ?? [];
  return {
    preview: host.__STORYBOOK_PREVIEW__ !== undefined,
    phases: events.flatMap((entry) => (entry.newPhase === undefined ? [] : [entry.newPhase])),
  };
}

/** Waits for web fonts, then two animation frames (03 §5.5 steps 3 and 6). */
export async function settleFrame(): Promise<void> {
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * Finds the root container (03 §6.1). `>>>` steps into the open shadow root of the element
 * matched so far: `my-app >>> #root`. Returns `null` when a step matches nothing.
 */
export function findRootContainer(selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const steps = selector.split('>>>').map((step) => step.trim());
    let match: Element | null = document.querySelector(steps[0] ?? '');
    for (const step of steps.slice(1)) {
      const shadow: ShadowRoot | null = match === null ? null : match.shadowRoot;
      match = shadow === null ? null : shadow.querySelector(step);
    }
    if (match !== null) return match;
  }
  return null;
}

/** The container's displayed element children: what the story rendered. */
export function displayedChildren(container: Element): Element[] {
  const skipped = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);
  return Array.from(container.children).filter(
    (child) => !skipped.has(child.tagName.toUpperCase()) && getComputedStyle(child).display !== 'none',
  );
}

/**
 * `layout: 'fullscreen'` for capture (03 §6.1): the `padded` / `centered` layouts are Storybook
 * chrome, not component. `keepLayout` skips this.
 */
export const FULLSCREEN_LAYOUT_CSS = [
  'body.sb-show-main{margin:0!important;padding:0!important;display:block!important;min-height:0!important}',
  'body.sb-show-main::after{content:none!important}',
  '#storybook-root{display:block!important;margin:0!important;padding:0!important;max-height:none!important}',
].join('\n');
