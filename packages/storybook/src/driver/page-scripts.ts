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

/** A decorator wrapper that was unwrapped although it paints a background (`SB_DECORATOR_PAINTS`). */
export interface PaintedWrapper {
  /** `nth-child` path from the root container, e.g. `:nth-child(1)`. */
  readonly path: string;
  readonly background: string;
}

/** What {@link resolveRoots} found. */
export interface ResolvedRoots {
  readonly roots: Element[];
  /** Wrappers descended through. */
  readonly unwrapped: number;
  readonly painted: PaintedWrapper[];
}

/**
 * The story's roots under `container` (03 §6.1–6.2): its displayed element children, then, while
 * there is exactly one, down through transparent decorator wrappers. A wrapper is transparent
 * when it has `display: contents`, or one displayed child, no text of its own, no paint, no
 * clipping and the child's border box (±0.5 px). Known provider wrappers (`[data-theme]`,
 * `#root-inner`, `.docs-story`) are transparent even when their box differs; one that paints a
 * background is reported. `maxDepth` 0 keeps the children as they are.
 */
export function resolveRoots(container: Element, maxDepth: number): ResolvedRoots {
  const skipped = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);
  const displayed = (element: Element): Element[] =>
    Array.from(element.children).filter(
      (child) => !skipped.has(child.tagName.toUpperCase()) && getComputedStyle(child).display !== 'none',
    );
  const hasText = (element: Element): boolean =>
    Array.from(element.childNodes).some((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '');
  const none = (value: string): boolean => value === '' || value === 'none';
  const paintsBackground = (style: CSSStyleDeclaration): boolean =>
    !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor) || !none(style.backgroundImage);
  const paints = (style: CSSStyleDeclaration): boolean => {
    if (paintsBackground(style)) return true;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const width = Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
      const kind = style.getPropertyValue(`border-${side}-style`);
      if (width > 0 && kind !== 'none' && kind !== 'hidden') return true;
    }
    return (
      !none(style.boxShadow) ||
      (Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none') ||
      !none(style.filter) ||
      !none(style.getPropertyValue('backdrop-filter')) ||
      Number.parseFloat(style.opacity) < 1 ||
      !none(style.transform) ||
      style.mixBlendMode !== 'normal'
    );
  };
  const clips = (style: CSSStyleDeclaration): boolean =>
    style.overflowX !== 'visible' ||
    style.overflowY !== 'visible' ||
    !none(style.clipPath) ||
    !none(style.getPropertyValue('mask-image'));
  const sameBox = (a: Element, b: Element): boolean => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return (
      Math.abs(ra.x - rb.x) <= 0.5 &&
      Math.abs(ra.y - rb.y) <= 0.5 &&
      Math.abs(ra.width - rb.width) <= 0.5 &&
      Math.abs(ra.height - rb.height) <= 0.5
    );
  };
  const step = (element: Element): string =>
    `:nth-child(${Array.from(element.parentElement?.children ?? []).indexOf(element) + 1})`;

  let roots = displayed(container);
  let unwrapped = 0;
  const painted: PaintedWrapper[] = [];
  const path: string[] = [];
  while (unwrapped < maxDepth && roots.length === 1) {
    const element = roots[0] as Element;
    const style = getComputedStyle(element);
    const kids = displayed(element);
    let transparent = false;
    if (style.display === 'contents') transparent = kids.length > 0;
    else if (kids.length === 1 && !hasText(element) && !clips(style)) {
      const known = element.matches('[data-theme], #root-inner, .docs-story');
      transparent = known || (!paints(style) && sameBox(element, kids[0] as Element));
      if (known && paintsBackground(style)) {
        painted.push({ path: [...path, step(element)].join(' > '), background: style.backgroundColor });
      }
    }
    if (!transparent) break;
    path.push(step(element));
    roots = kids;
    unwrapped += 1;
  }
  return { roots, unwrapped, painted };
}

/** What the stability check saw. */
export interface StabilityReport {
  readonly stable: boolean;
  /** Sample pairs compared (at most `tries`). */
  readonly tries: number;
}

/**
 * Stability check (03 §5.5 step 8, as corrected by S-07 Q17): samples the border box of the root
 * container and of every element under it, plus the container's markup, `intervalMs` apart; one
 * of up to `tries` pairs must match. The plan's container rect + `body.innerHTML.length`
 * heuristic misses roots whose children move while the markup length stays the same.
 */
export async function checkStability(arg: {
  readonly selectors: readonly string[];
  readonly tries: number;
  readonly intervalMs: number;
  /** Elements sampled at most, so a huge story stays cheap. */
  readonly maxElements: number;
}): Promise<StabilityReport> {
  const find = (): Element | null => {
    for (const selector of arg.selectors) {
      const steps = selector.split('>>>').map((part) => part.trim());
      let match: Element | null = document.querySelector(steps[0] ?? '');
      for (const part of steps.slice(1)) match = match?.shadowRoot?.querySelector(part) ?? null;
      if (match !== null) return match;
    }
    return null;
  };
  const sample = (): string => {
    const root = find();
    if (root === null) return '';
    const rects = [root, ...Array.from(root.querySelectorAll('*'))].slice(0, arg.maxElements).map((element) => {
      const rect = element.getBoundingClientRect();
      return `${rect.x},${rect.y},${rect.width},${rect.height}`;
    });
    return `${rects.join(';')}|${root.innerHTML}`;
  };
  for (let attempt = 1; attempt <= arg.tries; attempt += 1) {
    const before = sample();
    await new Promise((resolve) => setTimeout(resolve, arg.intervalMs));
    if (sample() === before) return { stable: true, tries: attempt };
  }
  return { stable: false, tries: arg.tries };
}

/** Storybook's test-runner marker (D-24): with it the `completing` phase pauses animations. */
export const TEST_RUNNER_MARKER = 'StorybookTestRunner';

/**
 * Init script for a context whose user agent lacks {@link TEST_RUNNER_MARKER}: adds it to
 * `navigator.userAgent` in this page, so Storybook does not wait ≈ 100 ms for animations on
 * every render (S-07 Q7).
 */
export function addTestRunnerMarker(marker: string): void {
  const agent = navigator.userAgent;
  if (agent.includes(marker)) return;
  Object.defineProperty(Navigator.prototype, 'userAgent', { configurable: true, get: () => `${agent} ${marker}` });
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
