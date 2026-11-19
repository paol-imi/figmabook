/// <reference lib="dom" />
/*
 * S-07 channel render loop, page side. Playwright serializes these functions with
 * `Function.prototype.toString`, so each is self-contained: no imports, no module scope, only
 * its argument and browser globals.
 */

/** Window property of the controller state. */
export const CONTROLLER_KEY = '__holotypeS07';

/**
 * One channel event, both directions: `out` = emitted in the page, `in` = from a transport.
 * On a top-level `iframe.html` the postMessage transport hands every `out` event back as an
 * `in` echo (Storybook drops it before its listeners); the dev server adds its own events.
 */
export interface PageEvent {
  readonly seq: number;
  /** `performance.now()` of the document. */
  readonly t: number;
  readonly dir: 'out' | 'in';
  readonly event: string;
  readonly storyId?: string;
  readonly status?: string;
  readonly newPhase?: string;
  readonly message?: string;
  readonly stack?: string;
}

export type PageOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly event: string; readonly message: string; readonly stack?: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'timeout'; readonly phases: readonly string[] }
  | { readonly kind: 'load-failed'; readonly message: string };

/** What one channel step did: the event we emitted and how long until the story was done. */
export interface StepReport {
  readonly step: 'select' | 'preset-args' | 'args' | 'globals' | 'remount' | 'heal';
  readonly ms: number;
  /** Render phases Storybook went through for this step. */
  readonly phases: readonly string[];
  readonly outcome: PageOutcome['kind'];
}

export interface PageRenderRequest {
  readonly key: string;
  readonly storyId: string;
  /** Desired args over the story's `initialArgs`; `{ $fromStory, arg }` markers are rehydrated. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Desired user globals over `initialGlobals`; `undefined` keeps the current globals. */
  readonly globals?: Readonly<Record<string, unknown>>;
  readonly remount: boolean;
  /** Write the args into the ArgsStore before `setCurrentStory`, so a revisit renders once. */
  readonly presetArgs: boolean;
  readonly doneEvent: 'storyFinished' | 'storyRendered';
  readonly timeoutMs: number;
  /** 03 §5.5 step 8: root rect + `body.innerHTML.length`, twice 100 ms apart, up to 3 tries. */
  readonly stability: boolean;
}

export interface PageRenderReport {
  readonly outcome: PageOutcome;
  readonly steps: readonly StepReport[];
  /** No render was needed: the story was current with the same args and globals. */
  readonly skipped: boolean;
  readonly settleMs: number;
  readonly totalMs: number;
  /** `false` when the stability check ran and the root kept changing (element rects + markup). */
  readonly stable: boolean | null;
  /** The 03 §5.5 step 8 heuristic (container rect + `body.innerHTML.length`) on the first pair. */
  readonly planStable: boolean | null;
  /** Number of Storybook renders this request caused (one per done event). */
  readonly renders: number;
  /** Incoming events that show the index or a CSF module changed while we rendered. */
  readonly hmrEvents: readonly string[];
}

/**
 * Init script: records every channel event of the document in a ring buffer, and resolves
 * waiters as events arrive. `docId` changes with every document, so Node can tell a reload.
 */
