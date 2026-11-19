/**
 * Serves the diagnostics pages that `tools/diag-gen` writes to `docs/diagnostics/` as site
 * pages under `/reference/diagnostics/`. The generated files stay the only copy: the site
 * reads them at build time and adapts their links, it never stores or edits them. The
 * config excludes `diagnostics/` from VitePress's sources, so they are not also raw pages.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoLink } from './site.ts';

/** Where diag-gen writes the pages, relative to the site root (`docs/`). */
export const DIAGNOSTICS_DIR = 'diagnostics';

/** The same folder, repository-relative (tools/diag-gen `DOCS_DIR`). */
export const DIAGNOSTICS_SOURCE = `docs/${DIAGNOSTICS_DIR}`;

/** The generated index page; it becomes `/reference/diagnostics/`. */
export const DIAGNOSTICS_INDEX = 'README.md';

/** Site route prefix of the diagnostics pages. */
export const DIAGNOSTICS_ROUTE = '/reference/diagnostics/';

export interface DiagnosticPage {
  /** Route segment: `index` for the index page, otherwise the code. */
  readonly slug: string;
  /** Markdown, adapted for the site by {@link toSiteMarkdown}. */
  readonly content: string;
}

export interface DiagnosticArea {
  readonly title: string;
  /** Prefix without the trailing underscore, e.g. `SB`. */
  readonly prefix: string;
  /** Anchor of the area's section on the index page. */
  readonly anchor: string;
  readonly codes: readonly string[];
}

/** Route segment for a generated file name, or `undefined` for files that are not pages. */
export function pageSlug(fileName: string): string | undefined {
  if (fileName === DIAGNOSTICS_INDEX) return 'index';
  const match = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\.md$/.exec(fileName);
  return match?.[1];
}

/** The internal notes folder (plan, research, spike reports), repository-relative; never published. */
export const INTERNAL_DIR = 'internal';

/** A link from `docs/diagnostics/` into `internal/`: text, path inside `internal/`. */
const INTERNAL_LINK = /\[([^\]]*)\]\(\.\.\/\.\.\/internal\/([^)\s]*)\)/g;
const INDEX_LINK = /\]\(README\.md(#[^)\s]*)?\)/g;
/** HTML comments, such as the generator's banner, which names the internal catalog file. */
const COMMENT = /<!--[\s\S]*?-->\n*/g;

/**
 * Adapts a generated page to the site:
 * - HTML comments are dropped (the generator's banner names its internal source file);
 * - links to the index (`README.md`) point at the site's index page;
 * - links into `internal/` (plan, research), which the site never publishes, become their
 *   plain text, or point at the repository when `designDocsRepo` is given (the
 *   `HOLOTYPE_SITE_PLAN_LINKS=repo` opt-in).
 * Every other link is kept, so VitePress's dead-link check still sees it.
 */
export function toSiteMarkdown(markdown: string, designDocsRepo: string | undefined): string {
  return markdown
    .replace(COMMENT, '')
    .replace(INTERNAL_LINK, (_, text: string, target: string) =>
      designDocsRepo ? `[${text}](${repoLink(designDocsRepo, `${INTERNAL_DIR}/${target}`)})` : text,
    )
    .replace(INDEX_LINK, (_, hash: string | undefined) => `](./index.md${hash ?? ''})`);
}

/** Reads every generated page in `dir`, sorted by file name; `designDocsRepo` as in {@link toSiteMarkdown}. */
export function loadDiagnosticPages(dir: string, designDocsRepo: string | undefined): DiagnosticPage[] {
  const pages: DiagnosticPage[] = [];
  for (const name of readdirSync(dir).sort()) {
    const slug = pageSlug(name);
    if (slug) pages.push({ slug, content: toSiteMarkdown(readFileSync(join(dir, name), 'utf8'), designDocsRepo) });
  }
  if (!pages.some((page) => page.slug === 'index')) {
    throw new Error(`${dir} has no ${DIAGNOSTICS_INDEX}. Run \`pnpm diag:gen\` at the repository root.`);
  }
  return pages;
}

/** A search-index section, in the shape of VitePress's `PageSplitSection`. */
export interface SearchSection {
  anchor?: string;
  titles: string[];
  text: string;
}

/** Markdown reduced to the words a reader searches for. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?[\s|:-]*-[\s|:-]*$/gm, ' ')
    .replace(/[`*|#]/g, ' ')
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search sections for one page. VitePress's local search indexes files it reads from disk,
 * which dynamic routes are not, so the site indexes these pages from their markdown:
 * a code page is one section titled with the code; the index has one section per area.
 */
export function searchSections(page: DiagnosticPage): SearchSection[] {
  if (page.slug !== 'index') return [{ titles: [page.slug], text: plainText(page.content.replace(/^# .*$/m, '')) }];
  const sections: SearchSection[] = [];
  const areas = new Map(diagnosticAreas(page.content).map((area) => [area.title, area]));
  let current: { anchor?: string; titles: string[]; lines: string[] } = { titles: ['Diagnostics'], lines: [] };
  const flush = () => {
    const { anchor, titles } = current;
    const text = plainText(current.lines.join('\n'));
    sections.push(anchor ? { anchor, titles, text } : { titles, text });
  };
  for (const line of page.content.split(/\r?\n/)) {
    const heading = AREA_HEADING.exec(line);
    const area = heading?.[1] ? areas.get(heading[1]) : undefined;
    if (area) {
      flush();
      current = { anchor: area.anchor, titles: ['Diagnostics', `${area.title} (${area.prefix}_)`], lines: [] };
    } else if (!/^# /.test(line)) {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

const AREA_HEADING = /^## (.+) \(`([A-Z][A-Z0-9]*)_`\)\s*$/;
const AREA_ANCHOR = /^<a id="(domain-[a-z0-9-]+)"><\/a>\s*$/;
const CODE_ROW = /^\| <a id="([A-Z][A-Z0-9_]*)"><\/a>/;

/** The areas of the index page, in page order, each with its codes in table order. */
export function diagnosticAreas(indexMarkdown: string): DiagnosticArea[] {
  const areas: { title: string; prefix: string; anchor: string; codes: string[] }[] = [];
  let anchor: string | undefined;
  for (const line of indexMarkdown.split(/\r?\n/)) {
    const anchorMatch = AREA_ANCHOR.exec(line);
    if (anchorMatch) {
      anchor = anchorMatch[1];
      continue;
    }
    const heading = AREA_HEADING.exec(line);
    if (heading?.[1] && heading[2]) {
      areas.push({
        title: heading[1],
        prefix: heading[2],
        anchor: anchor ?? `domain-${heading[2].toLowerCase()}`,
        codes: [],
      });
      anchor = undefined;
      continue;
    }
    const code = CODE_ROW.exec(line)?.[1];
    if (code) areas.at(-1)?.codes.push(code);
  }
  return areas;
}
