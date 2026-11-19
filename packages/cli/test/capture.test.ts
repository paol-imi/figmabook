import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateBundleManifest } from '@holotype/ir';
import { createDiagnostic, diagnostic } from '@holotype/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkStories,
  ExitCode,
  makeRunId,
  redactSource,
  resolveMapperSettings,
  resolveSource,
  runCapture,
  storybookLinks,
  unzipBundle,
} from '../src';
import { fakeDeps, GOLDEN_STORIES } from './support';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'holotype-capture-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const options = (patch: Partial<Parameters<typeof runCapture>[0]> = {}) => ({
  cwd,
  storybook: 'storybook-static',
  stories: [...GOLDEN_STORIES],
  ...patch,
});

describe('runCapture', () => {
  it('captures, maps and writes a bundle (exit 0)', async () => {
    const closed: string[] = [];
    const result = await runCapture(options({ out: 'smoke.holotype.zip' }), fakeDeps({ closed }));
    expect(result.exitCode).toBe(ExitCode.Ok);
    expect(closed).toEqual(['capturer', 'storybook']);
    expect(result.bundle).toEqual({ path: join(cwd, 'smoke.holotype.zip'), kind: 'zip', bytes: expect.any(Number) });
    const files = unzipBundle(new Uint8Array(await readFile(join(cwd, 'smoke.holotype.zip'))));
    expect(Object.keys(files)).toEqual([
      'manifest.json',
      'components/components-badge.json',
      'components/micro-flex.json',
      'report.json',
    ]);
    const manifest = validateBundleManifest(JSON.parse(new TextDecoder().decode(files['manifest.json'])));
    if (!manifest.ok) throw new Error('invalid manifest');
    expect(manifest.value.runId).toMatch(/^20261119T100000Z-[0-9a-f]{8}$/);
    expect(manifest.value).toMatchObject({
      createdAt: '2026-11-19T10:00:00Z',
      source: { origin: 'static:storybook-static', storybookVersion: '10.6.7', renderer: '@storybook/react' },
      generator: { name: '@holotype/cli', chromium: '153.0.8010.12' },
    });
    expect(result.report.run).toMatchObject({ command: 'capture', exitCode: 0, id: manifest.value.runId });
    expect(result.report.totals).toEqual({
      components: 2,
      ok: 2,
      failed: 0,
      variants: 2,
      nodes: 6,
      autoLayoutCoverage: 0,
    });
    expect(result.report.output).toEqual({
      path: join(cwd, 'smoke.holotype.zip'),
      kind: 'zip',
      bytes: result.bundle?.bytes,
    });
    expect(result.report.bundle?.kind).toBe('holotype/report');
  });

  it('gives the same bundle bytes for the same input', async () => {
    const a = await runCapture(options({ out: 'a.holotype.zip' }), fakeDeps());
    const b = await runCapture(options({ out: 'b.holotype.zip' }), fakeDeps());
    expect(a.bundle && b.bundle).toBeTruthy();
    expect(await readFile(join(cwd, 'a.holotype.zip'))).toEqual(await readFile(join(cwd, 'b.holotype.zip')));
  });

  it('writes to <output.dir>/<runId>.holotype.zip by default', async () => {
    await writeFile(
      join(cwd, 'holotype.config.json'),
      JSON.stringify({ storybook: { source: 'sb' }, output: { dir: 'out' } }),
    );
    const result = await runCapture({ cwd, stories: ['micro-flex--row'] }, fakeDeps());
    expect(result.bundle?.path).toBe(join(cwd, 'out', `${result.report.run.id}.holotype.zip`));
    expect(result.report.run.storybook?.source).toBe('static:sb');
  });

  it('builds the other components when a story is missing (exit 1)', async () => {
    const result = await runCapture(
      options({ stories: ['micro-flex--row', 'components-nope--x'], out: 'o.holotype.zip' }),
      fakeDeps(),
    );
    expect(result.exitCode).toBe(ExitCode.Errors);
    expect(result.report.components.map((c) => [c.sid, c.status])).toEqual([
      ['micro-flex', 'ok'],
      ['components-nope', 'failed'],
    ]);
    expect(result.report.components[1]?.diagnostics[0]).toMatchObject({
      code: 'SB_STORY_MISSING',
      sid: 'components-nope',
    });
    expect(result.report.bundle?.components.find((c) => c.sid === 'components-nope')?.skipped).toEqual({
      reason: 'the story could not be planned',
    });
    expect(result.bundle).toBeDefined();
  });

  it('writes nothing when no component could be built (exit 1)', async () => {
    const result = await runCapture(options({ out: 'o.holotype.zip' }), fakeDeps({ failing: [...GOLDEN_STORIES] }));
    expect(result.exitCode).toBe(ExitCode.Errors);
    expect(result.bundle).toBeUndefined();
    expect(result.report.output).toBeUndefined();
    expect(result.report.totals).toMatchObject({ components: 2, ok: 0, failed: 2 });
    expect(result.report.diagnosticsByCode).toEqual({ SB_STORY_ERROR: 2 });
  });

  it('stops with exit 2 on bad --story values, before connecting', async () => {
    const result = await runCapture(options({ stories: [] }), fakeDeps({ throws: new Error('not reached') }));
    expect(result.exitCode).toBe(ExitCode.Usage);
    expect(result.report.diagnostics[0]?.code).toBe('PLAN_CONFIG_INVALID');
  });

  it('stops with exit 2 on an invalid config', async () => {
    await writeFile(
      join(cwd, 'holotype.config.json'),
      JSON.stringify({ storybook: { source: 'sb' }, capture: { dpr: 7 } }),
    );
    const result = await runCapture(options(), fakeDeps());
    expect(result.exitCode).toBe(ExitCode.Usage);
    expect(result.report.diagnosticsByCode).toEqual({ PLAN_CONFIG_INVALID: 1 });
  });

  it('stops with exit 3 when the Storybook cannot be reached', async () => {
    const unreachable = createDiagnostic(diagnostic('SB_INDEX_UNREACHABLE'), { url: '/nope' }, { severity: 'fatal' });
    const result = await runCapture(options(), fakeDeps({ connectError: unreachable }));
    expect(result.exitCode).toBe(ExitCode.StorybookUnreachable);
    expect(result.report.diagnostics).toEqual([unreachable]);
    expect(result.report.run.storybook).toBeUndefined();
  });

  it('stops with exit 4 when the browser fails, and still closes everything', async () => {
    const closed: string[] = [];
    const result = await runCapture(
      options(),
      fakeDeps({ throws: new Error('Executable does not exist\nmore'), closed }),
    );
    expect(result.exitCode).toBe(ExitCode.Browser);
    expect(result.report.failure?.message).toBe('The browser could not capture: Executable does not exist');
    expect(closed).toEqual(['capturer', 'storybook']);
  });

  it('stops with exit 130 when interrupted, writing nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runCapture(options({ signal: controller.signal, out: 'o.holotype.zip' }), fakeDeps());
    expect(result.exitCode).toBe(ExitCode.Interrupted);
    expect(result.bundle).toBeUndefined();
  });

  it('reports progress', async () => {
    const events: string[] = [];
    await runCapture(
      options({
        out: 'o.holotype.zip',
        onProgress: (e) => events.push(e.kind === 'connected' ? `connected ${e.stories}` : `${e.storyId} ${e.ok}`),
      }),
      fakeDeps({ failing: ['components-badge--default'] }),
    );
    expect(events).toEqual(['connected 2', 'micro-flex--row true', 'components-badge--default false']);
  });
});

