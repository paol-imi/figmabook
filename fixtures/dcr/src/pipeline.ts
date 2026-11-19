import * as dcr from '@holotype/dcr';
import { type DcrItem, type DesignChangeRequest, extractDcr, type UsageSnippet } from '@holotype/dcr';
import type { CaseInput } from './case.ts';
import { coreBytes, requestBytes } from './expected.ts';
import type { SnippetCase } from './schemas.ts';

/*
 * The one place the case runner calls into the pipeline. Each stage is `pending` until the
 * work item that builds it lands; its tests are skipped until then, and a guard test fails
 * as soon as the function exists, so the flag is never left behind:
 *
 *   extract     extractDcr                 B-65          plugin and CLI core extraction
 *   screens     extractDcr screen items    B-66          screens, new-component nearest scoring
 *   provenance  CLI provenance attachment  B-70          origin, css, reach, varDefinition, code
 *   prompt      renderPrompt               B-67          expected/prompt.md
 *   snippet     renderSnippet              B-67          snippet/*.jsx-sketch
 *
 * To wire a stage: call it below, set its status to `ready`, run
 * `pnpm -F @holotype/fixture-dcr test`, and fix the goldens with reviewer sign-off (12 §1.2).
 *
 * `screens` is part of `extractDcr` (no export of its own): until it lands, a screen frame is
 * extracted as `unknown`, and the cases in `CASE_STAGES` that need it compare only the items
 * extraction already owns (`ownedItems`).
 */

export type Stage = 'extract' | 'screens' | 'provenance' | 'prompt' | 'snippet';
export type StageStatus = 'pending' | 'ready';

export const STAGES: Readonly<Record<Stage, StageStatus>> = {
  extract: 'ready',
  screens: 'pending',
  provenance: 'pending',
  prompt: 'pending',
  snippet: 'pending',
};

/**
 * The extraction stages beyond `extract` a case's golden needs: screen items and nearest
 * scoring (`screens`, B-66), and the usage snippets embedded in the request (`snippet`, B-67).
 */
export const CASE_STAGES: Readonly<Record<string, readonly Stage[]>> = {
  'component-new': ['screens', 'snippet'],
  injection: ['screens', 'snippet'],
  'instance-detached': ['screens', 'snippet'],
  'screen-usage-basic': ['screens', 'snippet'],
};

/** Whether every stage a case's golden needs is built, so its whole request can be compared. */
export const caseReady = (name: string): boolean =>
  STAGES.extract === 'ready' && (CASE_STAGES[name] ?? []).every((stage) => STAGES[stage] === 'ready');

/** Item kinds `extract` builds (B-65); screens and instance items arrive with B-66 and B-132. */
const EXTRACT_KINDS: ReadonlySet<DcrItem['kind']> = new Set([
  'component.modified',
  'variant.added',
  'variant.removed',
  'property.added',
  'property.changed',
  'node.added',
  'node.removed',
  'component.new',
  'token.changed',
  'token.added',
]);

/** Fields of an item that a pending stage fills: nearest scoring (B-66) and the snippet (B-67). */
const PENDING_FIELDS = ['nearest', 'snippet'] as const;
const PENDING_CODES: ReadonlySet<string> = new Set(['DCR_NEAREST_COMPONENT']);

/**
 * The part of a request that `extract` alone owns, for a case whose golden needs a pending
 * stage: its items of the extract kinds without the pending fields, with their own questions
 * (code, text, options; ids depend on the other items).
 */
export function ownedItems(request: Pick<DesignChangeRequest, 'items' | 'questions'>): unknown[] {
  return request.items
    .filter((item) => EXTRACT_KINDS.has(item.kind))
    .map((item) => {
      const out: Record<string, unknown> = { ...item };
      for (const key of PENDING_FIELDS) delete out[key];
      const diagnostics = (item.diagnostics ?? []).filter((d) => !PENDING_CODES.has(d.code));
      if (diagnostics.length > 0) out.diagnostics = diagnostics;
      else delete out.diagnostics;
      const questions = request.questions
        .filter((q) => q.itemId === item.id && !PENDING_CODES.has(q.code))
        .map(({ code, text, options }) => ({ code, text, options }));
      return { item: out, questions };
    });
}

/** The `@holotype/dcr` export each pending stage waits for (checked by the guard tests). */
export const STAGE_EXPORTS: Readonly<Record<Exclude<Stage, 'extract' | 'screens'>, string>> = {
  provenance: 'attachProvenance',
  prompt: 'renderPrompt',
  snippet: 'renderSnippet',
};

/** Whether `@holotype/dcr` exports a function of this name yet. */
export function dcrExports(name: string): boolean {
  return typeof (dcr as Record<string, unknown>)[name] === 'function';
}

const notWired = (stage: Stage): Error =>
  new Error(`Pipeline stage "${stage}" is not wired yet: see fixtures/dcr/src/pipeline.ts.`);

/** Core extraction (plugin side, 15 §4): the snapshot and its baselines → a sealed request. */
export function extract(input: CaseInput): DesignChangeRequest {
  return extractDcr(input.branch, input.baseline);
}

/**
 * CLI provenance (15 §5): attaches origins, CSS values, blast radius and code refs from
 * `input.provenance`, or `DCR_PROVENANCE_MISSING` when the case has none.
 */
export function attachProvenance(_request: DesignChangeRequest, _input: CaseInput): DesignChangeRequest {
  throw notWired('provenance');
}

/** The request as `dcr import` writes it: extraction, then provenance once that stage is wired. */
export function runPipeline(input: CaseInput): DesignChangeRequest {
  const extracted = extract(input);
  return STAGES.provenance === 'ready' ? attachProvenance(extracted, input) : extracted;
}

/**
 * How a produced request is compared with `expected/dcr.json`: every byte once provenance
 * is wired; until then only the core (15 §4.9), which is all extraction produces.
 */
export const comparedBytes = (request: DesignChangeRequest): string =>
  STAGES.provenance === 'ready' ? requestBytes(request) : coreBytes(request);

/** `prompt.md` (15 §7). */
export function renderPrompt(_request: DesignChangeRequest): string {
  throw notWired('prompt');
}

/** One snippet golden (15 §7.3). */
export function renderSnippet(_input: SnippetCase): UsageSnippet {
  throw notWired('snippet');
}

/** The text of a `*.jsx-sketch` golden: import lines, a blank line, the sketch, a final newline. */
export function formatSketch(snippet: UsageSnippet): string {
  const imports = snippet.imports.length > 0 ? `${snippet.imports.join('\n')}\n\n` : '';
  return `${imports}${snippet.code}\n`;
}
