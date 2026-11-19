// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  awaitBoot,
  CONTROLLER_KEY,
  channelRender,
  installChannelController,
  type PageRenderRequest,
  readDocId,
} from '../driver/page.ts';

/**
 * A fake Storybook 10 preview with the behaviour S-07 measured: synchronous local listeners,
 * `storyFinished` with status "success" after errors, args kept per story across switches,
 * `deleteUndefined` on args updates, and a re-render of an errored story that renders nothing.
 */
type Behaviour = 'ok' | 'hang' | 'tick';
type Args = Record<string, unknown>;

class FakeStorybook {
  readonly listeners = new Map<string, ((payload: unknown) => void)[]>();
  readonly argsByStory = new Map<string, Args>();
  current: string | undefined;
  globals: Args = { theme: 'light' };
  errored = false;
  timer: ReturnType<typeof setInterval> | undefined;

  constructor(readonly stories: Record<string, { initialArgs: Args; behaviour?: Behaviour }>) {
    this.on('setCurrentStory', (payload) => {
      const { storyId } = payload as { storyId: string };
      this.current = storyId;
      if (this.stories[storyId] === undefined) {
        queueMicrotask(() => this.emit('storyMissing', storyId));
        return;
      }
      if (!this.argsByStory.has(storyId)) this.argsByStory.set(storyId, { ...this.stories[storyId]?.initialArgs });
      this.render(storyId, 'fresh');
    });
    this.on('updateStoryArgs', (payload) => {
      const { storyId, updatedArgs } = payload as { storyId: string; updatedArgs: Args };
      const next = { ...this.argsByStory.get(storyId), ...updatedArgs };
      for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
      this.argsByStory.set(storyId, next);
      if (storyId === this.current) this.render(storyId, 'rerender', () => this.emit('storyArgsUpdated', { storyId }));
      else queueMicrotask(() => this.emit('storyArgsUpdated', { storyId }));
    });
    this.on('updateGlobals', (payload) => {
      this.globals = { ...this.globals, ...(payload as { globals: Args }).globals };
      if (this.current !== undefined) this.render(this.current, 'rerender');
    });
    this.on('forceRemount', (payload) => this.render((payload as { storyId: string }).storyId, 'fresh'));
  }

  on(event: string, listener: (payload: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  private render(storyId: string, mode: 'fresh' | 'rerender', after?: () => void): void {
    clearInterval(this.timer);
    const story = this.stories[storyId];
    const args = this.argsByStory.get(storyId) ?? {};
    setTimeout(() => {
      this.emit('storyRenderPhaseChanged', { newPhase: 'rendering', storyId });
      if (story?.behaviour === 'hang') return;
      const root = document.querySelector('#storybook-root') as HTMLElement;
      if (args.crash === true) {
        this.errored = true;
        document.body.className = 'sb-show-errordisplay';
        root.innerHTML = '';
        this.emit('storyThrewException', { message: 'boom', stack: 'Error: boom' });
      } else if (this.errored && mode === 'rerender') {
        // SB 10.6: re-rendering an errored story renders nothing and still reports success.
        document.body.className = 'sb-show-errordisplay sb-show-main';
      } else {
        this.errored = false;
        document.body.className = 'sb-show-main';
        root.innerHTML = `<div class="${String(this.globals.theme)}">${String(args.label ?? '')}${
          args.content instanceof Object ? '<b data-node=""></b>' : ''
        }</div>`;
        if (story?.behaviour === 'tick') {
          let width = 100;
          root.innerHTML = `<div style="width: ${width}px">tick</div>`;
          this.timer = setInterval(() => {
            width = width === 199 ? 100 : width + 1;
            root.innerHTML = `<div style="width: ${width}px">tick</div>`;
          }, 20);
        }
      }
      this.emit('storyRendered', storyId);
      this.emit('storyFinished', { storyId, status: 'success' });
      after?.();
    }, 1);
  }

  get preview() {
    return {
      ready: async () => undefined,
      currentSelection: this.current === undefined ? undefined : { storyId: this.current },
      storyStoreValue: {
        loadStory: async ({ storyId }: { storyId: string }) => ({
          initialArgs: this.stories[storyId]?.initialArgs ?? {},
        }),
        args: { get: (storyId: string) => this.argsByStory.get(storyId) },
        userGlobals: { get: () => this.globals, initialGlobals: { theme: 'light' } },
      },
    };
  }
}

const host = window as unknown as Record<string, unknown>;
let fake: FakeStorybook;

function install(stories: ConstructorParameters<typeof FakeStorybook>[0]): FakeStorybook {
  document.body.innerHTML = '<div id="storybook-root"></div>';
  delete host[CONTROLLER_KEY];
  installChannelController(CONTROLLER_KEY);
  fake = new FakeStorybook(stories);
  host.__STORYBOOK_ADDONS_CHANNEL__ = fake;
  Object.defineProperty(host, '__STORYBOOK_PREVIEW__', { configurable: true, get: () => fake.preview });
  return fake;
}

const request = (storyId: string, args: Args = {}, extra: Partial<PageRenderRequest> = {}): PageRenderRequest => ({
  key: CONTROLLER_KEY,
  storyId,
  args,
  remount: false,
  presetArgs: true,
  doneEvent: 'storyFinished',
  timeoutMs: 500,
  stability: false,
  ...extra,
});

beforeEach(() => {
  if (!('fonts' in document)) Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() } });
  install({
    'a--one': { initialArgs: { label: 'One', tone: 'neutral' } },
    'b--two': { initialArgs: { label: 'Two' } },
    'c--hang': { initialArgs: {}, behaviour: 'hang' },
    'd--tick': { initialArgs: {}, behaviour: 'tick' },
    'e--slot': { initialArgs: { label: 'Slot', content: null } },
    'f--filled': { initialArgs: { content: { $$typeof: 'react.element' } } },
  });
});

