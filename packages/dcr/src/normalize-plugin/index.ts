import { APPLIED_GROUPS, type JsonValue, normalizeGroups, type RawNodeGroups } from '@holotype/ir';
import { compareStrings, isObject } from '../identify/json';
import {
  type DcrScope,
  type FigmaSnapshot,
  type PartialNodeGroups,
  type SnapNode,
  type SnapVariable,
  validateFigmaSnapshot,
} from '../schema';

/*
 * `normalizePlugin(raw)` (15 §4.1): the plugin's read-back of the scope, as main sends it in
 * `snapshot` chunks (09 §20.3), into a `FigmaSnapshot`. Groups go through the `ah` normalizer
 * of `@holotype/ir` (floats to 1e-3, colors to 1e-4), so a value Figma re-measured within that
 * step is never a change. Pure and isomorphic: it runs in the plugin UI and in the CLI.
 *
 * - Instance sublayers (ids starting with `I`) are skipped, and an instance lists no children:
 *   only the instance itself is read, with its properties and overrides (10 §2.1).
 * - Baseline chunks (`base:*`) travel separately as `BaselineSnapshot`s, and submitted
 *   requests (`request:*`) are outputs, not design: both are left out, so submitting does not
 *   change the snapshot.
 * - Variable aliases (`{ type: 'VARIABLE_ALIAS', id }`) become `{ alias: id }`.
 */

/** One node as plugin main reads it (`readGroups` plus identity, B-58). */
export interface PluginNodeRead {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly parent?: string;
  readonly children?: readonly string[];
  /** `holotype` shared plugin data. */
  readonly data: Readonly<Record<string, string>>;
  /** `readGroups(node)`: raw read-back, normalized here. Absent groups were not read. */
  readonly groups: RawNodeGroups;
  readonly component?: SnapNode['component'];
  readonly instance?: SnapNode['instance'];
  readonly detachedInfo?: SnapNode['detachedInfo'];
  readonly devStatus?: SnapNode['devStatus'];
  readonly annotations?: SnapNode['annotations'];
}

/** One variable as plugin main reads it. Values may hold Figma aliases. */
export interface PluginVariableRead extends Omit<SnapVariable, 'valuesByMode'> {
  readonly valuesByMode: Readonly<Record<string, unknown>>;
  /** Figma variable scopes (an open field of the snapshot, 15 §4.7 candidates). */
  readonly scopes?: readonly string[];
}

/** What plugin main sends for `snapshot.request` (09 §20.3). */
export interface PluginReadback {
  readonly fileKey: string;
  readonly fileVersion?: string;
  readonly scope: DcrScope;
  readonly pages: ReadonlyArray<{ readonly id: string; readonly name: string; readonly topLevel: readonly string[] }>;
  readonly nodes: readonly PluginNodeRead[];
  readonly variables: readonly PluginVariableRead[];
  /** `figma.root` shared plugin data (`branch:meta`, registry chunks). */
  readonly rootData: Readonly<Record<string, string>>;
}

/** Thrown when the read-back does not make a valid snapshot; lists every schema issue. */
export class SnapshotReadError extends Error {
  override readonly name = 'SnapshotReadError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`The plugin read-back is not a valid Figma snapshot:\n  ${issues.join('\n  ')}`);
    this.issues = issues;
  }
}

const isSublayer = (id: string): boolean => id.startsWith('I');
const DROPPED_DATA = /^base:/;
const DROPPED_ROOT = /^request:/;

/** Normalizes any read-back value with the `ah` normalizer (numbers 1e-3, colors 1e-4). */
function normalizeValue(value: unknown): JsonValue {
  return normalizeGroups({ vis: value }).vis;
}

function normalizedGroups(raw: RawNodeGroups): PartialNodeGroups {
  const all = normalizeGroups(raw);
  const out: PartialNodeGroups = {};
  for (const group of APPLIED_GROUPS) if (raw[group] !== undefined) out[group] = all[group];
  return out;
}

