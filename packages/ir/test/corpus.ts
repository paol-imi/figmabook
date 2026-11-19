import { readdirSync, readFileSync } from 'node:fs';

/*
 * The schema corpus (BUILD B-01): `valid/<doc>/*.json` are complete documents;
 * `invalid/<doc>/*.json` and `invariants/<doc>/*.json` are JSON patches (RFC 6902 subset)
 * on a valid base, with the issues they must produce.
 */

export const DOCUMENTS = [
  'capture',
  'scene',
  'tokens',
  'bundle',
  'report',
  'apply-report',
  'provenance',
  'config',
  'params',
] as const;
export type DocumentName = (typeof DOCUMENTS)[number];

const root = new URL('./corpus/', import.meta.url);

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));
const list = (dir: string): string[] =>
  readdirSync(new URL(dir, root))
    .filter((name) => name.endsWith('.json'))
    .sort();

export function validDocs(doc: string): Array<[name: string, value: unknown]> {
  return list(`valid/${doc}/`).map((name) => [name, readJson(new URL(`valid/${doc}/${name}`, root))]);
}

export function validDoc(doc: string, name: string): unknown {
  return readJson(new URL(`valid/${doc}/${name}`, root));
}

export type PatchOp =
  | { readonly op: 'replace' | 'add'; readonly path: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: string };

interface PatchCase<E> {
  readonly base: string;
  readonly patch: readonly PatchOp[];
  readonly expect: readonly E[];
  readonly why?: string;
  readonly tokens?: string;
}

export type InvalidCase = PatchCase<{ readonly path: string; readonly kind: 'invalid' | 'unknown-key' }>;
export type InvariantCase = PatchCase<string>;

export function cases<C>(kind: 'invalid' | 'invariants', doc: string): Array<[name: string, value: C]> {
  let names: string[];
  try {
    names = list(`${kind}/${doc}/`);
  } catch {
    return [];
  }
  return names.map((name) => [name, readJson(new URL(`${kind}/${doc}/${name}`, root)) as C]);
}

/** The base document with the case's patch applied. */
export function patched(doc: string, testCase: PatchCase<unknown>): unknown {
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
