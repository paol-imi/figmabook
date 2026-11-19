import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkManifestInvariants,
  checkSceneHashes,
  sha256Hex,
  validateBundleManifest,
  validateBundleReport,
  validateSceneComponent,
} from '@holotype/ir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipBundle } from '../../src/bundle';
import { type FixtureBuild, fixtureStorybook, holotype } from './support';

/*
 * B-13 acceptance: the built `holotype capture` against the fixture Storybook in headless
 * Chromium. Capture `micro-flex--row` to a zip, unzip it, validate the manifest and the
 * scene, check the integrity block, snapshot `--json`, and exit 3 for a missing Storybook.
 */

let storybook: FixtureBuild;
let work: string;
const EPOCH = { SOURCE_DATE_EPOCH: '1763546400' };

beforeAll(async () => {
  storybook = await fixtureStorybook();
  work = await mkdtemp(join(tmpdir(), 'holotype-cli-e2e-'));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
  await storybook?.close();
});

const decoder = new TextDecoder();
const json = (bytes: Uint8Array | undefined): unknown => JSON.parse(decoder.decode(bytes));

/** The `--json` document with what differs between machines and runs replaced. */
function stableReport(stdout: string): unknown {
  const volatile = new Set(['durationMs', 'startedAt', 'capture', 'map', 'chromium', 'path']);
  return JSON.parse(stdout, (key, value: unknown) => {
    if (volatile.has(key) && (typeof value === 'number' || typeof value === 'string')) return `<${key}>`;
    if (key === 'source' && typeof value === 'string') return value.replace(/^static:.*/, 'static:<dir>');
    return value;
  });
}

describe('holotype capture (B-13)', () => {
  it('captures micro-flex--row into a bundle that validates', async () => {
    const out = join(work, 'flex.holotype.zip');
    const result = await holotype(
      ['capture', '--storybook', storybook.dir, '--story', 'micro-flex--row', '--out', out],
      {
        cwd: work,
        env: EPOCH,
      },
    );
    expect(result.stderr).toContain('✔ micro-flex--row');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('  ✔ micro-flex  1 variant  0 props  0 warn');
    expect(result.stdout).toContain(
      'Next: in Figma, run Plugins ▸ Development ▸ Holotype, open Import file and pick flex.holotype.zip.',
    );

    const files = unzipBundle(new Uint8Array(await readFile(out)));
    expect(Object.keys(files)).toEqual(['manifest.json', 'components/micro-flex.json', 'report.json']);
    const manifest = validateBundleManifest(json(files['manifest.json']));
    if (!manifest.ok) throw new Error(JSON.stringify(manifest.error));
    expect(checkManifestInvariants(manifest.value)).toEqual([]);
    expect(manifest.value).toMatchObject({
      kind: 'holotype/bundle',
      createdAt: '2025-11-19T10:00:00Z',
      features: [],
      source: { storybookVersion: '10.6.7', renderer: '@storybook/react', builder: 'vite' },
      totals: { components: 1, variants: 1, nodes: 4, assetBytes: 0 },
    });
    for (const [path, sha] of Object.entries(manifest.value.integrity.files)) {
      expect(sha256Hex(files[path] ?? new Uint8Array()), path).toBe(sha);
    }
    const scene = validateSceneComponent(json(files['components/micro-flex.json']));
    if (!scene.ok) throw new Error(JSON.stringify(scene.error));
    expect(checkSceneHashes(scene.value)).toEqual([]);
    expect(scene.value.irh).toBe(manifest.value.components[0]?.irh);
    expect(scene.value.variants[0]?.root.children).toHaveLength(3);
    expect(validateBundleReport(json(files['report.json'])).ok).toBe(true);
  });

  it('writes the same bytes on a second run', async () => {
    const runs = ['a', 'b'].map((name) => join(work, `${name}.holotype.zip`));
    for (const out of runs) {
      const result = await holotype(
        ['capture', '--storybook', storybook.dir, '--story', 'micro-flex--row', '--out', out],
        {
          cwd: work,
          env: EPOCH,
        },
      );
      expect(result.code).toBe(0);
    }
    const [a, b] = await Promise.all(runs.map((out) => readFile(out)));
    expect(sha256Hex(new Uint8Array(b ?? []))).toBe(sha256Hex(new Uint8Array(a ?? [])));
  });

  it('prints one RunReport with --json', async () => {
    const result = await holotype(
      [
        'capture',
        '--storybook',
        storybook.dir,
        '--story',
        'micro-flex--row',
        '--out',
        join(work, 'json.holotype.zip'),
        '--json',
      ],
      { cwd: work, env: EPOCH },
    );
    expect(result.code).toBe(0);
    expect(stableReport(result.stdout)).toMatchSnapshot();
  });

  it('exits 3 when the Storybook folder does not exist', async () => {
    const missing = join(work, 'no-such-storybook');
    const human = await holotype(['capture', '--storybook', missing, '--story', 'micro-flex--row'], { cwd: work });
    expect(human.code).toBe(3);
    expect(human.stdout).toContain('✖ SB_INDEX_UNREACHABLE');
    expect(human.stdout).toContain('Help: docs/diagnostics/SB_INDEX_UNREACHABLE.md');
    const machine = await holotype(['capture', '--storybook', missing, '--story', 'micro-flex--row', '--json'], {
      cwd: work,
    });
    expect(machine.code).toBe(3);
    expect(JSON.parse(machine.stdout)).toMatchObject({
      run: { exitCode: 3 },
      diagnostics: [
        {
          code: 'SB_INDEX_UNREACHABLE',
          severity: 'fatal',
          data: { reason: 'the static build directory does not exist' },
        },
      ],
    });
  });

  it('exits 2 for a flag error', async () => {
    const result = await holotype(['capture', '--storybook', storybook.dir], { cwd: work });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('PLAN_CONFIG_INVALID');
  });
});
