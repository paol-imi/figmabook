import { readdirSync, readFileSync } from 'node:fs';
import type { ValidationIssue, Validator } from '@holotype/ir';
import {
  validateBaselineSnapshot,
  validateDcr,
  validateDcrAnswers,
  validateDcrDecisions,
  validateFigmaSnapshot,
} from '../src';

/*
 * The DCR schema corpus (B-64): `valid/<doc>/*.json` are complete documents;
 * `invalid/<doc>/*.json` and `integrity/<doc>/*.json` are JSON patches (RFC 6902 subset)
 * on a valid base, with the issues they must produce.
 */

export const DOCUMENTS = {
  dcr: { validate: validateDcr, schemaFile: 'dcr.v1.json' },
  'figma-snapshot': { validate: validateFigmaSnapshot, schemaFile: 'figma-snapshot.v1.json' },
  baseline: { validate: validateBaselineSnapshot, schemaFile: 'baseline.v1.json' },
  answers: { validate: validateDcrAnswers, schemaFile: 'answers.v1.json' },
  decisions: { validate: validateDcrDecisions, schemaFile: 'decisions.v1.json' },
} as const satisfies Record<string, { validate: Validator<unknown>; schemaFile: string }>;
export type DocumentName = keyof typeof DOCUMENTS;

const root = new URL('./corpus/', import.meta.url);

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));
const list = (dir: string): string[] => {
  try {
    return readdirSync(new URL(dir, root))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
};

export function validDocs(doc: DocumentName): Array<[name: string, value: unknown]> {
  return list(`valid/${doc}/`).map((name) => [name, readJson(new URL(`valid/${doc}/${name}`, root))]);
}

export function validDoc(doc: DocumentName, name: string): unknown {
  return readJson(new URL(`valid/${doc}/${name}`, root));
}

export type PatchOp =
  | { readonly op: 'replace' | 'add'; readonly path: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: string };

interface PatchCase<E> {
  readonly base: string;
  readonly why: string;
  readonly patch: readonly PatchOp[];
  readonly expect: readonly E[];
}

export type InvalidCase = PatchCase<Pick<ValidationIssue, 'path' | 'kind'>>;
/** Expected issue paths of `checkDcrIntegrity`. */
export type IntegrityCase = PatchCase<string>;

export function cases<C>(kind: 'invalid' | 'integrity', doc: DocumentName): Array<[name: string, value: C]> {
  return list(`${kind}/${doc}/`).map((name) => [name, readJson(new URL(`${kind}/${doc}/${name}`, root)) as C]);
}

/** The base document with the case's patch applied. */
export function patched(doc: DocumentName, testCase: PatchCase<unknown>): unknown {
  let value = structuredClone(validDoc(doc, testCase.base));
  for (const op of testCase.patch) value = applyOp(value, op);
  return value;
}

const decode = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~');

function applyOp(document: unknown, op: PatchOp): unknown {
  const segments = op.path.split('/').slice(1).map(decode);
  const key = segments.pop();
  if (key === undefined) throw new Error(`Patch path "${op.path}" has no target.`);
  let parent: unknown = document;
  for (const segment of segments) {
    parent = (parent as Record<string, unknown>)[segment];
    if (parent === null || typeof parent !== 'object') throw new Error(`Patch path "${op.path}" does not exist.`);
  }
  if (op.op !== 'add' && !(key in (parent as object))) throw new Error(`Patch path "${op.path}" does not exist.`);
  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    if (op.op === 'remove') parent.splice(index, 1);
    else parent.splice(index, op.op === 'add' ? 0 : 1, op.value);
  } else {
    const record = parent as Record<string, unknown>;
    if (op.op === 'remove') delete record[key];
    else record[key] = op.value;
  }
  return document;
}
