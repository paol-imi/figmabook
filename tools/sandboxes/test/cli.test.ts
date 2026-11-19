import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { listing, parseCommand, USAGE } from '../src/cli.ts';
import { DEFAULT_OUT_ROOT } from '../src/generate.ts';
import { freePort, sandboxEnv, storybookBin } from '../src/setup.ts';

describe('parseCommand', () => {
  it('parses gen with overlays, a version, --out and --build (which implies --install)', () => {
    expect(
      parseCommand([
        'gen',
        'react-vite@10.6',
        '--overlay',
        'faults',
        '--storybook',
        '10.6.2',
        '--out',
        '/tmp/x',
        '--build',
        'static',
      ]),
    ).toEqual({
      command: 'gen',
      template: 'react-vite@10.6',
      overlays: ['faults'],
      storybookVersion: '10.6.2',
      outRoot: '/tmp/x',
      force: false,
      install: true,
      offline: false,
      build: 'static',
    });
  });

  it('defaults to the .out folder, no install', () => {
    expect(parseCommand(['gen', 'react-vite@10.6', '--force'])).toMatchObject({
      outRoot: DEFAULT_OUT_ROOT,
      force: true,
      install: false,
      overlays: [],
    });
    expect(parseCommand(['list'])).toEqual({ command: 'list' });
  });

  it('throws the usage on a bad command line', () => {
    expect(() => parseCommand([])).toThrow(USAGE);
    expect(() => parseCommand(['gen'])).toThrow(USAGE);
    expect(() => parseCommand(['gen', 'a', 'b'])).toThrow(USAGE);
    expect(() => parseCommand(['gen', 'a', '--nope'])).toThrow(/nope/);
  });
});

describe('listing', () => {
  it('lists templates, planned templates with their work item, and overlays', () => {
    const text = listing();
    expect(text).toContain('react-vite@10.6  (Storybook 10.6.7)');
    expect(text).toContain('react-vite@11  (not yet: Storybook 11 beta');
    expect(text).toContain('faults  Failure-injection stories');
  });
});

describe('setup helpers', () => {
  it('drops package-manager variables from the child environment and disables telemetry', () => {
    const env = sandboxEnv({
      PATH: '/bin',
      npm_config_user_agent: 'pnpm',
      PNPM_SCRIPT_SRC_DIR: '/x',
      INIT_CWD: '/y',
      NODE_PATH: '/repo/node_modules/.pnpm/node_modules',
    });
    expect(env).toEqual({ PATH: '/bin', CI: 'true', NO_COLOR: '1', STORYBOOK_DISABLE_TELEMETRY: '1' });
  });

  it('finds a free loopback port', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('explains a sandbox without an install', async () => {
    await expect(storybookBin('/nonexistent/sandbox')).rejects.toThrow(/not installed .*--install/);
  });
});
