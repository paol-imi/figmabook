import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { canonicalDcr, checkDcrIntegrity, type DesignChangeRequest, dcrJsonSchemaFiles, validateDcr } from '../src';
import {
  cases,
  DOCUMENTS,
  type DocumentName,
  type IntegrityCase,
  type InvalidCase,
  patched,
  validDocs,
} from './corpus';

const NAMES = Object.keys(DOCUMENTS) as DocumentName[];

describe.each(NAMES)('%s corpus', (doc) => {
  const { validate } = DOCUMENTS[doc];

  it('has valid and invalid documents', () => {
    expect(validDocs(doc).length).toBeGreaterThan(0);
    expect(cases('invalid', doc).length).toBeGreaterThan(0);
  });

  it.each(validDocs(doc))('accepts valid/%s', (_name, value) => {
    const result = validate(value);
    expect(result.ok ? [] : result.error).toEqual([]);
  });

  it.each(validDocs(doc))('round-trips valid/%s through canonical JSON', (_name, value) => {
    const canonical = canonicalDcr(value);
    const parsed: unknown = JSON.parse(canonical);
    expect(validate(parsed).ok).toBe(true);
    expect(canonicalDcr(parsed)).toBe(canonical);
  });

  it.each(cases<InvalidCase>('invalid', doc))('rejects invalid/%s', (_name, testCase) => {
    const result = validate(patched(doc, testCase));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const expected of testCase.expect) {
      const hit = result.error.find((issue) => issue.path.startsWith(expected.path) && issue.kind === expected.kind);
      expect(hit, `${expected.kind} at ${expected.path} in ${JSON.stringify(result.error)}`).toBeDefined();
    }
  });
});

describe('DCR integrity (15 §4.9)', () => {
  it.each(validDocs('dcr'))('valid/%s is consistent: ids, hash, references, summary, order', (_name, value) => {
    expect(checkDcrIntegrity(value as DesignChangeRequest)).toEqual([]);
  });

  it.each(cases<IntegrityCase>('integrity', 'dcr'))('integrity/%s', (_name, testCase) => {
    const dcr = patched('dcr', testCase);
    const shape = validateDcr(dcr);
    expect(shape.ok ? [] : shape.error, 'integrity cases are schema-valid').toEqual([]);
    const paths = checkDcrIntegrity(dcr as DesignChangeRequest).map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining([...testCase.expect]));
  });

  it('DCR documents are open: unknown fields are ignored within the major (06 §7)', () => {
    const [, value] = validDocs('dcr')[0] ?? [];
    const dcr = structuredClone(value) as Record<string, unknown> & { items: Array<Record<string, unknown>> };
    dcr.addedInAMinor = true;
    const first = dcr.items[0];
    if (first) first.futureField = { any: 'thing' };
    expect(validateDcr(dcr).ok).toBe(true);
  });
});

describe('published JSON Schema files (D-07)', () => {
  const files = dcrJsonSchemaFiles();

  it('committed schema/*.json match the TypeBox sources (run `pnpm -F @holotype/dcr build` to regenerate)', () => {
    const dir = new URL('../schema/', import.meta.url);
    expect(readdirSync(dir).sort()).toEqual(Object.keys(files).sort());
    for (const [name, contents] of Object.entries(files)) {
      expect(readFileSync(new URL(name, dir), 'utf8'), name).toBe(contents);
    }
  });

  it('publishes one file per document, named by major', () => {
    expect(Object.keys(files).sort()).toEqual([
      'answers.v1.json',
      'baseline.v1.json',
      'dcr.v1.json',
      'decisions.v1.json',
      'figma-snapshot.v1.json',
    ]);
  });

  it('embeds the recursive UsageNode under $defs', () => {
    const dcr = JSON.parse(files['dcr.v1.json'] ?? '{}');
    expect(dcr.$defs.UsageNode.$id).toBe('UsageNode');
    expect(dcr.title).toBe('Holotype Design Change Request (DesignChangeRequest)');
  });

  const ajv = new Ajv2020({ strict: false, allErrors: true });
  it.each(NAMES)('%s: JSON Schema accepts and rejects the same corpus as the validator', (doc) => {
    const contents = files[DOCUMENTS[doc].schemaFile];
    if (contents === undefined) throw new Error(`${DOCUMENTS[doc].schemaFile} is not published.`);
    const check = ajv.compile(JSON.parse(contents));
    for (const [name, value] of validDocs(doc)) expect(check(value), `valid/${name}`).toBe(true);
    for (const [name, testCase] of cases<InvalidCase>('invalid', doc)) {
      expect(check(patched(doc, testCase)), `invalid/${name}`).toBe(false);
    }
  });
});
