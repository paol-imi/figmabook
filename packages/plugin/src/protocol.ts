/*
 * Plugin main ↔ UI messages (09 §3.2). Every message is a plain, structured-clone-safe
 * object carrying `{ v, sessionId }` and a discriminant `t`.
 *
 * This is the slice subset of the 09 union: `hello`, `session.open`, `unit`, `cancel`,
 * `pong` (UI → main) and `ready`, `need`, `progress`, `diagnostics`, `done`, `error`,
 * `ping` (main → UI). Later items add their members here (B-63, B-69).
 */
import type { ApplyReport, BundleManifest } from '@holotype/ir';
import type { Diagnostic } from '@holotype/shared';

/** Protocol major. A message with any other `v` is ignored by both sides. */
export const PROTOCOL_VERSION = 1;

/** Components travel as JSON strings split into parts of at most this many bytes (09 §3.2, S-06). */
export const MAX_PART_BYTES = 1024 * 1024;

/** `diagnostics` messages carry at most this many items (09 §3.2). */
export const MAX_DIAGNOSTICS_PER_MESSAGE = 200;

/** Pipeline stages, in order (09 §5). */
export const STAGES = ['preflight', 'index', 'plan', 'tokens', 'apply', 'verify', 'finalize', 'export'] as const;
export type Stage = (typeof STAGES)[number];

export const BUNDLE_SOURCES = ['server', 'file', 'registry'] as const;
export type BundleSource = (typeof BUNDLE_SOURCES)[number];

export interface Envelope {
  readonly v: typeof PROTOCOL_VERSION;
  readonly sessionId: string;
}

/**
 * Options of one apply session. 09 names the type without defining it; these are the
 * options 09 mentions: harness mode (§14) and the undo granularity (§12).
 */
export interface ApplyOptions {
  /** Harness mode: skip the review screen, apply, export and close. Set only by the CLI in a dev build. */
  readonly auto?: boolean;
  /** One undo step per component (default) or a single step for the whole run. */
  readonly undo?: 'per-component' | 'single';
}

/** What the file's registry says about managed components (10). `null` in a file Holotype never wrote to. */
export interface RegistrySummary {
  readonly components: number;
  readonly variants: number;
}

/** Totals of a finished run, shown in the report header (11 §6.9). */
export interface ApplySummary {
  readonly componentsOk: number;
  readonly componentsFailed: number;
  readonly variants: number;
  readonly durationMs: number;
  readonly cancelled: boolean;
}

export type UnitRef =
  | { readonly kind: 'tokens' }
  | { readonly kind: 'component'; readonly sid: string }
  | { readonly kind: 'asset'; readonly sha256: string };

export type TransferUnit =
  | { readonly kind: 'tokens'; readonly json: string }
  | {
      readonly kind: 'component';
      readonly sid: string;
      readonly json: string;
      readonly part: number;
      readonly parts: number;
    }
  | { readonly kind: 'asset'; readonly sha256: string; readonly mime: string; readonly bytes: Uint8Array };

export type UiToMainBody =
  | { readonly t: 'hello'; readonly uiVersion: string }
  | {
      readonly t: 'session.open';
      readonly manifest: BundleManifest;
      readonly source: BundleSource;
      readonly options: ApplyOptions;
    }
  | { readonly t: 'unit'; readonly seq: number; readonly unit: TransferUnit; readonly last: boolean }
  | { readonly t: 'cancel' }
  | { readonly t: 'pong'; readonly id: number };

export type MainToUiBody =
  | {
      readonly t: 'ready';
      readonly pluginVersion: string;
      /** Scene IR majors this build can apply. */
      readonly irMajors: readonly number[];
      readonly fileKey: string | null;
      readonly registry: RegistrySummary | null;
    }
  | { readonly t: 'need'; readonly unit: UnitRef }
  | {
      readonly t: 'progress';
      readonly stage: Stage;
      readonly done: number;
      readonly total: number;
      readonly current?: string;
      readonly etaMs?: number;
    }
  | { readonly t: 'diagnostics'; readonly items: readonly Diagnostic[] }
  | {
      readonly t: 'done';
      readonly summary: ApplySummary;
      /** What was built, for the report download (06 §4.5); absent when nothing was applied. */
      readonly report?: ApplyReport;
    }
  | { readonly t: 'error'; readonly code: string; readonly message: string; readonly recoverable: boolean }
  | { readonly t: 'ping'; readonly id: number };

type Enveloped<B> = B extends unknown ? Envelope & B : never;

export type UiToMain = Enveloped<UiToMainBody>;
export type MainToUi = Enveloped<MainToUiBody>;
export type UiToMainType = UiToMain['t'];
export type MainToUiType = MainToUi['t'];

/** The message of type `T` in union `M`. */
export type MessageOf<M extends { readonly t: string }, T extends M['t']> = Extract<M, { readonly t: T }>;

/** A message body without its envelope: what a sender passes to `send()`. */
export type BodyOf<M extends { readonly t: string }, T extends M['t']> = Omit<MessageOf<M, T>, keyof Envelope>;

// ---------------------------------------------------------------------------------------
// Runtime validation. Messages cross a process boundary, so each side checks the shape of
// what it receives before it trusts the static type. Deep checks of payload documents
// (manifest, Scene IR) belong to the receiver's own validators (06).

