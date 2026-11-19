import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import { componentIdFromStoryId, isStoryId, type SbError, type SbErrorCode } from '@holotype/storybook';
import type { PageOutcome } from './page.ts';

/** Storybook stacks can be long; diagnostics keep the start (as in the B-10 URL driver). */
const MAX_STACK_LENGTH = 4000;

const PLAY_EVENTS: ReadonlySet<string> = new Set(['playFunctionThrewException', 'unhandledErrorsWhilePlaying']);

export interface ErrorDetails {
  readonly value?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

const scope = (storyId: string) => (isStoryId(storyId) ? { sid: componentIdFromStoryId(storyId) } : {});

export function renderError(storyId: string, code: SbErrorCode, details: ErrorDetails = {}): SbError {
  const made = createDiagnostic(diagnostic(code), undefined, {
    ...scope(storyId),
    ...(details.value === undefined || details.value === '' ? {} : { value: details.value }),
    data: { storyId, ...details.data },
  });
  return { ok: false, storyId, code, diagnostic: made, warnings: [] };
}

/**
 * Maps a failed page outcome to its error, as the URL driver does (03 §5.3): play events →
 * `SB_PLAY_ERROR`; other error events and the error overlay → `SB_STORY_ERROR`; `storyMissing`
 * for an indexed story → `SB_STORY_LOAD_FAILED`; a timeout → `SB_RENDER_TIMEOUT`.
 */
export function outcomeError(
  storyId: string,
  outcome: Exclude<PageOutcome, { kind: 'done' }>,
  inIndex: boolean,
  timeoutMs: number,
): SbError {
  switch (outcome.kind) {
    case 'missing':
      return renderError(storyId, inIndex ? 'SB_STORY_LOAD_FAILED' : 'SB_STORY_MISSING', {
        value: storyId,
        data: { event: 'storyMissing' },
      });
    case 'load-failed':
      return renderError(storyId, 'SB_STORY_LOAD_FAILED', {
        value: outcome.message,
        data: { event: 'loadStory', message: outcome.message },
      });
    case 'timeout':
      return renderError(storyId, 'SB_RENDER_TIMEOUT', {
        value: `${timeoutMs} ms`,
        data: { timeoutMs, phases: [...outcome.phases] },
      });
    case 'error': {
      const code = PLAY_EVENTS.has(outcome.event) ? 'SB_PLAY_ERROR' : 'SB_STORY_ERROR';
      const stack = outcome.stack === undefined ? {} : { stack: outcome.stack.slice(0, MAX_STACK_LENGTH) };
      return renderError(storyId, code, {
        value: outcome.message,
        data: { event: outcome.event, message: outcome.message, ...stack },
      });
    }
  }
}

/** `CAP_UNSTABLE_RENDER` (03 §5.5 step 8): the root kept changing after settle. */
export function unstableWarning(storyId: string): Diagnostic {
  return createDiagnostic(diagnostic('CAP_UNSTABLE_RENDER'), undefined, { ...scope(storyId), data: { storyId } });
}

/** `SB_HMR_DURING_CAPTURE` (03 §9.2): the index or a module changed, or the preview reloaded. */
export function hmrWarning(storyId: string, events: readonly string[]): Diagnostic {
  return createDiagnostic(diagnostic('SB_HMR_DURING_CAPTURE'), undefined, {
    ...scope(storyId),
    value: events.join(', '),
    data: { storyId, events: [...events] },
  });
}

/** `SB_CONSOLE_ERROR` (03 §5.3): console errors and page errors during the render. */
export function consoleWarning(storyId: string, messages: readonly string[]): Diagnostic {
  const kept = messages.slice(0, 20);
  return createDiagnostic(diagnostic('SB_CONSOLE_ERROR'), undefined, {
    ...scope(storyId),
    value: kept[0] ?? '',
    data: { storyId, count: messages.length, messages: kept },
  });
}
