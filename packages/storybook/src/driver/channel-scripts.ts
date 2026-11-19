/// <reference lib="dom" />
/*
 * The channel render loop, page side (03 §5.3 with the S-07 corrections). Playwright serializes
 * these functions with `Function.prototype.toString`, so each one is self-contained: no imports,
 * no module scope, only its argument and browser globals.
 */

/** Window property of the controller state. */
export const CONTROLLER_KEY = '__holotypeSbChannel';

/**
 * One channel event, both directions: `out` was emitted in the page (by Storybook or by us),
 * `in` came from a transport (the dev server). On a top-level `iframe.html` the postMessage
 * transport also hands every `out` event back as an `in` echo (S-07 Q9), so waiters read `out`.
 */
export interface ChannelEvent {
  readonly seq: number;
  readonly dir: 'out' | 'in';
  readonly event: string;
  readonly storyId?: string;
  readonly status?: string;
  readonly newPhase?: string;
  readonly message?: string;
  readonly stack?: string;
}

/** The outcome of a boot or of one render step. */
export type ChannelOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly event: string; readonly message: string; readonly stack?: string }
  | { readonly kind: 'missing'; readonly message?: string }
  | { readonly kind: 'timeout'; readonly phases: readonly string[] }
  | { readonly kind: 'load-failed'; readonly message: string }
  /** The preview has no usable channel API (an exotic or older build): use the URL path. */
  | { readonly kind: 'no-api'; readonly missing: readonly string[] };

/** What {@link awaitPreview} found. */
export type PreviewState =
  | { readonly kind: 'ready'; readonly docId: string }
  | { readonly kind: 'timeout'; readonly preview: boolean }
  | { readonly kind: 'no-api'; readonly missing: readonly string[] };

export interface ChannelRenderArgs {
  readonly key: string;
  readonly storyId: string;
  /** Desired args over `initialArgs`; `{ $fromStory, arg }` and `{ $mapKey }` are rehydrated. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Desired globals over `initialGlobals`; other globals go back to their initial value. */
  readonly globals: Readonly<Record<string, unknown>>;
  readonly remount: boolean;
  readonly doneEvent: 'storyFinished' | 'storyRendered';
  readonly timeoutMs: number;
  /** How long to wait for the done event of a render that errored (S-07 Q4). */
  readonly errorGraceMs: number;
}

/** The steps a render took: what was emitted, in order. */
export type ChannelStep = 'preset-args' | 'select' | 'args' | 'globals' | 'remount' | 'heal';

export interface ChannelReport {
  readonly outcome: ChannelOutcome;
  readonly steps: readonly ChannelStep[];
  /** Storybook renders this request caused (one per done event). */
  readonly renders: number;
  /** Events that show the index or a CSF module changed while we rendered (S-07 Q10). */
  readonly hmrEvents: readonly string[];
}

/**
 * Init script: records the channel events of each document (wrapping `emit` and the transport
 * handler, S-07 Q9) in a ring buffer and wakes waiters as events arrive. The preview assigns
 * `__STORYBOOK_ADDONS_CHANNEL__` while it boots; an accessor on that property hooks it at once.
 * `docId` is new for every document, so Node can tell that Storybook replaced the page.
 */
