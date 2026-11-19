/**
 * The spike module contract (BUILD §9.1). A spike is a list of steps. Each step is an async
 * function that runs in the UI iframe and drives the Figma side through named **main tasks**
 * (`io.call`), asks the user for manual actions (`io.ask`), and returns a JSON result.
 */
import type { JsonObject, JsonPrimitive } from './json.ts';

/** Anything `figma.ui.postMessage` carries: JSON plus byte arrays (PNG exports, payload tests). */
export type WireValue = JsonPrimitive | Uint8Array | readonly WireValue[] | { readonly [key: string]: WireValue };

/** What a main task receives besides its input. The only door to the Plugin API. */
export interface MainContext {
  readonly figma: PluginAPI;
  /** Shows a short progress line in the plugin window. */
  progress(message: string): void;
}

/** A unit of work that runs in the Figma main thread. Input and output cross `postMessage`. */
export type MainTask<I extends WireValue, O extends WireValue> = (ctx: MainContext, input: I) => Promise<O>;

/** A spike's main tasks, keyed `S-xx/<name>`. `never` input accepts every task signature. */
export type TaskTable = { readonly [task: string]: (ctx: MainContext, input: never) => Promise<WireValue> };

export type TaskInput<F> = F extends (ctx: MainContext, input: infer I) => Promise<WireValue> ? I : never;
export type TaskOutput<F> = F extends (ctx: MainContext, input: never) => Promise<infer O> ? O : never;

/** Coarse, non-identifying facts about where the spike ran (BUILD §9.1). */
export type SpikeEnv = {
  readonly apiVersion: string;
  readonly editorType: string;
  readonly client: 'desktop' | 'browser' | 'unknown';
  readonly os: 'macos' | 'windows' | 'linux' | 'chromeos' | 'other';
};

/** A manual action for the user. Lines are short, plain-language sentences. */
export type Ask =
  | { readonly kind: 'continue'; readonly lines: readonly string[]; readonly button?: string }
  | {
      readonly kind: 'choice';
      readonly lines: readonly string[];
      readonly choices: readonly { readonly id: string; readonly label: string }[];
      /** When set, a one-line text box is shown under the choices. */
      readonly note?: { readonly label: string };
    };

export type AskAnswer = { readonly choice: string; readonly note: string };

/** Per-spike persistent state in `figma.clientStorage`, so users can close Figma between steps. */
export interface KitState {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface StepIO {
  call(task: string, input: WireValue): Promise<unknown>;
  ask(question: Ask): Promise<AskAnswer>;
  progress(message: string): void;
  readonly state: KitState;
  readonly env: SpikeEnv;
}

export type StepOutcome = {
  readonly results: JsonObject;
  /** Short messages shown on the Done screen (for example "the library update was not seen"). */
  readonly notes?: readonly string[];
};

export interface StepDefinition {
  /** Stable id used in the result envelope: `step1`, `step2`, `run`. */
  readonly id: string;
  /** Button label, as in the BUILD §9 card: "Step 1 (build)". */
  readonly label: string;
  /** Which file to run it in, e.g. "Spikes Library". */
  readonly where: string;
  /** Shown before the Run button. Keep each line short. */
  readonly before?: readonly string[];
  /** Shown on the Done screen, next to Copy results. */
  readonly after?: readonly string[];
  run(io: StepIO): Promise<StepOutcome>;
}

export interface SpikeDefinition {
  readonly id: string;
  readonly title: string;
  /** The question the spike answers, in one sentence. */
  readonly question: string;
  /** Rough user time, as in BUILD §9.3. */
  readonly userTime: string;
  readonly steps: readonly StepDefinition[];
}

/** A typed `io.call` for one spike's task table. */
export function taskClient<T extends TaskTable>(io: Pick<StepIO, 'call'>) {
  return <K extends keyof T & string>(task: K, input: TaskInput<T[K]>): Promise<TaskOutput<T[K]>> =>
    io.call(task, input as WireValue) as Promise<TaskOutput<T[K]>>;
}
