import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { type ConsoleMessageLike, type ConsolePage, isBrowserFaviconError, watchConsole } from '../src';

const BASE = 'http://127.0.0.1:41234/';
const LOAD_FAILED = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

function message(text: string, url = '', type = 'error'): ConsoleMessageLike {
  return {
    type: () => type as ReturnType<ConsoleMessageLike['type']>,
    text: () => text,
    location: () => ({ url, line: 0, column: 0, lineNumber: 0, columnNumber: 0 }),
  };
}

/** A page that only emits the events the watch listens to. */
function fakePage() {
  const emitter = new EventEmitter();
  const page = emitter as unknown as ConsolePage;
  return {
    page,
    log: (item: ConsoleMessageLike) => emitter.emit('console', item),
    throwInPage: (error: Error) => emitter.emit('pageerror', error),
    request: (url: string) => emitter.emit('request', { url: () => url }),
    listeners: () => emitter.eventNames().length,
  };
}

describe('isBrowserFaviconError', () => {
  const none: ReadonlySet<string> = new Set();

  it("matches the failed load of the browser's own /favicon.ico at the Storybook origin", () => {
    expect(isBrowserFaviconError(message(LOAD_FAILED, `${BASE}favicon.ico`), BASE, none)).toBe(true);
    // The favicon lives at the origin root, also for a Storybook under a path.
    expect(
      isBrowserFaviconError(
        message('Failed to load resource: net::ERR_FAILED', 'https://sb.example.test/favicon.ico'),
        'https://sb.example.test/design/system/',
        none,
      ),
    ).toBe(true);
  });

  it('keeps every other console error', () => {
    expect(isBrowserFaviconError(message(LOAD_FAILED, `${BASE}assets/missing.json`), BASE, none)).toBe(false);
    expect(isBrowserFaviconError(message(LOAD_FAILED, 'http://cdn.example.test/favicon.ico'), BASE, none)).toBe(false);
    expect(isBrowserFaviconError(message('Uncaught boom', `${BASE}favicon.ico`), BASE, none)).toBe(false);
    expect(isBrowserFaviconError(message(LOAD_FAILED, `${BASE}favicon.ico`, 'warning'), BASE, none)).toBe(false);
    expect(isBrowserFaviconError(message(LOAD_FAILED, ''), BASE, none)).toBe(false);
  });

  it('keeps the error when the page itself requested /favicon.ico', () => {
    const requested = new Set([`${BASE}favicon.ico`]);
    expect(isBrowserFaviconError(message(LOAD_FAILED, `${BASE}favicon.ico`), BASE, requested)).toBe(false);
  });
});

describe('watchConsole', () => {
  it('reports console and page errors as one SB_CONSOLE_ERROR, without the favicon 404', () => {
    const fake = fakePage();
    const watch = watchConsole(fake.page, BASE);
    fake.log(message(LOAD_FAILED, `${BASE}favicon.ico`));
    fake.log(message('just info', '', 'log'));
    fake.log(message('Uncaught TypeError: x is undefined'));
    fake.throwInPage(new Error('boom'));
    const [reported, ...rest] = watch.stop();
    expect(rest).toEqual([]);
    expect(reported).toMatchObject({
      code: 'SB_CONSOLE_ERROR',
      value: 'Uncaught TypeError: x is undefined',
      data: { count: 2, messages: ['Uncaught TypeError: x is undefined', 'boom'] },
    });
    expect(fake.listeners()).toBe(0);
    expect(watch.stop()).toEqual([]);
  });

  it('reports nothing when only the favicon request failed', () => {
    const fake = fakePage();
    const watch = watchConsole(fake.page, BASE);
    fake.log(message(LOAD_FAILED, `${BASE}favicon.ico`));
    expect(watch.stop()).toEqual([]);
  });

  it("reports a story's own failed /favicon.ico fetch", () => {
    const fake = fakePage();
    const watch = watchConsole(fake.page, BASE);
    fake.request(`${BASE}favicon.ico`);
    fake.log(message(LOAD_FAILED, `${BASE}favicon.ico`));
    expect(watch.stop()).toMatchObject([{ code: 'SB_CONSOLE_ERROR', value: LOAD_FAILED }]);
  });

  it('keeps the first 20 messages and counts them all', () => {
    const fake = fakePage();
    const watch = watchConsole(fake.page, BASE);
    for (let i = 0; i < 25; i++) fake.log(message(`error ${i}`));
    const [reported] = watch.stop();
    expect(reported?.data).toMatchObject({ count: 25 });
    expect(reported?.data?.messages).toHaveLength(20);
  });
});
