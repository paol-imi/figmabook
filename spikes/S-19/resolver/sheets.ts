/**
 * Style sheets → original files (05 §6.2, 15 §5.1). A served position (CDP `SourceRange`,
 * 0-based, relative to the sheet's own text) maps to a repo `SourceLoc` (1-based) through the
 * sheet's source map. Vite serves dev CSS as script-inserted `<style>` elements: their header has
 * an empty `sourceURL`, `isInline: false`, the inline source map as a `data:` URL in
 * `sourceMapURL`, and the file in the owner node's `data-vite-dev-id`.
 *
 * Pure (no Node built-ins): the caller loads the headers, owner attributes and any linked maps.
 */
import type { SourceLoc } from '@holotype/ir';
import { type SourceMapInput, sourceContentFor, TraceMap, traceSegment } from '@jridgewell/trace-mapping';
import type { SourceRange, StyleSheetHeader } from './cdp.ts';
import { dirname, type RepoPathOptions, type RepoPathResult, toRepoPath } from './paths.ts';

export interface SheetInput {
  readonly header: StyleSheetHeader;
  /** `data-vite-dev-id` of the owner node: the file Vite served (absolute path, may carry a query). */
  readonly devId?: string;
  /** The source map, parsed (a `data:` URL decoded with {@link decodeDataUrl}, or a fetched file). */
  readonly sourceMap?: SourceMapInput;
}

/**
 * How a sheet resolves to code:
 * - `source-mapped`: positions go through its source map (branch mode, `css.devSourcemap: true`);
 * - `dev-id`: Vite's file but no map: file known, positions taken as-is (`approximate`);
 * - `built`: a linked sheet with no map, e.g. a static build (`DCR_PROVENANCE_MINIFIED`);
 * - `unmapped`: no map and no file (`DCR_PROVENANCE_NO_SOURCEMAP`): an inline `<style>` of the
 *   document, a constructed sheet, a CSS-in-JS sheet.
 */
export type SheetKind = 'source-mapped' | 'dev-id' | 'built' | 'unmapped' | 'user-agent';

export interface SheetSource {
  readonly styleSheetId: string;
  readonly kind: SheetKind;
  readonly header: StyleSheetHeader;
  readonly devId?: string;
  /** `dev-id` sheets: the served file. */
  readonly file?: RepoPathResult;
  /** `source-mapped` sheets. */
  readonly map?: TraceMap;
}

/** 0-based position inside a sheet's own text (CDP coordinates). */
export interface SheetPosition {
  readonly line: number;
  readonly column: number;
}

export type MappedPosition =
  | {
      readonly ok: true;
      /** 1-based, repo-relative. */
      readonly loc: SourceLoc;
      /** The map has a segment that starts exactly at the position. */
      readonly exact: boolean;
      /** No map: the served position was taken as the original one (`dev-id` sheets). */
      readonly approximate: boolean;
      /** The original file's text, when the map embeds it (`sourcesContent`). */
      readonly content?: string;
    }
  | { readonly ok: false; readonly reason: UnmappedReason };

export type UnmappedReason =
  | 'no-sourcemap'
  | 'minified'
  | 'user-agent'
  /** The map has no segment on that line. */
  | 'no-segment'
  | Exclude<RepoPathResult, { ok: true }>['reason'];

