/*
 * What the UI knows about the current apply run, folded from main's messages. The Report
 * screen renders one of its four states from this (BUILD §3.2, 11 §6.8–6.9).
 */
import type { Diagnostic } from '@holotype/shared';
import type { ApplySummary, MainToUi, MessageOf, Stage } from '../protocol';

export interface RunProgress {
  readonly stage: Stage;
  readonly done: number;
  readonly total: number;
  readonly current?: string;
  readonly etaMs?: number;
}

export interface RunError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export type RunState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly progress: RunProgress | null; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: 'done'; readonly summary: ApplySummary; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: 'failed'; readonly error: RunError; readonly diagnostics: readonly Diagnostic[] };

/** The main → UI messages that change the run state. */
export type RunMessage = MessageOf<MainToUi, 'progress' | 'diagnostics' | 'done' | 'error'>;

export const RUN_MESSAGE_TYPES = [
  'progress',
  'diagnostics',
  'done',
  'error',
] as const satisfies readonly RunMessage['t'][];

export const IDLE: RunState = { status: 'idle' };

const diagnosticsOf = (state: RunState): readonly Diagnostic[] => (state.status === 'idle' ? [] : state.diagnostics);

/** Folds one message into the run state. Pure. */
export function reduceRun(state: RunState, message: RunMessage): RunState {
  switch (message.t) {
    case 'progress': {
      const { stage, done, total, current, etaMs } = message;
      const progress: RunProgress = {
        stage,
        done,
        total,
        ...(current === undefined ? {} : { current }),
        ...(etaMs === undefined ? {} : { etaMs }),
      };
      // A finished run's diagnostics belong to it; a new run starts with none.
      const diagnostics = state.status === 'running' ? state.diagnostics : [];
      return { status: 'running', progress, diagnostics };
    }
    case 'diagnostics': {
      const diagnostics = [...diagnosticsOf(state), ...message.items];
      return state.status === 'idle' ? { status: 'running', progress: null, diagnostics } : { ...state, diagnostics };
    }
    case 'done':
      return { status: 'done', summary: message.summary, diagnostics: diagnosticsOf(state) };
    case 'error': {
      const { code, message: text, recoverable } = message;
      return { status: 'failed', error: { code, message: text, recoverable }, diagnostics: diagnosticsOf(state) };
    }
  }
}