type Fields = Readonly<Record<string, unknown>>;
type Check = (message: Fields) => boolean;

const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isOptional = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value);
const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.includes(value as T);

function isUnitRef(value: unknown): value is UnitRef {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'tokens':
      return true;
    case 'component':
      return isString(value.sid);
    case 'asset':
      return isString(value.sha256);
    default:
      return false;
  }
}

function isTransferUnit(value: unknown): value is TransferUnit {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'tokens':
      return isString(value.json);
    case 'component':
      return (
        isString(value.sid) &&
        isString(value.json) &&
        isCount(value.part) &&
        isCount(value.parts) &&
        (value.part as number) < (value.parts as number)
      );
    case 'asset':
      return isString(value.sha256) && isString(value.mime) && value.bytes instanceof Uint8Array;
    default:
      return false;
  }
}

function isApplyOptions(value: unknown): value is ApplyOptions {
  return (
    isRecord(value) &&
    isOptional(value.auto, isBoolean) &&
    isOptional(value.undo, isOneOf(['per-component', 'single'] as const))
  );
}

function isRegistrySummary(value: unknown): value is RegistrySummary {
  return isRecord(value) && isCount(value.components) && isCount(value.variants);
}

function isApplySummary(value: unknown): value is ApplySummary {
  return (
    isRecord(value) &&
    isCount(value.componentsOk) &&
    isCount(value.componentsFailed) &&
    isCount(value.variants) &&
    isCount(value.durationMs) &&
    isBoolean(value.cancelled)
  );
}

function isApplyReport(value: unknown): value is ApplyReport {
  return (
    isRecord(value) &&
    value.kind === 'holotype/apply-report' &&
    Array.isArray(value.components) &&
    Array.isArray(value.diagnostics)
  );
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return (
    isRecord(value) &&
    isString(value.code) &&
    isOneOf(['info', 'warn', 'error', 'fatal'] as const)(value.severity) &&
    isString(value.message)
  );
}

const uiToMainChecks: Readonly<Record<UiToMainType, Check>> = {
  hello: (m) => isString(m.uiVersion),
  'session.open': (m) =>
    isRecord(m.manifest) &&
    m.manifest.kind === 'holotype/bundle' &&
    isOneOf(BUNDLE_SOURCES)(m.source) &&
    isApplyOptions(m.options),
  unit: (m) => isCount(m.seq) && isTransferUnit(m.unit) && isBoolean(m.last),
  cancel: () => true,
  pong: (m) => isCount(m.id),
};

const mainToUiChecks: Readonly<Record<MainToUiType, Check>> = {
  ready: (m) =>
    isString(m.pluginVersion) &&
    Array.isArray(m.irMajors) &&
    m.irMajors.every(isCount) &&
    (m.fileKey === null || isString(m.fileKey)) &&
    (m.registry === null || isRegistrySummary(m.registry)),
  need: (m) => isUnitRef(m.unit),
  progress: (m) =>
    isOneOf(STAGES)(m.stage) &&
    isCount(m.done) &&
    isCount(m.total) &&
    (m.done as number) <= (m.total as number) &&
    isOptional(m.current, isString) &&
    isOptional(m.etaMs, isCount),
  diagnostics: (m) =>
    Array.isArray(m.items) && m.items.length <= MAX_DIAGNOSTICS_PER_MESSAGE && m.items.every(isDiagnostic),
  done: (m) => isApplySummary(m.summary) && isOptional(m.report, isApplyReport),
  error: (m) => isString(m.code) && isString(m.message) && isBoolean(m.recoverable),
  ping: (m) => isCount(m.id),
};

function parseWith<M>(checks: Readonly<Record<string, Check>>, value: unknown): M | undefined {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || !isString(value.sessionId) || value.sessionId === '') {
    return undefined;
  }
  const { t } = value;
  if (!isString(t) || !Object.hasOwn(checks, t)) return undefined;
  return checks[t]?.(value) ? (value as M) : undefined;
}

/** The message as a `UiToMain`, or `undefined` when it is not a well-formed current-version message. */
export function parseUiToMain(value: unknown): UiToMain | undefined {
  return parseWith<UiToMain>(uiToMainChecks, value);
}

/** The message as a `MainToUi`, or `undefined` when it is not a well-formed current-version message. */
export function parseMainToUi(value: unknown): MainToUi | undefined {
  return parseWith<MainToUi>(mainToUiChecks, value);
}

/** Every message type, for exhaustive tests and logging. */
export const UI_TO_MAIN_TYPES = Object.keys(uiToMainChecks) as readonly UiToMainType[];
export const MAIN_TO_UI_TYPES = Object.keys(mainToUiChecks) as readonly MainToUiType[];

/** Splits diagnostics into `diagnostics` message bodies of at most {@link MAX_DIAGNOSTICS_PER_MESSAGE} items. */
export function diagnosticBatches(items: readonly Diagnostic[]): BodyOf<MainToUi, 'diagnostics'>[] {
  const batches: BodyOf<MainToUi, 'diagnostics'>[] = [];
  for (let start = 0; start < items.length; start += MAX_DIAGNOSTICS_PER_MESSAGE) {
    batches.push({ t: 'diagnostics', items: items.slice(start, start + MAX_DIAGNOSTICS_PER_MESSAGE) });
  }
  return batches;
}
