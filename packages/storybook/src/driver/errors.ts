import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import { componentIdFromStoryId, isStoryId } from '../story-id';
import type { SbError, SbErrorCode } from '../types';
import type { UnencodableValue } from '../url-args';

/** Storybook stacks can be long; diagnostics keep the start. */
export const MAX_STACK_LENGTH = 4000;

/** What a render error reports besides its code: the offending value and structured data. */
export interface ErrorDetails {
  readonly value?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** The `sid` scope of a story's diagnostics. */
export const scopeOf = (storyId: string): { sid?: string } =>
  isStoryId(storyId) ? { sid: componentIdFromStoryId(storyId) } : {};

/** Builds a failed render with one `code` diagnostic. */
export function renderError(storyId: string, code: SbErrorCode, details: ErrorDetails = {}): SbError {
  const made = createDiagnostic(diagnostic(code), undefined, {
    ...scopeOf(storyId),
    ...(details.value === undefined || details.value === '' ? {} : { value: details.value }),
    data: { storyId, ...details.data },
  });
  return { ok: false, storyId, code, diagnostic: made, warnings: [] };
}

/** How a render ended in the page, as both drivers report it (03 §5.2). */
export type FailedOutcome =
  | {
      readonly kind: 'error';
      /** The Storybook event, or `errordisplay` for the error overlay backstop. */
      readonly event: string;
      readonly message: string;
      readonly stack?: string;
    }
  | { readonly kind: 'missing'; readonly message?: string; readonly stack?: string }
  /** `loadStory` threw: the CSF module failed to import (S-07 Q11). */
  | { readonly kind: 'load-failed'; readonly message: string };

/** Story events that come from the play function (03 §5.2). */
const PLAY_EVENTS: ReadonlySet<string> = new Set(['playFunctionThrewException', 'unhandledErrorsWhilePlaying']);

const trimmedStack = (stack: string | undefined) =>
  stack === undefined ? {} : { stack: stack.slice(0, MAX_STACK_LENGTH) };

/**
 * Maps a failed page outcome to its error (03 §5.3): play events → `SB_PLAY_ERROR`, other
 * error events and the error overlay → `SB_STORY_ERROR`. `storyMissing` for a story the index
 * lists, or a `loadStory` that threw, means its CSF file failed to load (`SB_STORY_LOAD_FAILED`);
 * otherwise `SB_STORY_MISSING`.
 */
export function outcomeError(storyId: string, outcome: FailedOutcome, inIndex: boolean): SbError {
  if (outcome.kind === 'load-failed') {
    return renderError(storyId, 'SB_STORY_LOAD_FAILED', {
      value: outcome.message,
      data: { event: 'loadStory', message: outcome.message },
    });
  }
  if (outcome.kind === 'missing') {
    const code = inIndex ? 'SB_STORY_LOAD_FAILED' : 'SB_STORY_MISSING';
    const message = outcome.message ?? '';
    return renderError(storyId, code, {
      value: message,
      data: { event: 'storyMissing', ...(message === '' ? {} : { message }), ...trimmedStack(outcome.stack) },
    });
  }
  const code = PLAY_EVENTS.has(outcome.event) ? 'SB_PLAY_ERROR' : 'SB_STORY_ERROR';
  return renderError(storyId, code, {
    value: outcome.message,
    data: { event: outcome.event, message: outcome.message, ...trimmedStack(outcome.stack) },
  });
}

/** `SB_RENDER_TIMEOUT` (the preview is up) or `SB_PREVIEW_INIT_TIMEOUT` (it never booted). */
export function timeoutFailure(
  storyId: string,
  timeoutMs: number,
  state: { readonly preview: boolean; readonly phases: readonly string[] },
  data: Readonly<Record<string, unknown>> = {},
): SbError {
  return renderError(storyId, state.preview ? 'SB_RENDER_TIMEOUT' : 'SB_PREVIEW_INIT_TIMEOUT', {
    value: `${timeoutMs} ms`,
    data: { ...data, timeoutMs, phases: [...state.phases] },
  });
}

/** `SB_URL_ARG_UNENCODABLE`: the variant is skipped in URL mode (03 §5.4). */
export function unencodableError(
  storyId: string,
  param: 'args' | 'globals',
  problems: readonly UnencodableValue[],
): SbError {
  const paths = problems.map((problem) => `${param}.${problem.path}`);
  return renderError(storyId, 'SB_URL_ARG_UNENCODABLE', {
    value: paths.join(', '),
    data: { param, problems: problems.map((problem) => ({ path: problem.path, reason: problem.reason })) },
  });
}

/**
 * `SB_HMR_DURING_CAPTURE` (03 §9.2, S-07 Q6/Q10): the index or a module changed during the
 * render, or the preview replaced its document; the render was retried.
 */
export function hmrWarning(storyId: string, events: readonly string[]): Diagnostic {
  return createDiagnostic(diagnostic('SB_HMR_DURING_CAPTURE'), undefined, {
    ...scopeOf(storyId),
    value: events.join(', '),
    data: { storyId, events: [...events] },
  });
}

/** `SB_STORY_UNRENDERABLE` (03 §5.3): the story kept failing over three fresh documents. */
export function unrenderableError(storyId: string, reloads: number, last: SbError | undefined): SbError {
  return renderError(storyId, 'SB_STORY_UNRENDERABLE', {
    value: storyId,
    data: {
      reloads,
      ...(last === undefined
        ? {}
        : { lastCode: last.code, lastMessage: last.diagnostic.message, last: last.diagnostic.data }),
    },
  });
}
