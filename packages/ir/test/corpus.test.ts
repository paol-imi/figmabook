import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  type BundleManifest,
  type CanonicalOptions,
  canonicalJSON,
  captureNumKind,
  checkManifestInvariants,
  checkSceneHashes,
  checkSceneInvariants,
  jsonSchemaFiles,
  type SceneComponent,
  sceneNumKind,
  type TokensDoc,
  tokensIrh,
  type Validator,
  validateApplyReport,
  validateBundleManifest,
  validateBundleReport,
  validateCaptureDoc,
  validateHolotypeConfig,
  validateHolotypeParams,
  validateProvenanceDoc,
  validateSceneComponent,
  validateTokensDoc,
} from '../src';
import {
  cases,
  DOCUMENTS,
  type DocumentName,
  type InvalidCase,
  type InvariantCase,
  patched,
  validDoc,
  validDocs,
} from './corpus';

const VALIDATORS: Record<DocumentName, Validator<unknown>> = {
  capture: validateCaptureDoc,
  scene: validateSceneComponent,
  tokens: validateTokensDoc,
  bundle: validateBundleManifest,
  report: validateBundleReport,
  'apply-report': validateApplyReport,
  provenance: validateProvenanceDoc,
  config: validateHolotypeConfig,
  params: validateHolotypeParams,
};

const CANONICAL: Record<DocumentName, CanonicalOptions> = {
  capture: { numKind: captureNumKind },
  scene: { numKind: sceneNumKind },
  tokens: { numKind: sceneNumKind },
  bundle: { numKind: sceneNumKind },
  report: { numKind: sceneNumKind },
  'apply-report': {},
  provenance: {},
  config: {},
  params: {},
};

/** The published JSON Schema file of each document, when it has one. */
const PUBLISHED: Partial<Record<DocumentName, string>> = {
  capture: 'capture.v0.json',
  scene: 'scene.v0.json',
  tokens: 'tokens.v0.json',
  bundle: 'bundle.v0.json',
  report: 'report.v0.json',
  provenance: 'provenance.v1.json',
  config: 'config.v0.json',
};

describe.each(DOCUMENTS)('%s corpus', (doc) => {
  const validate = VALIDATORS[doc];

  it('has valid and invalid documents', () => {
    expect(validDocs(doc).length).toBeGreaterThan(0);
    expect(cases('invalid', doc).length).toBeGreaterThan(0);
  });

  it.each(validDocs(doc))('accepts valid/%s', (_name, value) => {
    const result = validate(value);
    expect(result.ok ? [] : result.error).toEqual([]);
  });

  it.each(validDocs(doc))('round-trips valid/%s through canonical JSON', (_name, value) => {
    const canonical = canonicalJSON(value, CANONICAL[doc]);
    const parsed: unknown = JSON.parse(canonical);
    expect(validate(parsed).ok).toBe(true);
    expect(canonicalJSON(parsed, CANONICAL[doc])).toBe(canonical);
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

describe('IR documents are open, configuration is strict (06 §7, 16 §2)', () => {
  it('ignores unknown fields in IR documents at any depth', () => {
    const scene = structuredClone(validDoc('scene', 'button.json')) as Record<string, unknown> & {
      variants: Array<{ root: Record<string, unknown> }>;
    };
    scene.addedInAMinor = true;
    const variant = scene.variants[0];
    if (variant) variant.root.futureField = { any: 'thing' };
    expect(validateSceneComponent(scene).ok).toBe(true);
    expect(validateBundleManifest({ ...(validDoc('bundle', 'button.json') as object), extra: 1 }).ok).toBe(true);
  });

  it('reports unknown config keys as `unknown-key` with a pointer', () => {
    const result = validateHolotypeConfig({ storybook: { source: 'x', sourc: 'y' } });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toEqual([{ path: '/storybook/sourc', kind: 'unknown-key', message: 'Unknown key "sourc"' }]);
  });
});

describe('published JSON Schema files accept and reject the same corpus', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const files = jsonSchemaFiles();

  it.each(Object.entries(PUBLISHED))('%s', (doc, file) => {
    const contents = files[file];
    if (contents === undefined) throw new Error(`${file} is not published.`);
    const check = ajv.compile(JSON.parse(contents));
    for (const [name, value] of validDocs(doc)) expect(check(value), `valid/${name}`).toBe(true);
    for (const [name, testCase] of cases<InvalidCase>('invalid', doc)) {
      expect(check(patched(doc, testCase)), `invalid/${name}`).toBe(false);
    }
  });

  it('JSON config patterns are "/pattern/flags" strings and TS-only function keys are not published', () => {
    const config = JSON.parse(files['config.v0.json'] ?? '{}');
    const tokens = config.properties.tokens.properties;
    expect(tokens.rename).toBeUndefined();
    expect(tokens.cssName).toBeUndefined();
    expect(tokens.ignore.items).toMatchObject({ type: 'string' });
  });
});

describe('semantic invariants (06 §9)', () => {
  const tokens = validDoc('tokens', 'ds-react.json') as TokensDoc;

  it.each(validDocs('scene'))('valid/%s has none', (_name, value) => {
    expect(checkSceneInvariants(value as SceneComponent)).toEqual([]);
  });

  it('the Button binds only variables of the ds-react tokens', () => {
    expect(checkSceneInvariants(validDoc('scene', 'button.json') as SceneComponent, { tokens })).toEqual([]);
  });

  it.each(validDocs('bundle'))('valid bundle/%s has none', (_name, value) => {
    expect(checkManifestInvariants(value as BundleManifest)).toEqual([]);
  });

  it.each(cases<InvariantCase>('invariants', 'scene'))('scene/%s', (_name, testCase) => {
    const scene = patched('scene', testCase) as SceneComponent;
    expect(validateSceneComponent(scene).ok).toBe(true);
    const options = testCase.tokens ? { tokens: validDoc('tokens', testCase.tokens) as TokensDoc } : {};
    const found = checkSceneInvariants(scene, options).map((violation) => violation.invariant);
    expect(found).toEqual(expect.arrayContaining([...testCase.expect]));
  });

  it.each(cases<InvariantCase>('invariants', 'bundle'))('bundle/%s', (_name, testCase) => {
    const manifest = patched('bundle', testCase) as BundleManifest;
    expect(validateBundleManifest(manifest).ok).toBe(true);
    const found = checkManifestInvariants(manifest).map((violation) => violation.invariant);
    expect(found).toEqual(expect.arrayContaining([...testCase.expect]));
  });
});

describe('corpus hashes are consistent (06 §6)', () => {
  it.each(validDocs('scene'))('scene/%s', (_name, value) => {
    expect(checkSceneHashes(value as SceneComponent)).toEqual([]);
  });

  it.each(validDocs('tokens'))('tokens/%s', (_name, value) => {
    const doc = value as TokensDoc;
    expect(tokensIrh(doc)).toBe(doc.irh);
  });
});