export function installChannelController(key: string): void {
  type Channel = {
    emit(event: string, ...args: unknown[]): void;
    handleEvent?: (event: { type: string; args?: unknown[] }) => void;
  };
  type State = {
    docId: string;
    seq: number;
    events: PageEvent[];
    listeners: Set<() => void>;
    channel?: Channel;
  };
  const host = window as unknown as Record<string, unknown>;
  if (host[key] !== undefined) return;
  const state: State = {
    docId: `${performance.timeOrigin}-${Math.floor(performance.now() * 1000)}`,
    seq: 0,
    events: [],
    listeners: new Set(),
  };
  host[key] = state;
  const MAX_EVENTS = 4000;
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  const record = (dir: 'out' | 'in', event: string, args: readonly unknown[]): void => {
    const [first] = args;
    const fields = typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {};
    const entry: Record<string, unknown> = { seq: state.seq++, t: performance.now(), dir, event };
    const values: Record<string, string | undefined> = {
      storyId: typeof first === 'string' ? first : (text(fields.storyId) ?? text(fields.id)),
      status: text(fields.status),
      newPhase: text(fields.newPhase),
      message: text(fields.message) ?? text(fields.title),
      stack: text(fields.stack) ?? text(fields.description),
    };
    for (const [name, value] of Object.entries(values)) if (value !== undefined) entry[name] = value;
    state.events.push(entry as unknown as PageEvent);
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    for (const listener of [...state.listeners]) listener();
  };
  const attach = (channel: unknown): void => {
    if (typeof channel !== 'object' || channel === null || state.channel === channel) return;
    const typed = channel as Channel;
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

/** The document id, or `null` before the controller exists (about:blank). */
export function readDocId(key: string): string | null {
  const state = (window as unknown as Record<string, { docId: string } | undefined>)[key];
  return state?.docId ?? null;
}

/**
 * Waits for the boot render of the document: the done event of `storyId`, an error, or a
 * missing story. Used after a navigation to `iframe.html?id=`.
 */
export async function awaitBoot(arg: {
  readonly key: string;
  readonly storyId: string;
  readonly doneEvent: 'storyFinished' | 'storyRendered';
  readonly timeoutMs: number;
}): Promise<PageOutcome> {
  type State = { events: PageEvent[]; listeners: Set<() => void> };
  const end = performance.now() + arg.timeoutMs;
  while ((window as unknown as Record<string, unknown>)[arg.key] === undefined) {
    if (performance.now() > end) return { kind: 'timeout', phases: [] };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const state = (window as unknown as Record<string, State>)[arg.key] as State;
  const errors = ['storyErrored', 'storyThrewException', 'playFunctionThrewException', 'unhandledErrorsWhilePlaying'];
  return new Promise<PageOutcome>((resolve) => {
    let error: PageOutcome | undefined;
    const scan = (): boolean => {
      for (const entry of state.events) {
        if (entry.dir !== 'out') continue;
        if (entry.event === 'storyMissing') return finish({ kind: 'missing' });
        if (error === undefined && errors.includes(entry.event)) {
          error = {
            kind: 'error',
            event: entry.event,
            message: entry.message ?? '',
            ...(entry.stack === undefined ? {} : { stack: entry.stack }),
          };
        }
        if (entry.event === arg.doneEvent && entry.storyId === arg.storyId) return finish(error ?? { kind: 'done' });
      }
      return false;
    };
    const timer = setTimeout(
      () => {
        const phases = state.events.flatMap((entry) => (entry.newPhase === undefined ? [] : [entry.newPhase]));
        finish(error ?? { kind: 'timeout', phases });
      },
      Math.max(1, end - performance.now()),
    );
    const finish = (outcome: PageOutcome): true => {
      clearTimeout(timer);
      state.listeners.delete(listener);
      resolve(outcome);
      return true;
    };
    const listener = () => {
      scan();
    };
    state.listeners.add(listener);
    scan();
  });
}

/**
 * One variant through the channel (03 §5.3, with the S-07 corrections): select the story if
 * needed, set the full arg set in one `updateStoryArgs` (initial values restored explicitly,
 * extra keys unset), update globals, remount when asked or when an earlier error left the
 * story blank, then fonts + two frames and the optional stability check.
 */
export async function channelRender(req: PageRenderRequest): Promise<PageRenderReport> {
  type State = { events: PageEvent[]; listeners: Set<() => void>; channel?: { emit(e: string, p: unknown): void } };
  type Story = { initialArgs: Record<string, unknown> };
  type Preview = {
    ready?: () => Promise<void>;
    currentSelection?: { storyId: string };
    storyStoreValue: {
      loadStory(options: { storyId: string }): Promise<Story>;
      args: { get(storyId: string): Record<string, unknown> | undefined; argsByStoryId?: Record<string, unknown> };
      userGlobals: { get(): Record<string, unknown>; initialGlobals?: Record<string, unknown> };
    };
  };
  const started = performance.now();
  const end = started + req.timeoutMs;
  const host = window as unknown as Record<string, unknown>;
  const state = host[req.key] as State;
  // A document Storybook just reloaded may not have created its preview yet.
  while (host.__STORYBOOK_PREVIEW__ === undefined && performance.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const preview = host.__STORYBOOK_PREVIEW__ as Preview | undefined;
  const steps: StepReport[] = [];
  const firstSeq = state.events.at(-1)?.seq ?? -1;
  const errorEvents = [
    'storyErrored',
    'storyThrewException',
    'playFunctionThrewException',
    'unhandledErrorsWhilePlaying',
  ];
  let renders = 0;

  const report = (
    outcome: PageOutcome,
    skipped: boolean,
    settleMs: number,
    stable: boolean | null,
    planStable: boolean | null,
  ): PageRenderReport => ({
    outcome,
    steps,
    skipped,
    settleMs,
    totalMs: performance.now() - started,
    stable,
    planStable,
    renders,
    hmrEvents: state.events
      .filter(
        (entry) =>
          entry.seq > firstSeq &&
          // The server announces an index change; the preview announces a hot-updated CSF module.
          ((entry.dir === 'in' && entry.event === 'storyIndexInvalidated') ||
            (entry.dir === 'out' && entry.event === 'storyHotUpdated')),
      )
      .map((entry) => entry.event),
  });

  /**
   * Emits and waits for the story's done event; an error event earlier in the render wins.
   * `expectRender: false` is an args write for a story that is not current: Storybook only
   * answers `storyArgsUpdated`.
   */
  const emitAndWait = (step: StepReport['step'], event: string, payload: unknown, expectRender = true) =>
    new Promise<PageOutcome>((resolve) => {
      const mark = state.events.at(-1)?.seq ?? -1;
      const t0 = performance.now();
      let error: PageOutcome | undefined;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const phases = () =>
        state.events.flatMap((entry) => (entry.seq > mark && entry.newPhase !== undefined ? [entry.newPhase] : []));
      const finish = (outcome: PageOutcome, rendered: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(grace);
        state.listeners.delete(scan);
        if (rendered) renders += 1;
        steps.push({ step, ms: performance.now() - t0, phases: phases(), outcome: outcome.kind });
        resolve(outcome);
      };
      const scan = () => {
        for (const entry of state.events) {
          if (finished) return;
          if (entry.seq <= mark || entry.dir !== 'out') continue;
          if (!expectRender && entry.event === 'storyArgsUpdated' && entry.storyId === req.storyId) {
            finish({ kind: 'done' }, false);
          } else if (entry.event === 'storyMissing') {
            finish({ kind: 'missing' }, false);
          } else if (error === undefined && errorEvents.includes(entry.event)) {
            error = {
              kind: 'error',
              event: entry.event,
              message: entry.message ?? '',
              ...(entry.stack === undefined ? {} : { stack: entry.stack }),
            };
            // The errored render still ends with a done event (status "success"): wait for it,
            // briefly, so it is not read as the next render's done event.
            const failed = error;
            grace = setTimeout(() => finish(failed, true), 1000);
          } else if (entry.event === req.doneEvent && (entry.storyId === undefined || entry.storyId === req.storyId)) {
            finish(error ?? { kind: 'done' }, true);
          }
        }
      };
      const timer = setTimeout(
        () => finish(error ?? { kind: 'timeout', phases: phases() }, false),
        Math.max(1, end - performance.now()),
      );
      state.listeners.add(scan);
      state.channel?.emit(event, payload);
      scan();
    });

  const same = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!Object.is(a[k], b[k])) return false;
    return true;
  };

  if (preview === undefined) return report({ kind: 'timeout', phases: [] }, false, 0, null, null);
  await preview.ready?.();
  const store = preview.storyStoreValue;

  // Rehydrate `{ $fromStory, arg }` markers into live values (03 §5.3 "In-page values").
  const desired: Record<string, unknown> = {};
  try {
    Object.assign(desired, (await store.loadStory({ storyId: req.storyId })).initialArgs);
    for (const [name, value] of Object.entries(req.args)) {
      const marker = value as { $fromStory?: unknown; arg?: unknown } | null;
      if (typeof marker === 'object' && marker !== null && typeof marker.$fromStory === 'string') {
        const source = await store.loadStory({ storyId: marker.$fromStory });
        desired[name] = source.initialArgs[String(marker.arg ?? name)];
      } else {
        desired[name] = value;
      }
    }
  } catch (error) {
    // The CSF module failed to import, or (dev server) the index lists a file the preview's
    // importers do not know yet.
    const failure = error as Error;
    return report({ kind: 'load-failed', message: String(failure?.message ?? error) }, false, 0, null, null);
  }
  const updatedArgs = (current: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...desired };
    for (const name of Object.keys(current)) if (!(name in desired)) next[name] = undefined;
    return next;
  };

  const isCurrent = preview.currentSelection?.storyId === req.storyId;
  const staleError = () => document.body.classList.contains('sb-show-errordisplay');
  let outcome: PageOutcome = { kind: 'done' };
  let skipped = true;

  if (!isCurrent) {
    skipped = false;
    const known = store.args.get(req.storyId);
    if (req.presetArgs && known !== undefined && !same(known, desired)) {
      outcome = await emitAndWait(
        'preset-args',
        'updateStoryArgs',
        { storyId: req.storyId, updatedArgs: updatedArgs(known) },
        false,
      );
    }
    outcome = await emitAndWait('select', 'setCurrentStory', { storyId: req.storyId, viewMode: 'story' });
  }
  if (outcome.kind === 'done') {
    const current = store.args.get(req.storyId) ?? {};
    if (!same(current, desired)) {
      skipped = false;
      outcome = await emitAndWait('args', 'updateStoryArgs', {
        storyId: req.storyId,
        updatedArgs: updatedArgs(current),
      });
    }
  }
  if (outcome.kind === 'done' && req.globals !== undefined) {
    // Full desired globals over `initialGlobals` (03 §5.1), so a later variant resets a theme.
    const globals = store.userGlobals.get();
    const wanted = { ...globals, ...(store.userGlobals.initialGlobals ?? {}), ...req.globals };
    if (!same(globals, wanted)) {
      skipped = false;
      outcome = await emitAndWait('globals', 'updateGlobals', { globals: wanted });
    }
  }
  if (outcome.kind === 'done' && req.remount) {
    skipped = false;
    outcome = await emitAndWait('remount', 'forceRemount', { storyId: req.storyId });
  }
  // An args update on a story whose last render threw renders nothing and reports success
  // (SB 10.6 quirk): the error overlay class stays on <body>. Remount to recover.
  if (outcome.kind === 'done' && staleError()) {
    outcome = await emitAndWait('heal', 'forceRemount', { storyId: req.storyId });
    if (outcome.kind === 'done' && staleError()) {
      outcome = {
        kind: 'error',
        event: 'errordisplay',
        message: document.querySelector('#error-message')?.textContent ?? '',
      };
    }
  }
  if (outcome.kind !== 'done') return report(outcome, false, 0, null, null);

  const settleStart = performance.now();
  await document.fonts.ready;
  const frames = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await frames();
  let stable: boolean | null = null;
  let planStable: boolean | null = null;
  if (req.stability) {
    const root = document.querySelector('#storybook-root');
    // 03 §5.5 step 8 as written: the container rect plus the length of the body markup.
    const planSample = () => {
      const rect = root?.getBoundingClientRect();
      return `${rect?.x},${rect?.y},${rect?.width},${rect?.height}|${document.body.innerHTML.length}`;
    };
    // The stricter check: every element's rect under the root, plus the root markup itself.
    const strictSample = () => {
      if (root === null) return '';
      const rects = [root, ...root.querySelectorAll('*')].slice(0, 500).map((element) => {
        const rect = element.getBoundingClientRect();
        return `${rect.x},${rect.y},${rect.width},${rect.height}`;
      });
      return `${rects.join(';')}|${root.innerHTML}`;
    };
    stable = false;
    for (let attempt = 0; attempt < 3 && !stable; attempt += 1) {
      const before = [planSample(), strictSample()];
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (planStable === null) planStable = planSample() === before[0];
      stable = strictSample() === before[1];
    }
  }
  return report(outcome, skipped, performance.now() - settleStart, stable, planStable);
}
