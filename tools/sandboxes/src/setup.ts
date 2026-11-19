/**
 * Installs, builds and serves a generated sandbox. The sandbox lives inside the monorepo but is
 * not one of its workspace packages: pnpm runs with `--ignore-workspace`, and the child
 * environment drops the `npm_*` / `PNPM_*` variables and the `NODE_PATH` a parent `pnpm run` sets.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * A child process environment for a sandbox: no inherited package-manager config and no
 * `NODE_PATH` (`pnpm run` points it into the monorepo's store), no telemetry.
 */
export function sandboxEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (/^(npm|pnpm)_/i.test(key) || key === 'INIT_CWD' || key === 'NODE_PATH') continue;
    env[key] = value;
  }
  return { ...env, CI: 'true', NO_COLOR: '1', STORYBOOK_DISABLE_TELEMETRY: '1' };
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command to completion; rejects with its output when it exits non-zero. */
export function run(command: string, args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: sandboxEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code} in ${cwd}:\n${stdout}\n${stderr}`));
    });
  });
}

export interface InstallOptions {
  /** Install from the local pnpm store only (`--offline`). Default: prefer the store. */
  readonly offline?: boolean;
}

/** `pnpm install` in the sandbox, outside the monorepo's workspace. */
export async function installSandbox(dir: string, options: InstallOptions = {}): Promise<void> {
  const mode = options.offline === true ? '--offline' : '--prefer-offline';
  await run('pnpm', ['install', '--ignore-workspace', mode, '--reporter=append-only'], dir);
}

/** The `storybook` CLI entry of the sandbox's own install. */
export async function storybookBin(dir: string): Promise<string> {
  const root = resolve(dir);
  const require = createRequire(join(root, 'package.json'));
  const missing = `Storybook is not installed in ${dir}; run the generator with --install first.`;
  let manifest: string;
  try {
    manifest = require.resolve('storybook/package.json');
  } catch (error) {
    throw new Error(missing, { cause: error });
  }
  // `NODE_PATH` (set by `pnpm run`) can resolve another project's Storybook: only our own counts.
  if (!manifest.startsWith(`${root}${sep}`)) throw new Error(missing);
  const { bin } = JSON.parse(await readFile(manifest, 'utf8')) as { bin?: string | Record<string, string> };
  const entry = typeof bin === 'string' ? bin : bin?.storybook;
  if (entry === undefined) throw new Error(`No "storybook" bin in ${manifest}.`);
  return join(dirname(manifest), entry);
}

/** `storybook build` of the sandbox into `outputDir` (absolute, or relative to the sandbox). */
export async function buildSandbox(dir: string, outputDir: string): Promise<string> {
  const target = resolve(dir, outputDir);
  await run(process.execPath, [await storybookBin(dir), 'build', '--output-dir', target, '--quiet'], dir);
  return target;
}

/** A free TCP port on 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });
}

export interface DevServer {
  /** `http://127.0.0.1:<port>/` */
  readonly url: string;
  readonly port: number;
  /** Output so far, for error messages. */
  output(): string;
  /** Stops the server; resolves once the process exited. Idempotent. */
  stop(): Promise<void>;
}

export interface DevServerOptions {
  readonly port?: number;
  /** How long to wait for `index.json`. Default 120 000 ms. */
  readonly readyTimeoutMs?: number;
}

async function waitForIndex(url: string, child: ChildProcess, timeoutMs: number, output: () => string) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`storybook dev exited with ${child.exitCode}:\n${output()}`);
    const ready = await fetch(new URL('index.json', url)).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`storybook dev did not serve index.json within ${timeoutMs} ms:\n${output()}`);
}

/** Starts `storybook dev` on 127.0.0.1 and resolves once `index.json` is served. */
export async function startDevServer(dir: string, options: DevServerOptions = {}): Promise<DevServer> {
  const port = options.port ?? (await freePort());
  const args = [await storybookBin(dir), 'dev', '--port', String(port), '--host', '127.0.0.1', '--ci', '--no-open'];
  const child = spawn(process.execPath, [...args, '--exact-port'], {
    cwd: dir,
    env: sandboxEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const append = (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-20_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const exited = new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()));
  const url = `http://127.0.0.1:${port}/`;
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  };
  try {
    await waitForIndex(url, child, options.readyTimeoutMs ?? 120_000, () => log);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, port, output: () => log, stop };
}
