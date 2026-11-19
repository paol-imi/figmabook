import { readdirSync, readFileSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import {
  checkVersion,
  createValidator,
  type HolotypeConfig,
  jsonSchemaFiles,
  migrateScene,
  PUBLISHED_SCHEMAS,
  type SceneMigration,
  toJsonSchema,
  validateBundleManifest,
  validateHolotypeConfig,
  validateHolotypeParams,
  validateSceneComponent,
} from '../src';
import { validDoc } from './corpus';

describe('validators', () => {
  it('explain union failures by the member the value was meant to be', () => {
    const scene = structuredClone(validDoc('scene', 'button.json')) as {
      variants: Array<{ root: { fills: Array<Record<string, unknown>> } }>;
    };
    const fill = scene.variants[0]?.root.fills[0];
    if (fill) fill.opacity = 2;
    const result = validateSceneComponent(scene);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual([
        {
          path: '/variants/0/root/fills/0/opacity',
          kind: 'invalid',
          message: 'Expected number to be less or equal to 1',
        },
      ]);
    }
  });

  it('list the allowed values of an enum', () => {
    const result = validateHolotypeParams({ strategy: 'stories-first' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]).toEqual({
        path: '/strategy',
        kind: 'invalid',
        message: 'Expected one of "auto", "stories", "args", "curated"',
      });
    }
  });

  it('cap the number of issues', () => {
    const validate = createValidator(Type.Array(Type.String()), { maxIssues: 3 });
    const result = validate([1, 2, 3, 4, 5]);
    expect(result.ok ? 0 : result.error.length).toBe(3);
  });

  it('decode JSON-pointer escapes in unknown-key messages', () => {
    const result = validateHolotypeParams({ 'a/b~c': 1 });
    expect(result.ok ? [] : result.error.map((issue) => issue.message)).toEqual(['Unknown key "a/b~c"']);
  });

  it('accept a TypeScript config with RegExp and function values (16 §1)', () => {
    const input = {
      storybook: { source: './storybook-static' },
      naming: { stripClassPatterns: [/^css-[a-z0-9]+$/, '/^sc-/'] },
      tokens: { ignore: [/^--_/i], rename: (css: string) => css.slice(2), cssName: (path: string[]) => path.join('-') },
      dcr: { content: { placeholders: [/^XX+$/] } },
    };
    const result = validateHolotypeConfig(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const config: HolotypeConfig = result.value;
    expect(config.naming?.stripClassPatterns).toEqual(['/^css-[a-z0-9]+$/', '/^sc-/']);
    expect(config.tokens?.ignore).toEqual(['/^--_/i']);
    expect(config.tokens?.rename?.('--color-bg')).toBe('color-bg');
    expect(input.naming.stripClassPatterns[0]).toBeInstanceOf(RegExp);
  });

  it('reject a non-function where a function is expected', () => {
    const result = validateHolotypeConfig({ storybook: { source: 'x' }, tokens: { rename: 'upper' } });
    expect(result.ok ? [] : result.error.map((issue) => issue.path)).toEqual(['/tokens/rename']);
  });

  it('report every unknown key, nested ones too', () => {
    const result = validateBundleManifest({});
    expect(result.ok).toBe(false);
    const params = validateHolotypeParams({ budget: { maxVariantsPerSet: 10 }, layout: {} });
    expect(params.ok ? [] : params.error.map(({ path, kind }) => `${kind} ${path}`).sort()).toEqual([
      'unknown-key /budget/maxVariantsPerSet',
      'unknown-key /layout',
    ]);
  });
});

describe('versions and migrations (06 §7)', () => {
  const scene = validDoc('scene', 'button.json') as Record<string, unknown>;

  it('migrateScene passes the current major through, ready for validation', () => {
    const migrated = migrateScene(scene);
    expect(migrated.ok && validateSceneComponent(migrated.value).ok).toBe(true);
  });

  it.each([{ ...scene, sceneVersion: '7.0.0' }, { ...scene, sceneVersion: 'latest' }, 'not a document', null])(
    'migrateScene rejects %j with APPLY_IR_VERSION_UNSUPPORTED',
    (input) => {
      const result = migrateScene(input);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error[0]).toMatchObject({ code: 'APPLY_IR_VERSION_UNSUPPORTED', severity: 'error' });
    },
  );

  it('migrateScene runs registered steps from an older major in order', () => {
    const steps = new Map<number, SceneMigration>([
      [0, (doc) => ({ ...doc, sceneVersion: '1.0.0', step0: true })],
      [1, (doc) => ({ ...doc, sceneVersion: '2.0.0', step1: true })],
    ]);
    const result = migrateScene({ ...scene, sceneVersion: '0.4.0' }, steps, [0, 1, 2]);
    expect(result.ok && result.value).toMatchObject({ sceneVersion: '2.0.0', step0: true, step1: true });
    expect(() => migrateScene({ ...scene, sceneVersion: '0.4.0' }, new Map(), [0, 1])).toThrow(
      /Missing Scene IR migration 0 → 1/,
    );
  });

  it('checkVersion accepts supported majors only', () => {
    expect(checkVersion('Bundle', '0.9.1', [0])).toBeUndefined();
    expect(checkVersion('Bundle', '1.0.0', [0])).toMatchObject({
      code: 'APPLY_IR_VERSION_UNSUPPORTED',
      message: expect.stringContaining('Bundle version 1.0.0'),
    });
    expect(checkVersion('Bundle', 3, [0])?.message).toContain('version unknown');
  });
});

describe('JSON Schema emission (06 §7)', () => {
  it('committed schema/*.json files match the TypeBox sources (run `pnpm build` to regenerate)', () => {
    const expected = jsonSchemaFiles();
    const dir = new URL('../schema/', import.meta.url);
    expect(readdirSync(dir).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, contents] of Object.entries(expected)) {
      expect(readFileSync(new URL(name, dir), 'utf8'), name).toBe(contents);
    }
  });

  it('publishes one file per document, named by major', () => {
    expect(Object.keys(jsonSchemaFiles()).sort()).toEqual([
      'bundle.v0.json',
      'capture.v0.json',
      'config.v0.json',
      'provenance.v1.json',
      'report.v0.json',
      'scene.v0.json',
      'tokens.v0.json',
    ]);
    expect(PUBLISHED_SCHEMAS.every(({ schema }) => typeof schema.title === 'string')).toBe(true);
  });

  it('writes tuples as draft 2020-12 prefixItems and drops function-typed properties', () => {
    const schema = Type.Object({
      point: Type.Tuple([Type.Number(), Type.Number()]),
      transform: Type.Function([Type.String()], Type.String()),
      name: Type.String(),
    });
    expect(toJsonSchema(schema)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['point', 'name'],
      properties: {
        point: {
          type: 'array',
          prefixItems: [{ type: 'number' }, { type: 'number' }],
          items: false,
          minItems: 2,
          maxItems: 2,
        },
        name: { type: 'string' },
      },
    });
    expect(() => toJsonSchema(Type.Function([], Type.Void()))).toThrow(/no JSON form/);
  });
});