function sortedRecord<T>(record: Readonly<Record<string, T>>, keep: (key: string) => boolean = () => true) {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort(compareStrings)) if (keep(key)) out[key] = record[key] as T;
  return out;
}

function node(read: PluginNodeRead, present: ReadonlySet<string>): SnapNode {
  const children =
    read.type === 'INSTANCE' ? undefined : read.children?.filter((id) => !isSublayer(id) && present.has(id));
  const out: SnapNode = {
    id: read.id,
    type: read.type,
    name: read.name,
    data: sortedRecord(read.data, (key) => !DROPPED_DATA.test(key)),
    groups: normalizedGroups(read.groups),
  };
  if (read.parent !== undefined) out.parent = read.parent;
  if (children !== undefined) out.children = [...children];
  if (read.component !== undefined) {
    const { propertyDefs, ...rest } = read.component;
    out.component = { ...rest, ...(propertyDefs === undefined ? {} : { propertyDefs: normalizeValue(propertyDefs) }) };
  }
  if (read.instance !== undefined) {
    const properties: NonNullable<SnapNode['instance']>['properties'] = {};
    for (const [id, property] of Object.entries(read.instance.properties)) {
      properties[id] = { type: property.type, value: normalizeValue(property.value) };
    }
    out.instance = {
      ...read.instance,
      properties: sortedRecord(properties),
      overrides: read.instance.overrides
        .filter((override) => override.fields.length > 0)
        .map((override) => ({ id: override.id, fields: [...override.fields].sort(compareStrings) })),
    };
  }
  if (read.detachedInfo !== undefined) out.detachedInfo = read.detachedInfo;
  if (read.devStatus !== undefined) out.devStatus = read.devStatus;
  if (read.annotations !== undefined && read.annotations.length > 0) out.annotations = [...read.annotations];
  return out;
}

/** A Figma alias `{ type: 'VARIABLE_ALIAS', id }` as the snapshot writes it: `{ alias: id }`. */
function variableValue(value: unknown): JsonValue {
  if (isObject(value) && value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') return { alias: value.id };
  return normalizeValue(value);
}

function variable(read: PluginVariableRead): SnapVariable {
  const { valuesByMode, ...rest } = read;
  const values: Record<string, JsonValue> = {};
  for (const mode of Object.keys(valuesByMode).sort(compareStrings)) values[mode] = variableValue(valuesByMode[mode]);
  const out = { ...rest, valuesByMode: values, data: sortedRecord(read.data) } as SnapVariable;
  return read.scopes === undefined ? out : ({ ...out, scopes: [...read.scopes] } as SnapVariable);
}

/** The plugin read-back as a validated `FigmaSnapshot`. Throws `SnapshotReadError` when it is malformed. */
export function normalizePlugin(raw: PluginReadback): FigmaSnapshot {
  const reads = raw.nodes.filter((read) => !isSublayer(read.id));
  const present = new Set(reads.map((read) => read.id));
  const nodes: Record<string, SnapNode> = {};
  for (const read of [...reads].sort((a, b) => compareStrings(a.id, b.id))) nodes[read.id] = node(read, present);
  const variables: Record<string, SnapVariable> = {};
  for (const read of [...raw.variables].sort((a, b) => compareStrings(a.id, b.id))) variables[read.id] = variable(read);
  const snapshot: FigmaSnapshot = {
    kind: 'holotype/figma-snapshot',
    v: 1,
    source: 'plugin',
    fileKey: raw.fileKey,
    ...(raw.fileVersion === undefined ? {} : { fileVersion: raw.fileVersion }),
    scope: raw.scope,
    pages: raw.pages.map((page) => ({
      id: page.id,
      name: page.name,
      topLevel: page.topLevel.filter((id) => present.has(id)),
    })),
    nodes,
    variables,
    rootData: sortedRecord(raw.rootData, (key) => !DROPPED_ROOT.test(key)),
  };
  const result = validateFigmaSnapshot(snapshot);
  if (!result.ok) throw new SnapshotReadError(result.error.map((issue) => `${issue.path || '/'}: ${issue.message}`));
  return result.value;
}
