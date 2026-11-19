import { describe, expect, it } from 'vitest';
import { consoleWarning, hmrWarning, outcomeError, renderError, unstableWarning } from '../driver/errors.ts';

describe('outcomeError', () => {
  const storyId = 'faults-probe--throws';

  it('maps render and play errors like the URL driver', () => {
    const story = outcomeError(storyId, { kind: 'error', event: 'storyThrewException', message: 'boom' }, true, 1000);
    expect(story).toMatchObject({ ok: false, code: 'SB_STORY_ERROR', storyId });
    expect(story.diagnostic).toMatchObject({
      code: 'SB_STORY_ERROR',
      sid: 'faults-probe',
      value: 'boom',
      data: { storyId, event: 'storyThrewException', message: 'boom' },
    });
    const play = outcomeError(storyId, { kind: 'error', event: 'playFunctionThrewException', message: 'p' }, true, 1);
    expect(play.code).toBe('SB_PLAY_ERROR');
  });

  it('keeps the start of long stacks', () => {
    const failed = outcomeError(
      storyId,
      { kind: 'error', event: 'storyErrored', message: 'm', stack: 'x'.repeat(5000) },
      true,
      1,
    );
    expect(String(failed.diagnostic.data?.stack)).toHaveLength(4000);
  });

  it('maps missing stories, load failures and timeouts', () => {
    expect(outcomeError(storyId, { kind: 'missing' }, true, 1).code).toBe('SB_STORY_LOAD_FAILED');
    expect(outcomeError(storyId, { kind: 'missing' }, false, 1).code).toBe('SB_STORY_MISSING');
    const load = outcomeError(storyId, { kind: 'load-failed', message: 'importers[path] is not a function' }, true, 1);
    expect(load).toMatchObject({ code: 'SB_STORY_LOAD_FAILED', diagnostic: { data: { event: 'loadStory' } } });
    const timeout = outcomeError(storyId, { kind: 'timeout', phases: ['preparing', 'loading'] }, true, 4000);
    expect(timeout.diagnostic).toMatchObject({
      code: 'SB_RENDER_TIMEOUT',
      value: '4000 ms',
      data: { timeoutMs: 4000, phases: ['preparing', 'loading'] },
    });
  });
});

describe('warnings', () => {
  it('builds the catalog diagnostics the loop reports', () => {
    expect(renderError('not-a-story-id', 'SB_STORY_MISSING').diagnostic).not.toHaveProperty('sid');
    expect(unstableWarning('faults-unstable--ticking')).toMatchObject({
      code: 'CAP_UNSTABLE_RENDER',
      severity: 'warn',
      sid: 'faults-unstable',
    });
    expect(hmrWarning('a--b', ['storyIndexInvalidated'])).toMatchObject({
      code: 'SB_HMR_DURING_CAPTURE',
      value: 'storyIndexInvalidated',
    });
    const logged = consoleWarning(
      'a--b',
      Array.from({ length: 25 }, (_, index) => `error ${index}`),
    );
    expect(logged).toMatchObject({ code: 'SB_CONSOLE_ERROR', value: 'error 0', data: { count: 25 } });
    expect(logged.data?.messages).toHaveLength(20);
  });
});