afterEach(() => clearInterval(fake.timer));

describe('installChannelController', () => {
  it('records emitted events once the channel is assigned, with a document id', () => {
    fake.emit('storyRendered', 'a--one');
    const state = host[CONTROLLER_KEY] as { events: { event: string; dir: string; storyId?: string }[] };
    expect(state.events).toEqual([expect.objectContaining({ dir: 'out', event: 'storyRendered', storyId: 'a--one' })]);
    expect(readDocId(CONTROLLER_KEY)).toMatch(/^\d/);
  });

  it('records transport events as "in" when the channel has handleEvent', () => {
    delete host[CONTROLLER_KEY];
    installChannelController(CONTROLLER_KEY);
    const seen: string[] = [];
    const channel = { emit: () => undefined, handleEvent: (event: { type: string }) => seen.push(event.type) };
    host.__STORYBOOK_ADDONS_CHANNEL__ = channel;
    channel.handleEvent({ type: 'storyIndexInvalidated' });
    const state = host[CONTROLLER_KEY] as { events: { event: string; dir: string }[] };
    expect(state.events).toEqual([expect.objectContaining({ dir: 'in', event: 'storyIndexInvalidated' })]);
    expect(seen).toEqual(['storyIndexInvalidated']);
  });
});

describe('channelRender', () => {
  it('selects the story, then sets the full arg set in one update', async () => {
    const report = await channelRender(request('a--one', { tone: 'info' }));
    expect(report.outcome).toEqual({ kind: 'done' });
    expect(report.steps.map((step) => step.step)).toEqual(['select', 'args']);
    expect(report.renders).toBe(2);
    expect(fake.argsByStory.get('a--one')).toEqual({ label: 'One', tone: 'info' });
    expect(document.querySelector('#storybook-root')?.textContent).toBe('One');
  });

  it('skips a request that changes nothing', async () => {
    await channelRender(request('a--one', { tone: 'info' }));
    const report = await channelRender(request('a--one', { tone: 'info' }));
    expect(report).toMatchObject({ skipped: true, steps: [], renders: 0 });
  });

  it('restores initial values explicitly and unsets keys the request drops', async () => {
    await channelRender(request('a--one', { label: 'Changed', extra: 1 }));
    await channelRender(request('a--one', {}));
    expect(fake.argsByStory.get('a--one')).toEqual({ label: 'One', tone: 'neutral' });
  });

  it('presets args of a story seen before, so switching back renders once', async () => {
    await channelRender(request('a--one', { tone: 'info' }));
    await channelRender(request('b--two'));
    const report = await channelRender(request('a--one', { tone: 'danger' }));
    expect(report.steps.map((step) => step.step)).toEqual(['preset-args', 'select']);
    expect(report.renders).toBe(1);
    expect(fake.argsByStory.get('a--one')).toMatchObject({ tone: 'danger' });
  });

  it('without presetting, a switch back costs a select and an args render', async () => {
    await channelRender(request('a--one', { tone: 'info' }));
    await channelRender(request('b--two'));
    const report = await channelRender(request('a--one', { tone: 'danger' }, { presetArgs: false }));
    expect(report.steps.map((step) => step.step)).toEqual(['select', 'args']);
  });

  it('reports an error event, after waiting for the errored render to finish', async () => {
    const report = await channelRender(request('a--one', { crash: true }));
    expect(report.outcome).toMatchObject({ kind: 'error', event: 'storyThrewException', message: 'boom' });
    expect(report.renders).toBe(2);
    const state = host[CONTROLLER_KEY] as { events: { event: string }[] };
    expect(state.events.at(-2)?.event).toBe('storyFinished');
  });

  it('heals a story the last render left blank by remounting it', async () => {
    await channelRender(request('a--one', { crash: true }));
    const report = await channelRender(request('a--one', { crash: false }));
    expect(report.outcome).toEqual({ kind: 'done' });
    expect(report.steps.map((step) => step.step)).toEqual(['args', 'heal']);
    expect(document.body.className).toBe('sb-show-main');
    expect(document.querySelector('#storybook-root')?.textContent).toBe('One');
  });

  it('reports a missing story', async () => {
    const report = await channelRender(request('z--none'));
    expect(report.outcome).toEqual({ kind: 'missing' });
  });

  it('times out on a render that never finishes, with the phases seen', async () => {
    const report = await channelRender(request('c--hang', {}, { timeoutMs: 100 }));
    expect(report.outcome).toEqual({ kind: 'timeout', phases: ['rendering'] });
  });

  it('sets globals over initialGlobals, so a later request resets them', async () => {
    await channelRender(request('a--one', {}, { globals: { theme: 'dark' } }));
    expect(document.querySelector('#storybook-root div')?.className).toBe('dark');
    const report = await channelRender(request('a--one', {}, { globals: {} }));
    expect(report.steps.map((step) => step.step)).toEqual(['globals']);
    expect(fake.globals.theme).toBe('light');
  });

  it('remounts on request', async () => {
    await channelRender(request('a--one'));
    const report = await channelRender(request('a--one', {}, { remount: true }));
    expect(report.steps.map((step) => step.step)).toEqual(['remount']);
  });

  it('rehydrates { $fromStory } markers into the other story’s live initial value', async () => {
    const report = await channelRender(request('e--slot', { content: { $fromStory: 'f--filled', arg: 'content' } }));
    expect(report.outcome).toEqual({ kind: 'done' });
    expect(fake.argsByStory.get('e--slot')?.content).toEqual({ $$typeof: 'react.element' });
    expect(document.querySelector('#storybook-root [data-node]')).not.toBeNull();
  });

  it('flags a root that keeps changing, which the 03 §5.5 heuristic misses', async () => {
    const report = await channelRender(request('d--tick', {}, { stability: true }));
    expect(report.stable).toBe(false);
    expect(report.planStable).toBe(true);
    clearInterval(fake.timer);
    const calm = await channelRender(request('a--one', {}, { stability: true }));
    expect(calm).toMatchObject({ stable: true, planStable: true });
  });
});

