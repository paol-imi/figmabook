/**
 * S-17 marker plan and analysis (pure). Each step writes shared plugin data markers on the
 * document root and on one component, then reads every marker back. Comparing the readouts
 * of the five steps answers: do branches carry plugin data on creation, on "Update from
 * main", and on merge (D-32, 10 §9.5)?
 */

export const STEP_IDS = ['step1', 'step2', 'step3', 'step4', 'step5'] as const;
export type StepId = (typeof STEP_IDS)[number];
export type MarkerHost = 'root' | 'component';

/** Size of the `base:*`-like chunk (embedded baselines are split into ≤ 90 kB values, D-34). */
export const CHUNK_LENGTH = 90_000;

export type MarkerSpec = {
  readonly key: string;
  readonly on: MarkerHost;
  readonly writtenIn: StepId;
  /** Expected value; chunks are checked by length and fingerprint instead. */
  readonly value: string | 'chunk';
};

export const MARKERS: readonly MarkerSpec[] = [
  { key: 's17.created', on: 'root', writtenIn: 'step1', value: 'step1' },
  { key: 's17.base.0', on: 'root', writtenIn: 'step1', value: 'chunk' },
  { key: 's17.created', on: 'component', writtenIn: 'step1', value: 'step1' },
  { key: 's17.base.0', on: 'component', writtenIn: 'step1', value: 'chunk' },
  { key: 's17.branch', on: 'root', writtenIn: 'step2', value: 'step2' },
  { key: 's17.branch-only', on: 'component', writtenIn: 'step2', value: 'step2' },
  { key: 's17.main-update', on: 'root', writtenIn: 'step3', value: 'step3' },
  { key: 's17.main-update', on: 'component', writtenIn: 'step3', value: 'step3' },
];

/** A value written in step 1 ("main") and overwritten in the branch (step 2, "branch"). */
export const EDIT_KEY = 's17.edit';

/** Deterministic 90 kB text, so the reader can check it arrived intact without storing it. */
export function makeChunk(length = CHUNK_LENGTH): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  let state = 7;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[state % alphabet.length];
  }
  return out;
}

export type MarkerRead = {
  readonly key: string;
  readonly on: MarkerHost;
  readonly present: boolean;
  /** Short markers: the value read. Chunks: `intact` or `damaged:<length>`. */
  readonly value: string | null;
};

export type Readout = {
  readonly step: StepId;
  readonly componentFound: boolean;
  readonly markers: readonly MarkerRead[];
  readonly edit: string | null;
  /** Fingerprint of `figma.fileKey`, never the key itself. */
  readonly fileKeyFingerprint: string | null;
  readonly wrote: readonly string[];
  readonly errors: readonly string[];
};

export type Survival = 'yes' | 'no' | 'partial' | 'not-run';

/** Did every marker written in `writtenIn` (optionally only on one host) show up in `readout`? */
export function survival(readout: Readout | undefined, writtenIn: StepId, on?: MarkerHost): Survival {
  if (!readout) return 'not-run';
  const expected = MARKERS.filter((marker) => marker.writtenIn === writtenIn && (on === undefined || marker.on === on));
  const found = expected.filter((marker) => {
    const read = readout.markers.find((entry) => entry.key === marker.key && entry.on === marker.on);
    if (!read?.present) return false;
    return marker.value === 'chunk' ? read.value === 'intact' : read.value === marker.value;
  });
  if (found.length === expected.length) return 'yes';
  return found.length === 0 ? 'no' : 'partial';
}

function chunkState(readout: Readout | undefined, on: MarkerHost): string {
  if (!readout) return 'not-run';
  const read = readout.markers.find((marker) => marker.key === 's17.base.0' && marker.on === on);
  return read?.present ? (read.value ?? 'missing') : 'missing';
}

/** Direct answers to the S-17 questions from whatever steps have run so far. */
export function analyze(readouts: Partial<Record<StepId, Readout>>) {
  const { step1, step2, step3, step4, step5 } = readouts;
  const fp = (readout: Readout | undefined) => readout?.fileKeyFingerprint ?? null;
  const differs = (a: Readout | undefined, b: Readout | undefined) =>
    fp(a) === null || fp(b) === null ? null : fp(a) !== fp(b);
  return {
    branchCreationWithoutUi: 'not testable from a plugin; checked separately (REST and Figma MCP tool list)',
    onCreate: {
      root: survival(step2, 'step1', 'root'),
      component: survival(step2, 'step1', 'component'),
      chunk90kB: { root: chunkState(step2, 'root'), component: chunkState(step2, 'component') },
    },
    branchWritesVisibleInMainBeforeMerge: step3 ? survival(step3, 'step2') !== 'no' : null,
    onUpdateFromMain: {
      mainWritesArrived: survival(step4, 'step3'),
      branchWritesKept: survival(step4, 'step2'),
      editValue: step4?.edit ?? null,
    },
    onMerge: {
      branchWritesArrived: survival(step5, 'step2'),
      editValue: step5?.edit ?? null,
      mainWritesKept: survival(step5, 'step3'),
      step1MarkersKept: survival(step5, 'step1'),
      chunk90kB: { root: chunkState(step5, 'root'), component: chunkState(step5, 'component') },
    },
    fileKey: {
      branchHasOwnKey: differs(step1, step2),
      mainKeyStable: step5 ? !differs(step1, step5) : null,
    },
    stepsRun: STEP_IDS.filter((id) => readouts[id] !== undefined),
  };
}
