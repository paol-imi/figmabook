import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadComponentsManifest,
  packageFromImports,
  packageOf,
  parseComponentsManifest,
  startStaticServer,
} from '../src';
import { readFixtureJson } from './support';

describe('parseComponentsManifest (SB 10 manifests/components.json)', () => {
  it('reads export names and packages from the recorded fixture manifest', () => {
    const manifest = parseComponentsManifest(readFixtureJson('sb10-manifest', 'components.json'));
    expect(manifest).toBeDefined();
    expect(Object.fromEntries(manifest ?? [])).toEqual({
      'components-badge': { id: 'components-badge', exportName: 'Badge', package: '@holotype/fixture-ds-react' },
      'components-button': { id: 'components-button', exportName: 'Button', package: '@holotype/fixture-ds-react' },
      'components-card': { id: 'components-card', exportName: 'Card', package: '@holotype/fixture-ds-react' },
      'components-icon': { id: 'components-icon', exportName: 'Icon', package: '@holotype/fixture-ds-react' },
      'components-input': { id: 'components-input', exportName: 'Input', package: '@holotype/fixture-ds-react' },
      'components-stack': { id: 'components-stack', exportName: 'Stack', package: '@holotype/fixture-ds-react' },
      // No `meta.component`: the manifest has an error entry and nothing to read.
      'micro-backgrounds': { id: 'micro-backgrounds' },
      'micro-borders': { id: 'micro-borders' },
      'micro-flex': { id: 'micro-flex' },
      'micro-text': { id: 'micro-text' },
    });
  });

  it('rejects unknown shapes', () => {
    expect(parseComponentsManifest(null)).toBeUndefined();
    expect(parseComponentsManifest({ v: 0 })).toBeUndefined();
    expect(parseComponentsManifest({ components: { a: 'nope' } })).toBeUndefined();
  });
});

describe('import snippets', () => {
  it('finds the package a name is imported from', () => {
    const snippet = 'import { Badge, Stack as S } from \'@acme/ui/badge\';\nimport { Button } from "../local";';
    expect(packageFromImports(snippet, 'Badge')).toBe('@acme/ui');
    expect(packageFromImports(snippet, 'Stack')).toBe('@acme/ui');
    expect(packageFromImports(snippet, 'Button')).toBeUndefined();
    expect(packageFromImports(snippet, 'Card')).toBeUndefined();
  });

  it('reduces a specifier to its package', () => {
    expect(packageOf('@scope/name/sub/path')).toBe('@scope/name');
    expect(packageOf('lodash/fp')).toBe('lodash');
    expect(packageOf('./x')).toBeUndefined();
    expect(packageOf('/abs')).toBeUndefined();
    expect(packageOf('node:fs')).toBeUndefined();
  });
});

describe('loadComponentsManifest', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function serve(body: string | undefined) {
    dir = await mkdtemp(join(tmpdir(), 'holotype-manifest-'));
    if (body !== undefined) {
      await mkdir(join(dir, 'manifests'));
      await writeFile(join(dir, 'manifests', 'components.json'), body);
    }
    return startStaticServer(dir);
  }

  it('gives nothing for a build without a manifest', async () => {
    const server = await serve(undefined);
    try {
      expect(await loadComponentsManifest(server.url, 2000)).toEqual({ diagnostics: [] });
    } finally {
      await server.close();
    }
  });

  it('reports SB_MANIFEST_UNPARSEABLE for JSON of an unknown shape', async () => {
    const server = await serve('{"components": []}');
    try {
      const loaded = await loadComponentsManifest(server.url, 2000);
      expect(loaded.manifest).toBeUndefined();
      expect(loaded.diagnostics).toEqual([
        expect.objectContaining({ code: 'SB_MANIFEST_UNPARSEABLE', severity: 'info', fallback: 'in-page docgen' }),
      ]);
    } finally {
      await server.close();
    }
  });

  it('reads a manifest', async () => {
    const server = await serve(JSON.stringify(readFixtureJson('sb10-manifest', 'components.json')));
    try {
      const loaded = await loadComponentsManifest(server.url, 2000);
      expect(loaded.manifest?.get('components-card')).toEqual({
        id: 'components-card',
        exportName: 'Card',
        package: '@holotype/fixture-ds-react',
      });
      expect(loaded.diagnostics).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
