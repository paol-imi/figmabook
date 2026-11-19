import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiagnostic, diagnostic } from '@holotype/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { displayPath, ExitCode, formatBytes, formatDiagnostic, helpLink, main, run, sourceDateEpoch } from '../src';
import { fakeDeps, memoryIo } from './support';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'holotype-main-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const STORIES = ['--story', 'micro-flex--row', '--story', 'components-badge--default'];

/** A `--json` document with the run's volatile values (paths, clock) replaced. */
function stableJson(text: string): unknown {
  return JSON.parse(text.replaceAll(cwd, '<cwd>'), (key, value) =>
    key === 'durationMs' || key === 'capture' || key === 'map' ? 0 : value,
  );
}

describe('holotype', () => {
  it('prints help and the version', async () => {
    const help = memoryIo(cwd);
    expect(await main(['--help'], help.io)).toBe(ExitCode.Ok);
    expect(help.stdout()).toContain('capture');
    const none = memoryIo(cwd);
    expect(await main([], none.io)).toBe(ExitCode.Usage);
    const version = memoryIo(cwd);
    expect(await main(['--version'], version.io)).toBe(ExitCode.Ok);
    expect(version.stdout()).toBe('0.0.0\n');
    const captureHelp = memoryIo(cwd);
    expect(await main(['capture', '--help'], captureHelp.io)).toBe(ExitCode.Ok);
    expect(captureHelp.stdout()).toContain('--storybook');
  });

  it('rejects an unknown command with exit 2', async () => {
    const io = memoryIo(cwd);
    expect(await main(['captur'], io.io)).toBe(ExitCode.Usage);
    expect(io.stderr()).toContain('✖ Unknown command "captur".');
  });

  it('runs a command through run() for the Action', async () => {
    const io = memoryIo(cwd);
    expect(await run({ command: '--version', args: [] }, io.io)).toBe(ExitCode.Ok);
  });
});

