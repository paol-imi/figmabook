import { existsSync, readdirSync, readFileSync } from 'node:fs';
import {
  type BaselineSnapshot,
  type DesignChangeRequest,
  type FigmaSnapshot,
  validateDcr,
  validateFigmaSnapshot,
} from '@holotype/dcr';
import type { ValidationIssue, Validator } from '@holotype/ir';
import {
  type CaseConfig,
  type FixtureProvenance,
  type SnippetCase,
  validateBaselineFile,
  validateCaseConfig,
  validateFixtureProvenance,
  validateSnippetCase,
} from './schemas.ts';

/*
 * One golden case per directory (12 §2.4):
 *
 *   <case>/baseline.json         BaselineSnapshot[]: the embedded baselines in scope (base:*, 15 §3.3)
 *   <case>/branch.json           FigmaSnapshot: the plugin read-back after the designer's edit (15 §4.1)
 *   <case>/provenance.json       optional: CLI provenance (CodeRefs, side files, token sites, 15 §5)
 *   <case>/config.json           the resolved `dcr` config (16 §15), equal to branch:meta.dcrConfig
 *   <case>/expected/dcr.json     the request the pipeline must produce, byte for byte (canonical)
 *   <case>/expected/prompt.md    the rendered prompt, or a pending placeholder
 *
 * Snippet goldens live in `snippet/<row>.json` → `snippet/<row>.jsx-sketch` (15 §7.3).
 */

/** The fixtures root: `fixtures/dcr/`. */
export const FIXTURES_ROOT = new URL('../', import.meta.url);
/** The snippet goldens: `fixtures/dcr/snippet/`. */
export const SNIPPET_ROOT = new URL('snippet/', FIXTURES_ROOT);

export const CASE_FILES = {
  baseline: 'baseline.json',
  branch: 'branch.json',
  provenance: 'provenance.json',
  config: 'config.json',
  dcr: 'expected/dcr.json',
  prompt: 'expected/prompt.md',
} as const;
export type CaseFile = keyof typeof CASE_FILES;

/** What the pipeline reads. */
export interface CaseInput {
  branch: FigmaSnapshot;
  baseline: BaselineSnapshot[];
  config: CaseConfig;
  provenance?: FixtureProvenance;
}

/** An expected prompt: the golden text, or a placeholder until the renderer exists. */
export type PromptGolden =
  | { readonly pending: true; readonly reason: string }
  | { readonly pending: false; readonly text: string };

export interface DcrCase {
  readonly name: string;
  readonly dir: URL;
  readonly input: CaseInput;
  readonly expected: { readonly dcr: DesignChangeRequest; readonly prompt: PromptGolden };
}

/** A case file failed its schema. The message lists the file and every issue. */
export class CaseFileError extends Error {
  readonly file: string;
  readonly issues: readonly ValidationIssue[];

  constructor(file: string, issues: readonly ValidationIssue[]) {
    super(`${file} is invalid:\n${issues.map((i) => `  ${i.path || '/'}: ${i.message}`).join('\n')}`);
    this.name = 'CaseFileError';
    this.file = file;
    this.issues = issues;
  }
}

/** First line of a pending prompt golden: `<!-- holotype:pending <reason> -->`. */
export const PENDING_MARKER = /^<!-- holotype:pending (.+?) -->\r?\n/;

/** Every case directory name, sorted: a directory of the fixtures root that holds `branch.json`. */
export function listCases(root: URL = FIXTURES_ROOT): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/${CASE_FILES.branch}`, root)))
    .map((entry) => entry.name)
    .sort();
}

/** Every snippet golden name (`snippet/<name>.json`), sorted. */
export function listSnippets(root: URL = SNIPPET_ROOT): string[] {
  return readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

export const caseDir = (name: string, root: URL = FIXTURES_ROOT): URL => new URL(`${name}/`, root);

/** Reads one case file as text, or `undefined` when it does not exist. */
export function readCaseText(dir: URL, file: CaseFile): string | undefined {
  const url = new URL(CASE_FILES[file], dir);
  return existsSync(url) ? readFileSync(url, 'utf8') : undefined;
}

/** Reads and parses one JSON case file, or `undefined` when it does not exist. */
export function readCaseJson(dir: URL, file: Exclude<CaseFile, 'prompt'>): unknown {
  const text = readCaseText(dir, file);
  return text === undefined ? undefined : JSON.parse(text);
}

function validated<T>(validate: Validator<T>, value: unknown, file: string): T {
  const result = validate(value);
  if (!result.ok) throw new CaseFileError(file, result.error);
  return result.value;
}

function required(dir: URL, file: Exclude<CaseFile, 'prompt'>): unknown {
  const value = readCaseJson(dir, file);
  if (value === undefined) throw new Error(`${new URL(CASE_FILES[file], dir).pathname} is missing.`);
  return value;
}

/** Parses a prompt golden: a pending placeholder or the expected text. */
export function parsePromptGolden(text: string): PromptGolden {
  const pending = PENDING_MARKER.exec(text);
  return pending ? { pending: true, reason: pending[1] as string } : { pending: false, text };
}

/** Loads and validates the input files of a case. Throws `CaseFileError` on a schema failure. */
export function loadCaseInput(dir: URL): CaseInput {
  const at = (file: CaseFile) => `${dir.pathname}${CASE_FILES[file]}`;
  const input: CaseInput = {
    branch: validated(validateFigmaSnapshot, required(dir, 'branch'), at('branch')),
    baseline: validated(validateBaselineFile, required(dir, 'baseline'), at('baseline')),
    config: validated(validateCaseConfig, required(dir, 'config'), at('config')),
  };
  const provenance = readCaseJson(dir, 'provenance');
  if (provenance !== undefined) input.provenance = validated(validateFixtureProvenance, provenance, at('provenance'));
  return input;
}

/** Loads and validates a whole case. Throws `CaseFileError` on a schema failure. */
export function loadCase(name: string, root: URL = FIXTURES_ROOT): DcrCase {
  const dir = caseDir(name, root);
  const prompt = readCaseText(dir, 'prompt');
  if (prompt === undefined) throw new Error(`${dir.pathname}${CASE_FILES.prompt} is missing.`);
  return {
    name,
    dir,
    input: loadCaseInput(dir),
    expected: {
      dcr: validated(validateDcr, required(dir, 'dcr'), `${dir.pathname}${CASE_FILES.dcr}`),
      prompt: parsePromptGolden(prompt),
    },
  };
}

export interface SnippetGolden {
  readonly name: string;
  readonly input: SnippetCase;
  /** The expected `*.jsx-sketch` text. */
  readonly expected: string;
}

/** Loads and validates a snippet golden. */
export function loadSnippet(name: string, root: URL = SNIPPET_ROOT): SnippetGolden {
  const json = new URL(`${name}.json`, root);
  const sketch = new URL(`${name}.jsx-sketch`, root);
  return {
    name,
    input: validated(validateSnippetCase, JSON.parse(readFileSync(json, 'utf8')), json.pathname),
    expected: readFileSync(sketch, 'utf8'),
  };
}
