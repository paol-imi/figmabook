/** Small, dependency-free helpers for the GFM subset the catalog tables use. */

/**
 * Splits a GFM table row into trimmed cells. Leading and trailing pipes are optional;
 * `\|` is a literal pipe (also inside code spans, as in GFM tables) and stays escaped.
 */
export function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '\\' && body[i + 1] === '|') {
      cell += '\\|';
      i++;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Whether a line is a GFM table delimiter row, e.g. `|---|:--:|`. */
export function isDelimiterRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** Turns table-cell markdown into markdown for running text: `\|` becomes `|`. */
export function unescapeCell(markdown: string): string {
  return markdown.replaceAll('\\|', '|');
}

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|<>~])/g;

/**
 * Plain text for messages shown outside markdown (CLI, plugin): emphasis markers and link
 * targets are removed, escapes resolved. Code spans keep their backticks, because they mark
 * literal names the user types or looks for.
 */
export function toPlainText(markdown: string): string {
  return unescapeCell(markdown)
    .split(/(`[^`]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : plainSegment(part)))
    .join('');
}

function plainSegment(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(ESCAPABLE, '$1');
}

/** Escapes `<` outside code spans, so placeholders such as `<branch>` render instead of vanishing as HTML. */
export function escapeHtml(markdown: string): string {
  return markdown
    .split(/(`[^`]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replaceAll('<', '&lt;')))
    .join('');
}

/**
 * Rewrites relative links of markdown written in `docs/plan/<source>` so they resolve from
 * `docs/diagnostics/`: `[x](03-storybook.md)` → `[x](../plan/03-storybook.md)`, `[x](#a)` →
 * `[x](../plan/<source>#a)`. Absolute URLs and code spans are left alone.
 */
export function rebasePlanLinks(markdown: string, sourceFile: string): string {
  return markdown
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/\]\(([^()\s]+)\)/g, (link, target: string) => {
            if (/^[a-z][a-z0-9+.-]*:|^\//i.test(target)) return link;
            return `](../plan/${target.startsWith('#') ? sourceFile : ''}${target})`;
          }),
    )
    .join('');
}

/** Upper-cases a leading lower-case letter and ends the text with a full stop. */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?:]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}