describe('capture helpers', () => {
  it('checks --story values', () => {
    expect(checkStories(['micro-flex--row'])).toEqual([]);
    expect(checkStories(['nope', 'a--b', 'a--b', 'a--c']).map((d) => d.message)).toEqual([
      'Invalid config value at --story: "nope" is not a story id (expected <component>--<story>).',
      'Invalid config value at --story: "a--b" is given twice.',
      'Invalid config value at --story: "a--b" and "a--c" are stories of one component; capture one story per component for now.',
    ]);
  });

  it('makes sortable, stable run ids', () => {
    const at = new Date('2026-11-19T10:15:00.123Z');
    expect(makeRunId(at, ['a--b'])).toMatch(/^20261119T101500Z-[0-9a-f]{8}$/);
    expect(makeRunId(at, ['a--b'])).toBe(makeRunId(at, ['a--b']));
    expect(makeRunId(at, ['a--b'])).not.toBe(makeRunId(at, ['a--c']));
  });

  it('resolves and redacts sources', () => {
    expect(resolveSource('sb', '/work')).toEqual({ kind: 'static', dir: '/work/sb' });
    expect(resolveSource('https://user:pw@sb.example.com/ui/?path=/story/x', '/work')).toEqual({
      kind: 'url',
      url: 'https://user:pw@sb.example.com/ui/?path=/story/x',
    });
    expect(redactSource({ kind: 'static', dir: '/home/someone/project/storybook-static' })).toBe(
      'static:storybook-static',
    );
    expect(redactSource({ kind: 'url', url: 'https://user:pw@sb.example.com/ui/?token=1#x' })).toBe(
      'https://sb.example.com/ui/',
    );
    expect(redactSource({ kind: 'url', url: 'not a url' })).toBe('url:invalid');
  });

  it('links to the story only for a Storybook others can open', () => {
    expect(storybookLinks({ kind: 'static', dir: '/sb' }, 'http://127.0.0.1:5000/', 'a--b')).toEqual([]);
    expect(storybookLinks({ kind: 'url', url: 'https://sb.example.com/' }, 'https://sb.example.com/', 'a--b')).toEqual([
      { label: 'Storybook', url: 'https://sb.example.com/?path=/story/a--b' },
    ]);
  });

  it('applies the mapper namespaces of the config', () => {
    const settings = resolveMapperSettings({
      storybook: { source: 'sb' },
      mapper: { exactRadii: true },
      layout: { tolerancePx: 1, textWrap: 'locked-lines' },
      figma: { grid: { gap: 8 } },
      tokens: { bindByValue: true },
    });
    expect(settings.mapper.exactRadii).toBe(true);
    expect(settings.mapper.alignment).toEqual({ maxPlaceholdersRatio: 0.5 });
    expect(settings.layout.tolerancePx).toBe(1);
    expect(settings.grid).toEqual({ maxColumns: 8, gap: 8, padding: 32 });
    expect(settings.textMode).toBe('locked-lines');
    expect(settings.bindByValue).toBe(true);
    expect(
      resolveMapperSettings({
        storybook: { source: 'sb' },
        defaults: { textMode: 'reflow' },
        layout: { textWrap: 'locked-lines' },
      }).textMode,
    ).toBe('reflow');
  });
});