/** Decodes a `data:application/json[;base64],…` source map URL; undefined for other URLs or bad JSON. */
export function decodeDataUrl(url: string): unknown {
  const match = /^data:([^,]*),(.*)$/s.exec(url);
  if (!match) return undefined;
  const [, meta = '', payload = ''] = match;
  try {
    let text: string;
    if (/;base64$/i.test(meta)) {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      text = new TextDecoder().decode(bytes);
    } else {
      text = decodeURIComponent(payload);
    }
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Whether `value` looks like a v3 source map with `sources` and `mappings` (index maps are not). */
export function isSourceMap(value: unknown): value is SourceMapInput {
  if (typeof value !== 'object' || value === null) return false;
  const map = value as { version?: unknown; sources?: unknown; mappings?: unknown };
  return map.version === 3 && Array.isArray(map.sources) && typeof map.mappings === 'string';
}

/** Classifies one sheet and prepares its map. */
export function classifySheet(input: SheetInput, options: RepoPathOptions): SheetSource {
  const { header, devId } = input;
  const base = { styleSheetId: header.styleSheetId, header, ...(devId === undefined ? {} : { devId }) };
  if (header.origin === 'user-agent') return { ...base, kind: 'user-agent' };
  if (input.sourceMap !== undefined) return { ...base, kind: 'source-mapped', map: new TraceMap(input.sourceMap) };
  if (devId !== undefined) return { ...base, kind: 'dev-id', file: toRepoPath(devId, options) };
  const linked = !header.isInline && /^https?:\/\//i.test(header.sourceURL);
  return { ...base, kind: linked ? 'built' : 'unmapped' };
}

/** Where a source of the map lives, before repo validation. */
function sourcePath(map: TraceMap, index: number): string | undefined {
  const source = map.sources[index];
  if (source === undefined || source === null) return undefined;
  const root = map.sourceRoot ?? '';
  return root === '' || /^[a-z]+:|^\//i.test(source) ? source : `${root.replace(/\/$/, '')}/${source}`;
}

/** Maps a served position to the original file (05 §6.2). */
export function mapPosition(sheet: SheetSource, position: SheetPosition, options: RepoPathOptions): MappedPosition {
  switch (sheet.kind) {
    case 'user-agent':
      return { ok: false, reason: 'user-agent' };
    case 'built':
      return { ok: false, reason: 'minified' };
    case 'unmapped':
      return { ok: false, reason: 'no-sourcemap' };
    case 'dev-id': {
      const file = sheet.file;
      if (file === undefined || !file.ok) return { ok: false, reason: file?.reason ?? 'no-sourcemap' };
      return {
        ok: true,
        loc: { file: file.path, line: position.line + 1, col: position.column + 1 },
        exact: false,
        approximate: true,
      };
    }
    case 'source-mapped': {
      const map = sheet.map;
      if (map === undefined) return { ok: false, reason: 'no-sourcemap' };
      const segment = traceSegment(map, position.line, position.column);
      if (segment === null || segment.length < 4) return { ok: false, reason: 'no-segment' };
      const [generatedColumn, sourceIndex, line, column] = segment;
      const source = sourcePath(map, sourceIndex);
      if (source === undefined) return { ok: false, reason: 'no-segment' };
      const baseDir = sheet.devId === undefined ? options.baseDir : dirname(sheet.devId.replace(/[?#].*$/, ''));
      const file = toRepoPath(source, { ...options, ...(baseDir === undefined ? {} : { baseDir }) });
      if (!file.ok) return { ok: false, reason: file.reason };
      const exact = generatedColumn === position.column;
      // A segment that starts earlier on the line covers verbatim text: keep the offset.
      const col = column + (position.column - generatedColumn) + 1;
      const content = sourceContentFor(map, map.sources[sourceIndex] ?? '') ?? undefined;
      return {
        ok: true,
        loc: { file: file.path, line: line + 1, col },
        exact,
        approximate: false,
        ...(content === undefined ? {} : { content }),
      };
    }
  }
}

/** The start of a CDP range as a sheet position. */
export function rangeStart(range: SourceRange): SheetPosition {
  return { line: range.startLine, column: range.startColumn };
}

/**
 * Where a sheet-relative position sits in the sheet's document (for inline `<style>` sheets of an
 * HTML file): CDP ranges are relative to the sheet, `header.startLine/startColumn` place the sheet.
 */
export function documentPosition(header: StyleSheetHeader, position: SheetPosition): SheetPosition {
  return {
    line: header.startLine + position.line,
    column: position.line === 0 ? header.startColumn + position.column : position.column,
  };
}

/** Sheets by `styleSheetId`. */
export class SheetTable {
  readonly #sheets = new Map<string, SheetSource>();

  readonly options: RepoPathOptions;

  constructor(inputs: Iterable<SheetInput>, options: RepoPathOptions) {
    this.options = options;
    for (const input of inputs) this.#sheets.set(input.header.styleSheetId, classifySheet(input, options));
  }

  get(styleSheetId: string): SheetSource | undefined {
    return this.#sheets.get(styleSheetId);
  }

  get size(): number {
    return this.#sheets.size;
  }

  values(): IterableIterator<SheetSource> {
    return this.#sheets.values();
  }

  /** Maps a range start of sheet `styleSheetId`; an unknown sheet counts as unmapped. */
  map(styleSheetId: string | undefined, range: SourceRange | undefined): MappedPosition {
    const sheet = styleSheetId === undefined ? undefined : this.#sheets.get(styleSheetId);
    if (sheet === undefined || range === undefined) return { ok: false, reason: 'no-sourcemap' };
    return mapPosition(sheet, rangeStart(range), this.options);
  }
}
