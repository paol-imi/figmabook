/** The registry's default severities. The catalog writes `'warn'` as *warning* (12 §6.1). */
export type CatalogSeverity = 'info' | 'warn' | 'error';

/** A **Defined in** cell: a link to the plan chapter that specifies the behaviour. */
export interface ChapterRef {
  /** Link text, e.g. `03`. */
  readonly chapter: string;
  /** File name inside `docs/plan/`, e.g. `03-storybook.md`. */
  readonly file: string;
  /** Fragment without `#`, when the link has one. */
  readonly anchor?: string;
}

/** One row of a catalog table. Markdown fields keep the cell's inline markdown verbatim. */
export interface CatalogRow {
  readonly code: string;
  readonly domain: string;
  /** 1-based line in the source file. */
  readonly line: number;
  readonly severity: CatalogSeverity;
  /** Qualifier in parentheses after the severity, e.g. `error over 8 MB`. */
  readonly severityNote?: string;
  /** Package names (or a bare tool name such as `CI`), deduplicated, in cell order. */
  readonly emittedBy: readonly string[];
  readonly emittedByMarkdown: string;
  readonly meaningMarkdown: string;
  readonly remedyMarkdown: string;
  readonly definedIn: ChapterRef;
}

/** One `#### Title (PREFIX_) — N` section and its table. */
export interface CatalogDomain {
  readonly prefix: string;
  readonly title: string;
  /** Row count stated in the heading. */
  readonly count: number;
  /** Prose between the heading and the table (and after it), as markdown paragraphs. */
  readonly notes: readonly string[];
  readonly line: number;
  readonly rows: readonly CatalogRow[];
}

export interface Catalog {
  /** Repository-relative path of the parsed file. */
  readonly source: string;
  readonly domains: readonly CatalogDomain[];
}

/** A problem in the catalog source, with its 1-based line. */
export interface CatalogIssue {
  readonly line: number;
  readonly message: string;
}

export type ParseResult =
  | { readonly ok: true; readonly catalog: Catalog }
  | { readonly ok: false; readonly issues: readonly CatalogIssue[] };

/** Every row of the catalog, in catalog order. */
export function catalogRows(catalog: Catalog): readonly CatalogRow[] {
  return catalog.domains.flatMap((domain) => domain.rows);
}
