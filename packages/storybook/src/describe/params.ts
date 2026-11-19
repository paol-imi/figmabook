import {
  type HolotypeParams,
  HolotypeParamsSchema,
  type JsonValue,
  type ValidationIssue,
  validateHolotypeParams,
} from '@holotype/ir';
import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import { globToRegExp } from '../filter';

/**
 * `parameters.holotype` (04 §9) with README §7 precedence, lowest to highest: config `defaults`,
 * the Storybook layers (project < meta < story, already merged by Storybook), then config
 * `components[<sid | glob>]` in order.
 */

/** The config layers around the Storybook ones (16 §4, 04 §9). */
export interface ParamsConfig {
  /** `holotype.config.ts` → `defaults`. */
  readonly defaults?: HolotypeParams;
  /** `holotype.config.ts` → `components`: keys are a sid or a glob on the sid or title; later entries win. */
  readonly components?: Readonly<Record<string, HolotypeParams>>;
}

type JsonRecord = { readonly [key: string]: JsonValue };

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Deep merge with Storybook's `combineParameters` semantics: plain objects merge key by key,
 * anything else (arrays included) replaces. `undefined` never overrides.
 */
export function mergeParams<T>(...layers: readonly (T | undefined)[]): T {
  const merge = (base: unknown, over: unknown): unknown => {
    if (over === undefined) return base;
    if (!isPlainRecord(base) || !isPlainRecord(over)) return over;
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(over)) out[key] = merge(out[key], value);
    return out;
  };
  return layers.reduce<unknown>((merged, layer) => merge(merged, layer), {}) as T;
}

/** Turns `{$regexp: "/a/i"}` markers from the page back into the config pattern form (16 §1). */
function unmarkPatterns(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(unmarkPatterns);
  if (value === null || typeof value !== 'object') return value;
  const record = value as JsonRecord;
  const keys = Object.keys(record);
  if (keys.length === 1 && typeof record.$regexp === 'string') return record.$regexp;
  return Object.fromEntries(keys.map((key) => [key, unmarkPatterns(record[key] ?? null)]));
}

const decode = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~');
const segmentsOf = (pointer: string): string[] => (pointer === '' ? [] : pointer.slice(1).split('/').map(decode));

/** Removes the value at a JSON pointer (a copy; `value` is not changed). */
function removeAt(value: JsonValue, segments: readonly string[]): JsonValue {
  const [head, ...rest] = segments;
  if (head === undefined) return value;
  if (Array.isArray(value)) {
    const index = Number(head);
    return rest.length === 0
      ? value.filter((_, i) => i !== index)
      : value.map((item, i) => (i === index ? removeAt(item, rest) : item));
  }
  if (value === null || typeof value !== 'object') return value;
  const record = value as JsonRecord;
  if (!(head in record)) return value;
  const out: Record<string, JsonValue> = { ...record };
  if (rest.length === 0) delete out[head];
  else out[head] = removeAt(record[head] ?? null, rest);
  return out;
}

interface SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly patternProperties?: Readonly<Record<string, SchemaNode>>;
  readonly anyOf?: readonly SchemaNode[];
  readonly items?: SchemaNode;
}

/** The keys a strict object at `segments` allows, for a "did you mean" hint. */
export function allowedKeys(segments: readonly string[]): string[] {
  let nodes: SchemaNode[] = [HolotypeParamsSchema as SchemaNode];
  const expand = (list: readonly SchemaNode[]): SchemaNode[] =>
    list.flatMap((node) => (node.anyOf ? expand(node.anyOf) : [node]));
  for (const segment of segments) {
    nodes = expand(nodes).flatMap((node) => {
      const property = node.properties?.[segment];
      if (property !== undefined) return [property];
      if (node.patternProperties !== undefined) return Object.values(node.patternProperties);
      if (node.items !== undefined && /^\d+$/.test(segment)) return [node.items];
      return [];
    });
  }
  return [...new Set(expand(nodes).flatMap((node) => Object.keys(node.properties ?? {})))].sort();
}