export function installChannelController(key: string): void {
  type Channel = {
    emit(event: string, ...args: unknown[]): void;
    handleEvent?: (event: { type: string; args?: unknown[] }) => void;
  };
  type State = {
    docId: string;
    seq: number;
    events: ChannelEvent[];
    listeners: Set<() => void>;
    channel?: Channel;
  };
  const host = window as unknown as Record<string, unknown>;
  if (host[key] !== undefined) return;
  const random = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  const state: State = {
    docId: random === undefined ? `${performance.timeOrigin}-${performance.now()}` : random(),
    seq: 0,
    events: [],
    listeners: new Set(),
  };
  host[key] = state;
  const MAX_EVENTS = 2000;
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  const record = (dir: 'out' | 'in', event: string, args: readonly unknown[]): void => {
    const [first] = args;
    const fields = typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {};
    const entry: Record<string, unknown> = { seq: state.seq++, dir, event };
    const values: Record<string, string | undefined> = {
      storyId: typeof first === 'string' ? first : (text(fields.storyId) ?? text(fields.id)),
      status: text(fields.status),
      newPhase: text(fields.newPhase),
      message: text(fields.message) ?? text(fields.title),
      stack: text(fields.stack) ?? text(fields.description),
    };
    for (const [name, value] of Object.entries(values)) if (value !== undefined) entry[name] = value;
    state.events.push(entry as unknown as ChannelEvent);
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    for (const listener of [...state.listeners]) listener();
  };
  const attach = (channel: unknown): void => {
    if (typeof channel !== 'object' || channel === null || state.channel === channel) return;
    const typed = channel as Channel;
    if (typeof typed.emit !== 'function') return;
    state.channel = typed;
    const emit = typed.emit.bind(typed);
    typed.emit = (event: string, ...args: unknown[]) => {
      record('out', event, args);
      emit(event, ...args);
    };
    const handle = typed.handleEvent?.bind(typed);
    if (handle !== undefined) {
      typed.handleEvent = (event) => {
        record('in', event.type, event.args ?? []);
        handle(event);
      };
    }
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

/** The document id, or `null` before the controller exists (about:blank, a foreign page). */
export function readDocId(key: string): string | null {
  const state = (window as unknown as Record<string, { docId: string } | undefined>)[key];
  return state?.docId ?? null;
}

/**
 * Waits until the preview of this document is ready to be driven: `__STORYBOOK_PREVIEW__` with
 * its story store, `ready()` resolved, and the channel hooked by the controller.
 */
export async function awaitPreview(arg: { readonly key: string; readonly timeoutMs: number }): Promise<PreviewState> {
  type Preview = { ready?: () => Promise<void>; storyStoreValue?: unknown; loadStory?: unknown };
  const host = window as unknown as Record<string, unknown>;
  const end = performance.now() + arg.timeoutMs;
  const sleep = () => new Promise((resolve) => setTimeout(resolve, 10));
  while (host.__STORYBOOK_PREVIEW__ === undefined) {
    if (performance.now() > end) return { kind: 'timeout', preview: false };
    await sleep();
  }
  const preview = host.__STORYBOOK_PREVIEW__ as Preview;
  if (typeof preview.ready === 'function') {
    const ready = await Promise.race([
      preview.ready().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), Math.max(1, end - performance.now()))),
    ]);
    if (!ready) return { kind: 'timeout', preview: true };
  }
  const state = host[arg.key] as { docId: string; channel?: unknown } | undefined;
  while (state !== undefined && state.channel === undefined && performance.now() <= end) await sleep();
  const store = preview.storyStoreValue as { loadStory?: unknown; args?: unknown; userGlobals?: unknown } | undefined;
  const missing = [
    ...(state?.channel === undefined ? ['channel'] : []),
    ...(typeof store?.loadStory !== 'function' ? ['storyStoreValue.loadStory'] : []),
    ...(typeof store?.args !== 'object' ? ['storyStoreValue.args'] : []),
    ...(typeof store?.userGlobals !== 'object' ? ['storyStoreValue.userGlobals'] : []),
  ];
  if (missing.length > 0 || state === undefined) return { kind: 'no-api', missing };
  return { kind: 'ready', docId: state.docId };
}

/**
 * Waits for the render Storybook started by itself in a document it reloaded (S-07 Q6): the
 * done event of `storyId`, an error, or a missing story.
 */
export function awaitStoryRender(arg: {
  readonly key: string;
  readonly storyId: string;
  readonly doneEvent: 'storyFinished' | 'storyRendered';
  readonly timeoutMs: number;
}): Promise<ChannelOutcome> {
  type State = { events: ChannelEvent[]; listeners: Set<() => void> };
  const state = (window as unknown as Record<string, State>)[arg.key] as State;
  const errors = ['storyErrored', 'storyThrewException', 'playFunctionThrewException', 'unhandledErrorsWhilePlaying'];
  return new Promise<ChannelOutcome>((resolve) => {
    let error: ChannelOutcome | undefined;
    const finish = (outcome: ChannelOutcome): void => {
      clearTimeout(timer);
      state.listeners.delete(scan);
      resolve(outcome);
    };
    const scan = (): void => {
      for (const entry of state.events) {
        if (entry.dir !== 'out') continue;
        if (entry.event === 'storyMissing') {
          finish({ kind: 'missing' });
          return;
        }
        if (error === undefined && errors.includes(entry.event)) {
          error = { kind: 'error', event: entry.event, message: entry.message ?? '' };
        }
        if (entry.event === arg.doneEvent && entry.storyId === arg.storyId) {
          finish(error ?? { kind: 'done' });
          return;
        }
      }
    };
    const timer = setTimeout(() => {
      const phases = state.events.flatMap((entry) => (entry.newPhase === undefined ? [] : [entry.newPhase]));
      finish(error ?? { kind: 'timeout', phases });
    }, arg.timeoutMs);
    state.listeners.add(scan);
    scan();
  });
}

/**
 * One render through the channel (03 §5.3, corrected by S-07): read the story's store args
 * (they persist per story across switches, Q1); preset them before `setCurrentStory` so a
 * switch renders once (Q8); send the full arg set, initial values restored and extra keys
 * unset (Q2), and only when it differs (Q3); then globals, then a remount when asked or when an
 * earlier error left the story blank (Q5). Each step arms its waiter before emitting; the first
 * error event wins over the done event, whose status says "success" anyway (Q4). Ends with
 * `document.fonts.ready` and two animation frames (03 §5.5).
 */
