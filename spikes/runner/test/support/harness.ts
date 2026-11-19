/**
 * Runs spike steps end to end in tests: the real main host and UI bridge, connected by an
 * in-memory channel that structured-clones every message like `postMessage` does, on top of
 * the dry-run Plugin API.
 */
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Ask, AskAnswer, SpikeDefinition, SpikeEnv } from '../../../_shared/spike.ts';
import { type Bridge, type BridgePort, createBridge } from '../../src/bridge.ts';
import { createMainHost } from '../../src/host.ts';
import { createStepIO, runStep, type StepRun } from '../../src/session.ts';
import { allTasks } from '../../src/tasks.ts';
import { createDryRunFigma, type DryRun, type DryRunOptions } from './dry-run-figma.ts';

export const TEST_ENV: SpikeEnv = { apiVersion: '1.0.0', editorType: 'figma', client: 'desktop', os: 'macos' };

export type Connected = { dryRun: DryRun; figma: PluginAPI; bridge: Bridge };

/** A dry-run Figma with `figma.ui` wired to a bridge, as in the real plugin. */
export function connect(options: DryRunOptions = {}): Connected {
  const dryRun = createDryRunFigma(options);
  const listeners = new Set<(message: unknown) => void>();
  const ui = {
    onmessage: undefined as ((message: unknown) => void) | undefined,
    postMessage(message: unknown) {
      const copy = structuredClone(message);
      queueMicrotask(() => {
        for (const listener of listeners) listener(copy);
      });
    },
  };
  const figma = new Proxy(dryRun.figma, {
    get: (target, key, receiver) => (key === 'ui' ? ui : Reflect.get(target, key, receiver)),
  });
  createMainHost(figma, allTasks);
  const port: BridgePort = {
    post(message) {
      const copy = structuredClone(message);
      queueMicrotask(() => ui.onmessage?.(copy));
    },
    listen(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
  return { dryRun, figma, bridge: createBridge(port) };
}

export type Answerer = (question: Ask) => AskAnswer;

/** Picks the first choice (or Continue) for every manual question. */
export const firstChoice: Answerer = (question) => ({
  choice: question.kind === 'choice' ? (question.choices[0]?.id ?? '') : 'continue',
  note: question.kind === 'choice' && question.note ? 'dry run' : '',
});

export async function runDry(
  connected: Connected,
  spike: SpikeDefinition,
  stepId: string,
  answer: Answerer = firstChoice,
): Promise<StepRun> {
  const step = spike.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`${spike.id} has no step ${stepId}`);
  const io = createStepIO(connected.bridge, spike.id, TEST_ENV, {
    onProgress: () => {},
    onAsk: async (question) => answer(question),
  });
  return runStep(spike, step, io, '0.1.0');
}

/** Validates against a TypeBox schema and returns readable errors (empty when valid). */
export function schemaErrors(schema: TSchema, value: unknown): string[] {
  return [...Value.Errors(schema, value)].map((error) => `${error.path}: ${error.message}`);
}
