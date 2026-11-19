import { isDelimiterRow, splitTableRow } from './markdown.ts';
import type {
  Catalog,
  CatalogDomain,
  CatalogIssue,
  CatalogRow,
  CatalogSeverity,
  ChapterRef,
  ParseResult,
} from './model.ts';

/** The column headers every catalog table has, in order (12 §6.2). */
export const CATALOG_COLUMNS = ['Code', 'Severity', 'Emitted by', 'Meaning', 'User remedy', 'Defined in'] as const;

const SECTION_ANCHOR = '<a id="diagnostics"></a>';
const CATALOG_HEADING = /^###\s+(?:\d+(?:\.\d+)*\.?\s+)?Catalog\s*$/;
const SECTION_END = /^(?:#{1,3}\s|---\s*$)/;
const ANCHOR_LINE = /^<a id="[^"]*"><\/a>$/;
const SUMMARY_LINE = /^\*\*(\d+) codes in (\d+) domains:\*\*\s*(.*)$/;
const SUMMARY_ITEM = /^([A-Z][A-Z0-9]*) (\d+)$/;
const DOMAIN_HEADING = /^####\s+(.+?)\s+\(([A-Z][A-Z0-9]*)_\)\s+[—–-]\s+(\d+)\s*$/;
const CODE_CELL = /^`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`$/;
const SEVERITY_CELL = /^(info|warning|warn|error)(?:\s+\(([^()]+)\))?$/;
const EMITTER_ITEM = /^(?:`([a-z][a-z0-9-]*)`|([A-Za-z][A-Za-z0-9-]*))(?:\s+\((.+)\))?$/;
const CHAPTER_LINK = /^\[([^\]]+)\]\(([A-Za-z0-9][A-Za-z0-9._-]*\.md)(?:#([A-Za-z0-9_-]+))?\)$/;

const SEVERITY: Readonly<Record<string, CatalogSeverity>> = {
  info: 'info',
  warning: 'warn',
  warn: 'warn',
  error: 'error',
};

interface SectionDraft {
  prefix: string;
  title: string;
  count: number;
  line: number;
  notes: string[];
  rows: CatalogRow[];
  tables: number;
  /** Data rows of the table, malformed ones included; `undefined` while no table header is valid. */
  dataRows: number | undefined;
}

interface Summary {
  readonly line: number;
  readonly total: number;
  readonly domainCount: number;
  readonly counts: ReadonlyMap<string, number>;
}

/**
 * Parses the catalog of plan chapter 12 (§6.2) and validates it. Every problem is reported,
 * not just the first, so one run lists all malformed rows.
 *
 * The catalog runs from the `### … Catalog` heading after `<a id="diagnostics">` to the next
 * heading of level 1–3 or `---` rule. It holds a summary line
 * (`**N codes in M domains:** SB 27 · …`) and one `#### Title (PREFIX_) — N` section per
 * domain, each with exactly one table in {@link CATALOG_COLUMNS} order.
 */
export function parseCatalog(markdown: string, source: string): ParseResult {
  const lines = markdown.split(/\r?\n/);
  const issues: CatalogIssue[] = [];
  const report = (line: number, message: string): void => {
    issues.push({ line, message });
  };

  const anchor = lines.findIndex((line) => line.trim() === SECTION_ANCHOR);
  if (anchor < 0) return fail(1, `missing the ${SECTION_ANCHOR} anchor of the diagnostics chapter`);
  const start = lines.findIndex((line, index) => index > anchor && CATALOG_HEADING.test(line));
  if (start < 0) return fail(anchor + 1, 'missing the "### Catalog" heading after the diagnostics anchor');
  let end = lines.findIndex((line, index) => index > start && SECTION_END.test(line));
  if (end < 0) end = lines.length;

  let summary: Summary | undefined;
  const sections: SectionDraft[] = [];
  let section: SectionDraft | undefined;
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length > 0 && section) section.notes.push(paragraph.join(' '));
    paragraph = [];
  };

  for (let index = start + 1; index < end; index++) {
    const text = lines[index] ?? '';
    const lineNo = index + 1;
    if (text.startsWith('####')) {
      flushParagraph();
      section = parseHeading(text, lineNo, report);
      if (section) sections.push(section);
      continue;
    }
    if (text.trimStart().startsWith('|')) {
      flushParagraph();
      const tableEnd = findTableEnd(lines, index, end);
      if (!section) {
        report(lineNo, 'table outside a "#### Title (PREFIX_) — N" domain section');
      } else {
        section.tables++;
        if (section.tables > 1) report(lineNo, `domain ${section.prefix}_ has more than one table`);
        else parseTable(lines, index, tableEnd, section, report);
      }
      index = tableEnd - 1;
      continue;
    }
    const summaryMatch = SUMMARY_LINE.exec(text.trim());
    if (summaryMatch) {
      if (summary || section) report(lineNo, 'the summary line must appear once, before the first domain section');
      else summary = parseSummary(summaryMatch, lineNo, report);
      continue;
    }
    if (ANCHOR_LINE.test(text.trim())) continue;
    if (text.trim() === '') flushParagraph();
    else if (section) paragraph.push(text.trim());
  }
  flushParagraph();

  if (!summary) report(start + 1, 'missing the summary line "**N codes in M domains:** PREFIX N · …"');
  if (sections.length === 0) report(start + 1, 'the catalog has no domain sections');
  validateCounts(sections, summary, report);
  validateUniqueness(sections, report);

  if (issues.length > 0) return { ok: false, issues: issues.sort((a, b) => a.line - b.line) };
  const domains = sections.map(
    ({ prefix, title, count, line, notes, rows }): CatalogDomain => ({ prefix, title, count, line, notes, rows }),
  );
  const catalog: Catalog = { source, domains };
  return { ok: true, catalog };

  function fail(line: number, message: string): ParseResult {
    return { ok: false, issues: [{ line, message }] };
  }
}