export async function channelRender(req: ChannelRenderArgs): Promise<ChannelReport> {
  type State = { events: ChannelEvent[]; listeners: Set<() => void>; channel?: { emit(e: string, p: unknown): void } };
  type ArgType = { mapping?: Record<string, unknown> };
  type Story = { initialArgs: Record<string, unknown>; argTypes?: Record<string, ArgType> };
  type Store = {
    loadStory(options: { storyId: string }): Promise<Story>;
    args: { get(storyId: string): Record<string, unknown> | undefined; argsByStoryId?: Record<string, unknown> };
    userGlobals: { get(): Record<string, unknown>; initialGlobals?: Record<string, unknown> };
  };
  type Preview = { ready?: () => Promise<void>; currentSelection?: { storyId: string }; storyStoreValue: Store };
  const host = window as unknown as Record<string, unknown>;
  const state = host[req.key] as State;
  const preview = host.__STORYBOOK_PREVIEW__ as Preview;
  const end = performance.now() + req.timeoutMs;
  const firstSeq = state.events.at(-1)?.seq ?? -1;
  const steps: ChannelStep[] = [];
  const errorEvents = [
    'storyErrored',
    'storyThrewException',
    'playFunctionThrewException',
    'unhandledErrorsWhilePlaying',
  ];
  let renders = 0;
  const report = (outcome: ChannelOutcome): ChannelReport => ({
    outcome,
    steps,
    renders,
    hmrEvents: state.events
      .filter(
        (entry) =>
          entry.seq > firstSeq &&
          ((entry.dir === 'in' && entry.event === 'storyIndexInvalidated') ||
            (entry.dir === 'out' && entry.event === 'storyHotUpdated')),
      )
      .map((entry) => entry.event),
  });

  /**
   * Emits `event` and waits for the story's done event; an error event earlier in the render
   * wins. `expectRender: false` is an args write for a story that is not current: Storybook
   * answers with `storyArgsUpdated` only.
   */
  const emitAndWait = (step: ChannelStep, event: string, payload: unknown, expectRender = true) =>
    new Promise<ChannelOutcome>((resolve) => {
      const mark = state.events.at(-1)?.seq ?? -1;
      let error: ChannelOutcome | undefined;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const phases = () =>
        state.events.flatMap((entry) => (entry.seq > mark && entry.newPhase !== undefined ? [entry.newPhase] : []));
      const finish = (outcome: ChannelOutcome, rendered: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(grace);
        state.listeners.delete(scan);
        if (rendered) renders += 1;
        resolve(outcome);
      };
      const scan = () => {
        for (const entry of state.events) {
          if (finished) return;
          if (entry.seq <= mark || entry.dir !== 'out') continue;
          if (!expectRender && entry.event === 'storyArgsUpdated' && entry.storyId === req.storyId) {
            finish({ kind: 'done' }, false);
          } else if (entry.event === 'storyMissing') {
            finish({ kind: 'missing', ...(entry.message === undefined ? {} : { message: entry.message }) }, false);
          } else if (error === undefined && errorEvents.includes(entry.event)) {
            error = {
              kind: 'error',
              event: entry.event,
              message: entry.message ?? '',
              ...(entry.stack === undefined ? {} : { stack: entry.stack }),
            };
            // The errored render still ends with a done event: wait for it, briefly, so it is
            // not read as the done event of the next render.
            const failed = error;
            grace = setTimeout(() => finish(failed, true), req.errorGraceMs);
          } else if (entry.event === req.doneEvent && (entry.storyId === undefined || entry.storyId === req.storyId)) {
            finish(error ?? { kind: 'done' }, true);
          }
        }
      };
      const timer = setTimeout(
        () => finish(error ?? { kind: 'timeout', phases: phases() }, false),
        Math.max(1, end - performance.now()),
      );
      steps.push(step);
      state.listeners.add(scan);
      state.channel?.emit(event, payload);
      scan();
    });

  /** Structural equality for arg values: plain objects and arrays by content, the rest by identity. */
  const equal = (a: unknown, b: unknown, depth = 0): boolean => {
    if (Object.is(a, b)) return true;
    if (depth > 8 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    const plain = (value: object) => Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype;
    if (!plain(a) || !plain(b) || Array.isArray(a) !== Array.isArray(b)) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    for (const k of keys) if (!equal(ra[k], rb[k], depth + 1)) return false;
    return true;
  };
  /** Equal records; a key set to `undefined` equals a missing key (Storybook deletes it, Q2). */
  const same = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!equal(a[k], b[k])) return false;
    return true;
  };
  /** The full update: every desired value, plus `undefined` for keys only `current` has. */
  const fullUpdate = (current: Record<string, unknown>, desired: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...desired };
    for (const name of Object.keys(current)) if (!(name in desired)) next[name] = undefined;
    return next;
  };

  /** A CSF import that hangs (a held module, top-level `await`) must not outlive the deadline. */
  const EXPIRED = Symbol('expired');
  const inTime = <T>(work: Promise<T>): Promise<T | typeof EXPIRED> =>
    Promise.race([
      work,
      new Promise<typeof EXPIRED>((resolve) =>
        setTimeout(() => resolve(EXPIRED), Math.max(1, end - performance.now())),
      ),
    ]);
  const expired = () => report({ kind: 'timeout', phases: ['loading'] });
  const loadStory = async (storyId: string): Promise<Story> => {
    const loaded = await inTime(store.loadStory({ storyId }));
    if (loaded === EXPIRED) throw EXPIRED;
    return loaded;
  };

  if ((await inTime(preview.ready?.() ?? Promise.resolve())) === EXPIRED) return expired();
  const store = preview.storyStoreValue;
  const desired: Record<string, unknown> = {};
  try {
    const story = await loadStory(req.storyId);
    Object.assign(desired, story.initialArgs);
    for (const [name, value] of Object.entries(req.args)) {
      const marker = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
      if (marker !== undefined && typeof marker.$fromStory === 'string') {
        const source = await loadStory(marker.$fromStory);
        desired[name] = source.initialArgs[typeof marker.arg === 'string' ? marker.arg : name];
      } else if (marker !== undefined && typeof marker.$mapKey === 'string') {
        desired[name] = story.argTypes?.[name]?.mapping?.[marker.$mapKey] ?? marker.$mapKey;
      } else {
        desired[name] = value;
      }
    }
  } catch (error) {
    if (error === EXPIRED) return expired();
    // The CSF module failed to import, or (dev server) the index lists a file the preview's
    // importers do not know yet (Q11).
    return report({ kind: 'load-failed', message: String((error as Error)?.message ?? error) });
  }
  const storeArgs = (): Record<string, unknown> | undefined => {
    try {
      return store.args.get(req.storyId);
    } catch {
      return undefined;
    }
  };

  const staleError = () => document.body.classList.contains('sb-show-errordisplay');
  let outcome: ChannelOutcome = { kind: 'done' };
  if (preview.currentSelection?.storyId !== req.storyId) {
    const known = storeArgs();
    if (known !== undefined && !same(known, desired)) {
      outcome = await emitAndWait(
        'preset-args',
        'updateStoryArgs',
        { storyId: req.storyId, updatedArgs: fullUpdate(known, desired) },
        false,
      );
    }
    if (outcome.kind === 'done') {
      outcome = await emitAndWait('select', 'setCurrentStory', { storyId: req.storyId, viewMode: 'story' });
    }
  }
  if (outcome.kind === 'done') {
    const current = storeArgs() ?? {};
    if (!same(current, desired)) {
      outcome = await emitAndWait('args', 'updateStoryArgs', {
        storyId: req.storyId,
        updatedArgs: fullUpdate(current, desired),
      });
    }
  }
  if (outcome.kind === 'done') {
    const globals = store.userGlobals.get();
    const wanted = { ...(store.userGlobals.initialGlobals ?? {}), ...req.globals };
    if (!same(globals, wanted)) {
      outcome = await emitAndWait('globals', 'updateGlobals', { globals: fullUpdate(globals, wanted) });
    }
  }
  if (outcome.kind === 'done' && req.remount) {
    outcome = await emitAndWait('remount', 'forceRemount', { storyId: req.storyId });
  }
  // After a render error, re-rendering the same story renders nothing and reports success; the
  // error overlay class stays on <body> (Q5). A remount recovers.
  if (outcome.kind === 'done' && staleError()) {
    outcome = await emitAndWait('heal', 'forceRemount', { storyId: req.storyId });
    if (outcome.kind === 'done' && staleError()) {
      outcome = {
        kind: 'error',
        event: 'errordisplay',
        message: document.querySelector('#error-message')?.textContent?.trim() ?? '',
      };
    }
  }
  if (outcome.kind !== 'done') return report(outcome);
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return report(outcome);
}

/** The render phases recorded in this document, for timeout diagnostics. */
export function channelPhases(key: string): { readonly preview: boolean; readonly phases: string[] } {
  const host = window as unknown as Record<string, unknown>;
  const events = (host[key] as { events: ChannelEvent[] } | undefined)?.events ?? [];
  return {
    preview: host.__STORYBOOK_PREVIEW__ !== undefined,
    phases: events.flatMap((entry) => (entry.newPhase === undefined ? [] : [entry.newPhase])),
  };
}
