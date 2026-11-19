/**
 * Small readers over original CSS text: the selector that starts at a mapped position (CSS
 * modules: the de-hashed selector, 15 §5.1), selector lists, value components, and the enclosing
 * rule of a declaration (the S-19 ground-truth check). Not a CSS parser: comments, strings and
 * nesting depth are tracked, which is enough for selectors and declaration values.
 */

/** Offset of a 1-based line and column in `text`, or -1 when out of range. */
export function offsetOf(text: string, line: number, col: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return -1;
    offset = next + 1;
  }
  const lineEnd = text.indexOf('\n', offset);
  const result = offset + col - 1;
  if (col < 1 || (lineEnd >= 0 && result > lineEnd) || result > text.length) return -1;
  return result;
}

const BACKSLASH = '\\';
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Blanks `/* … *\/` comments (outside strings) with spaces, keeping offsets and line breaks. */
export function stripComments(text: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (quote !== null) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) out += text[++i] ?? '';
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? text.length : close + 2;
      out += text.slice(i, end).replace(/[^\n]/g, ' ');
      i = end - 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** The selector list that starts at `offset`, up to its `{`, whitespace-collapsed. */
export function selectorFrom(text: string, offset: number): string | undefined {
  if (offset < 0) return undefined;
  let quote: string | null = null;
  let depth = 0;
  for (let i = offset; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return undefined;
      i = end + 1;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (depth === 0 && (ch === ';' || ch === '}')) {
      return undefined;
    } else if (depth === 0 && ch === '{') {
      const selector = collapse(stripComments(text.slice(offset, i)));
      return selector === '' ? undefined : selector;
    }
  }
  return undefined;
}

/** Splits at top-level commas (not inside `()`, `[]` or strings). */
export function splitTopLevel(text: string, separator: ',' | ' '): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (depth === 0 && (separator === ',' ? ch === ',' : /\s/.test(ch ?? ''))) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** The selectors of a list, each whitespace-collapsed. */
export function splitSelectorList(list: string): string[] {
  return splitTopLevel(list, ',').map(collapse);
}

/**
 * The selector of the rule that encloses `offset` (a declaration's start): a forward scan that
 * tracks open blocks, skipping comments, strings and brackets, so `{`/`}` inside them do not count.
 */
export function enclosingSelector(text: string, offset: number): string | undefined {
  const clean = stripComments(text);
  const open: { brace: number; start: number }[] = [];
  let boundary = -1;
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < offset && i < clean.length; i++) {
    const ch = clean[i];
    if (quote !== null) {
      if (ch === BACKSLASH) i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && ch === '{') {
      open.push({ brace: i, start: boundary + 1 });
      boundary = i;
    } else if (depth === 0 && ch === '}') {
      open.pop();
      boundary = i;
    } else if (depth === 0 && ch === ';') {
      boundary = i;
    }
  }
  const block = open[open.length - 1];
  if (block === undefined) return undefined;
  const selector = collapse(clean.slice(block.start, block.brace));
  return selector === '' ? undefined : selector;
}

/** Whether the text at `offset` is a declaration of `name` (`name` then optional space then `:`). */
export function declarationAt(text: string, offset: number, name: string): boolean {
  if (offset < 0) return false;
  const head = text.slice(offset, offset + name.length + 64);
  if (head.slice(0, name.length).toLowerCase() !== name.toLowerCase()) return false;
  return /^\s*:/.test(head.slice(name.length));
}