describe('holotype capture', () => {
  it('prints the human summary with the next step', async () => {
    const io = memoryIo(cwd);
    const code = await main(
      ['capture', '--storybook', 'storybook-static', ...STORIES, '--out', 'smoke.holotype.zip'],
      io.io,
      {
        capture: fakeDeps(),
      },
    );
    expect(code).toBe(ExitCode.Ok);
    expect(io.stdout().replace(/\(\d+(?:\.\d)? K?B\)/, '(<size>)')).toMatchInlineSnapshot(`
      "Holotype 0.0.0 · Storybook 10.6.7 (@storybook/react) · Chromium 153.0.8010.12
        ✔ micro-flex        1 variant  0 props  0 warn
        ✔ components-badge  1 variant  0 props  0 warn
      Bundle: smoke.holotype.zip (<size>)
      Next: in Figma, run Plugins ▸ Development ▸ Holotype, open Import file and pick smoke.holotype.zip.
      "
    `);
    expect(io.stderr()).toBe(
      'Storybook 10.6.7 · capturing 2 stories…\n  ✔ micro-flex--row\n  ✔ components-badge--default\n',
    );
  });

  it('prints one RunReport with --json', async () => {
    const io = memoryIo(cwd, { SOURCE_DATE_EPOCH: '1763546400' });
    const code = await main(
      ['capture', '--storybook', 'storybook-static', ...STORIES, '--out', 'smoke.holotype.zip', '--json'],
      io.io,
      {
        capture: fakeDeps(),
      },
    );
    expect(code).toBe(ExitCode.Ok);
    expect(stableJson(io.stdout())).toMatchSnapshot();
  });

  it('prints errors with their fix and help page, and exits 1', async () => {
    const io = memoryIo(cwd);
    const code = await main(
      ['capture', '--storybook', 'sb', '--story', 'micro-flex--row,components-nope--x', '--out', 'b'],
      io.io,
      {
        capture: fakeDeps(),
      },
    );
    expect(code).toBe(ExitCode.Errors);
    const out = io.stdout();
    expect(out).toContain('  ✖ components-nope  SB_STORY_MISSING (see below)');
    expect(out).toContain('    Help: docs/diagnostics/SB_STORY_MISSING.md');
    expect(out).toContain(
      'Next: the Figma plugin imports zip files; run again with --out <name>.holotype.zip to get one.',
    );
  });

  it('exits 3 for a Storybook it cannot reach, with the fix', async () => {
    const io = memoryIo(cwd);
    const unreachable = createDiagnostic(
      diagnostic('SB_INDEX_UNREACHABLE'),
      { url: '/missing' },
      { severity: 'fatal', data: { fatal: true, reason: 'the static build directory does not exist' } },
    );
    const code = await main(['capture', '--storybook', 'missing', ...STORIES], io.io, {
      capture: fakeDeps({ connectError: unreachable }),
    });
    expect(code).toBe(ExitCode.StorybookUnreachable);
    expect(io.stdout()).toMatchInlineSnapshot(`
      "Holotype 0.0.0
      Error:
        ✖ SB_INDEX_UNREACHABLE  Could not load the Storybook index from /missing.
          Why: the static build directory does not exist
          Fix: Check the URL and that Storybook is running. For a static build, run \`storybook build\` and point Holotype at \`storybook-static/\`.
          Help: docs/diagnostics/SB_INDEX_UNREACHABLE.md
      Next: build Storybook (storybook build) or start it, then pass --storybook <dir|url>.
      "
    `);
  });

  it('exits 4 when the browser fails', async () => {
    const io = memoryIo(cwd);
    const code = await main(['capture', '--storybook', 'sb', ...STORIES], io.io, {
      capture: fakeDeps({ throws: new Error('Executable does not exist') }),
    });
    expect(code).toBe(ExitCode.Browser);
    expect(io.stdout()).toContain(
      '✖ The browser could not capture: Executable does not exist\n  Fix: Install the pinned Chromium',
    );
  });

  it('exits 2 on flag errors, with a RunReport under --json', async () => {
    const unknown = memoryIo(cwd);
    expect(await main(['capture', '--colour', '--json'], unknown.io)).toBe(ExitCode.Usage);
    expect(unknown.stderr()).toContain('✖ Unknown flag --colour.');
    expect(JSON.parse(unknown.stdout())).toMatchObject({
      run: { command: 'capture', exitCode: 2 },
      failure: { message: 'Unknown flag --colour.', hint: 'Run holotype capture --help for the flags.' },
    });
    const missing = memoryIo(cwd);
    expect(await main(['capture', '--out'], missing.io)).toBe(ExitCode.Usage);
    expect(missing.stderr()).toContain('✖ --out needs a value.');
    const stray = memoryIo(cwd);
    expect(await main(['capture', 'extra'], stray.io)).toBe(ExitCode.Usage);
    expect(stray.stderr()).toContain('✖ Unexpected argument "extra".');
    const noStory = memoryIo(cwd);
    expect(await main(['capture', '--storybook', 'sb'], noStory.io, { capture: fakeDeps() })).toBe(ExitCode.Usage);
    expect(noStory.stdout()).toContain('PLAN_CONFIG_INVALID');
  });

  it('resolves --cwd against the working directory', async () => {
    const io = memoryIo('/');
    const code = await main(
      ['capture', '--cwd', cwd, '--storybook', 'sb', '--story', 'micro-flex--row', '--out', 'x.holotype.zip', '--json'],
      io.io,
      {
        capture: fakeDeps(),
      },
    );
    expect(code).toBe(ExitCode.Ok);
    expect(JSON.parse(io.stdout()).output.path).toBe(join(cwd, 'x.holotype.zip'));
  });
});

describe('output helpers', () => {
  it('formats sizes, paths and help links', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(displayPath('/a/b/c.zip', '/a')).toBe('b/c.zip');
    expect(displayPath('/x/c.zip', '/a')).toBe('/x/c.zip');
    expect(helpLink('SB_STORY_MISSING')).toBe('docs/diagnostics/SB_STORY_MISSING.md');
    expect(formatDiagnostic({ code: 'NOT_A_CODE', severity: 'error', message: 'Odd.' })).toEqual([
      '✖ NOT_A_CODE  Odd.',
      '  Help: docs/diagnostics/NOT_A_CODE.md',
    ]);
  });

  it('reads SOURCE_DATE_EPOCH', () => {
    expect(sourceDateEpoch({ SOURCE_DATE_EPOCH: '1763546400' })?.toISOString()).toBe('2025-11-19T10:00:00.000Z');
    expect(sourceDateEpoch({ SOURCE_DATE_EPOCH: 'soon' })).toBeUndefined();
    expect(sourceDateEpoch({})).toBeUndefined();
  });
});