type Report = (line: number, message: string) => void;

function parseHeading(text: string, line: number, report: Report): SectionDraft | undefined {
  const match = DOMAIN_HEADING.exec(text.trim());
  if (!match) {
    report(line, `domain heading must read "#### Title (PREFIX_) — N", got "${text.trim()}"`);
    return undefined;
  }
  const [, title = '', prefix = '', count = ''] = match;
  return { prefix, title, count: Number(count), line, notes: [], rows: [], tables: 0, dataRows: undefined };
}

function parseSummary(match: RegExpExecArray, line: number, report: Report): Summary {
  const [, total = '', domainCount = '', list = ''] = match;
  const counts = new Map<string, number>();
  for (const item of list
    .replace(/\.\s*$/, '')
    .split('·')
    .map((part) => part.trim())) {
    const itemMatch = SUMMARY_ITEM.exec(item);
    if (!itemMatch) {
      report(line, `summary entry must read "PREFIX N", got "${item}"`);
      continue;
    }
    const [, prefix = '', count = ''] = itemMatch;
    if (counts.has(prefix)) report(line, `summary lists domain ${prefix} twice`);
    counts.set(prefix, Number(count));
  }
  return { line, total: Number(total), domainCount: Number(domainCount), counts };
}

function findTableEnd(lines: readonly string[], from: number, limit: number): number {
  let index = from;
  while (index < limit && (lines[index] ?? '').trimStart().startsWith('|')) index++;
  return index;
}

/** Parses one table into `section`; a table with a bad header or delimiter leaves `dataRows` unset. */
function parseTable(lines: readonly string[], from: number, to: number, section: SectionDraft, report: Report): void {
  const header = splitTableRow(lines[from] ?? '');
  const expected = CATALOG_COLUMNS.join(' | ');
  if (header.join(' | ').toLowerCase() !== expected.toLowerCase()) {
    report(from + 1, `table header must be "| ${expected} |", got "| ${header.join(' | ')} |"`);
    return;
  }
  if (from + 1 >= to || !isDelimiterRow(lines[from + 1] ?? '')) {
    report(from + 2, 'table header must be followed by a delimiter row "|---|---|…|"');
    return;
  }
  section.dataRows = to - from - 2;
  for (let index = from + 2; index < to; index++) {
    const row = parseRow(lines[index] ?? '', index + 1, section.prefix, report);
    if (row) section.rows.push(row);
  }
}

