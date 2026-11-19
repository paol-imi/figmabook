import type { JsonValue } from '@holotype/ir';

/** Storybook control types (03 §4.4). */
export const CONTROL_TYPES = [
  'boolean',
  'text',
  'number',
  'range',
  'color',
  'date',
  'object',
  'file',
  'select',
  'multi-select',
  'radio',
  'inline-radio',
  'check',
  'inline-check',
] as const;
export type ControlType = (typeof CONTROL_TYPES)[number];

/** Where an argType comes from; the planner weighs enums by it (03 §4.2, 04 §4.2). */
export type ArgTypeOrigin = 'story' | 'docgen-inline' | 'docgen-service' | 'inferred-from-args';

export interface NormalizedControl {
  readonly type: ControlType;
  readonly labels?: Readonly<Record<string, string>>;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/** One argType, normalized across Storybook versions (03 §4.4). */
export interface NormalizedArgType {
  readonly name: string;
  readonly origin: ArgTypeOrigin;
  readonly type?: {
    readonly name: string;
    readonly value?: JsonValue;
    readonly required?: boolean;
    readonly raw?: string;
  };
  /** `false`: the arg has no control (functions, symbols, or `control: false`). */
  readonly control?: NormalizedControl | false;
  readonly options?: readonly JsonValue[];
  readonly mapping?: Readonly<Record<string, JsonValue>>;
  readonly if?: Readonly<Record<string, JsonValue>>;
  readonly table?: {
    readonly category?: string;
    readonly subcategory?: string;
    readonly disable?: boolean;
    readonly defaultValue?: { readonly summary?: string };
  };
  readonly description?: string;
}

/** Which keys the project, meta and story wrote, and which props docgen knows. */
export interface ArgTypeSources {
  readonly declared: ReadonlySet<string>;
  readonly docgen: ReadonlySet<string>;
}

type Json = Readonly<Record<string, JsonValue>>;

const isRecord = (value: JsonValue | undefined): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: JsonValue | undefined): string | undefined => (typeof value === 'string' ? value : undefined);
const num = (value: JsonValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const isControlType = (value: string): value is ControlType => (CONTROL_TYPES as readonly string[]).includes(value);

/** A record without the `undefined` values, so optional fields stay absent. */
function compact<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function readType(value: JsonValue | undefined): NormalizedArgType['type'] {
  if (typeof value === 'string') return { name: value };
  if (!isRecord(value)) return undefined;
  const name = str(value.name);
  if (name === undefined) return undefined;
  return compact({
    name,
    value: value.value,
    required: typeof value.required === 'boolean' ? value.required : undefined,
    raw: str(value.raw),
  });
}

function readControl(value: JsonValue | undefined): NormalizedControl | false | undefined {
  if (value === false) return false;
  if (typeof value === 'string') return isControlType(value) ? { type: value } : undefined;
  if (!isRecord(value)) return undefined;
  if (value.disable === true) return false;
  const type = str(value.type);
  if (type === undefined || !isControlType(type)) return undefined;
  const labels = isRecord(value.labels)
    ? Object.fromEntries(
        Object.entries(value.labels).flatMap(([key, label]) => (typeof label === 'string' ? [[key, label]] : [])),
      )
    : undefined;
  return compact({ type, labels, min: num(value.min), max: num(value.max), step: num(value.step) });
}

/**
 * Storybook's control inference (`store/inferControls.ts`, 03 §4.4), for argTypes without a
 * control: enums and options → `radio` (≤ 5 values) or `select`; boolean, string → `text`,
 * number; arrays → `object`; functions and symbols get none.
 */
export function inferControl(
  type: NormalizedArgType['type'],
  options: readonly JsonValue[] | undefined,
): NormalizedControl | false | undefined {
  const enumValues = type?.name === 'enum' && Array.isArray(type.value) ? type.value : undefined;
  const values = options ?? enumValues;
  if (values !== undefined) return { type: values.length <= 5 ? 'radio' : 'select' };
  switch (type?.name) {
    case 'boolean':
      return { type: 'boolean' };
    case 'string':
      return { type: 'text' };
    case 'number':
      return { type: 'number' };
    case 'array':
    case 'object':
      return { type: 'object' };
    case 'function':
    case 'symbol':
      return false;
    default:
      return undefined;
  }
}

function readTable(value: JsonValue | undefined): NormalizedArgType['table'] {
  if (!isRecord(value)) return undefined;
  const summary = isRecord(value.defaultValue) ? str(value.defaultValue.summary) : undefined;
  const table = compact<NonNullable<NormalizedArgType['table']>>({
    category: str(value.category),
    subcategory: str(value.subcategory),
    disable: typeof value.disable === 'boolean' ? value.disable : undefined,
    defaultValue: summary === undefined ? undefined : { summary },
  });
  return Object.keys(table).length === 0 ? undefined : table;
}

/** Normalizes one argType as `loadStory` gave it (made JSON-safe in the page). */
export function normalizeArgType(key: string, raw: JsonValue, sources: ArgTypeSources): NormalizedArgType {
  const record: Json = isRecord(raw) ? raw : {};
  const type = readType(record.type);
  const options = Array.isArray(record.options) ? record.options : undefined;
  const control = readControl(record.control) ?? inferControl(type, options);
  const origin: ArgTypeOrigin = sources.declared.has(key)
    ? 'story'
    : sources.docgen.has(key)
      ? 'docgen-inline'
      : 'inferred-from-args';
  return compact<NormalizedArgType>({
    name: str(record.name) ?? key,
    origin,
    type,
    control,
    options,
    mapping: isRecord(record.mapping) ? record.mapping : undefined,
    if: isRecord(record.if) ? record.if : undefined,
    table: readTable(record.table),
    description: str(record.description) === '' ? undefined : str(record.description),
  });
}

/** Normalizes every argType, keys sorted so the output is stable. */
export function normalizeArgTypes(
  raw: Readonly<Record<string, JsonValue>>,
  sources: ArgTypeSources,
): Record<string, NormalizedArgType> {
  return Object.fromEntries(
    Object.keys(raw)
      .sort()
      .map((key) => [key, normalizeArgType(key, raw[key] ?? null, sources)]),
  );
}
