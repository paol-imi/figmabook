/**
 * Starts the ds-react Storybook dev server (Vite, branch mode) on a free loopback port, as the CLI
 * will in branch mode (15 §5.1). `sourcemaps: false` runs it with a generated config directory
 * whose `viteFinal` turns `css.devSourcemap` off: the `capture.devSourcemap: 'keep'` case of a
 * project without CSS source maps (16 §capture), used to measure `DCR_PROVENANCE_NO_SOURCEMAP`.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `fixtures/ds-react`, absolute. */
export const FIXTURE_ROOT = fileURLToPath(new URL('../../fixtures/ds-react/', import.meta.url));
/** The repository root, absolute. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface DevServer {
  readonly url: string;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject()));
    });
  });
}

async function storybookBin(): Promise<string> {
  const require = createRequire(join(FIXTURE_ROOT, 'package.json'));
  const manifest = require.resolve('storybook/package.json');
  const { bin } = JSON.parse(await readFile(manifest, 'utf8')) as { bin: string | Record<string, string> };
  const path = typeof bin === 'string' ? bin : bin.storybook;
  if (path === undefined) throw new Error(`S-19: no "storybook" bin in ${manifest}.`);
  return join(dirname(manifest), path);
}

/**
 * A config directory that reuses the fixture's `main.ts` and `preview.tsx` with CSS source maps
 * off. It lives under the fixture's `node_modules` (untracked), so module resolution still finds
 * the fixture's dependencies.
 */
async function noSourcemapConfig(): Promise<string> {
  const dir = join(FIXTURE_ROOT, 'node_modules', '.holotype-s19', 'no-sourcemap');
  await mkdir(dir, { recursive: true });
  const base = join(FIXTURE_ROOT, '.storybook');
  const main = `import base from ${JSON.stringify(join(base, 'main.ts'))};
export default {
  ...base,
  stories: [${JSON.stringify(join(FIXTURE_ROOT, 'src/**/*.stories.@(ts|tsx)'))}],
  viteFinal: async (config, options) => {
    const merged = base.viteFinal ? await base.viteFinal(config, options) : config;
    return { ...merged, css: { ...merged.css, devSourcemap: false } };
  },
};
`;
  await writeFile(join(dir, 'main.ts'), main);
  // Storybook reads the preview's `tags` statically, so the generated preview repeats them.
  const preview = `import base from ${JSON.stringify(join(base, 'preview.tsx'))};
const preview = { ...base, tags: ['figma'] };
export default preview;
`;
  await writeFile(join(dir, 'preview.tsx'), preview);
  return dir;
}

async function waitForIndex(url: string, child: ChildProcess, timeoutMs: number, log: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`S-19: storybook dev exited (${child.exitCode}):\n${log()}`);
    try {
      const response = await fetch(new URL('index.json', url));
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`S-19: storybook dev did not serve index.json within ${timeoutMs} ms:\n${log()}`);
}

export async function startDevServer(options: { sourcemaps?: boolean; timeoutMs?: number } = {}): Promise<DevServer> {
  const port = await freePort();
  const configDir = options.sourcemaps === false ? await noSourcemapConfig() : undefined;
  const args = [await storybookBin(), 'dev', '--port', String(port), '--host', '127.0.0.1', '--exact-port', '--ci'];
  args.push('--no-open', '--quiet', '--no-version-updates');
  if (configDir !== undefined) args.push('--config-dir', configDir);
  const child = spawn(process.execPath, args, {
    cwd: FIXTURE_ROOT,
    env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1', NO_COLOR: '1', CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group: the storybook dispatcher forks the server, and both must stop.
    detached: true,
  });
  let output = '';
  const append = (chunk: Buffer) => {
    output = (output + chunk.toString('utf8')).slice(-8000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const url = `http://127.0.0.1:${port}/`;
  const signal = (name: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, name);
    } catch {
      // already gone
    }
  };
  const close = async () => {
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      signal('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (child.exitCode === null) signal('SIGKILL');
    }
    if (configDir !== undefined) await rm(configDir, { recursive: true, force: true });
  };
  try {
    await waitForIndex(url, child, options.timeoutMs ?? 120_000, () => output);
  } catch (error) {
    await close();
    throw error;
  }
  return { url, close };
}