function parseRow(text: string, line: number, domain: string, report: Report): CatalogRow | undefined {
  const cells = splitTableRow(text);
  if (cells.length !== CATALOG_COLUMNS.length) {
    report(line, `row has ${cells.length} cells, expected ${CATALOG_COLUMNS.length} (escape a literal pipe as \\|)`);
    return undefined;
  }
  const [codeCell = '', severityCell = '', emitterCell = '', meaning = '', remedy = '', definedInCell = ''] = cells;
  const problems: string[] = [];

  const code = CODE_CELL.exec(codeCell)?.[1];
  if (!code) problems.push(`code must be one backticked UPPER_SNAKE code, got "${codeCell}"`);
  else if (!code.startsWith(`${domain}_`)) problems.push(`code ${code} is not in domain ${domain}_`);

  const severityMatch = SEVERITY_CELL.exec(severityCell);
  const severity = severityMatch ? SEVERITY[severityMatch[1] ?? ''] : undefined;
  if (!severity) problems.push(`severity must be info, warning or error, got "${severityCell}"`);

  const emittedBy = parseEmitters(emitterCell);
  if (!emittedBy) problems.push(`"Emitted by" must list backticked package names, got "${emitterCell}"`);

  if (meaning === '') problems.push('meaning is empty');
  if (remedy === '') problems.push('user remedy is empty');

  const definedIn = parseChapterRef(definedInCell);
  if (!definedIn) problems.push(`"Defined in" must be one link like [03](03-storybook.md), got "${definedInCell}"`);

  if (problems.length > 0 || !code || !severity || !emittedBy || !definedIn) {
    for (const problem of problems) report(line, code ? `${code}: ${problem}` : problem);
    return undefined;
  }
  const severityNote = severityMatch?.[2]?.trim();
  return {
    code,
    domain,
    line,
    severity,
    ...(severityNote ? { severityNote } : {}),
    emittedBy,
    emittedByMarkdown: emitterCell,
    meaningMarkdown: meaning,
    remedyMarkdown: remedy,
    definedIn,
  };
}

/** Splits `` `cli`, `plugin` (hosted) `` on commas outside parentheses. */
function parseEmitters(cell: string): string[] | undefined {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of cell) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current.trim());
  const names: string[] = [];
  for (const item of items) {
    const match = EMITTER_ITEM.exec(item);
    const name = match?.[1] ?? match?.[2];
    if (!name) return undefined;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function parseChapterRef(cell: string): ChapterRef | undefined {
  const match = CHAPTER_LINK.exec(cell);
  if (!match) return undefined;
  const [, chapter = '', file = '', anchor] = match;
  return anchor ? { chapter, file, anchor } : { chapter, file };
}

function validateCounts(sections: readonly SectionDraft[], summary: Summary | undefined, report: Report): void {
  for (const section of sections) {
    if (section.tables === 0) report(section.line, `domain ${section.prefix}_ has no table`);
    else if (section.dataRows !== undefined && section.dataRows !== section.count) {
      report(
        section.line,
        `domain ${section.prefix}_ heading says ${section.count} codes, its table has ${section.dataRows} rows`,
      );
    }
  }
  if (!summary) return;
  const rowTotal = sections.reduce((sum, section) => sum + section.count, 0);
  if (summary.total !== rowTotal) {
    report(summary.line, `summary says ${summary.total} codes, the domain headings add up to ${rowTotal}`);
  }
  if (summary.domainCount !== sections.length) {
    report(
      summary.line,
      `summary says ${summary.domainCount} domains, the catalog has ${plural(sections.length, 'section')}`,
    );
  }
  const listed = [...summary.counts.keys()];
  const headed = sections.map((section) => section.prefix);
  if (listed.join(' ') !== headed.join(' ')) {
    report(summary.line, `summary lists domains "${listed.join(' ')}", the sections are "${headed.join(' ')}"`);
  }
  for (const section of sections) {
    const count = summary.counts.get(section.prefix);
    if (count !== undefined && count !== section.count) {
      report(
        summary.line,
        `summary says ${section.prefix} ${count}, the ${section.prefix}_ heading says ${section.count}`,
      );
    }
  }
}

function validateUniqueness(sections: readonly SectionDraft[], report: Report): void {
  const seenPrefix = new Map<string, number>();
  for (const section of sections) {
    const first = seenPrefix.get(section.prefix);
    if (first !== undefined) report(section.line, `domain ${section.prefix}_ also has a section at line ${first}`);
    else seenPrefix.set(section.prefix, section.line);
  }
  const seenCode = new Map<string, number>();
  for (const row of sections.flatMap((section) => section.rows)) {
    const first = seenCode.get(row.code);
    if (first !== undefined) report(row.line, `${row.code} is listed twice (first at line ${first})`);
    else seenCode.set(row.code, row.line);
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
