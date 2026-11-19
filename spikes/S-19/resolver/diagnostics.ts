/**
 * Provenance diagnostics, one per style sheet (12 §6.2): `DCR_PROVENANCE_NO_SOURCEMAP` (warn)
 * when a winning declaration sits in a dev-server sheet with no source map, and
 * `DCR_PROVENANCE_MINIFIED` (info) when it sits in built CSS. Raised lazily, only for sheets that
 * hold a winner of a mapped field: the Storybook preview's own sheets never warn.
 */
import { createDiagnostic, type Diagnostic, diagnostic } from '@holotype/shared';
import type { SheetSource } from './sheets.ts';

export class ProvenanceDiagnostics {
  readonly #seen = new Set<string>();
  readonly #list: Diagnostic[] = [];

  /** Records the diagnostic a field's sheet calls for, once per file. */
  observe(property: string, sheet: SheetSource | undefined): void {
    if (sheet === undefined) return;
    // The same file is a new sheet on every navigation: dedupe by what identifies the file.
    const key = sheet.devId ?? (sheet.header.sourceURL || sheet.styleSheetId);
    if (this.#seen.has(key)) return;
    const data = {
      styleSheetId: sheet.styleSheetId,
      ...(sheet.header.sourceURL === '' ? {} : { sourceURL: sheet.header.sourceURL }),
      // Repo-relative only: absolute paths stay on the machine (15 §10.2).
      ...(sheet.file?.ok === true ? { file: sheet.file.path } : {}),
    };
    if (sheet.kind === 'unmapped' || sheet.kind === 'dev-id') {
      this.#seen.add(key);
      this.#list.push(
        createDiagnostic(diagnostic('DCR_PROVENANCE_NO_SOURCEMAP'), undefined, {
          property,
          data: { ...data, approximate: sheet.kind === 'dev-id' },
          fallback: sheet.kind === 'dev-id' ? 'file from data-vite-dev-id, served line numbers' : 'selector only',
        }),
      );
    } else if (sheet.kind === 'built') {
      this.#seen.add(key);
      this.#list.push(
        createDiagnostic(diagnostic('DCR_PROVENANCE_MINIFIED'), undefined, {
          property,
          data,
          fallback: 'selector only',
        }),
      );
    }
  }

  get list(): readonly Diagnostic[] {
    return this.#list;
  }
}
