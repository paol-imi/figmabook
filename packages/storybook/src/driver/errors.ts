import { createDiagnostic, diagnostic } from '@holotype/shared';
import { componentIdFromStoryId, isStoryId } from '../story-id';
import type { SbError, SbErrorCode } from '../types';
import type { UnencodableValue } from '../url-args';
import type { PageOutcome } from './page-scripts';

/** Storybook stacks can be long; diagnostics keep the start. */
export const MAX_STACK_LENGTH = 4000;

/** What a render error reports besides its code: the offending value and structured data. */
export interface ErrorDetails {
  readonly value?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Builds a failed render with one `code` diagnostic. */
export function renderError(storyId: string, code: SbErrorCode, details: ErrorDetails = {}): SbError {
  const sid = isStoryId(storyId) ? componentIdFromStoryId(storyId) : undefined;
  const made = createDiagnostic(diagnostic(code), undefined, {
    ...(sid === undefined ? {} : { sid }),
    ...(details.value === undefined || details.value === '' ? {} : { value: details.value }),
    data: { storyId, ...details.data },
  });
  return { ok: false, storyId, code, diagnostic: made, warnings: [] };
}

/** Story events that come from the play function (03 §5.2). */
const PLAY_EVENTS: ReadonlySet<string> = new Set(['playFunctionThrewException', 'unhandledErrorsWhilePlaying']);

/**
 * Maps a failed page outcome to its error (03 §5.3): play events → `SB_PLAY_ERROR`, other
 * error events and the error overlay → `SB_STORY_ERROR`. `storyMissing` for a story the index
 * lists means its CSF file failed to load (`SB_STORY_LOAD_FAILED`); otherwise `SB_STORY_MISSING`.
 */
export function outcomeError(
  storyId: string,
  outcome: Exclude<PageOutcome, { kind: 'done' }>,
  inIndex: boolean,
): SbError {
  const stack = outcome.stack === undefined ? {} : { stack: outcome.stack.slice(0, MAX_STACK_LENGTH) };
  if (outcome.kind === 'missing') {
    const code = inIndex ? 'SB_STORY_LOAD_FAILED' : 'SB_STORY_MISSING';
    const message = outcome.message ?? '';
    return renderError(storyId, code, {
      value: message,
      data: { event: 'storyMissing', ...(message === '' ? {} : { message }), ...stack },
    });
  }
  const code = PLAY_EVENTS.has(outcome.event) ? 'SB_PLAY_ERROR' : 'SB_STORY_ERROR';
  return renderError(storyId, code, {
    value: outcome.message,
    data: { event: outcome.event, message: outcome.message, ...stack },
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
