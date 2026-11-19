/**
 * Runs one step of one spike: builds its `StepIO` on top of the bridge, catches failures and
 * wraps the outcome in the result envelope. The last envelope of each step is kept in client
 * storage, so results can be copied again after Figma was closed.
 */
import { buildEnvelope, type ResultEnvelope } from '../../_shared/envelope.ts';
import { errorMessage, type JsonValue } from '../../_shared/json.ts';
import type {
  Ask,
  AskAnswer,
  KitState,
  SpikeDefinition,
  SpikeEnv,
  StepDefinition,
  StepIO,
} from '../../_shared/spike.ts';
import type { Bridge } from './bridge.ts';

export interface SessionHandlers {
  onProgress(message: string): void;
  onAsk(question: Ask): Promise<AskAnswer>;
}

export function kitState(bridge: Bridge, spike: string): KitState {
  return {
    async get<T>(key: string) {
      const { value } = (await bridge.call('kit/state.get', { spike, key })) as { value: JsonValue };
      return value === null ? undefined : (value as T);
    },
    async set(key, value) {
      await bridge.call('kit/state.set', { spike, key, value: value as JsonValue });
    },
  };
}

export function createStepIO(bridge: Bridge, spike: string, env: SpikeEnv, handlers: SessionHandlers): StepIO {
  return {
    call: (task, input) => bridge.call(task, input, handlers.onProgress),
    ask: (question) => handlers.onAsk(question),
    progress: handlers.onProgress,
    state: kitState(bridge, spike),
    env,
  };
}

export type StepRun = {
  readonly envelope: ResultEnvelope;
  readonly notes: readonly string[];
};

/** Status of a step as remembered in client storage. */
export type StepRecord = { readonly status: ResultEnvelope['status']; readonly envelope: ResultEnvelope };

export function stepRecordKey(step: string): string {
  return `last:${step}`;
}

export async function runStep(
  spike: SpikeDefinition,
  step: StepDefinition,
  io: StepIO,
  kitVersion: string,
): Promise<StepRun> {
  const base = { spike: spike.id, kitVersion, step: step.id, env: io.env };
  let run: StepRun;
  try {
    const outcome = await step.run(io);
    run = {
      envelope: buildEnvelope({ ...base, status: 'done', results: outcome.results }),
      notes: outcome.notes ?? [],
    };
  } catch (error) {
    run = {
      envelope: buildEnvelope({ ...base, status: 'failed', results: { error: errorMessage(error) } }),
      notes: [],
    };
  }
  try {
    const record: StepRecord = { status: run.envelope.status, envelope: run.envelope };
    await io.state.set(stepRecordKey(step.id), record);
  } catch {
    // Keeping the copy is a convenience; the result is still on screen.
  }
  return run;
}