describe('awaitBoot', () => {
  it('resolves with the boot render of the story', async () => {
    const booted = awaitBoot({ key: CONTROLLER_KEY, storyId: 'b--two', doneEvent: 'storyFinished', timeoutMs: 500 });
    fake.emit('setCurrentStory', { storyId: 'b--two' });
    await expect(booted).resolves.toEqual({ kind: 'done' });
  });

  it('reports an error before the done event, a missing story, and a timeout', async () => {
    const errored = awaitBoot({ key: CONTROLLER_KEY, storyId: 'a--one', doneEvent: 'storyFinished', timeoutMs: 500 });
    fake.argsByStory.set('a--one', { crash: true });
    fake.emit('setCurrentStory', { storyId: 'a--one' });
    await expect(errored).resolves.toMatchObject({ kind: 'error', event: 'storyThrewException' });

    const missing = awaitBoot({ key: CONTROLLER_KEY, storyId: 'z--none', doneEvent: 'storyFinished', timeoutMs: 500 });
    fake.emit('setCurrentStory', { storyId: 'z--none' });
    await expect(missing).resolves.toEqual({ kind: 'missing' });

    install({ 'c--hang': { initialArgs: {}, behaviour: 'hang' } });
    const hung = awaitBoot({ key: CONTROLLER_KEY, storyId: 'c--hang', doneEvent: 'storyFinished', timeoutMs: 80 });
    fake.emit('setCurrentStory', { storyId: 'c--hang' });
    await expect(hung).resolves.toEqual({ kind: 'timeout', phases: ['rendering'] });
  });
});
