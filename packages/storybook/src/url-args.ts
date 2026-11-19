import { err, ok, type Result } from '@holotype/shared';

/*
 * The `args=` / `globals=` URL parameter (03 §5.4): a port of Storybook's `buildArgsParam`
 * (`core/src/router/utils.ts`) with its safe-list (`preview-web/parseArgsParam.ts`). Storybook
 * silently drops what fails the safe-list, so anything that would not come back as the same
 * value is reported instead of encoded.
 */

const SAFE = /^[a-zA-Z0-9 _-]*$/;
const NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;
const HEX = /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i;
const COLOR = /^(rgba?|hsla?)\(([0-9]{1,3}),\s?([0-9]{1,3})%?,\s?([0-9]{1,3})%?,?\s?([0-9](\.[0-9]{1,2})?)?\)$/i;

/** A value that the URL path cannot carry. */
export interface UnencodableValue {
  /** `label`, `style.color`, `items[0]`. */
  readonly path: string;
  readonly reason: string;
}

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function encodeString(value: string): string | { reason: string } {
  if (HEX.test(value)) return `!hex(${value.slice(1)})`;
  if (COLOR.test(value)) return `!${value.replace(/[\s%]/g, '')}`;
  if (NUMBER.test(value)) return { reason: 'a numeric string would be read back as a number' };
  if (!SAFE.test(value)) {
    return { reason: 'strings may hold only letters, digits, space, "_" and "-", or be a hex or rgb/hsl color' };
  }
  return value;
}

function encodeInto(path: string, value: unknown, parts: string[], problems: UnencodableValue[]): void {
  const fail = (reason: string) => problems.push({ path, reason });
  if (value === undefined) parts.push(`${path}:!undefined`);
  else if (value === null) parts.push(`${path}:!null`);
  else if (typeof value === 'boolean') parts.push(`${path}:!${value}`);
  else if (typeof value === 'number') {
    if (Number.isFinite(value) && NUMBER.test(String(value))) parts.push(`${path}:${value}`);
    else fail(`the number ${String(value)} has no plain decimal form`);
  } else if (typeof value === 'string') {
    const encoded = encodeString(value);
    if (typeof encoded === 'string') parts.push(`${path}:${encoded}`);
    else fail(encoded.reason);
  } else if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail('invalid date');
    else parts.push(`${path}:!date(${value.toISOString()})`);
  } else if (Array.isArray(value)) {
    if (value.length === 0) fail('an empty array cannot be encoded');
    value.forEach((item, index) => {
      encodeInto(`${path}[${index}]`, item, parts, problems);
    });
  } else if (isPlainObject(value)) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) fail('an empty object cannot be encoded');
    for (const [key, item] of entries) {
      if (key === '' || !SAFE.test(key)) problems.push({ path: `${path}.${key}`, reason: 'unsafe key' });
      else encodeInto(`${path}.${key}`, item, parts, problems);
    }
  } else {
    fail(`a ${typeof value === 'object' ? 'class instance' : typeof value} cannot be encoded`);
  }
}

/**
 * Encodes arg or global values for `iframe.html?args=…` / `globals=…`, e.g.
 * `{ label: 'Hi there', disabled: true }` → `disabled:!true;label:Hi there`. Keys are sorted so
 * equal values give equal URLs. Returns every value that cannot be encoded, or `''` for `{}`.
 */
export function encodeUrlParam(values: Readonly<Record<string, unknown>>): Result<string, readonly UnencodableValue[]> {
  const parts: string[] = [];
  const problems: UnencodableValue[] = [];
  const keys = Object.keys(values).sort();
  for (const key of keys) {
    if (key === '' || !SAFE.test(key)) problems.push({ path: key, reason: 'unsafe key' });
    else encodeInto(key, values[key], parts, problems);
  }
  return problems.length > 0 ? err(problems) : ok(parts.join(';'));
}