/** Edit distance with adjacent transpositions (optimal string alignment): `nmae` → `name` is 1. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number): number => rows[i]?.[j] ?? 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      const row = rows[i];
      if (row !== undefined) row[j] = best;
    }
  }
  return at(a.length, b.length);
}

/** The closest allowed key within a third of its length (at least 1, at most 3 edits). */
export function suggestKey(key: string, candidates: readonly string[]): string | undefined {
  const limit = Math.min(3, Math.max(1, Math.floor(key.length / 3)));
  let best: { key: string; d: number } | undefined;
  for (const candidate of candidates) {
    const d = distance(key.toLowerCase(), candidate.toLowerCase());
    if (d <= limit && (best === undefined || d < best.d)) best = { key: candidate, d };
  }
  return best?.key;
}

export interface CheckedParams {
  readonly params: HolotypeParams;
  readonly diagnostics: Diagnostic[];
}

function issueDiagnostic(issue: ValidationIssue, scope: { storyId: string; sid: string }): Diagnostic {
  const segments = segmentsOf(issue.path);
  if (issue.kind === 'unknown-key') {
    const key = segments.at(-1) ?? '';
    const suggestion = suggestKey(key, allowedKeys(segments.slice(0, -1)));
    return createDiagnostic(
      diagnostic('PLAN_PARAM_UNKNOWN_KEY'),
      { pointer: issue.path },
      {
        sid: scope.sid,
        value: key,
        data: { storyId: scope.storyId, pointer: issue.path, ...(suggestion === undefined ? {} : { suggestion }) },
      },
    );
  }
  return createDiagnostic(
    diagnostic('PLAN_CONFIG_INVALID'),
    { pointer: issue.path, reason: issue.message },
    {
      sid: scope.sid,
      fallback: 'the value was ignored',
      data: { storyId: scope.storyId, pointer: issue.path, source: 'parameters.holotype' },
    },
  );
}

/**
 * Validates the Storybook-merged `parameters.holotype` (04 §9). Unknown keys give
 * `PLAN_PARAM_UNKNOWN_KEY` (with `data.suggestion` when a key is close) and invalid values
 * `PLAN_CONFIG_INVALID`; both are left out and the rest is kept.
 */
export function checkParams(raw: JsonValue | undefined, scope: { storyId: string; sid: string }): CheckedParams {
  if (raw === undefined || raw === null) return { params: {}, diagnostics: [] };
  let value = unmarkPatterns(raw);
  if (!isPlainRecord(value)) {
    const issue: ValidationIssue = { path: '', kind: 'invalid', message: 'Expected an object' };
    return { params: {}, diagnostics: [issueDiagnostic(issue, scope)] };
  }
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<string>();
  // Each pass drops what the validator rejected; nested issues can surface only after a parent passes.
  for (let pass = 0; pass < 8; pass += 1) {
    const checked = validateHolotypeParams(value);
    if (checked.ok) return { params: checked.value, diagnostics };
    const issues = checked.error.filter((issue) => !reported.has(issue.path));
    if (issues.length === 0) break;
    for (const issue of issues) {
      reported.add(issue.path);
      diagnostics.push(issueDiagnostic(issue, scope));
      value = removeAt(value, segmentsOf(issue.path));
    }
  }
  const last = validateHolotypeParams(value);
  return { params: last.ok ? last.value : {}, diagnostics };
}

/** The config `components` entries that apply to a story: sid or glob on the sid or title. */
export function componentLayers(config: ParamsConfig, sid: string, title: string): HolotypeParams[] {
  return Object.entries(config.components ?? {}).flatMap(([key, params]) => {
    if (key === sid) return [params];
    const glob = globToRegExp(key);
    return glob.test(sid) || glob.test(title) ? [params] : [];
  });
}

/** `parameters.holotype` with every layer applied (README §7), plus the validation diagnostics. */
export function resolveParams(
  raw: JsonValue | undefined,
  config: ParamsConfig,
  scope: { storyId: string; sid: string; title: string },
): CheckedParams {
  const story = checkParams(raw, scope);
  const params = mergeParams<HolotypeParams>(
    config.defaults,
    story.params,
    ...componentLayers(config, scope.sid, scope.title),
  );
  return { params, diagnostics: story.diagnostics };
}
