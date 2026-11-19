/**
 * `var()` references in a declared value (CSS Variables 1 §3). Only the outermost references
 * are listed: a reference inside another one's fallback belongs to that fallback.
 */

export interface VarRef {
  /** e.g. `--space-3`. */
  readonly name: string;
  /** The fallback text after the first comma, trimmed; absent without a comma. */
  readonly fallback?: string;
  /** Offsets of `var(` … `)` in the value. */
  readonly start: number;
  readonly end: number;
}

const NAME = /^\s*(--[A-Za-z0-9_\-\u0080-￿]+)\s*/;

/** Index of the `)` that closes the parenthesis opened just before `from`, or -1. */
function closingParen(value: string, from: number): number {
  let depth = 1;
  let quote: string | null = null;
  for (let i = from; i < value.length; i++) {
    const ch = value[i];
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The outermost `var()` references of `value`, in order. Malformed references are skipped. */
export function varRefs(value: string): VarRef[] {
  const refs: VarRef[] = [];
  const pattern = /var\(/gi;
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    pattern.lastIndex = i;
    const match = pattern.exec(value);
    if (match?.index !== i) continue;
    // `var(` must not be the tail of a longer identifier (e.g. `somevar(`).
    if (i > 0 && /[A-Za-z0-9_-]/.test(value[i - 1] ?? '')) continue;
    const open = i + match[0].length;
    const close = closingParen(value, open);
    if (close < 0) break;
    const inner = value.slice(open, close);
    const name = NAME.exec(inner);
    if (name?.[1] !== undefined) {
      const rest = inner.slice(name[0].length);
      const ref: VarRef = rest.startsWith(',')
        ? { name: name[1], fallback: rest.slice(1).trim(), start: i, end: close + 1 }
        : { name: name[1], start: i, end: close + 1 };
      if (rest === '' || rest.startsWith(',')) refs.push(ref);
    }
    i = close;
  }
  return refs;
}

/** The single reference when `value` is exactly one `var()` (whitespace aside), else undefined. */
export function soleVarRef(value: string): VarRef | undefined {
  const trimmed = value.trim();
  const refs = varRefs(trimmed);
  const [only] = refs;
  return refs.length === 1 && only !== undefined && only.start === 0 && only.end === trimmed.length ? only : undefined;
}
