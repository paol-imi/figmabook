import { describe, expect, it } from 'vitest';
import { MAX_STACK_LENGTH, outcomeError, renderError, unencodableError } from '../src/driver/errors';

describe('outcomeError (03 §5.2–5.3)', () => {
  it('maps a render exception to SB_STORY_ERROR with the Storybook message', () => {
    const error = outcomeError(
      'components-icon--default',
      { kind: 'error', event: 'storyThrewException', message: 'icons[name] is undefined', stack: 'TypeError: …' },
      true,
    );
    expect(error).toEqual({
      ok: false,
      storyId: 'components-icon--default',
      code: 'SB_STORY_ERROR',
      warnings: [],
      diagnostic: {
        code: 'SB_STORY_ERROR',
        severity: 'error',
        message: 'Storybook reported `storyErrored`/`storyThrewException`; the variant fails (retried twice).',
        sid: 'components-icon',
        value: 'icons[name] is undefined',
        data: {
          storyId: 'components-icon--default',
          event: 'storyThrewException',
          message: 'icons[name] is undefined',
          stack: 'TypeError: …',
        },
      },
    });
  });

  it.each([
    ['storyErrored', 'SB_STORY_ERROR'],
    ['errordisplay', 'SB_STORY_ERROR'],
    ['storyFinished', 'SB_STORY_ERROR'],
    ['playFunctionThrewException', 'SB_PLAY_ERROR'],
    ['unhandledErrorsWhilePlaying', 'SB_PLAY_ERROR'],
  ])('maps %s to %s', (event, code) => {
    expect(outcomeError('a--b', { kind: 'error', event, message: 'boom' }, true).code).toBe(code);
  });

  it('tells a CSF load failure from an unknown id on storyMissing', () => {
    const loadFailed = outcomeError('a--b', { kind: 'missing', message: 'Failed to fetch module' }, true);
    expect(loadFailed.code).toBe('SB_STORY_LOAD_FAILED');
    expect(loadFailed.diagnostic.data).toEqual({
      storyId: 'a--b',
      event: 'storyMissing',
      message: 'Failed to fetch module',
    });
    const missing = outcomeError('a--b', { kind: 'missing' }, false);
    expect(missing.code).toBe('SB_STORY_MISSING');
    expect(missing.diagnostic).not.toHaveProperty('value');
  });

  it('truncates long stacks', () => {
    const stack = 'x'.repeat(MAX_STACK_LENGTH * 2);
    const error = outcomeError('a--b', { kind: 'error', event: 'storyErrored', message: 'm', stack }, true);
    expect(String(error.diagnostic.data?.stack)).toHaveLength(MAX_STACK_LENGTH);
  });
});

describe('renderError', () => {
  it('leaves sid out for a malformed story id', () => {
    const error = renderError('not-a-story', 'SB_STORY_MISSING', { value: 'not-a-story' });
    expect(error.diagnostic).not.toHaveProperty('sid');
    expect(error.diagnostic.value).toBe('not-a-story');
  });

  it('reports SB_RENDER_TIMEOUT with its data', () => {
    const error = renderError('a--b', 'SB_RENDER_TIMEOUT', { value: '15000 ms', data: { timeoutMs: 15000 } });
    expect(error.diagnostic).toMatchObject({
      code: 'SB_RENDER_TIMEOUT',
      severity: 'error',
      data: { storyId: 'a--b', timeoutMs: 15000 },
    });
  });
});

describe('unencodableError', () => {
  it('names every offending path under its param', () => {
    const error = unencodableError('a--b', 'globals', [
      { path: 'theme', reason: 'unsafe' },
      { path: 'locale', reason: 'unsafe' },
    ]);
    expect(error.code).toBe('SB_URL_ARG_UNENCODABLE');
    expect(error.diagnostic).toMatchObject({
      severity: 'warn',
      value: 'globals.theme, globals.locale',
      data: { param: 'globals', problems: [{ path: 'theme' }, { path: 'locale' }] },
    });
  });
});
